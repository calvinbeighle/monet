// AI summary service (spec 12) - per-workstream summary generation
// Triggers: creation, new activity, user refresh, cache >30min old
// Debounce: 60-second window after LAST activity arrives

import { apiPost } from "./api-client";
import { useActivityStore } from "../stores/activity-store";
import { useWorkstreamStore } from "../stores/workstream-store";
import type {
  ActivityRecord,
  WorkstreamSummary,
  RecommendedAction,
  UrgencyLevel,
} from "../types";

type SummarizeResponse = {
  statusSummary: string;
  keyDevelopments: string[];
  recommendedAction: {
    type: string;
    description: string;
    targetActivityId: string | null;
    confidence: number;
  };
  urgency: string;
  generatedAt: number;
  error?: string;
};

// Cache TTL: 30 minutes
const CACHE_TTL_MS = 30 * 60 * 1000;

// Debounce: 60 seconds after last activity
const DEBOUNCE_MS = 60 * 1000;

// Track pending debounce timers per workstream
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Track in-flight requests to avoid duplicates
const inFlightRequests = new Set<string>();

/**
 * Request a summary for a workstream.
 * Debounces multiple calls within 60 seconds.
 * Set immediate=true to bypass debounce (user refresh).
 */
export function requestSummary(workstreamId: string, immediate = false): void {
  if (immediate) {
    // Cancel any pending debounce
    const existingTimer = debounceTimers.get(workstreamId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      debounceTimers.delete(workstreamId);
    }
    generateSummary(workstreamId).catch((err) =>
      console.error(
        `[ai-summary] Immediate generation failed for ${workstreamId}:`,
        err,
      ),
    );
    return;
  }

  // Debounce: reset timer on each call
  const existingTimer = debounceTimers.get(workstreamId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  debounceTimers.set(
    workstreamId,
    setTimeout(() => {
      debounceTimers.delete(workstreamId);
      generateSummary(workstreamId).catch((err) =>
        console.error(
          `[ai-summary] Debounced generation failed for ${workstreamId}:`,
          err,
        ),
      );
    }, DEBOUNCE_MS),
  );
}

/**
 * Check if a workstream's summary needs refresh (>30min old or missing).
 */
export function needsRefresh(workstreamId: string): boolean {
  const ws = useWorkstreamStore.getState().getWorkstream(workstreamId);
  if (!ws) return false;
  if (!ws.summary) return true;
  return Date.now() - ws.summary.generatedAt > CACHE_TTL_MS;
}

/**
 * Refresh all stale summaries (called periodically).
 */
export async function refreshStaleSummaries(): Promise<void> {
  const workstreamStore = useWorkstreamStore.getState();
  const workstreams = [...workstreamStore.workstreams.values()];

  for (const ws of workstreams) {
    if (ws.status === "archived") continue;
    if (needsRefresh(ws.id)) {
      requestSummary(ws.id);
    }
  }
}

/**
 * Generate a summary for a workstream via the AI proxy.
 */
async function generateSummary(workstreamId: string): Promise<void> {
  // Avoid duplicate in-flight requests
  if (inFlightRequests.has(workstreamId)) return;
  inFlightRequests.add(workstreamId);

  try {
    const workstreamStore = useWorkstreamStore.getState();
    const activityStore = useActivityStore.getState();
    const ws = workstreamStore.getWorkstream(workstreamId);

    if (!ws) return;

    // Get member activities
    const activities = ws.activityIds
      .map((id) => activityStore.getActivity(id))
      .filter((a): a is ActivityRecord => a !== undefined)
      .sort((a, b) => b.timestamp - a.timestamp);

    if (activities.length === 0) return;

    // Prepare activities for AI (titles/participants/timestamps/previews only)
    const preparedActivities = activities.map((a) => ({
      activityId: a.activityId,
      source: a.source,
      title: a.title,
      timestamp: a.timestamp,
      preview: a.preview.substring(0, 150),
      participants: a.participants.map((p) => ({
        email: p.email,
        displayName: p.displayName,
      })),
    }));

    const result = await apiPost<SummarizeResponse>("/ai/summarize", {
      workstream: {
        name: ws.name,
        description: ws.description,
        participants: ws.participants.map((p) => p.email),
      },
      activities: preparedActivities,
      previousSummary: ws.summary?.statusSummary ?? null,
      crmContext: ws.participants
        .filter((p) => p.enrichment)
        .map((p) => ({
          email: p.email,
          company: p.enrichment?.organization ?? "",
          dealNames: p.enrichment?.dealNames ?? [],
          lifecycleStage: p.enrichment?.lifecycleStage ?? "",
        })),
    });

    if (result.error) {
      console.error("[ai-summary] API returned error:", result.error);
      // Keep stale cached summary
      return;
    }

    // Validate and normalize the response
    const summary: WorkstreamSummary = {
      statusSummary: result.statusSummary || "Summary unavailable.",
      keyDevelopments: Array.isArray(result.keyDevelopments)
        ? result.keyDevelopments.slice(0, 3)
        : [],
      recommendedAction: normalizeAction(result.recommendedAction),
      urgency: normalizeUrgency(result.urgency),
      generatedAt: result.generatedAt || Date.now(),
    };

    // Update workstream in store
    workstreamStore.updateWorkstream(workstreamId, { summary });

    console.log(
      `[ai-summary] Generated summary for "${ws.name}" (urgency: ${summary.urgency})`,
    );
  } finally {
    inFlightRequests.delete(workstreamId);
  }
}

function normalizeAction(
  raw: SummarizeResponse["recommendedAction"],
): RecommendedAction {
  const validTypes = new Set([
    "reply-email",
    "schedule-meeting",
    "review-document",
    "follow-up",
    "archive-workstream",
    "no-action",
  ]);

  return {
    type: validTypes.has(raw?.type)
      ? (raw.type as RecommendedAction["type"])
      : "no-action",
    description: raw?.description || "No action needed",
    targetActivityId: raw?.targetActivityId ?? null,
    confidence:
      typeof raw?.confidence === "number"
        ? Math.max(0, Math.min(1, raw.confidence))
        : 0.5,
  };
}

function normalizeUrgency(raw: string): UrgencyLevel {
  if (raw === "high" || raw === "medium" || raw === "low") return raw;
  return "low";
}

/**
 * Clean up all pending timers.
 */
export function stopSummaryService(): void {
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
}
