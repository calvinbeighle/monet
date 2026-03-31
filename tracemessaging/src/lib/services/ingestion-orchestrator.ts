import type { SourceType } from "@/lib/types";
import type { ActivityRecord } from "@/lib/types";
import { useActivityStore } from "@/lib/stores/activity-store";
import { useWorkstreamStore } from "@/lib/stores/workstream-store";
import { useAppStore } from "@/lib/stores/app-store";
import { fetchGmailActivities } from "./gmail-ingestion";
import { fetchArcActivities } from "./arc-ingestion";
import { fetchCalendarActivities } from "./calendar-ingestion";
import { fetchGitActivities } from "./git-ingestion";
import { fetchClaudeSessionActivities } from "./claude-sessions-ingestion";
import {
  detectWorkstreams,
  startDetection,
  stopDetection,
} from "./ai-detection";
import { evaluateActivity } from "./ai-linking";
import {
  requestSummary,
  refreshStaleSummaries,
  stopSummaryService,
} from "./ai-summary";

interface IngestionSource {
  name: SourceType;
  fetch: () => Promise<ActivityRecord[]>;
  intervalMs: number;
  timerId?: ReturnType<typeof setInterval>;
}

const sources: IngestionSource[] = [
  { name: "gmail", fetch: fetchGmailActivities, intervalMs: 30_000 },
  { name: "arc-browser", fetch: fetchArcActivities, intervalMs: 60_000 },
  {
    name: "google-calendar",
    fetch: fetchCalendarActivities,
    intervalMs: 300_000,
  },
  { name: "git", fetch: fetchGitActivities, intervalMs: 300_000 },
  {
    name: "claude-code",
    fetch: fetchClaudeSessionActivities,
    intervalMs: 300_000,
  },
];

// Track whether initial detection has run
let initialDetectionDone = false;
// Summary refresh timer
let summaryRefreshTimer: ReturnType<typeof setInterval> | null = null;

async function runSource(source: IngestionSource): Promise<void> {
  const appStore = useAppStore.getState();
  appStore.updateSourceSync(source.name, { status: "syncing", error: null });

  try {
    const activities = await source.fetch();
    const activityStore = useActivityStore.getState();

    // Track which activities are new (for context linking)
    const existingIds = new Set([...activityStore.activities.keys()]);
    activityStore.addActivities(activities);

    // Evaluate new activities via context linking (after initial detection)
    if (initialDetectionDone) {
      const newActivities = activities.filter(
        (a) => !existingIds.has(a.activityId),
      );
      for (const activity of newActivities) {
        evaluateActivity(activity);
      }

      // Request summary refresh for affected workstreams
      const affectedWorkstreamIds = new Set<string>();
      for (const activity of newActivities) {
        const current = activityStore.getActivity(activity.activityId);
        if (current?.workstreamId) {
          affectedWorkstreamIds.add(current.workstreamId);
        }
      }
      for (const wsId of affectedWorkstreamIds) {
        requestSummary(wsId);
      }
    }

    useAppStore.getState().updateSourceSync(source.name, {
      status: "connected",
      lastSyncAt: Date.now(),
      itemCount: activities.length,
      error: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[ingestion-orchestrator] source "${source.name}" failed:`,
      err,
    );
    useAppStore.getState().updateSourceSync(source.name, {
      status: "error",
      error: msg,
    });
  }
}

export function startIngestion(): void {
  // Initial parallel fetch for all sources, then run AI detection
  void Promise.all(sources.map((source) => runSource(source))).then(
    async () => {
      const activityCount = useActivityStore.getState().getActivityCount();
      if (activityCount > 0) {
        useAppStore.getState().setDataState("loaded");
      }

      // Run initial workstream detection after all sources have loaded
      try {
        await detectWorkstreams();
        initialDetectionDone = true;

        // Generate initial summaries for all detected workstreams
        const workstreams = [
          ...useWorkstreamStore.getState().workstreams.values(),
        ];
        for (const ws of workstreams) {
          requestSummary(ws.id);
        }
      } catch (err) {
        console.error(
          "[ingestion-orchestrator] Initial detection failed:",
          err,
        );
        initialDetectionDone = true; // Still allow linking to proceed
      }

      // Start periodic detection (every 5 minutes)
      startDetection();

      // Start periodic summary refresh (every 5 minutes)
      summaryRefreshTimer = setInterval(
        () => {
          refreshStaleSummaries().catch((err) =>
            console.error(
              "[ingestion-orchestrator] Summary refresh failed:",
              err,
            ),
          );
        },
        5 * 60 * 1000,
      );
    },
  );

  // Set up per-source polling intervals
  for (const source of sources) {
    source.timerId = setInterval(() => {
      void runSource(source);
    }, source.intervalMs);
  }
}

export function stopIngestion(): void {
  for (const source of sources) {
    if (source.timerId !== undefined) {
      clearInterval(source.timerId);
      source.timerId = undefined;
    }
  }
  stopDetection();
  stopSummaryService();
  if (summaryRefreshTimer) {
    clearInterval(summaryRefreshTimer);
    summaryRefreshTimer = null;
  }
  initialDetectionDone = false;
}

// Singleton: export bound functions directly
const ingestionOrchestrator = { startIngestion, stopIngestion };
export default ingestionOrchestrator;
