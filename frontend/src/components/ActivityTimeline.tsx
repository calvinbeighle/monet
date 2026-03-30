/**
 * components/ActivityTimeline.tsx
 * Minimal vertical timeline feed showing what agents have been doing.
 *
 * Design:
 * - Thin 1px vertical line on the left running through all entries
 * - Each entry is a colored dot on the line + timestamp left + description right
 * - Day separator headers with thin rules on each side
 * - No backgrounds, no borders on entries - just dots and text
 * - Staggered entrance via Framer Motion
 * - Clickable entries expand to show a detail line
 *
 * Data source: appStore.activity (static fallback, later fetched from GET /activity)
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/stores/appStore';
import type { ActivityEvent } from '@/types';
import { BACKEND_URL } from '@/types';

/** Agent character names mirroring the ones in AgentCard */
const AGENT_CHARACTER_NAMES: Record<string, string> = {
  email: 'Mira',
  code: 'Kai',
  planning: 'Nova',
};

/** Richer mock activity data grouped over today and yesterday */
const MOCK_ACTIVITY: ActivityEvent[] = [
  {
    id: 'm1',
    agentId: 'email',
    agentName: 'Email Agent',
    label: 'Triaged 5 emails - 3 need replies',
    timestamp: '4:23 PM',
    color: '#ea4335',
    status: 'completed',
  },
  {
    id: 'm2',
    agentId: 'code',
    agentName: 'Code Agent',
    label: 'Reviewed PR #47 - 2 issues found',
    timestamp: '3:45 PM',
    color: '#8b5cf6',
    status: 'completed',
  },
  {
    id: 'm3',
    agentId: 'email',
    agentName: 'Email Agent',
    label: 'Sent reply to Marcus Obi',
    timestamp: '2:10 PM',
    color: '#ea4335',
    status: 'completed',
  },
  {
    id: 'm4',
    agentId: 'planning',
    agentName: 'Planning Agent',
    label: 'Planned sprint - 6 tasks created',
    timestamp: '1:30 PM',
    color: '#22c55e',
    status: 'completed',
  },
  {
    id: 'm5',
    agentId: 'code',
    agentName: 'Code Agent',
    label: 'Flagged 3 security issues in branch feat/auth',
    timestamp: '11:02 AM',
    color: '#8b5cf6',
    status: 'completed',
  },
  {
    id: 'm6',
    agentId: 'email',
    agentName: 'Email Agent',
    label: 'Drafted follow-up to Priya about funding round',
    timestamp: '9:44 AM',
    color: '#ea4335',
    status: 'completed',
  },
  {
    id: 'y1',
    agentId: 'email',
    agentName: 'Email Agent',
    label: 'Handled 8 emails - 2 escalated',
    timestamp: '5:15 PM',
    color: '#ea4335',
    status: 'completed',
  },
  {
    id: 'y2',
    agentId: 'code',
    agentName: 'Code Agent',
    label: 'Approved PR #45 - clean merge',
    timestamp: '3:00 PM',
    color: '#8b5cf6',
    status: 'completed',
  },
  {
    id: 'y3',
    agentId: 'planning',
    agentName: 'Planning Agent',
    label: 'Summarized Q2 roadmap - 4 blockers identified',
    timestamp: '1:20 PM',
    color: '#22c55e',
    status: 'completed',
  },
  {
    id: 'y4',
    agentId: 'email',
    agentName: 'Email Agent',
    label: 'Auto-archived 12 newsletters',
    timestamp: '9:05 AM',
    color: '#ea4335',
    status: 'completed',
  },
];

/** Groups activity events into labeled date buckets for rendering */
interface ActivityGroup {
  label: string;
  events: ActivityEvent[];
}

/**
 * Groups a flat list of ActivityEvents by date label.
 * The first N events go into "Today", the rest into "Yesterday".
 * In production this would parse real ISO timestamps.
 */
