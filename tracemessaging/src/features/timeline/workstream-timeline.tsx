import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWorkstreamStore } from "@/lib/stores";
import { useActivityStore } from "@/lib/stores";
import { useAppStore } from "@/lib/stores";
import type { Workstream, ActivityRecord, UrgencyLevel } from "@/lib/types";

type FilterChip = "all" | "urgent" | "deals" | "engineering" | "stale";

const HEADER_HEIGHT = 56; // px, matches header h-14

export function WorkstreamTimeline() {
  const workstreams = useWorkstreamStore((s) => s.workstreams);
  const activities = useActivityStore((s) => s.activities);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const navigate = useAppStore((s) => s.navigate);

  const [activeFilter, setActiveFilter] = useState<FilterChip>("all");
  const feedRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  // workstreams/activities maps are deps to trigger recompute when stores change.
  // The actual computation uses getState() to avoid calling store methods in selectors.
  const sortedWorkstreams = useMemo(
    () => useWorkstreamStore.getState().getSortedWorkstreams(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workstreams],
  );
  const unassigned = useMemo(
    () => useActivityStore.getState().getUnassignedActivities(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activities],
  );

  // Apply search filter
  const searched = useMemo(() => {
    if (!searchQuery) return sortedWorkstreams;
    const q = searchQuery.toLowerCase();
    return sortedWorkstreams.filter(
      (ws) =>
        ws.name.toLowerCase().includes(q) ||
        ws.description.toLowerCase().includes(q) ||
        ws.participants.some((p) => p.displayName.toLowerCase().includes(q)),
    );
  }, [sortedWorkstreams, searchQuery]);

  // Apply chip filter
  const filtered = useMemo(() => {
    switch (activeFilter) {
      case "urgent":
        return searched.filter(
          (ws) => getUrgency(ws) === "high" || getUrgency(ws) === "medium",
        );
      case "deals":
        return searched.filter(
          (ws) =>
            ws.sourceBreakdown.hubspot !== undefined &&
            ws.sourceBreakdown.hubspot > 0,
        );
      case "engineering":
        return searched.filter(
          (ws) =>
            (ws.sourceBreakdown.git !== undefined &&
              ws.sourceBreakdown.git > 0) ||
            (ws.sourceBreakdown["claude-code"] !== undefined &&
              ws.sourceBreakdown["claude-code"] > 0),
        );
      case "stale":
        return searched.filter((ws) => ws.status === "stale");
      default:
        return searched;
    }
  }, [searched, activeFilter]);

  // Track scroll position for progress indicator
  const handleScroll = useCallback(() => {
    if (!feedRef.current) return;
    const cardHeight = feedRef.current.clientHeight;
    if (cardHeight === 0) return;
    const idx = Math.round(feedRef.current.scrollTop / cardHeight);
    setCurrentIndex(idx);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!feedRef.current) return;
      // Don't capture when typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      const cardHeight = feedRef.current.clientHeight;
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        feedRef.current.scrollBy({ top: cardHeight, behavior: "smooth" });
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        feedRef.current.scrollBy({ top: -cardHeight, behavior: "smooth" });
      } else if (e.key === "Enter") {
        if (filtered[currentIndex]) {
          navigate({ view: "detail", workstreamId: filtered[currentIndex].id });
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filtered, currentIndex, navigate]);

  // Empty state
  if (filtered.length === 0 && unassigned.length === 0) {
    return <EmptyState hasAnyWorkstreams={sortedWorkstreams.length > 0} />;
  }

  const feedHeight = `calc(100vh - ${HEADER_HEIGHT}px)`;

  return (
    <div className="relative" style={{ height: feedHeight }}>
      {/* Filter chips */}
      <FilterChips
        active={activeFilter}
        onChange={setActiveFilter}
        unassignedCount={unassigned.length}
      />

      {/* Progress indicator */}
      {filtered.length > 1 && (
        <div
          className="pointer-events-none absolute bottom-6 left-1/2 z-20 -translate-x-1/2"
          style={{ fontFamily: "var(--font-body)" }}
        >
          <span className="rounded-full bg-[rgba(0,0,0,0.6)] px-3 py-1 text-[0.75rem] text-[var(--text-tertiary)] backdrop-blur-sm">
            {currentIndex + 1} of {filtered.length}
          </span>
        </div>
      )}

      {/* Snap-scroll feed */}
      <div ref={feedRef} className="feed-scroll h-full" onScroll={handleScroll}>
        <AnimatePresence mode="popLayout">
          {filtered.map((ws, i) => (
            <motion.div
              key={ws.id}
              className="feed-card"
              style={{ height: feedHeight }}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -30 }}
              transition={{
                type: "spring",
                stiffness: 300,
                damping: 30,
                delay: i * 0.05,
              }}
            >
              <WorkstreamCard
                workstream={ws}
                allActivities={activities}
                onClick={() =>
                  navigate({ view: "detail", workstreamId: ws.id })
                }
                isCurrent={i === currentIndex}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

// --- Filter chips ---

function FilterChips({
  active,
  onChange,
  unassignedCount,
}: {
  active: FilterChip;
  onChange: (f: FilterChip) => void;
  unassignedCount: number;
}) {
  const chips: { id: FilterChip; label: string }[] = [
    { id: "all", label: "All" },
    { id: "urgent", label: "Urgent" },
    { id: "deals", label: "Deals" },
    { id: "engineering", label: "Engineering" },
    { id: "stale", label: "Stale" },
  ];

  return (
    <div className="absolute top-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2">
      {chips.map((chip) => (
        <button
          key={chip.id}
          onClick={() => onChange(chip.id)}
          className={`cursor-pointer rounded-sm border px-3 py-1 text-[0.75rem] uppercase tracking-wider backdrop-blur-md transition-all ${
            active === chip.id
              ? "border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.08)] text-[var(--text-secondary)]"
              : "border-[rgba(255,255,255,0.06)] bg-[rgba(0,0,0,0.4)] text-[var(--text-tertiary)] hover:border-[rgba(255,255,255,0.1)] hover:text-[var(--text-secondary)]"
          }`}
          style={{ fontFamily: "var(--font-body)" }}
        >
          {chip.label}
        </button>
      ))}
      {unassignedCount > 0 && (
        <span
          className="ml-1 flex items-center gap-1 rounded-sm border border-dashed border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.4)] px-2.5 py-1 text-[0.7rem] text-[var(--text-tertiary)] backdrop-blur-md"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {unassignedCount} triage
        </span>
      )}
    </div>
  );
}

// --- Full-viewport workstream card ---

const SOURCE_ICONS: Record<string, { icon: string; color: string }> = {
  gmail: { icon: "@", color: "rgba(180,0,0,0.8)" },
  "arc-browser": { icon: "B", color: "rgba(255,255,255,0.5)" },
  "google-calendar": { icon: "C", color: "rgba(255,255,255,0.4)" },
  git: { icon: "G", color: "rgba(180,130,0,0.8)" },
  "local-project": { icon: "F", color: "rgba(255,255,255,0.3)" },
  "claude-code": { icon: "~", color: "rgba(200,180,140,0.7)" },
  hubspot: { icon: "$", color: "rgba(180,80,60,0.7)" },
};

function WorkstreamCard({
  workstream,
  allActivities,
  onClick,
  isCurrent,
}: {
  workstream: Workstream;
  allActivities: Map<string, ActivityRecord>;
  onClick: () => void;
  isCurrent: boolean;
}) {
  const urgency = getUrgency(workstream);
  const urgencyClass = `urgency-edge-${urgency === "high" ? "high" : urgency === "medium" ? "medium" : urgency === "low" ? "low" : "info"}`;
  const isStale = workstream.status === "stale";
  const sources = Object.keys(workstream.sourceBreakdown);
  const sparkData = computeSparkline(workstream.activityIds, allActivities);

  return (
    <div
      className="relative flex h-full cursor-pointer flex-col justify-between px-8 py-8 sm:px-12 lg:px-20"
      onClick={onClick}
    >
      {/* Image background layer (when available from xAI Imagine) */}
      {workstream.imageUrl && (
        <div
          className="card-image-bg"
          style={{ backgroundImage: `url(${workstream.imageUrl})` }}
        />
      )}

      {/* Content layer */}
      <div className="relative z-10 flex h-full flex-col justify-between">
        {/* Spacer for filter chips */}
        <div className="h-10" />

        {/* Top zone: name + urgency + meta */}
        <div className={`flex-shrink-0 ${isStale ? "opacity-50" : ""}`}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h2
                className="leading-tight tracking-tight"
                style={{
                  fontFamily: "var(--font-display)",
                  fontStyle: "italic",
                  fontSize: "clamp(1.6rem, 3.5vw, 2.4rem)",
                  color: "var(--text-primary)",
                }}
              >
                {workstream.name}
              </h2>
              <div
                className="mt-2 flex items-center gap-3"
                style={{ fontFamily: "var(--font-body)" }}
              >
                <span className="text-[0.8rem] text-[var(--text-tertiary)]">
                  {formatRelativeTime(workstream.lastActivityTimestamp)}
                </span>
                {workstream.unreadCount > 0 && (
                  <span className="rounded-sm bg-[rgba(255,255,255,0.08)] px-2 py-0.5 text-[0.75rem] font-semibold text-[var(--text-secondary)]">
                    {workstream.unreadCount} new
                  </span>
                )}
                <UrgencyBadge urgency={urgency} />
              </div>
            </div>

            {/* Right edge: TikTok-style action icons */}
            <div
              className="flex flex-col items-center gap-4 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              style={{ opacity: isCurrent ? 0.6 : 0 }}
            >
              <RightEdgeAction
                label="save"
                onClick={(e) => e.stopPropagation()}
              />
              <RightEdgeAction
                label="mute"
                onClick={(e) => e.stopPropagation()}
              />
              <RightEdgeAction
                label="archive"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        </div>

        {/* Middle zone: AI summary + recommended action */}
        <div
          className={`flex max-w-[680px] flex-1 flex-col justify-center ${isStale ? "opacity-50" : ""}`}
        >
          {workstream.summary ? (
            <p
              className="leading-relaxed"
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: "clamp(1rem, 2vw, 1.2rem)",
                color: "var(--text-secondary)",
                lineHeight: 1.7,
              }}
            >
              {workstream.summary.statusSummary}
            </p>
          ) : workstream.description ? (
            <p
              className="leading-relaxed"
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: "clamp(1rem, 2vw, 1.2rem)",
                color: "var(--text-secondary)",
                lineHeight: 1.7,
              }}
            >
              {workstream.description}
            </p>
          ) : null}

          {workstream.summary?.recommendedAction &&
            workstream.summary.recommendedAction.type !== "no-action" && (
              <button
                className="mt-5 w-fit cursor-pointer rounded-sm border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-5 py-2.5 text-left transition-all hover:border-[rgba(255,255,255,0.15)] hover:bg-[rgba(255,255,255,0.06)]"
                onClick={(e) => {
                  e.stopPropagation();
                  // Action execution would go here
                }}
                style={{ fontFamily: "var(--font-body)" }}
              >
                <span className="text-[0.85rem] text-[var(--text-secondary)]">
                  {workstream.summary.recommendedAction.description}
                </span>
                <span className="ml-2 text-[0.75rem] text-[var(--text-tertiary)]">
                  -&gt;
                </span>
              </button>
            )}
        </div>

        {/* Bottom zone: sources + participants + sparkline + actions */}
        <div className={`flex-shrink-0 ${isStale ? "opacity-50" : ""}`}>
          <div className="flex items-end justify-between">
            {/* Left: sources + participants */}
            <div className="flex items-center gap-5">
              {/* Source icons */}
              <div className="flex gap-1.5">
                {sources.map((source) => {
                  const info = SOURCE_ICONS[source] ?? {
                    icon: "?",
                    color: "rgba(255,255,255,0.3)",
                  };
                  return (
                    <div
                      key={source}
                      className="flex h-7 w-7 items-center justify-center rounded-sm"
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: "0.8rem",
                        color: info.color,
                        backgroundColor: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
                      title={source}
                    >
                      {info.icon}
                    </div>
                  );
                })}
              </div>

              {/* Participant avatars */}
              <div className="flex">
                {workstream.participants.slice(0, 4).map((p, i) => (
                  <div
                    key={p.email}
                    className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--bg-root)]"
                    style={{
                      marginLeft: i > 0 ? "-6px" : "0",
                      backgroundColor: stringToColor(p.email),
                      fontFamily: "var(--font-body)",
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      color: "rgba(255,255,255,0.85)",
                    }}
                    title={p.displayName || p.email}
                  >
                    {getInitials(p.displayName || p.email)}
                  </div>
                ))}
                {workstream.participants.length > 4 && (
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--bg-root)] bg-[var(--bg-elevated)]"
                    style={{
                      marginLeft: "-6px",
                      fontFamily: "var(--font-body)",
                      fontSize: "0.7rem",
                      color: "var(--text-tertiary)",
                    }}
                  >
                    +{workstream.participants.length - 4}
                  </div>
                )}
              </div>

              {/* Activity sparkline */}
              <Sparkline data={sparkData} />
            </div>

            {/* Right: activity count */}
            <div
              className="text-right"
              style={{ fontFamily: "var(--font-body)" }}
            >
              <span className="text-[0.75rem] text-[var(--text-muted)]">
                {workstream.activityIds.length} activities
              </span>
            </div>
          </div>

          {/* Urgency edge glow bar at very bottom */}
          {isCurrent && (
            <motion.div
              className={`mt-4 h-[2px] rounded-full ${urgencyClass}`}
              style={{
                background:
                  urgency === "high"
                    ? "var(--urgency-high)"
                    : urgency === "medium"
                      ? "var(--urgency-medium)"
                      : urgency === "low"
                        ? "var(--urgency-low)"
                        : "var(--urgency-info)",
                opacity: 0.4,
              }}
              layoutId="urgencyBar"
            />
          )}
        </div>
      </div>
    </div>
  );
}

