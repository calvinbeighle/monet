// Context linking service (spec 09) - assigns new activities to workstreams in real-time
// Fast-path: deterministic matching (same thread, same repo+branch)
// Slow-path: AI evaluation via backend proxy

import { apiPost } from "./api-client";
import { useActivityStore } from "../stores/activity-store";
import { useWorkstreamStore } from "../stores/workstream-store";
import { useAppStore } from "../stores/app-store";
import type { ActivityRecord, Workstream } from "../types";

type LinkResponse = {
  workstreamId: string | null;
  confidence: number;
  rationale: string;
  error?: string;
};

// Batch window: collect activities for 5 seconds before sending to AI
const BATCH_WINDOW_MS = 5000;
let batchQueue: ActivityRecord[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Evaluate a new or updated activity for workstream assignment.
 * Fast-path checks first, then batches for AI evaluation.
 */
export function evaluateActivity(activity: ActivityRecord): void {
  // Skip if user manually assigned/excluded
  if (activity.userOverride) return;
  // Skip if already assigned with high confidence
  if (activity.workstreamId) return;

  // Try fast-path deterministic matching
  const fastResult = fastPathMatch(activity);
  if (fastResult) {
    assignToWorkstream(
      activity,
      fastResult.workstreamId,
      fastResult.confidence,
      fastResult.rationale,
    );
    return;
  }

  // Queue for AI batch evaluation
  batchQueue.push(activity);
  if (!batchTimer) {
    batchTimer = setTimeout(() => {
      const batch = [...batchQueue];
      batchQueue = [];
      batchTimer = null;
      processBatch(batch).catch((err) =>
        console.error("[ai-linking] Batch processing error:", err),
      );
    }, BATCH_WINDOW_MS);
  }
}

/**
 * Fast-path deterministic matching - no AI call needed.
 */
function fastPathMatch(
  activity: ActivityRecord,
): { workstreamId: string; confidence: number; rationale: string } | null {
  const workstreamStore = useWorkstreamStore.getState();
  const activityStore = useActivityStore.getState();
  const workstreams = [...workstreamStore.workstreams.values()];

  // 1. Same Gmail thread ID
  if (activity.source === "gmail" && activity.metadata.threadId) {
    const threadId = activity.metadata.threadId as string;
    for (const ws of workstreams) {
      for (const memberActId of ws.activityIds) {
        const memberAct = activityStore.getActivity(memberActId);
        if (
          memberAct?.source === "gmail" &&
          memberAct.metadata.threadId === threadId
        ) {
          return {
            workstreamId: ws.id,
            confidence: 1.0,
            rationale: `Same Gmail thread (${threadId})`,
          };
        }
      }
    }
  }

  // 2. Same git repo + branch
  if (activity.source === "git" && activity.metadata.branch) {
    const branch = activity.metadata.branch as string;
    const repo = activity.metadata.repo as string | undefined;
    for (const ws of workstreams) {
      for (const memberActId of ws.activityIds) {
        const memberAct = activityStore.getActivity(memberActId);
        if (
          memberAct?.source === "git" &&
          memberAct.metadata.branch === branch &&
          (!repo || memberAct.metadata.repo === repo)
        ) {
          return {
            workstreamId: ws.id,
            confidence: 0.9,
            rationale: `Same git repo/branch (${branch})`,
          };
        }
      }
    }
  }

  // 3. Same calendar event series
  if (activity.source === "google-calendar" && activity.metadata.seriesId) {
    const seriesId = activity.metadata.seriesId as string;
    for (const ws of workstreams) {
      for (const memberActId of ws.activityIds) {
        const memberAct = activityStore.getActivity(memberActId);
        if (
          memberAct?.source === "google-calendar" &&
          memberAct.metadata.seriesId === seriesId
        ) {
          return {
            workstreamId: ws.id,
            confidence: 1.0,
            rationale: `Same calendar event series (${seriesId})`,
          };
        }
      }
    }
  }

  return null;
}

/**
 * Process a batch of activities through the AI linking endpoint.
 */
async function processBatch(activities: ActivityRecord[]): Promise<void> {
  const workstreamStore = useWorkstreamStore.getState();
  const workstreams = [...workstreamStore.workstreams.values()];

  if (workstreams.length === 0) {
    // No workstreams to link to yet
    return;
  }

  // Process each activity individually (the API takes one at a time)
  // but we can send them in sequence within the batch window
  for (const activity of activities) {
    // Re-check: may have been assigned by fast-path during batch wait
    const current = useActivityStore
      .getState()
      .getActivity(activity.activityId);
    if (current?.workstreamId || current?.userOverride) continue;

    try {
      await linkSingleActivity(activity, workstreams);
    } catch (err) {
      console.error(
        `[ai-linking] Failed to link activity ${activity.activityId}:`,
        err,
      );
      // Leave unassigned on failure - will be re-evaluated next cycle
    }
  }
}

/**
 * Link a single activity to a workstream via AI evaluation.
 */
async function linkSingleActivity(
  activity: ActivityRecord,
  workstreams: Workstream[],
): Promise<void> {
  // Rank candidates by participant overlap, take top 5
  const candidates = rankCandidates(activity, workstreams).slice(0, 5);

  if (candidates.length === 0) return;

  const result = await apiPost<LinkResponse>("/ai/link", {
    activity: {
      activityId: activity.activityId,
      source: activity.source,
      title: activity.title,
      participants: activity.participants.map((p) => ({
        email: p.email,
        displayName: p.displayName,
      })),
      timestamp: activity.timestamp,
      labels: activity.labels,
      preview: activity.preview.substring(0, 200),
    },
    candidates: candidates.map((c) => ({
      workstreamId: c.id,
      name: c.name,
      description: c.description,
      recentActivityTitles: getRecentActivityTitles(c, 5),
      participants: c.participants.map((p) => p.email),
    })),
  });

  if (result.error) {
    console.error("[ai-linking] API returned error:", result.error);
    return;
  }

  if (result.workstreamId && result.confidence >= 0.4) {
    assignToWorkstream(
      activity,
      result.workstreamId,
      result.confidence,
      result.rationale,
    );
  }
}

/**
 * Rank candidate workstreams by participant overlap with the activity.
 */
function rankCandidates(
  activity: ActivityRecord,
  workstreams: Workstream[],
): Workstream[] {
  const activityEmails = new Set(activity.participants.map((p) => p.email));

  const scored = workstreams
    .filter((ws) => ws.status !== "archived")
    .map((ws) => {
      const wsEmails = ws.participants.map((p) => p.email);
      const overlap = wsEmails.filter((e) => activityEmails.has(e)).length;
      const overlapScore = wsEmails.length > 0 ? overlap / wsEmails.length : 0;

      // Also factor in recency
      const recencyScore =
        1 /
        (1 + (Date.now() - ws.lastActivityTimestamp) / (24 * 60 * 60 * 1000));

      return { ws, score: overlapScore * 0.7 + recencyScore * 0.3 };
    })
    .sort((a, b) => b.score - a.score);

  return scored.map((s) => s.ws);
}

/**
 * Get recent activity titles for a workstream (for AI context).
 */
function getRecentActivityTitles(ws: Workstream, count: number): string[] {
  const activityStore = useActivityStore.getState();
  const activities = ws.activityIds
    .map((id) => activityStore.getActivity(id))
    .filter((a): a is ActivityRecord => a !== undefined)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, count);

  return activities.map((a) => a.title);
}

