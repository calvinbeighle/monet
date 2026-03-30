/**
 * components/AgentPill.tsx
 * Small status pill that displays an agent's name, status indicator,
 * and optional summary or last-run time in the sidebar.
 */
import type { Agent } from '../types';

interface AgentPillProps {
  agent: Agent;
}

/** Maps agent status to a dot color */
const STATUS_COLOR: Record<Agent['status'], string> = {
  running: 'var(--success)',
  idle: 'var(--text-muted)',
  error: 'var(--error)',
};

/** Maps agent status to a label */
const STATUS_LABEL: Record<Agent['status'], string> = {
  running: 'running',
  idle: 'idle',
  error: 'error',
};

/**
 * Renders a single agent row in the sidebar with a status dot,
 * agent name, and a subtle info line.
 */
export function AgentPill({ agent }: AgentPillProps) {
  const dotColor = STATUS_COLOR[agent.status];
  const infoText = agent.summary ?? (agent.lastRun ? `Last run ${agent.lastRun}` : STATUS_LABEL[agent.status]);

  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all duration-150"
      style={{ '--hover-bg': 'var(--surface-elevated)' } as React.CSSProperties}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-elevated)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = 'transparent';
      }}
    >
      {/* Status dot */}
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: dotColor }}
      />

      {/* Agent info */}
      <div className="flex flex-col min-w-0 flex-1">
        <span
          className="text-sm font-medium truncate"
          style={{ color: 'var(--text-primary)', fontSize: '13px' }}
        >
          {agent.name}
        </span>
        <span
          className="text-xs truncate mt-0.5"
          style={{ color: 'var(--text-muted)', fontSize: '11px' }}
        >
          {infoText}
        </span>
      </div>

      {/* Running pulse indicator */}
      {agent.status === 'running' && (
        <span className="flex-shrink-0">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: 'var(--success)' }}
          />
        </span>
      )}
    </div>
  );
}
