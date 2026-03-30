/**
 * views/HomeView.tsx
 * Main home screen with two layout modes, styled to match DIA browser exactly.
 *
 * Idle (no active agents, no decisions):
 *   - Pure black background (#000000)
 *   - Centered group: 3D orbit (subtle) + "monet" text + command bar + suggestion rows
 *   - "monet" at 28px, weight 300, letter-spacing -0.02em
 *   - NO subtitle
 *   - Command bar: 580px wide, DIA style
 *   - Suggestion rows below the command bar: pending decisions from agents
 *   - Each suggestion: colored dot, text, source label, chevron
 *   - Max 4 suggestions visible
 *
 * Active (any agent running or has decisions):
 *   - Agent cards in a centered row in DIA's minimal card style
 *   - Command bar fixed at bottom with fade gradient
 *
 * Uses Framer Motion AnimatePresence for transitions.
 */
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { AgentOrbitWithSuspense } from '@/components/AgentOrbit';
import { CommandBar } from '@/components/CommandBar';
import { AgentCard } from '@/components/AgentCard';
import { useAppStore } from '@/stores/appStore';
import type { Agent } from '@/types';

/**
 * Maps agent IDs to a dot color for suggestion rows.
 * Email - red, Code - violet, Planning - green, default - gray.
 */
const AGENT_DOT_COLOR: Record<string, string> = {
  email: '#ea4335',
  code: '#8b5cf6',
  planning: '#22c55e',
};

/**
 * Maps agent IDs to a source label shown on the right side of suggestion rows.
 */
const AGENT_SOURCE_LABEL: Record<string, string> = {
  email: 'gmail.com',
  code: 'github.com',
  planning: 'notion.so',
};

/**
 * Builds a human-readable suggestion text from an agent's decision state.
 * Returns null if the agent has no decisions.
 */
function buildSuggestionText(agent: Agent): string | null {
  if (!agent.decisionCount || agent.decisionCount === 0) return null;
  if (agent.id === 'email') return `${agent.decisionCount} email${agent.decisionCount > 1 ? 's' : ''} need your reply`;
  if (agent.id === 'code') return `${agent.decisionCount} PR${agent.decisionCount > 1 ? 's' : ''} ready for review`;
  if (agent.id === 'planning') return `${agent.decisionCount} item${agent.decisionCount > 1 ? 's' : ''} need your approval`;
  return `${agent.decisionCount} decision${agent.decisionCount > 1 ? 's' : ''} pending`;
}

interface SuggestionRowProps {
  agent: Agent;
  onClick: () => void;
}

/**
 * SuggestionRow renders a single DIA-style suggestion item below the command bar.
 * - 44px height, 580px wide to match the command bar
 * - Left: 8px colored dot
 * - Center: white text, 14px, truncated
 * - Right: gray source label + chevron arrow
 * - Hover: rgba(255,255,255,0.04) background
 */
function SuggestionRow({ agent, onClick }: SuggestionRowProps) {
  const text = buildSuggestionText(agent);
  if (!text) return null;

  const dotColor = AGENT_DOT_COLOR[agent.id] ?? 'rgba(255,255,255,0.3)';
  const sourceLabel = AGENT_SOURCE_LABEL[agent.id] ?? '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        width: '580px',
        height: '44px',
        padding: '0 14px',
        borderRadius: '10px',
        cursor: 'pointer',
        transition: 'background 0.1s ease',
      }}
      whileHover={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
    >
      {/* Colored dot - agent type indicator */}
      <div
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: dotColor,
          flexShrink: 0,
        }}
      />

      {/* Suggestion text */}
      <span
        style={{
          flex: 1,
          fontSize: '14px',
          color: '#ffffff',
          letterSpacing: '-0.01em',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          lineHeight: 1,
        }}
      >
        {text}
      </span>

      {/* Source label */}
      <span
        style={{
          fontSize: '12px',
          color: 'rgba(255,255,255,0.3)',
          flexShrink: 0,
          letterSpacing: '0em',
        }}
      >
        {sourceLabel}
      </span>

      {/* Chevron arrow */}
      <ChevronRight
        size={14}
        strokeWidth={1.5}
        style={{ color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}
      />
    </motion.div>
  );
}

/**
 * HomeView renders the adaptive home screen.
 * commandBarPosition derives whether agents are active.
 */
export function HomeView() {
  const { agents, commandBarPosition, setActiveView } = useAppStore();

  const isActive = commandBarPosition === 'bottom';

  /** Agents that have pending decisions - used for suggestion rows in idle state */
  const agentsWithDecisions = agents.filter(
    (a) => a.decisionCount && a.decisionCount > 0
  ).slice(0, 4);

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#000000',
      }}
    >
      <AnimatePresence mode="wait">
        {isActive ? (
          /* ------------------------------------------------------------------ */
          /* Active layout                                                        */
          /* Cards + command bar as ONE centered group                            */
          /* ------------------------------------------------------------------ */
          <motion.div
            key="active"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              height: '100%',
            }}
          >
            {/* Agent cards row */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                gap: '16px',
                justifyContent: 'center',
                flexWrap: 'wrap',
                padding: '0 32px',
                marginBottom: '40px',
              }}
            >
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>

            {/* Command bar inline below cards */}
            <CommandBar position="center" />

            {/* Suggestion rows below command bar */}
            <AnimatePresence>
              {agentsWithDecisions.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, delay: 0.1 }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    marginTop: '8px',
                    width: '580px',
                  }}
                >
                  {agentsWithDecisions.map((agent, idx) => (
                    <div key={agent.id}>
                      {idx > 0 && (
                        <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.04)' }} />
                      )}
                      <SuggestionRow
                        agent={agent}
                        onClick={() => setActiveView(agent.decisionView ?? 'chat')}
                      />
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          /* ------------------------------------------------------------------ */
          /* Idle layout - DIA new tab style                                     */
          /* Orbit + "monet" text + command bar + suggestion rows, centered      */
          /* ------------------------------------------------------------------ */
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 1,
              width: '100%',
              height: '100%',
              marginTop: '-3vh',
            }}
          >
            {/* 3D orbit visualization - subtle, smaller */}
            <div style={{ opacity: 0.6 }}>
              <AgentOrbitWithSuspense agents={agents} size={110} />
            </div>

            {/* "monet" branding - DIA style: 28px, weight 300, tight tracking */}
            <h1
              style={{
                fontSize: '28px',
                fontWeight: 300,
                letterSpacing: '-0.02em',
                color: '#ffffff',
                lineHeight: 1,
                marginTop: '0px',
                marginBottom: '32px',
              }}
            >
              monet
            </h1>

            {/* Command bar - DIA exact style */}
            <CommandBar position="center" />

            {/* Suggestion rows - 16px below the command bar */}
            <AnimatePresence>
              {agentsWithDecisions.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, delay: 0.1 }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    marginTop: '8px',
                    width: '580px',
                  }}
                >
                  {agentsWithDecisions.map((agent, idx) => (
                    <div key={agent.id}>
                      {/* Subtle divider between items (not before the first) */}
                      {idx > 0 && (
                        <div
                          style={{
                            width: '100%',
                            height: '1px',
                            background: 'rgba(255,255,255,0.04)',
                          }}
                        />
                      )}
                      <SuggestionRow
                        agent={agent}
                        onClick={() => setActiveView(agent.decisionView ?? 'chat')}
                      />
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Command bar is now inline in both modes - no fixed bottom bar */}
    </div>
  );
}
