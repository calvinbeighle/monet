/**
 * components/AgentCard.tsx
 * DIA-style agent card for the Monet home screen.
 * Thin, list-item style card that matches DIA browser's minimal aesthetic:
 * - Pure black/very dark background (#111111)
 * - Very subtle border: 1px rgba(255,255,255,0.06)
 * - NO box shadows, NO glows, NO colored rings
 * - Compact layout: character avatar top, name + character name center, badge bottom
 * - Violet accent only for active decision badge
 * - Clickable when agent has pending decisions
 *
 * Fixed width: 260px.
 */
import { motion } from 'framer-motion';
import { useAppStore } from '@/stores/appStore';
import type { Agent } from '@/types';
import { getAgentAvatar } from './agent-avatars';

/**
 * Returns the character name for a given agent ID.
 * Each agent has a personified name that makes them feel like team members.
 */
function getCharacterName(agentId: string): string {
  const names: Record<string, string> = {
    email: 'mira',
    code: 'kai',
    planning: 'nova',
  };
  return names[agentId] ?? '';
}

interface AgentCardProps {
  agent: Agent;
}

/**
 * AgentCard renders a single agent in DIA's minimal card style.
 * Layout: avatar left | name + mood center | decision count right
 * Very thin borders, no glows, no shadows.
 */
export function AgentCard({ agent }: AgentCardProps) {
  const { setOverlayView } = useAppStore();

  const hasDecisions = Boolean(agent.decisionCount && agent.decisionCount > 0);
  const isClickable = hasDecisions;
  const isRunning = agent.status === 'running';
  const isIdle = agent.status === 'idle' && !hasDecisions;

  const AvatarComponent = getAgentAvatar(agent.id);
  const characterName = getCharacterName(agent.id);

  function handleClick() {
    if (!isClickable) return;
    const view = (agent.decisionView as 'tinder' | 'diff' | 'whiteboard') ?? 'tinder';
    setOverlayView(view);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: isIdle ? 0.5 : 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      style={{ width: '260px', flexShrink: 0 }}
    >
      <div
        onClick={handleClick}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          background: '#111111',
          border: `1px solid ${hasDecisions ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.06)'}`,
          borderRadius: '16px',
          padding: '20px 16px 16px',
          cursor: isClickable ? 'pointer' : 'default',
          transition: 'border-color 0.2s ease',
        }}
        onMouseEnter={(e) => {
          if (isClickable)
            (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.1)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = hasDecisions
            ? 'rgba(139,92,246,0.2)'
            : 'rgba(255,255,255,0.06)';
        }}
      >
        {/* Animated SVG avatar */}
        <div style={{ marginBottom: '10px' }}>
          <AvatarComponent status={agent.status} hasDecisions={hasDecisions} />
        </div>

        {/* Character name - primary identity */}
        {characterName && (
          <span
            style={{
              fontSize: '15px',
              fontWeight: 500,
              color: '#ffffff',
              textAlign: 'center',
              letterSpacing: '-0.01em',
              marginBottom: '2px',
              lineHeight: 1.3,
              textTransform: 'capitalize',
            }}
          >
            {characterName}
          </span>
        )}

        {/* Role - what this agent does */}
        <span
          style={{
            fontSize: '11px',
            color: 'rgba(255,255,255,0.35)',
            textAlign: 'center',
            letterSpacing: '0.02em',
            marginBottom: '6px',
            lineHeight: 1.2,
          }}
        >
          {agent.name}
        </span>

        {/* Granular status */}
        <span
          style={{
            fontSize: '12px',
            color: agent.status === 'error'
              ? '#ef4444'
              : isRunning
                ? '#a78bfa'
                : hasDecisions
                  ? '#8b5cf6'
                  : 'rgba(255,255,255,0.3)',
            textAlign: 'center',
            lineHeight: 1.4,
            marginBottom: hasDecisions || (isRunning && agent.progress !== undefined) ? '12px' : '0',
          }}
        >
          {agent.status === 'error' && 'Connection lost'}
          {isRunning && (agent.currentStep || agent.mood || 'Working...')}
          {agent.status === 'idle' && hasDecisions && `${agent.decisionCount} items ready`}
          {isIdle && !hasDecisions && (agent.lastRun ? `Done - ${agent.lastRun}` : 'Standing by')}
        </span>

        {/* Progress bar - running agents only */}
        {isRunning && agent.progress !== undefined && (
          <div
            style={{
              width: '100%',
              height: '2px',
              background: 'rgba(255,255,255,0.08)',
              borderRadius: '1px',
              overflow: 'hidden',
              marginBottom: hasDecisions ? '12px' : '0',
            }}
          >
            <motion.div
              style={{ height: '100%', borderRadius: '1px', background: '#8b5cf6' }}
              initial={{ width: 0 }}
              animate={{ width: `${agent.progress}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          </div>
        )}

        {/* Decision badge - violet, compact */}
        {hasDecisions && (
          <motion.div
            animate={{ scale: [1, 1.03, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '20px',
              background: '#8b5cf6',
              color: '#ffffff',
              fontSize: '11px',
              fontWeight: 500,
              padding: '3px 12px',
              letterSpacing: '0em',
            }}
          >
            {agent.decisionCount} need your call
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
