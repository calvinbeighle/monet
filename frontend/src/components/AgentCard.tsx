/**
 * components/AgentCard.tsx
 * Visual card representing a single AI agent on the home screen.
 * Shows agent name, progress bar (if running), current step label,
 * and a decision count badge. Cards with pending decisions have a violet
 * ring and are clickable to open the relevant decision view.
 *
 * Fixed width: 240px. Uses Tailwind classes, no inline CSS vars.
 */
import { motion } from 'framer-motion';
import { useAppStore } from '@/stores/appStore';
import type { Agent } from '@/types';

interface AgentCardProps {
  agent: Agent;
}

/**
 * Status label shown below the agent name.
 * Running agents show the current step, idle agents show last run time,
 * error agents show "error".
 */
function StatusLabel({ agent }: { agent: Agent }) {
  if (agent.status === 'error') {
    return <span className="text-[12px] text-red-500">error</span>;
  }
  if (agent.status === 'running' && agent.currentStep) {
    return <span className="text-[12px] text-zinc-500">{agent.currentStep}</span>;
  }
  if (agent.status === 'idle' && agent.lastRun) {
    return <span className="text-[12px] text-zinc-500">Done - {agent.lastRun}</span>;
  }
  return <span className="text-[12px] text-zinc-500">Idle</span>;
}

/**
 * AgentCard renders a single agent as a fixed-width (240px) card.
 * Running cards get a 2px solid violet left border.
 * Decision cards get a subtle violet ring and shadow.
 * Idle cards without decisions are dimmed to opacity-50.
 * Clicking a card with pending decisions opens the relevant decision view.
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

  /* Build className string based on agent state */
  const baseClasses =
    'relative overflow-hidden bg-zinc-900 border border-zinc-800 rounded-xl transition-all duration-200';

  const stateClasses = (() => {
    if (agent.status === 'idle' && !hasDecisions) return 'opacity-50';
    if (hasDecisions) return 'ring-1 ring-violet-500/30 shadow-[0_0_16px_rgba(139,92,246,0.12)] hover:border-zinc-700';
    if (agent.status === 'running') return 'border-l-2 border-l-violet-500 hover:border-zinc-700';
    return '';
  })();

  const cursorClass = isClickable ? 'cursor-pointer' : 'cursor-default';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      style={{ width: '240px', flexShrink: 0 }}
    >
      <div
        onClick={handleClick}
        className={`${baseClasses} ${stateClasses} ${cursorClass}`}
        style={{ padding: '20px' }}
      >
        {/* Decision badge - absolute top-right */}
        {hasDecisions && (
          <motion.div
            animate={{ scale: [1, 1.12, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute -top-1.5 -right-1.5 flex items-center justify-center rounded-full bg-red-500 text-white font-semibold"
            style={{ width: '16px', height: '16px', fontSize: '10px' }}
          >
            {agent.decisionCount}
          </motion.div>
        )}

        {/* Agent name */}
        <span className="block text-[14px] font-medium text-zinc-100 leading-tight">
          {agent.name}
        </span>

        {/* Progress bar - only for running agents */}
        {agent.status === 'running' && agent.progress !== undefined && (
          <div className="w-full rounded-full overflow-hidden bg-zinc-800 mt-3" style={{ height: '3px' }}>
            <motion.div
              className="h-full rounded-full bg-violet-500"
              initial={{ width: 0 }}
              animate={{ width: `${agent.progress}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          </div>
        )}

        {/* Status label */}
        <div className="mt-1.5">
          <StatusLabel agent={agent} />
        </div>

        {/* Decisions hint */}
        {hasDecisions && (
          <p className="text-[12px] text-violet-400 font-medium" style={{ marginTop: '10px' }}>
            {agent.decisionCount} need review
          </p>
        )}
      </div>
    </motion.div>
  );
}
