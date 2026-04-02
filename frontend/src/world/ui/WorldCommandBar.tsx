/**
 * src/world/ui/WorldCommandBar.tsx
 * Floating command bar fixed to the bottom-center of the viewport.
 * Lets the user send a message to any agent without first clicking a character -
 * defaults to the email agent as the orchestrator when no chat is open.
 */

import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ArrowUp } from 'lucide-react';
import { useWorldStore } from '../stores/worldStore';

export function WorldCommandBar() {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { sendMessage, isChatOpen, selectAgent, agents, selectedAgentId } = useWorldStore();

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || sending) return;

    // Find the target agent - prefer selected, then first idle, then first
    let targetId = selectedAgentId;
    if (!targetId && agents.length > 0) {
      const target = agents.find(a => a.status === 'idle') || agents[0];
      targetId = target.id;
    }
    if (!targetId) return;

    // Check if the target agent is busy
    const targetAgent = agents.find(a => a.id === targetId);
    if (targetAgent && targetAgent.status === 'running') return;

    // Open the chat panel for this agent if not already open
    if (!isChatOpen || selectedAgentId !== targetId) {
      selectAgent(targetId);
    }

    // Brief lock to prevent double-submits from rapid Enter presses
    setSending(true);
    sendMessage(trimmed);
    setValue('');
    setTimeout(() => setSending(false), 500);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSubmit();
  }

  function handleOverlayClick() {
    setFocused(false);
    inputRef.current?.blur();
  }

  const hasText = value.trim().length > 0;

  const glowColor = focused
    ? '0 0 30px rgba(56, 189, 198, 0.5), 0 0 80px rgba(56, 189, 198, 0.25), 0 0 120px rgba(56, 189, 198, 0.1), 0 8px 32px rgba(0, 0, 0, 0.6)'
    : '0 0 20px rgba(56, 189, 198, 0.25), 0 0 60px rgba(56, 189, 198, 0.1), 0 0 100px rgba(56, 189, 198, 0.05), 0 6px 24px rgba(0, 0, 0, 0.5)';

  const borderColor = focused
    ? 'rgba(56, 189, 198, 0.6)'
    : 'rgba(56, 189, 198, 0.25)';

  return (
    <>
      <AnimatePresence>
        {focused && (
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={handleOverlayClick}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.6)',
              zIndex: 49,
            }}
          />
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.4 }}
        style={{
          position: 'fixed',
          bottom: '80px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 50,
        }}
      >
        <div style={{ position: 'relative', width: '90vw', maxWidth: '560px' }}>
          <motion.div
            animate={{ opacity: focused ? 0.7 : 0.35 }}
            transition={{ duration: 0.3 }}
            style={{
              position: 'absolute',
              top: '-40px',
              left: '-60px',
              right: '-60px',
              bottom: '-40px',
              background: 'radial-gradient(ellipse at center, rgba(56, 189, 198, 0.15) 0%, rgba(56, 189, 198, 0.05) 40%, transparent 70%)',
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
          <motion.div
            animate={{
              boxShadow: glowColor,
              borderColor: borderColor,
            }}
            transition={{ duration: 0.3 }}
            style={{
              position: 'relative',
              zIndex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              width: '100%',
              height: '64px',
              padding: '0 20px',
              background: 'rgba(18, 18, 20, 0.95)',
              border: `1px solid ${borderColor}`,
              borderRadius: '18px',
              boxSizing: 'border-box',
              backdropFilter: 'blur(20px)',
            }}
          >
            <Search
              size={18}
              strokeWidth={2}
              style={{
                color: focused ? 'rgba(56, 189, 198, 0.7)' : 'rgba(255,255,255,0.25)',
                flexShrink: 0,
                transition: 'color 0.3s ease',
              }}
            />

            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="Ask anything..."
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: '16px',
                color: '#ffffff',
                letterSpacing: '-0.01em',
              }}
            />

            <AnimatePresence>
              {hasText && (
                <motion.button
                  key="send"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.12 }}
                  onClick={handleSubmit}
                  disabled={sending || !hasText}
                  style={{
                    width: '30px',
                    height: '30px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '10px',
                    background: '#8b5cf6',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#ffffff',
                    flexShrink: 0,
                  }}
                >
                  <ArrowUp size={14} strokeWidth={2} />
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </motion.div>
    </>
  );
}
