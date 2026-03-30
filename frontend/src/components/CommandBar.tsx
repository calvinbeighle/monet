/**
 * components/CommandBar.tsx
 * Adaptive command input bar for the Monet home screen.
 * Accepts a position prop: 'center' renders inline, 'bottom' renders fixed
 * at the bottom of the viewport with a gradient fade background.
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
 * rounded bar capped at 560px. When 'bottom', renders as a fixed full-width
 * bar at the bottom with a gradient fade and max-width 640px.
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
          className="fixed bottom-0 left-0 right-0 z-40 px-6 pb-5 pt-8"
          style={{
            background: 'linear-gradient(to top, rgba(9,9,11,0.95) 60%, rgba(9,9,11,0))',
          }}
        >
          <div className="mx-auto" style={{ maxWidth: '640px' }}>
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
          style={{ maxWidth: '560px' }}
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
 * 48px height, zinc-900 background, zinc-800 border.
 * On focus: ring-2 ring-violet-500/20, border-zinc-700.
 * No search icon - just the input text and send button.
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
      className={`flex items-center gap-3 px-4 w-full rounded-xl bg-zinc-900 border transition-all duration-200 ${
        focused
          ? 'border-zinc-700 ring-2 ring-violet-500/20'
          : 'border-zinc-800'
      }`}
      style={{ height: '48px' }}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder="Ask anything..."
        className="flex-1 bg-transparent outline-none text-[14px] text-zinc-100 placeholder:text-zinc-500"
        disabled={isLoading}
        autoFocus
      />

      <button
        onClick={onSubmit}
        disabled={isLoading || !value.trim()}
        className={`w-7 h-7 flex items-center justify-center rounded-lg shrink-0 transition-all duration-150 ${
          value.trim() && !isLoading
            ? 'bg-violet-600 text-white cursor-pointer hover:bg-violet-500'
            : 'bg-zinc-800 text-zinc-500 cursor-default'
        }`}
      >
        {isLoading ? (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
            className="w-3 h-3 rounded-full border-2 border-violet-500 border-t-transparent"
          />
        ) : (
          <ArrowUp size={14} strokeWidth={2} />
        )}
      </button>
    </div>
  );
}
