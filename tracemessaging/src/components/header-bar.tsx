import { useAppStore } from "@/lib/stores";
import { useWorkstreamStore } from "@/lib/stores";
import { useActivityStore } from "@/lib/stores";
import type { ConnectivityStatus } from "@/lib/types";

function SyncIndicator({ status }: { status: ConnectivityStatus }) {
  const colors: Record<ConnectivityStatus, string> = {
    connected: "bg-[var(--urgency-low)]",
    syncing: "bg-[var(--urgency-medium)] animate-pulse",
    error: "bg-[var(--urgency-high)]",
    offline: "bg-[rgba(255,255,255,0.2)]",
  };

  const labels: Record<ConnectivityStatus, string> = {
    connected: "synced",
    syncing: "syncing...",
    error: "sync error",
    offline: "offline",
  };

  return (
    <div
      className="flex items-center gap-1.5 text-[0.75rem] uppercase tracking-widest text-[var(--text-tertiary)]"
      style={{ fontFamily: "var(--font-body)" }}
    >
      <div className={`h-1.5 w-1.5 rounded-full ${colors[status]}`} />
      {labels[status]}
    </div>
  );
}

export function HeaderBar() {
  const syncStatus = useAppStore((s) => s.syncStatus);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const currentRoute = useAppStore((s) => s.currentRoute);
  const navigate = useAppStore((s) => s.navigate);
  const workstreams = useWorkstreamStore((s) => s.workstreams);
  const activities = useActivityStore((s) => s.activities);

  const activeCount = [...workstreams.values()].filter(
    (ws) => ws.status === "active",
  ).length;
  const unassignedCount = [...activities.values()].filter(
    (a) => a.workstreamId === null,
  ).length;

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-root)] px-6 backdrop-blur-xl sm:px-8">
      <div className="flex items-center gap-5">
        <button
          onClick={() => navigate({ view: "timeline" })}
          className="cursor-pointer border-none bg-transparent tracking-tight text-[var(--text-primary)]"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "1.3rem",
            fontStyle: "italic",
          }}
        >
          trace<span style={{ color: "var(--text-tertiary)" }}>.</span>
        </button>
        <SyncIndicator status={syncStatus} />
      </div>

      <div className="flex items-center gap-4">
        {currentRoute.view === "timeline" && (
          <input
            type="text"
            className="w-48 rounded-sm border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-1.5 text-[0.8rem] text-[var(--text-secondary)] outline-none transition-colors placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-hover)]"
            style={{ fontFamily: "var(--font-body)" }}
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        )}

        <div
          className="flex gap-4 text-[0.75rem] uppercase tracking-wider"
          style={{ fontFamily: "var(--font-body)" }}
        >
          <span className="text-[var(--text-tertiary)]">
            <strong className="font-semibold text-[var(--text-secondary)]">
              {activeCount}
            </strong>{" "}
            active
          </span>
          {unassignedCount > 0 && (
            <span className="text-[var(--text-tertiary)]">
              <strong className="font-semibold text-[var(--text-secondary)]">
                {unassignedCount}
              </strong>{" "}
              triage
            </span>
          )}
        </div>

        <button
          onClick={() => navigate({ view: "settings" })}
          className="cursor-pointer border-none bg-transparent text-[0.85rem] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          settings
        </button>
      </div>
    </header>
  );
}