// --- Right edge action (TikTok-style) ---

function RightEdgeAction({
  label,
  onClick,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      className="cursor-pointer border-none bg-transparent text-[0.7rem] text-[var(--text-muted)] transition-all hover:text-[var(--text-tertiary)]"
      style={{
        fontFamily: "var(--font-body)",
        writingMode: "vertical-rl",
        textOrientation: "mixed",
      }}
    >
      {label}
    </button>
  );
}

// --- Urgency badge ---

function UrgencyBadge({ urgency }: { urgency: UrgencyLevel | "info" }) {
  const config: Record<string, { label: string; color: string; bg: string }> = {
    high: {
      label: "urgent",
      color: "var(--urgency-high)",
      bg: "var(--urgency-high-glow)",
    },
    medium: {
      label: "follow up",
      color: "var(--urgency-medium)",
      bg: "var(--urgency-medium-glow)",
    },
    low: {
      label: "on track",
      color: "var(--urgency-low)",
      bg: "var(--urgency-low-glow)",
    },
    info: {
      label: "info",
      color: "var(--urgency-info)",
      bg: "var(--urgency-info-glow)",
    },
  };
  const c = config[urgency];
  return (
    <span
      className="rounded-sm px-2 py-0.5 text-[0.7rem] uppercase tracking-wider"
      style={{
        fontFamily: "var(--font-body)",
        color: c.color,
        backgroundColor: c.bg,
      }}
    >
      {c.label}
    </span>
  );
}

