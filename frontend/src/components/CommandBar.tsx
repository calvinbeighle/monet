/**
 * components/CommandBar.tsx
 * DIA-style command input bar for the Monet home screen.
 *
 * Matches DIA browser's exact visual language:
 * - 580px wide, 44px tall
 * - #1a1a1a background, 1px solid rgba(255,255,255,0.08) border, 12px border-radius
 * - Magnifying glass icon on the LEFT (always visible)
 * - Send arrow on the RIGHT (only visible when text is entered)
 * - NO mic icon
 * - Focus: border becomes rgba(255,255,255,0.15), NO colored ring, NO glow
 * - Placeholder: "Ask anything..." at rgba(255,255,255,0.3)
 *
 * When position is 'bottom', renders fixed at the bottom with a fade gradient.
 */
import { useState } from 'react';
import { Search, ArrowUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/stores/appStore';
import type { CommandBarPosition } from '@/types';

interface CommandBarProps {
  position?: CommandBarPosition;
}

/**
 * The main command bar input. When position is 'center', renders as an inline
 * rounded bar at exactly 580px. When 'bottom', renders fixed at the bottom
 * of the viewport with a gradient fade, capped at 580px.
 */
export function CommandBar({ position = 'center' }: CommandBarProps) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const { submitIntent, isLoading } = useAppStore();

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;
    submitIntent(trimmed);
    setValue('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleSubmit();
  }

  const isBottom = position === 'bottom';

  return (
    <AnimatePresence mode="wait">
      {isBottom ? (
        <motion.div
          key="bottom"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
          className="fixed bottom-0 left-0 right-0 z-40 flex justify-center px-6 pb-5 pt-8"
          style={{
            background: 'linear-gradient(to top, rgba(0,0,0,0.95) 60%, rgba(0,0,0,0))',
          }}
        >
          <InputRow
            value={value}
            focused={focused}
            isLoading={isLoading}
            onChange={setValue}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={handleKeyDown}
            onSubmit={handleSubmit}
          />
        </motion.div>
      ) : (
        <motion.div
          key="center"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          <InputRow
            value={value}
            focused={focused}
            isLoading={isLoading}
            onChange={setValue}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={handleKeyDown}
            onSubmit={handleSubmit}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface InputRowProps {
  value: string;
  focused: boolean;
  isLoading: boolean;
  onChange: (v: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
}

/**
 * The inner input row - DIA browser style.
 * 580px wide, 44px tall, #1a1a1a background.
 * Search icon on left, send arrow on right (only when text present).
 * Focus adds a slightly brighter border with no glow or ring.
 */
function InputRow({
  value,
  focused,
  isLoading,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  onSubmit,
}: InputRowProps) {
  const hasText = value.trim().length > 0;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        width: '580px',
        height: '44px',
        padding: '0 12px',
        background: '#1a1a1a',
        border: `1px solid ${focused ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)'}`,
        borderRadius: '12px',
        transition: 'border-color 0.15s ease',
        boxSizing: 'border-box',
      }}
    >
      {/* Search icon - always visible on the left */}
      <Search
        size={16}
        strokeWidth={2}
        style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}
      />

      {/* Text input */}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder="Ask anything..."
        disabled={isLoading}
        autoFocus
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          fontSize: '14px',
          color: '#ffffff',
          letterSpacing: '-0.01em',
        }}
      />

      {/* Send button - only visible when text is entered */}
      <AnimatePresence>
        {(hasText || isLoading) && (
          <motion.button
            key="send"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.12 }}
            onClick={onSubmit}
            disabled={isLoading || !hasText}
            style={{
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '8px',
              background: hasText && !isLoading ? '#8b5cf6' : 'rgba(255,255,255,0.08)',
              border: 'none',
              cursor: hasText && !isLoading ? 'pointer' : 'default',
              color: '#ffffff',
              flexShrink: 0,
              transition: 'background 0.12s ease',
            }}
          >
            {isLoading ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  border: '2px solid rgba(139,92,246,0.4)',
                  borderTopColor: '#8b5cf6',
                }}
              />
            ) : (
              <ArrowUp size={14} strokeWidth={2} />
            )}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
