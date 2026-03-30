/**
 * views/TinderView.tsx
 * Placeholder for the swipe-to-triage card view.
 * Shown when activeView is 'tinder'.
 */
import { Layers } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

/**
 * Tinder/swipe view placeholder. Displays context from the active suggestion if present.
 */
export function TinderView() {
  const { setActiveView, activeSuggestion } = useAppStore();

  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-4">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{ background: 'var(--surface-elevated)' }}
      >
        <Layers size={24} strokeWidth={1.5} style={{ color: '#ea4335' }} />
      </div>
      <div className="text-center" style={{ maxWidth: '360px' }}>
        <h2 style={{ color: 'var(--text-primary)', fontSize: '18px', fontWeight: 500 }}>
          Triage View
        </h2>
        {activeSuggestion && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '6px' }}>
            {activeSuggestion.title}
          </p>
        )}
        <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '4px' }}>
          Swipe right to keep, left to archive
        </p>
      </div>

      {/* Fake card stack */}
      <div className="relative w-72 h-40" style={{ marginTop: '8px' }}>
        {[2, 1, 0].map((offset) => (
          <div
            key={offset}
            className="absolute inset-0 rounded-2xl"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border-strong)',
              transform: `translateY(${offset * -6}px) scale(${1 - offset * 0.03})`,
              zIndex: 3 - offset,
            }}
          />
        ))}
        <div
          className="absolute inset-0 rounded-2xl flex items-center justify-center"
          style={{ zIndex: 4 }}
        >
          <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Email preview here</span>
        </div>
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
