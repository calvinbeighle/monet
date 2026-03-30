/**
 * components/AgentCard.tsx
 * Personified agent card for the Monet home screen.
 * Each card has an animated SVG avatar, mood phrase (speech bubble), optional
 * progress bar, and a decision badge pill at the bottom.
 *
 * States:
 *   running  - avatar animates (particles/cursor/sparkles), progress bar visible
 *   idle     - dimmed (opacity-60), no progress bar, avatar breathes subtly
 *   error    - red tint on mood text, avatar shows error state
 *
 * Cards with pending decisions show a violet glow ring and are clickable.
 *
 * Fixed width: 260px. Height is auto (~180px).
 */
import { motion } from 'framer-motion';
import { useAppStore } from '@/stores/appStore';
import type { Agent } from '@/types';
import { getAgentAvatar } from './agent-avatars';

interface AgentCardProps {
  agent: Agent;
}

/**
 * Resolves the mood text color based on agent status.
 * Error state uses a red tint; all others use zinc-400.
 */
function moodColor(status: Agent['status']): string {
  if (status === 'error') return 'text-red-400';
  return 'text-zinc-400';
}

/**
 * AgentCard renders a single agent as a 260px personified card.
 * - Emoji avatar (40px) at top, pulses when running
 * - Agent name centered
 * - Mood phrase in quotes, italic, centered
 * - Thin violet progress bar when running
 * - Decision badge pill at bottom when decisionCount > 0
 * - Violet ring + glow when has decisions
 * - Dimmed to opacity-60 when idle with no decisions
 */
export function AgentCard({ agent }: AgentCardProps) {
  const { setActiveView } = useAppStore();

  const hasDecisions = Boolean(agent.decisionCount && agent.decisionCount > 0);
  const isClickable = hasDecisions;
  const isRunning = agent.status === 'running';
  const isIdle = agent.status === 'idle' && !hasDecisions;

  const AvatarComponent = getAgentAvatar(agent.id);

  function handleClick() {
    if (!isClickable) return;
    const view = agent.decisionView ?? 'chat';
    setActiveView(view);
  }

  /* Outer ring / glow when decisions are pending */
  const ringClasses = hasDecisions
    ? 'ring-1 ring-violet-500/40 shadow-[0_0_20px_rgba(139,92,246,0.18)]'
    : '';

  /* Opacity: dimmed when idle and no decisions */
  const opacityClass = isIdle ? 'opacity-60' : 'opacity-100';

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      style={{ width: '260px', flexShrink: 0 }}
      className={opacityClass}
    >
      <div
        onClick={handleClick}
        className={`
          relative flex flex-col items-center
          bg-zinc-900 border border-zinc-800 rounded-2xl
          transition-all duration-200
          ${ringClasses}
          ${isClickable ? 'cursor-pointer hover:border-zinc-700' : 'cursor-default'}
        `}
        style={{ padding: '24px 20px 20px' }}
      >
        {/* Animated SVG avatar - state-driven animations per agent type */}
        <div style={{ marginBottom: '12px' }}>
          <AvatarComponent status={agent.status} hasDecisions={hasDecisions} />
        </div>

        {/* Agent name */}
        <span
          className="text-zinc-200 font-medium text-center leading-tight"
          style={{ fontSize: '14px', marginBottom: '6px' }}
        >
          {agent.name}
        </span>

        {/* Mood speech bubble */}
        <span
          className={`italic text-center leading-snug ${moodColor(agent.status)}`}
          style={{ fontSize: '13px', marginBottom: '14px' }}
        >
          &ldquo;{agent.mood}&rdquo;
        </span>

        {/* Progress bar - only when running and progress is defined */}
        {isRunning && agent.progress !== undefined && (
          <div
            className="w-full rounded-full overflow-hidden bg-zinc-800"
            style={{ height: '3px', marginBottom: '14px' }}
          >
            <motion.div
              className="h-full rounded-full bg-violet-500"
              initial={{ width: 0 }}
              animate={{ width: `${agent.progress}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          </div>
        )}

        {/* Decision badge pill */}
        {hasDecisions && (
          <motion.div
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            className="flex items-center justify-center rounded-full bg-violet-600 text-white font-medium"
            style={{ fontSize: '12px', padding: '4px 14px' }}
          >
            {agent.decisionCount} need your call
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
