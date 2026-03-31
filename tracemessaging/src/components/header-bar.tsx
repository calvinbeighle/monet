import { useAppStore } from "../lib/stores";
import { useWorkstreamStore } from "../lib/stores";
import { useActivityStore } from "../lib/stores";
import type { ConnectivityStatus } from "../lib/types";

function SyncIndicator({ status }: { status: ConnectivityStatus }) {
  const colors: Record<ConnectivityStatus, string> = {
    connected: "bg-green-500",
    syncing: "bg-yellow-500 animate-pulse",
    error: "bg-red-500",
    offline: "bg-gray-500",
  };

  const labels: Record<ConnectivityStatus, string> = {
    connected: "synced",
    syncing: "syncing...",
    error: "sync error",
    offline: "offline",
  };

  return (
    <div className="flex items-center gap-1.5 text-[0.7rem] uppercase tracking-widest text-[rgba(255,255,255,0.3)]">
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
  const activeCount = useWorkstreamStore(
    (s) => s.getActiveWorkstreams().length,
  );
  const unassignedCount = useActivityStore(
    (s) => s.getUnassignedActivities().length,
  );

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-[rgba(255,255,255,0.06)] bg-[#0a0a0b] px-8 backdrop-blur-xl">
      <div className="flex items-center gap-6">
        <button
          onClick={() => navigate({ view: "timeline" })}
          className="cursor-pointer border-none bg-transparent font-serif text-[1.4rem] font-normal tracking-tight text-[rgba(255,255,255,0.92)]"
        >
          trace<span className="text-[#c8f06a]">.</span>
        </button>
        <SyncIndicator status={syncStatus} />
      </div>

      <div className="flex items-center gap-4">
        {currentRoute.view === "timeline" && (
          <input
            type="text"
            className="w-56 rounded-md border border-[rgba(255,255,255,0.06)] bg-[#111113] px-3 py-1.5 font-mono text-[0.75rem] text-[rgba(255,255,255,0.55)] outline-none transition-colors placeholder:text-[rgba(255,255,255,0.3)] focus:border-[rgba(255,255,255,0.12)]"
            placeholder="Search workstreams..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        )}

        <div className="flex gap-5 text-[0.7rem] uppercase tracking-wider">
          <span className="text-[rgba(255,255,255,0.3)]">
            <strong className="font-medium text-[rgba(255,255,255,0.55)]">
              {activeCount}
            </strong>{" "}
            active
          </span>
          {unassignedCount > 0 && (
            <span className="text-[rgba(255,255,255,0.3)]">
              <strong className="font-medium text-[rgba(255,255,255,0.55)]">
                {unassignedCount}
              </strong>{" "}
              unassigned
            </span>
          )}
        </div>

        <button
          onClick={() => navigate({ view: "settings" })}
          className="cursor-pointer border-none bg-transparent text-[0.8rem] text-[rgba(255,255,255,0.3)] transition-colors hover:text-[rgba(255,255,255,0.55)]"
        >
          settings
        </button>
      </div>
    </header>
  );
}
