// Workstream detection service (spec 07) - clusters activities into workstreams
// Runs after initial data load and re-evaluates every 5 minutes

import { apiPost } from "./api-client";
import { useActivityStore } from "../stores/activity-store";
import { useWorkstreamStore } from "../stores/workstream-store";
import { useAppStore } from "../stores/app-store";
import { createWorkstream } from "../types/workstream";
import type { ActivityRecord, Workstream } from "../types";

type DetectResponse = {
  workstreams: Array<{
    name: string;
    description: string;
    activityIds: string[];
    confidence: number;
    rationale: string;
    participants: string[];
  }>;
  error?: string;
};

// Re-evaluation interval: 5 minutes
const DETECT_INTERVAL_MS = 5 * 60 * 1000;
let detectTimer: ReturnType<typeof setInterval> | null = null;
let lastDetectTimestamp = 0;

// Prepare activity records for the AI - send only titles/participants/timestamps/labels
function prepareActivitiesForDetect(activities: ActivityRecord[]) {
  return activities.map((a) => ({
    activityId: a.activityId,
    source: a.source,
    title: a.title,
    participants: a.participants.map((p) => ({
      email: p.email,
      displayName: p.displayName,
    })),
    timestamp: a.timestamp,
    labels: a.labels,
    preview: a.preview.substring(0, 100),
  }));
}

/**
 * Run workstream detection on all unassigned activities + recent activities.
 * Creates/updates workstreams in the store based on AI clustering.
 */
export async function detectWorkstreams(): Promise<void> {
  const activityStore = useActivityStore.getState();
  const workstreamStore = useWorkstreamStore.getState();
  const appStore = useAppStore.getState();

  // Gather: all unassigned + last 24h of assigned activities for re-evaluation
  const allActivities = [...activityStore.activities.values()];
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;

  const unassigned = allActivities.filter(
    (a) => !a.workstreamId && !a.userOverride,
  );
  const recentAssigned = allActivities.filter(
    (a) =>
      a.workstreamId && a.timestamp >= twentyFourHoursAgo && !a.userOverride,
  );

  const toEvaluate = [...unassigned, ...recentAssigned];

  if (toEvaluate.length < 2) {
    // Need at least 2 activities to form a workstream
    return;
  }

  const prepared = prepareActivitiesForDetect(toEvaluate);

  try {
    const result = await apiPost<DetectResponse>("/ai/detect", {
      activities: prepared,
    });

    if (result.error) {
      console.error("[ai-detection] API returned error:", result.error);
      appStore.addNotification(
        "AI workstream detection unavailable",
        "warning",
      );
      return;
    }

    if (!result.workstreams || result.workstreams.length === 0) {
      return;
    }

    // Process each detected workstream
    const existingWorkstreams = [...workstreamStore.workstreams.values()];

    for (const detected of result.workstreams) {
      // Try to match with existing workstream by activity overlap
      const matchedExisting = findMatchingWorkstream(
        detected.activityIds,
        existingWorkstreams,
      );

      if (matchedExisting) {
        // Update existing workstream - add new activities, update AI fields
        const newActivityIds = detected.activityIds.filter(
          (id) => !matchedExisting.activityIds.includes(id),
        );

        for (const activityId of newActivityIds) {
          const activity = activityStore.getActivity(activityId);
          if (activity) {
            workstreamStore.addActivityToWorkstream(
              matchedExisting.id,
              activity,
            );
            activityStore.setActivityWorkstream(
              activityId,
              matchedExisting.id,
              false,
            );
          }
        }

        // Update AI fields
        workstreamStore.updateWorkstream(matchedExisting.id, {
          confidence: detected.confidence,
          rationale: detected.rationale,
          description: detected.description,
          name: detected.name, // AI can update name if it's better
        });
      } else {
        // Create new workstream
        const wsId = crypto.randomUUID();
        const ws = createWorkstream(wsId, detected.name, {
          description: detected.description,
          confidence: detected.confidence,
          rationale: detected.rationale,
          activityIds: detected.activityIds,
        });

        workstreamStore.setWorkstream(ws);

        // Assign activities to the new workstream
        for (const activityId of detected.activityIds) {
          const activity = activityStore.getActivity(activityId);
          if (activity && !activity.userOverride) {
            activityStore.setActivityWorkstream(activityId, wsId, false);
            // Add to workstream (triggers derived recomputation)
            workstreamStore.addActivityToWorkstream(wsId, activity);
          }
        }
      }
    }

    lastDetectTimestamp = Date.now();
  } catch (err) {
    console.error("[ai-detection] Detection failed:", err);
    // Preserve existing assignments on failure
    appStore.addNotification(
      "AI workstream detection failed - using cached data",
      "warning",
    );
  }
}

/**
 * Find an existing workstream that overlaps significantly with detected activity IDs.
 * Match if >50% of detected activities are already in an existing workstream.
 */
function findMatchingWorkstream(
  detectedActivityIds: string[],
  existingWorkstreams: Workstream[],
): Workstream | undefined {
  let bestMatch: Workstream | undefined;
  let bestOverlap = 0;

  for (const ws of existingWorkstreams) {
    const overlap = detectedActivityIds.filter((id) =>
      ws.activityIds.includes(id),
    ).length;
    const overlapRatio = overlap / detectedActivityIds.length;

    if (overlapRatio > 0.5 && overlap > bestOverlap) {
      bestOverlap = overlap;
      bestMatch = ws;
    }
  }

  return bestMatch;
}

/**
 * Start periodic workstream detection (every 5 minutes).
 */
export function startDetection(): void {
  if (detectTimer) return;
  detectTimer = setInterval(() => {
    detectWorkstreams().catch((err) =>
      console.error("[ai-detection] Periodic detection error:", err),
    );
  }, DETECT_INTERVAL_MS);
}

/**
 * Stop periodic workstream detection.
 */
export function stopDetection(): void {
  if (detectTimer) {
    clearInterval(detectTimer);
    detectTimer = null;
  }
}

/**
 * Get the timestamp of the last successful detection run.
 */
export function getLastDetectTimestamp(): number {
  return lastDetectTimestamp;
}
