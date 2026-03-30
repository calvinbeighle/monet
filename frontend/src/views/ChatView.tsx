/**
 * views/ChatView.tsx
 * Placeholder for the iMessage-style chat view.
 * Shown when activeView is 'chat'.
 */
import { MessageCircle } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

/**
 * Chat view placeholder with a back button to return to the welcome screen.
 */
export function ChatView() {
  const { setActiveView } = useAppStore();

  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-4">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{ background: 'var(--surface-elevated)' }}
      >
        <MessageCircle size={24} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
      </div>
      <div className="text-center">
        <h2 style={{ color: 'var(--text-primary)', fontSize: '18px', fontWeight: 500 }}>
          Chat View
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
          iMessage-style conversation with your agent
        </p>
      </div>
      <button
        onClick={() => setActiveView('welcome')}
        className="px-4 py-2 rounded-lg text-sm cursor-pointer transition-all duration-150"
        style={{
          background: 'var(--surface-elevated)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border-strong)',
          marginTop: '8px',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)';
        }}
      >
        - Back to Home
      </button>
    </div>
  );
}
