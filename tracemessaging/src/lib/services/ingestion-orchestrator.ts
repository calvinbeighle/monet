import type { SourceType } from "@/lib/types";
import type { ActivityRecord } from "@/lib/types";
import { useActivityStore } from "@/lib/stores/activity-store";
import { useAppStore } from "@/lib/stores/app-store";
import { fetchGmailActivities } from "./gmail-ingestion";
import { fetchArcActivities } from "./arc-ingestion";
import { fetchCalendarActivities } from "./calendar-ingestion";
import { fetchGitActivities } from "./git-ingestion";
import { fetchClaudeSessionActivities } from "./claude-sessions-ingestion";

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

async function runSource(source: IngestionSource): Promise<void> {
  const appStore = useAppStore.getState();
  appStore.updateSourceSync(source.name, { status: "syncing", error: null });

  try {
    const activities = await source.fetch();
    useActivityStore.getState().addActivities(activities);
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
  // Initial parallel fetch for all sources, transition to loaded when done
  void Promise.all(sources.map((source) => runSource(source))).then(() => {
    const activityCount = useActivityStore.getState().getActivityCount();
    if (activityCount > 0) {
      useAppStore.getState().setDataState("loaded");
    }
  });

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
}

// Singleton: export bound functions directly
const ingestionOrchestrator = { startIngestion, stopIngestion };
export default ingestionOrchestrator;