/**
 * Assign an activity to a workstream and update stores.
 */
function assignToWorkstream(
  activity: ActivityRecord,
  workstreamId: string,
  confidence: number,
  rationale: string,
): void {
  const activityStore = useActivityStore.getState();
  const workstreamStore = useWorkstreamStore.getState();
  const appStore = useAppStore.getState();

  // Update activity
  activityStore.setActivityWorkstream(activity.activityId, workstreamId, false);

  // Add to workstream (triggers derived field recomputation)
  const ws = workstreamStore.getWorkstream(workstreamId);
  if (ws && !ws.activityIds.includes(activity.activityId)) {
    workstreamStore.addActivityToWorkstream(workstreamId, activity);
  }

  // Notify if confident assignment
  if (confidence >= 0.7) {
    const wsName = ws?.name ?? "workstream";
    appStore.addNotification(
      `New activity linked to "${wsName}": ${activity.title}`,
      "info",
    );
  }

  console.log(
    `[ai-linking] Assigned ${activity.activityId} to ${workstreamId} (confidence: ${confidence}, rationale: ${rationale})`,
  );
}

/**
 * Re-evaluate uncertain assignments (confidence < 0.7) in a workstream.
 * Called when workstreams merge/split.
 */
export async function relinkUncertainActivities(
  workstreamId: string,
): Promise<void> {
  const workstreamStore = useWorkstreamStore.getState();
  const activityStore = useActivityStore.getState();
  const ws = workstreamStore.getWorkstream(workstreamId);
  if (!ws) return;

  const workstreams = [...workstreamStore.workstreams.values()];

  for (const activityId of ws.activityIds) {
    const activity = activityStore.getActivity(activityId);
    if (!activity || activity.userOverride) continue;

    try {
      await linkSingleActivity(activity, workstreams);
    } catch (err) {
      console.error(`[ai-linking] Re-link failed for ${activityId}:`, err);
    }
  }
}
