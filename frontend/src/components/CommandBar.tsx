/**
 * components/CommandBar.tsx
 * Adaptive command input bar for the Monet home screen.
 * Accepts a position prop: 'center' renders inline, 'bottom' renders fixed
 * at the bottom of the viewport with glass-morphism styling.
 * Framer Motion animates the transition between positions.
 * On submit it triggers submitIntent from the store (handles loading + navigation).
 */
import { useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/stores/appStore';
import type { CommandBarPosition } from '@/types';

interface CommandBarProps {
  position?: CommandBarPosition;
}

/**
 * The main command bar input. When position is 'center', renders as an inline
 * rounded bar. When 'bottom', renders as a fixed full-width bar at the bottom
 * with backdrop blur and a semi-transparent background.
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
          className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-4 pt-3"
          style={{
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            background: 'linear-gradient(to top, rgba(9,9,11,0.95) 60%, rgba(9,9,11,0.0))',
          }}
        >
          <div className="mx-auto" style={{ maxWidth: '720px' }}>
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
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="center"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="w-full px-6"
          style={{ maxWidth: '600px' }}
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
 * The inner input row shared between both position modes.
 * Styled consistently with a subtle violet focus ring.
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
  return (
    <div
      className="flex items-center gap-3 px-4 w-full rounded-xl transition-all duration-200"
      style={{
        background: 'var(--surface)',
        border: `1px solid ${focused ? 'rgba(139, 92, 246, 0.45)' : 'var(--border-strong)'}`,
        boxShadow: focused
          ? '0 0 0 3px rgba(139, 92, 246, 0.1), 0 8px 32px rgba(0,0,0,0.4)'
          : '0 4px 24px rgba(0,0,0,0.25)',
        height: '52px',
      }}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder="Ask anything..."
        className="flex-1 bg-transparent outline-none text-sm"
        style={{ color: 'var(--text-primary)' }}
        disabled={isLoading}
        autoFocus
      />

      <button
        onClick={onSubmit}
        disabled={isLoading || !value.trim()}
        className="w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150 shrink-0 disabled:cursor-default"
        style={{
          background: value.trim() && !isLoading ? 'var(--accent)' : 'var(--surface-elevated)',
          color: value.trim() && !isLoading ? '#fff' : 'var(--text-muted)',
        }}
      >
        {isLoading ? (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
            className="w-3 h-3 rounded-full border-2"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
          />
        ) : (
          <ArrowUp size={14} strokeWidth={2} />
        )}
      </button>
    </div>
  );
}
