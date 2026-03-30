/**
 * views/HomeView.tsx
 * The ONLY screen in Monet. Everything happens here.
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
 *   - Command bar below cards
 *
 * Chat is inline - responses stream directly below the command bar (DIA style).
 * Decision views (tinder/diff/whiteboard) open as modal overlays - see App.tsx.
 *
 * Uses Framer Motion AnimatePresence for transitions.
 */
import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, X } from 'lucide-react';
import { AgentOrbitWithSuspense } from '@/components/AgentOrbit';
import { CommandBar } from '@/components/CommandBar';
import { AgentCard } from '@/components/AgentCard';
import { useAppStore } from '@/stores/appStore';
import type { Agent } from '@/types';
import type { InlineChatMessage } from '@/stores/appStore';

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
 * A blinking cursor appended to streaming assistant messages in inline chat.
 */
function StreamingCursor() {
  return (
    <motion.span
      className="inline-block w-[2px] h-[1em] bg-violet-400 ml-[1px] align-middle"
      animate={{ opacity: [1, 0, 1] }}
      transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
    />
  );
}

interface InlineChatMessageRowProps {
  message: InlineChatMessage;
}

/**
 * Renders a single inline chat message in DIA/terminal style.
 * User messages: "You: " prefix in zinc-500, text in white.
 * Assistant messages: "monet: " prefix in violet-400, text in zinc-300.
 * No bubbles - just prefixed text for a clean minimal look.
 */
function InlineChatMessageRow({ message }: InlineChatMessageRowProps) {
  const isUser = message.role === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      style={{
        width: '580px',
        padding: '4px 0',
        lineHeight: '1.6',
        fontSize: '14px',
        letterSpacing: '-0.01em',
      }}
    >
      <span style={{ color: isUser ? 'rgba(161,161,170,0.7)' : '#a78bfa', marginRight: '6px', fontWeight: 500 }}>
        {isUser ? 'You:' : 'monet:'}
      </span>
      <span style={{ color: isUser ? '#ffffff' : 'rgba(228,228,231,0.85)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {message.text}
        {message.isStreaming && message.text.length > 0 && <StreamingCursor />}
        {message.isStreaming && message.text.length === 0 && (
          <motion.span
            style={{ color: 'rgba(161,161,170,0.5)', fontSize: '12px' }}
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          >
            thinking...
          </motion.span>
        )}
      </span>
    </motion.div>
  );
}

/**
 * HomeView renders the adaptive home screen - the ONLY screen in Monet.
 * commandBarPosition derives whether agents are active.
 */
export function HomeView() {
  const { agents, setOverlayView, inlineChatMessages, clearInlineChat } = useAppStore();
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Always show agent cards if agents exist - idle orbit only on first load with no agents
  const hasAgents = agents.length > 0;
  const isActive = hasAgents;
  const hasChatMessages = inlineChatMessages.length > 0;

  /** Agents that have pending decisions - used for suggestion rows in idle state */
  const agentsWithDecisions = agents.filter(
    (a) => a.decisionCount && a.decisionCount > 0
  ).slice(0, 4);

  // Auto-scroll to the latest chat message when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [inlineChatMessages]);

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
          /* Cards + scrollable chat area + command bar as ONE centered group    */
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
              justifyContent: hasChatMessages ? 'flex-start' : 'center',
              width: '100%',
              height: '100%',
              paddingTop: hasChatMessages ? '32px' : '0',
              overflow: 'hidden',
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
                marginBottom: hasChatMessages ? '24px' : '40px',
                flexShrink: 0,
              }}
            >
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>

            {/* Inline chat messages - scrollable area between cards and command bar */}
            <AnimatePresence>
              {hasChatMessages && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  style={{
                    flex: 1,
                    width: '580px',
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    paddingBottom: '8px',
                  }}
                >
                  {inlineChatMessages.map((msg) => (
                    <InlineChatMessageRow key={msg.id} message={msg} />
                  ))}
                  <div ref={chatEndRef} />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Command bar inline below cards (or below chat) */}
            <div style={{ flexShrink: 0, marginTop: hasChatMessages ? '8px' : '0' }}>
              <CommandBar position="center" />
            </div>

            {/* Clear chat button - shown when there are messages */}
            <AnimatePresence>
              {hasChatMessages && (
                <motion.button
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15 }}
                  onClick={clearInlineChat}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    marginTop: '10px',
                    fontSize: '12px',
                    color: 'rgba(161,161,170,0.4)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    transition: 'color 0.1s ease',
                    flexShrink: 0,
                  }}
                  whileHover={{ color: 'rgba(161,161,170,0.8)' } as any}
                >
                  <X size={11} strokeWidth={1.5} />
                  clear
                </motion.button>
              )}
            </AnimatePresence>

            {/* Suggestion rows below command bar - only when no chat messages */}
            <AnimatePresence>
              {agentsWithDecisions.length > 0 && !hasChatMessages && (
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
                    flexShrink: 0,
                  }}
                >
                  {agentsWithDecisions.map((agent, idx) => (
                    <div key={agent.id}>
                      {idx > 0 && (
                        <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.04)' }} />
                      )}
                      <SuggestionRow
                        agent={agent}
                        onClick={() => setOverlayView((agent.decisionView as 'tinder' | 'diff' | 'whiteboard') ?? 'tinder')}
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
                        onClick={() => setOverlayView((agent.decisionView as 'tinder' | 'diff' | 'whiteboard') ?? 'tinder')}
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
