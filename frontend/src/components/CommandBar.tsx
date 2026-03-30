/**
 * components/CommandBar.tsx
 * DIA-style centered command input bar for the welcome screen.
 * Supports text input with keyboard submit (Enter) and cosmetic mic/send buttons.
 */
import { useState } from 'react';
import { Search, Mic, ArrowUp } from 'lucide-react';

interface CommandBarProps {
  /** Called when the user submits a query */
  onSubmit: (value: string) => void;
}

/**
 * Renders the main command input with a search icon, placeholder, mic, and send button.
 * Has a violet focus ring and backdrop blur for a glass-like appearance.
 */
export function CommandBar({ onSubmit }: CommandBarProps) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && value.trim()) {
      onSubmit(value.trim());
      setValue('');
    }
  }

  function handleSend() {
    if (value.trim()) {
      onSubmit(value.trim());
      setValue('');
    }
  }

  return (
    <div
      className="flex items-center gap-3 px-4 w-full rounded-xl transition-all duration-200"
      style={{
        background: 'var(--surface)',
        border: `1px solid ${focused ? 'rgba(139, 92, 246, 0.5)' : 'var(--border-strong)'}`,
        boxShadow: focused
          ? '0 0 0 3px rgba(139, 92, 246, 0.12), 0 4px 24px rgba(0,0,0,0.3)'
          : '0 4px 24px rgba(0,0,0,0.2)',
        height: '52px',
        backdropFilter: 'blur(12px)',
        maxWidth: '640px',
      }}
    >
      {/* Search icon */}
      <Search
        size={16}
        strokeWidth={1.5}
        style={{ color: 'var(--text-muted)', flexShrink: 0 }}
      />

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
        style={{
          color: 'var(--text-primary)',
          fontSize: '14px',
        }}
      />

      {/* Right-side controls */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Mic icon - cosmetic */}
        <button
          className="w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer transition-colors duration-150"
          style={{ color: 'var(--text-muted)', background: 'transparent' }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
          }}
          tabIndex={-1}
        >
          <Mic size={14} strokeWidth={1.5} />
        </button>

        {/* Send button */}
        <button
          onClick={handleSend}
          className="w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150 flex-shrink-0"
          style={{
            background: value.trim() ? 'var(--accent)' : 'var(--surface-elevated)',
            color: value.trim() ? '#fff' : 'var(--text-muted)',
          }}
          onMouseEnter={(e) => {
            if (value.trim())
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-hover)';
          }}
          onMouseLeave={(e) => {
            if (value.trim())
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)';
          }}
        >
          <ArrowUp size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