// --- Sparkline ---

function computeSparkline(
  activityIds: string[],
  allActivities: Map<string, ActivityRecord>,
): number[] {
  const now = Date.now();
  const dayMs = 86400000;
  const buckets = new Array<number>(7).fill(0);
  for (const aid of activityIds) {
    const activity = allActivities.get(aid);
    if (!activity) continue;
    const daysAgo = Math.floor((now - activity.timestamp) / dayMs);
    if (daysAgo >= 0 && daysAgo < 7) {
      buckets[6 - daysAgo]++;
    }
  }
  return buckets;
}

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-[3px]" style={{ height: "24px" }}>
      {data.map((v, i) => (
        <motion.div
          key={i}
          className="sparkline-bar"
          initial={{ height: 0 }}
          animate={{ height: `${Math.max((v / max) * 24, 2)}px` }}
          transition={{ delay: i * 0.06, duration: 0.4, ease: "easeOut" }}
          style={{
            backgroundColor:
              v > 0 ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.06)",
          }}
        />
      ))}
    </div>
  );
}

// --- Empty state ---

function EmptyState({ hasAnyWorkstreams }: { hasAnyWorkstreams: boolean }) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center px-8"
      style={{ height: `calc(100vh - ${HEADER_HEIGHT}px)` }}
    >
      {hasAnyWorkstreams ? (
        <>
          <p
            className="text-[1.1rem] text-[var(--text-tertiary)]"
            style={{ fontFamily: "var(--font-display)", fontStyle: "italic" }}
          >
            No workstreams match this filter.
          </p>
          <p
            className="mt-2 text-[0.85rem] text-[var(--text-muted)]"
            style={{ fontFamily: "var(--font-body)" }}
          >
            Try a different filter or clear your search.
          </p>
        </>
      ) : (
        <motion.div
          className="flex flex-col items-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h2
            className="tracking-tight text-[rgba(255,255,255,0.12)]"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "2rem",
              fontStyle: "italic",
            }}
          >
            trace<span style={{ color: "var(--text-tertiary)" }}>.</span>
          </h2>
          <p
            className="mt-4 text-center text-[0.95rem] leading-relaxed text-[var(--text-tertiary)]"
            style={{ fontFamily: "var(--font-display)", fontStyle: "italic" }}
          >
            Connecting your data sources...
          </p>
          <div className="mt-8 flex flex-col gap-3">
            {["Gmail", "Arc Browser", "Calendar", "Git", "Claude Code"].map(
              (name, i) => (
                <motion.div
                  key={name}
                  className="flex items-center gap-3"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.12 }}
                >
                  <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-[rgba(255,255,255,0.15)]" />
                  <span
                    className="text-[0.8rem] text-[var(--text-muted)]"
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    {name}
                  </span>
                </motion.div>
              ),
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}

// --- Utilities ---

function getUrgency(ws: Workstream): UrgencyLevel | "info" {
  if (ws.summary?.urgency) return ws.summary.urgency;
  // Heuristic: stale = low, has unread = medium, no signal = info
  if (ws.status === "stale") return "low";
  if (ws.unreadCount > 3) return "medium";
  return "info";
}

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
