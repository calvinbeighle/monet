/**
 * components/CommandBar.tsx
 * DIA-style centered command input bar for the home screen.
 * Determines which view to open based on the query text.
 */
import { useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import type { ActiveView } from '@/types';

/**
 * Determines the appropriate view to open based on query text.
 * Email/inbox keywords - tinder, code/PR keywords - diff, plan keywords - whiteboard,
 * everything else - chat.
 */
function resolveView(query: string): ActiveView {
  const q = query.toLowerCase();
  if (q.includes('email') || q.includes('inbox') || q.includes('triage')) return 'tinder';
  if (q.includes('code') || q.includes('pr') || q.includes('diff') || q.includes('review')) return 'diff';
  if (q.includes('plan') || q.includes('sprint') || q.includes('board') || q.includes('whiteboard')) return 'whiteboard';
  return 'chat';
}

/**
 * The main command bar input. On submit it resolves the target view
 * and navigates to it via the Zustand store.
 */
export function CommandBar() {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const { setActiveView } = useAppStore();

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    const view = resolveView(trimmed);
    setValue('');
    setActiveView(view);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleSubmit();
  }

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
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* Main input */}
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Ask anything..."
        className="flex-1 bg-transparent outline-none text-sm"
        style={{ color: 'var(--text-primary)' }}
        autoFocus
      />

      {/* Send button */}
      <button
        onClick={handleSubmit}
        className="w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150 shrink-0"
        style={{
          background: value.trim() ? 'var(--accent)' : 'var(--surface-elevated)',
          color: value.trim() ? '#fff' : 'var(--text-muted)',
        }}
      >
        <ArrowUp size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
