import { useMemo, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { useWorkstreamStore } from "@/lib/stores";
import { useActivityStore } from "@/lib/stores";
import { useAppStore } from "@/lib/stores";
import type { ActivityRecord, SourceType } from "@/lib/types";

const SOURCE_LABELS: Record<string, string> = {
  gmail: "Email",
  "arc-browser": "Browser",
  "google-calendar": "Calendar",
  git: "Git",
  "local-project": "Project",
  "claude-code": "Claude",
  hubspot: "HubSpot",
};

const SOURCE_COLORS: Record<string, string> = {
  gmail: "rgba(180,0,0,0.8)",
  "arc-browser": "rgba(255,255,255,0.5)",
  "google-calendar": "rgba(255,255,255,0.4)",
  git: "rgba(180,130,0,0.8)",
  "local-project": "rgba(255,255,255,0.3)",
  "claude-code": "rgba(200,180,140,0.7)",
  hubspot: "rgba(180,80,60,0.7)",
};

type SourceFilter = "all" | SourceType;

export function WorkstreamDetail({ workstreamId }: { workstreamId: string }) {
  const workstream = useWorkstreamStore((s) => s.getWorkstream(workstreamId));
  const navigate = useAppStore((s) => s.navigate);
  const allActivities = useActivityStore((s) => s.activities);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const contentRef = useRef<HTMLDivElement>(null);

  const activities = useMemo(() => {
    if (!workstream) return [];
    const items: ActivityRecord[] = [];
    for (const aid of workstream.activityIds) {
      const a = allActivities.get(aid);
      if (a) items.push(a);
    }
    items.sort((a, b) => b.timestamp - a.timestamp);
    if (sourceFilter !== "all") {
      return items.filter((a) => a.source === sourceFilter);
    }
    return items;
  }, [workstream, allActivities, sourceFilter]);

  const sourceTabs = useMemo(() => {
    if (!workstream) return [];
    const sources = Object.keys(workstream.sourceBreakdown) as SourceType[];
    return sources;
  }, [workstream]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const goBack = useCallback(() => {
    navigate({ view: "timeline" });
  }, [navigate]);

  if (!workstream) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[var(--bg-root)]">
        <p
          className="text-[0.95rem] text-[var(--text-secondary)]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          Workstream not found
        </p>
        <button
          onClick={goBack}
          className="mt-4 cursor-pointer rounded-sm border border-[var(--border-hover)] bg-[var(--bg-card)] px-4 py-2 text-[0.85rem] text-[var(--text-secondary)] transition-all hover:border-[rgba(255,255,255,0.2)]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          Back to timeline
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--bg-root)]">
      {/* Sticky header */}
      <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-root)] px-6 py-4 sm:px-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={goBack}
              className="cursor-pointer border-none bg-transparent text-[0.9rem] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
              style={{ fontFamily: "var(--font-body)" }}
            >
              &lt;-
            </button>
            <h1
              className="leading-tight tracking-tight"
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: "clamp(1.2rem, 2.5vw, 1.6rem)",
                color: "var(--text-primary)",
              }}
            >
              {workstream.name}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {/* Participant avatars */}
            <div className="flex">
              {workstream.participants.slice(0, 4).map((p, i) => (
                <div
                  key={p.email}
                  className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--bg-root)]"
                  style={{
                    marginLeft: i > 0 ? "-5px" : "0",
                    backgroundColor: stringToColor(p.email),
                    fontFamily: "var(--font-body)",
                    fontSize: "0.65rem",
                    fontWeight: 600,
                    color: "rgba(255,255,255,0.85)",
                  }}
                  title={p.displayName || p.email}
                >
                  {getInitials(p.displayName || p.email)}
                </div>
              ))}
            </div>
            <span
              className="text-[0.75rem] text-[var(--text-tertiary)]"
              style={{ fontFamily: "var(--font-body)" }}
            >
              {workstream.activityIds.length} activities
            </span>
          </div>
        </div>
      </div>

      {/* AI Summary card - frosted glass, pinned */}
      {workstream.summary && (
        <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[rgba(10,10,10,0.8)] px-6 py-5 backdrop-blur-xl sm:px-10">
          <p
            className="max-w-[640px] leading-relaxed"
            style={{
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: "0.95rem",
              color: "var(--text-secondary)",
              lineHeight: 1.7,
            }}
          >
            {workstream.summary.statusSummary}
          </p>
          {workstream.summary.keyDevelopments.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {workstream.summary.keyDevelopments.map((dev, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-[0.85rem] text-[var(--text-tertiary)]"
                  style={{ fontFamily: "var(--font-body)" }}
                >
                  <span className="mt-0.5 text-[var(--text-muted)]">-</span>
                  {dev}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex items-center gap-4">
            {workstream.summary.recommendedAction &&
              workstream.summary.recommendedAction.type !== "no-action" && (
                <button
                  className="cursor-pointer rounded-sm border border-[var(--border-hover)] bg-[rgba(255,255,255,0.03)] px-4 py-2 text-[0.82rem] text-[var(--text-secondary)] transition-all hover:bg-[rgba(255,255,255,0.06)]"
                  style={{ fontFamily: "var(--font-body)" }}
                >
                  {workstream.summary.recommendedAction.description}{" "}
                  <span className="text-[var(--text-tertiary)]">-&gt;</span>
                </button>
              )}
            <span
              className="text-[0.7rem] text-[var(--text-muted)]"
              style={{ fontFamily: "var(--font-body)" }}
            >
              updated {formatRelativeTime(workstream.summary.generatedAt)}
            </span>
          </div>
        </div>
      )}

      {/* Source filter tabs */}
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--border-subtle)] px-6 py-2 sm:px-10">
        <FilterTab
          label="All"
          active={sourceFilter === "all"}
          onClick={() => setSourceFilter("all")}
        />
        {sourceTabs.map((source) => (
          <FilterTab
            key={source}
            label={SOURCE_LABELS[source] ?? source}
            active={sourceFilter === source}
            onClick={() => setSourceFilter(source)}
            color={SOURCE_COLORS[source]}
          />
        ))}
      </div>

      {/* Scrollable activity feed */}
      <div
        ref={contentRef}
        className="flex-1 overflow-y-auto px-6 py-4 sm:px-10"
      >
        {activities.map((activity, i) => (
          <motion.div
            key={activity.activityId}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03, duration: 0.25 }}
            className="mb-2 rounded-sm border border-[var(--border-subtle)] bg-[var(--bg-card)] transition-colors hover:border-[var(--border-hover)]"
          >
            <div
              className="flex cursor-pointer items-center justify-between px-4 py-3"
              onClick={() => toggleExpand(activity.activityId)}
            >
              <div className="flex items-center gap-3">
                <span
                  className="min-w-[50px] text-[0.65rem] uppercase tracking-widest"
                  style={{
                    fontFamily: "var(--font-body)",
                    color:
                      SOURCE_COLORS[activity.source] ?? "var(--text-tertiary)",
                  }}
                >
                  {SOURCE_LABELS[activity.source] ?? activity.source}
                </span>
                <span
                  className="text-[0.9rem] text-[var(--text-secondary)]"
                  style={{ fontFamily: "var(--font-body)" }}
                >
                  {activity.title}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {activity.participants.length > 0 && (
                  <span
                    className="text-[0.7rem] text-[var(--text-muted)]"
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    {activity.participants[0].displayName ||
                      activity.participants[0].email}
                  </span>
                )}
                <span
                  className="whitespace-nowrap text-[0.7rem] text-[var(--text-muted)]"
                  style={{ fontFamily: "var(--font-body)" }}
                >
                  {formatRelativeTime(activity.timestamp)}
                </span>
              </div>
            </div>

            {/* Expandable body */}
            {expandedIds.has(activity.activityId) && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden border-t border-[var(--border-subtle)] px-4 py-3"
              >
                {activity.preview && (
                  <p
                    className="text-[0.85rem] leading-relaxed text-[var(--text-tertiary)]"
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    {activity.preview}
                  </p>
                )}
                {activity.body && (
                  <div
                    className="mt-2 max-h-[300px] overflow-y-auto text-[0.85rem] leading-relaxed text-[var(--text-tertiary)]"
                    style={{ fontFamily: "var(--font-body)" }}
                    dangerouslySetInnerHTML={{
                      __html: activity.body,
                    }}
                  />
                )}
                {!activity.preview && !activity.body && (
                  <p
                    className="text-[0.8rem] text-[var(--text-muted)]"
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    No additional details.
                  </p>
                )}
              </motion.div>
            )}
          </motion.div>
        ))}

        {activities.length === 0 && (
          <p
            className="py-12 text-center text-[0.9rem] text-[var(--text-muted)]"
            style={{ fontFamily: "var(--font-body)" }}
          >
            No activities match this filter.
          </p>
        )}
      </div>
    </div>
  );
}

// --- Filter tab ---

function FilterTab({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`cursor-pointer rounded-sm border px-3 py-1 text-[0.72rem] uppercase tracking-wider transition-all ${
        active
          ? "border-[var(--border-hover)] bg-[rgba(255,255,255,0.04)] text-[var(--text-secondary)]"
          : "border-transparent bg-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
      }`}
      style={{
        fontFamily: "var(--font-body)",
        ...(active && color ? { borderColor: `${color}` } : {}),
      }}
    >
      {label}
    </button>
  );
}

// --- Utilities ---

function getInitials(name: string): string {
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 25%, 25%)`;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}
