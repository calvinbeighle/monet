/**
 * components/ActivityItem.tsx
 * Renders a single item in the activity timeline.
 * Shows a colored dot, label, agent name, and timestamp.
 */
import type { ActivityEvent } from '@/types';

interface ActivityItemProps {
  event: ActivityEvent;
  /** Whether to show the vertical connector line below this item */
  showLine?: boolean;
}

/**
 * A single timeline entry with a colored status dot, label, and timestamp.
 * The dot color matches the agent's color. Running items pulse.
 */
export function ActivityItem({ event, showLine = true }: ActivityItemProps) {
  return (
    <div className="flex gap-3">
      {/* Timeline dot + connector */}
      <div className="flex flex-col items-center">
        <div
          className={`w-2 h-2 rounded-full shrink-0 mt-1 ${event.status === 'running' ? 'animate-pulse' : ''}`}
          style={{ backgroundColor: event.color }}
        />
        {showLine && (
          <div className="w-px flex-1 mt-1 min-h-[20px]" style={{ backgroundColor: 'var(--border)' }} />
        )}
      </div>

      {/* Content */}
      <div className="pb-4 min-w-0">
        <p className="text-sm text-zinc-200 leading-none mb-1">{event.label}</p>
        <p className="text-xs text-zinc-600">{event.agentName} - {event.timestamp}</p>
      </div>
    </div>
  );
}
