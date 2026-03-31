import { useWorkstreamStore } from "../../lib/stores";
import { useActivityStore } from "../../lib/stores";
import { useAppStore } from "../../lib/stores";
import type { Workstream } from "../../lib/types";

export function WorkstreamTimeline() {
  const sortedWorkstreams = useWorkstreamStore((s) => s.getSortedWorkstreams());
  const unassigned = useActivityStore((s) => s.getUnassignedActivities());
  const searchQuery = useAppStore((s) => s.searchQuery);
  const navigate = useAppStore((s) => s.navigate);

  const filtered = searchQuery
    ? sortedWorkstreams.filter(
        (ws) =>
          ws.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          ws.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
          ws.participants.some((p) =>
            p.displayName.toLowerCase().includes(searchQuery.toLowerCase()),
          ),
      )
    : sortedWorkstreams;

  const active = filtered.filter((ws) => ws.status === "active");
  const stale = filtered.filter((ws) => ws.status === "stale");

  if (active.length === 0 && stale.length === 0 && unassigned.length === 0) {
    return (
      <div className="mx-auto max-w-[800px] px-8 pt-16 text-center">
        <p className="font-serif text-[1.2rem] text-[rgba(255,255,255,0.45)]">
          No workstreams yet
        </p>
        <p className="mt-2 font-mono text-[0.75rem] text-[rgba(255,255,255,0.25)]">
          Connect your data sources to start organizing your work by context.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[800px] px-8 py-6">
      {/* Active section */}
      {active.length > 0 && (
        <>
          <SectionHeader label="Active" count={active.length} />
          {active.map((ws) => (
            <WorkstreamCard
              key={ws.id}
              workstream={ws}
              onClick={() => navigate({ view: "detail", workstreamId: ws.id })}
            />
          ))}
        </>
      )}

      {/* Stale section */}
      {stale.length > 0 && (
        <>
          <SectionHeader label="Stale" count={stale.length} />
          {stale.map((ws) => (
            <WorkstreamCard
              key={ws.id}
              workstream={ws}
              onClick={() => navigate({ view: "detail", workstreamId: ws.id })}
              stale
            />
          ))}
        </>
      )}

      {/* Unassigned section */}
      {unassigned.length > 0 && (
        <>
          <SectionHeader label="Unassigned" count={unassigned.length} />
          {unassigned.map((activity) => (
            <div
              key={activity.activityId}
              className="mb-1 flex cursor-pointer items-center justify-between rounded-md border border-dashed border-[rgba(255,255,255,0.06)] px-4 py-3 transition-all hover:border-[rgba(255,255,255,0.12)] hover:bg-[#111113]"
            >
              <div className="flex items-center gap-3">
                <span className="min-w-[50px] text-[0.6rem] uppercase tracking-widest text-[rgba(255,255,255,0.3)]">
                  {activity.source.replace("-", " ").split(" ")[0]}
                </span>
                <span className="text-[0.82rem] text-[rgba(255,255,255,0.55)]">
                  {activity.title}
                </span>
              </div>
              <span className="text-[0.65rem] text-[rgba(255,255,255,0.3)]">
                {formatRelativeTime(activity.timestamp)}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// Helper components

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-3 mt-6 flex items-center gap-2.5 pl-0.5 first:mt-0">
      <span className="text-[0.65rem] font-medium uppercase tracking-[0.12em] text-[rgba(255,255,255,0.3)]">
        {label}
      </span>
      <span className="rounded bg-[#18181b] px-2 py-0.5 text-[0.6rem] text-[rgba(255,255,255,0.3)]">
        {count}
      </span>
      <div className="h-px flex-1 bg-[rgba(255,255,255,0.06)]" />
    </div>
  );
}

const SOURCE_ICONS: Record<string, string> = {
  gmail: "@",
  "arc-browser": "B",
  "google-calendar": "C",
  git: "G",
  "local-project": "F",
  "claude-code": "~",
  hubspot: "$",
};

function WorkstreamCard({
  workstream,
  onClick,
  stale = false,
}: {
  workstream: Workstream;
  onClick: () => void;
  stale?: boolean;
}) {
  const sources = Object.keys(workstream.sourceBreakdown);

  return (
    <div
      onClick={onClick}
      className={`mb-2 cursor-pointer rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#111113] p-4 transition-all hover:translate-y-[-1px] hover:border-[rgba(255,255,255,0.12)] hover:bg-[#18181b] ${stale ? "opacity-50 border-dashed hover:opacity-75" : ""}`}
    >
      {/* Top row: name + meta */}
      <div className="mb-2 flex items-start justify-between">
        <div className="font-serif text-[1.05rem] leading-tight text-[rgba(255,255,255,0.92)]">
          {workstream.name}
        </div>
        <div className="ml-4 flex shrink-0 items-center gap-2.5">
          <span className="whitespace-nowrap text-[0.65rem] text-[rgba(255,255,255,0.3)]">
            {formatRelativeTime(workstream.lastActivityTimestamp)}
          </span>
          {workstream.unreadCount > 0 && (
            <span className="flex min-w-[18px] items-center justify-center rounded-full bg-[rgba(200,240,106,0.15)] px-1.5 py-0.5 text-[0.6rem] font-medium text-[#c8f06a]">
              {workstream.unreadCount}
            </span>
          )}
        </div>
      </div>

      {/* Summary */}
      {workstream.summary && (
        <p className="mb-3 font-serif text-[0.88rem] italic leading-relaxed text-[rgba(255,255,255,0.55)]">
          {workstream.summary.statusSummary}
        </p>
      )}
      {!workstream.summary && workstream.description && (
        <p className="mb-3 font-serif text-[0.88rem] italic leading-relaxed text-[rgba(255,255,255,0.55)]">
          {workstream.description}
        </p>
      )}

      {/* Bottom: source icons + participants + action */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {sources.map((source) => (
              <div
                key={source}
                className="flex h-5 w-5 items-center justify-center rounded bg-[#1f1f23] text-[0.6rem] text-[rgba(255,255,255,0.55)]"
                title={source}
              >
                {SOURCE_ICONS[source] ?? "?"}
              </div>
            ))}
          </div>
          <div className="flex">
            {workstream.participants.slice(0, 3).map((p, i) => (
              <div
                key={p.email}
                className="flex h-[22px] w-[22px] items-center justify-center rounded-full border-[1.5px] border-[#111113] bg-[#2d1f3d] text-[0.55rem] font-medium uppercase text-[#c4a0ff]"
                style={{ marginLeft: i > 0 ? "-4px" : "0" }}
                title={p.displayName || p.email}
              >
                {getInitials(p.displayName || p.email)}
              </div>
            ))}
          </div>
        </div>
        {workstream.summary?.recommendedAction && (
          <div className="whitespace-nowrap rounded bg-[#1f1f23] px-2.5 py-1 text-[0.68rem] text-[rgba(255,255,255,0.3)] transition-colors hover:text-[rgba(255,255,255,0.55)]">
            {workstream.summary.recommendedAction.description}{" "}
            <span className="opacity-50">-&gt;</span>
          </div>
        )}
      </div>
    </div>
  );
}

function getInitials(name: string): string {
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (hours < 24) return `${hours} hr ago`;
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `${Math.floor(days / 7)}w ago`;
}