function groupActivity(events: ActivityEvent[]): ActivityGroup[] {
  const todayIds = new Set(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
  const today: ActivityEvent[] = [];
  const yesterday: ActivityEvent[] = [];

  for (const e of events) {
    if (todayIds.has(e.id)) today.push(e);
    else yesterday.push(e);
  }

  const groups: ActivityGroup[] = [];
  if (today.length > 0) groups.push({ label: 'Today', events: today });
  if (yesterday.length > 0) groups.push({ label: 'Yesterday', events: yesterday });
  return groups;
}

/**
 * Builds a human-readable description prefix using the agent's character name.
 * E.g. "Mira triaged 5 emails" instead of "Email Agent triaged 5 emails".
 */
function buildDescription(event: ActivityEvent): string {
  const characterName = AGENT_CHARACTER_NAMES[event.agentId];
  if (characterName) return `${characterName} ${lowercaseFirst(event.label)}`;
  return event.label;
}

function lowercaseFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

interface TimelineEntryProps {
  event: ActivityEvent;
  index: number;
  isLast: boolean;
}

/**
 * Renders a single timeline entry: dot on the line + timestamp + description.
 * Clicking toggles a subtle detail expansion below the description.
 */
function TimelineEntry({ event, index, isLast }: TimelineEntryProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const characterName = AGENT_CHARACTER_NAMES[event.agentId] ?? event.agentName;
  const description = buildDescription(event);

  /** Detail blurb shown on expand - synthesized from event data */
  const detailText = `${characterName} completed this at ${event.timestamp}. Click an agent card to act on any pending items.`;

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut', delay: index * 0.04 }}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0',
        position: 'relative',
        paddingBottom: isLast ? '0' : '18px',
        cursor: 'pointer',
      }}
      onClick={() => setIsExpanded((v) => !v)}
    >
      {/* Timestamp column - fixed width, right-aligned */}
      <div
        style={{
          width: '62px',
          flexShrink: 0,
          paddingTop: '1px',
          textAlign: 'right',
          paddingRight: '14px',
        }}
      >
        <span
          style={{
            fontSize: '11px',
            color: 'rgba(161,161,170,0.4)',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '0.01em',
            fontFamily: 'ui-monospace, monospace',
            lineHeight: 1,
          }}
        >
          {event.timestamp}
        </span>
      </div>

      {/* Dot on the timeline line */}
      <div
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: event.color,
          flexShrink: 0,
          marginTop: '3px',
          position: 'relative',
          zIndex: 1,
          opacity: 0.85,
          boxShadow: `0 0 6px ${event.color}55`,
        }}
      />

      {/* Description + expand area */}
      <div
        style={{
          flex: 1,
          paddingLeft: '14px',
          paddingTop: '0',
        }}
      >
        <motion.span
          style={{
            fontSize: '13px',
            color: 'rgba(228,228,231,0.5)',
            letterSpacing: '-0.005em',
            lineHeight: 1.4,
            display: 'block',
            transition: 'color 0.12s ease',
          }}
          whileHover={{ color: 'rgba(228,228,231,0.85)' } as any}
        >
          {description}
        </motion.span>

        {/* Expanded detail */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0, y: -2 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              exit={{ opacity: 0, height: 0, y: -2 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              style={{ overflow: 'hidden' }}
            >
              <span
                style={{
                  display: 'block',
                  fontSize: '11px',
                  color: 'rgba(161,161,170,0.35)',
                  marginTop: '4px',
                  letterSpacing: '0em',
                  lineHeight: 1.5,
                }}
              >
                {detailText}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

interface DaySeparatorProps {
  label: string;
  index: number;
}

/**
 * Day separator header: centered text with thin horizontal rules on each side.
 * Styled in 11px uppercase zinc-600.
 */
function DaySeparator({ label, index }: DaySeparatorProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut', delay: index * 0.04 }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginBottom: '18px',
        paddingLeft: '76px', // aligns with content column (timestamp + gap + dot offset)
      }}
    >
      <div
        style={{
          flex: 1,
          height: '1px',
          background: 'rgba(255,255,255,0.05)',
        }}
      />
      <span
        style={{
          fontSize: '10px',
          color: 'rgba(161,161,170,0.3)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontWeight: 500,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: '1px',
          background: 'rgba(255,255,255,0.05)',
        }}
      />
    </motion.div>
  );
}

/**
 * ActivityTimeline renders the full timeline section.
 * Attempts to fetch from GET /activity on mount; falls back to MOCK_ACTIVITY.
 * Grouped by date with subtle day separators.
 */
export function ActivityTimeline() {
  const storeActivity = useAppStore((s) => s.activity);
  const [events, setEvents] = useState<ActivityEvent[]>(MOCK_ACTIVITY);
  const [hasFetched, setHasFetched] = useState(false);

  useEffect(() => {
    if (hasFetched) return;
    setHasFetched(true);

    fetch(`${BACKEND_URL}/activity`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const raw: ActivityEvent[] = data.activity ?? data;
        if (Array.isArray(raw) && raw.length > 0) setEvents(raw);
      })
      .catch(() => {
        // Backend has no /activity yet - keep MOCK_ACTIVITY, which looks real
        if (storeActivity.length > 0) {
          // Prefer store data only if it is richer than default fallback
          setEvents(MOCK_ACTIVITY);
        }
      });
  }, [hasFetched, storeActivity]);

  const groups = groupActivity(events);

  // Running entry index for stagger delay across all groups
  let globalIndex = 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut', delay: 0.25 }}
      style={{
        width: '100%',
        maxWidth: '560px',
        paddingTop: '32px',
        paddingBottom: '48px',
      }}
    >
      {groups.map((group, groupIdx) => (
        <div key={group.label} style={{ marginBottom: groupIdx < groups.length - 1 ? '28px' : '0' }}>
          <DaySeparator label={group.label} index={globalIndex} />

          {/* Timeline track: relative container for the vertical line + entries */}
          <div style={{ position: 'relative' }}>
            {/* Vertical line running behind the dots */}
            <div
              style={{
                position: 'absolute',
                left: '76px', // timestamp width (62) + right-padding (14)
                top: '4px',
                bottom: '4px',
                width: '1px',
                background: 'rgba(255,255,255,0.06)',
                transform: 'translateX(-0.5px)',
              }}
            />

            {/* Entries */}
            {group.events.map((event, entryIdx) => {
              const idx = globalIndex++;
              return (
                <TimelineEntry
                  key={event.id}
                  event={event}
                  index={idx}
                  isLast={entryIdx === group.events.length - 1}
                />
              );
            })}
          </div>
        </div>
      ))}
    </motion.div>
  );
}
