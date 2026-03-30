/**
 * components/AgentCard.tsx
 * Visual card representing a single AI agent on the home screen.
 * Shows agent name, progress bar (if running), current step label,
 * and a decision count badge. Cards with pending decisions glow violet
 * and are clickable to open the relevant decision view.
 */
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { useAppStore } from '@/stores/appStore';
import type { Agent } from '@/types';

interface AgentCardProps {
  agent: Agent;
}

/**
 * Returns the card border/glow style based on agent state.
 * Running agents get a violet left border, decision agents get a violet glow.
 * Error agents get a red border. Idle agents use the default border.
 */
function getCardStyle(agent: Agent): React.CSSProperties {
  if (agent.status === 'error') {
    return {
      borderColor: 'rgba(239, 68, 68, 0.5)',
      boxShadow: '0 0 12px rgba(239, 68, 68, 0.2)',
    };
  }
  if (agent.decisionCount && agent.decisionCount > 0) {
    return {
      borderColor: 'rgba(139, 92, 246, 0.5)',
      boxShadow: '0 0 20px rgba(139, 92, 246, 0.3)',
    };
  }
  if (agent.status === 'running') {
    return {
      borderColor: 'rgba(139, 92, 246, 0.3)',
    };
  }
  return {};
}

/**
 * Status label shown below the agent name.
 * Running agents show the current step, idle agents show last run time,
 * error agents show "error".
 */
function StatusLabel({ agent }: { agent: Agent }) {
  if (agent.status === 'error') {
    return <span className="text-xs" style={{ color: 'var(--error)' }}>error</span>;
  }
  if (agent.status === 'running' && agent.currentStep) {
    return (
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {agent.currentStep}
      </span>
    );
  }
  if (agent.status === 'idle' && agent.lastRun) {
    return (
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Done - {agent.lastRun}
      </span>
    );
  }
  return <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Idle</span>;
}

/**
 * AgentCard renders a single agent as a shadcn Card.
 * Clicking a card with pending decisions opens the relevant decision view.
 * Cards without decisions are non-interactive (styled as muted).
 */
export function AgentCard({ agent }: AgentCardProps) {
  const { setActiveView } = useAppStore();

  const hasDecisions = Boolean(agent.decisionCount && agent.decisionCount > 0);
  const isClickable = hasDecisions;

  function handleClick() {
    if (!isClickable) return;
    const view = agent.decisionView ?? 'chat';
    setActiveView(view);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="w-full"
      style={{ minWidth: '180px', maxWidth: '220px' }}
    >
      <Card
        onClick={handleClick}
        className="relative p-4 transition-all duration-200 overflow-hidden"
        style={{
          background: 'var(--surface)',
          border: `1px solid ${agent.status === 'idle' && !hasDecisions ? 'var(--border)' : 'transparent'}`,
          cursor: isClickable ? 'pointer' : 'default',
          opacity: agent.status === 'idle' && !hasDecisions ? 0.65 : 1,
          ...getCardStyle(agent),
        }}
      >
        {/* Running agent - animated shimmer on the left edge */}
        {agent.status === 'running' && (
          <div
            className="absolute left-0 top-0 bottom-0 w-[3px]"
            style={{
              background: 'linear-gradient(180deg, #8b5cf6 0%, #a78bfa 50%, #8b5cf6 100%)',
              backgroundSize: '100% 200%',
              animation: 'shimmer-y 2s ease-in-out infinite',
            }}
          />
        )}

        {/* Header row: agent name + decision badge */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <span
            className="text-sm font-medium leading-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            {agent.name}
          </span>

          {hasDecisions && (
            <motion.div
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              className="flex items-center justify-center rounded-full text-white font-semibold shrink-0"
              style={{
                background: '#ef4444',
                fontSize: '10px',
                minWidth: '18px',
                height: '18px',
                padding: '0 4px',
              }}
            >
              {agent.decisionCount}
            </motion.div>
          )}
        </div>

        {/* Progress bar - only for running agents */}
        {agent.status === 'running' && agent.progress !== undefined && (
          <div
            className="mb-2 w-full rounded-full overflow-hidden"
            style={{ height: '4px', background: 'var(--surface-elevated)' }}
          >
            <motion.div
              className="h-full rounded-full"
              style={{ background: 'var(--accent)' }}
              initial={{ width: 0 }}
              animate={{ width: `${agent.progress}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          </div>
        )}

        {/* Status label */}
        <StatusLabel agent={agent} />

        {/* Decisions hint text */}
        {hasDecisions && (
          <div className="mt-2">
            <span
              className="text-xs font-medium"
              style={{ color: 'var(--accent)' }}
            >
              {agent.decisionCount} need review
            </span>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
