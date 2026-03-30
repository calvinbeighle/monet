/**
 * views/DiffView.tsx
 * Placeholder for the side-by-side diff/code review view.
 * Shown when activeView is 'diff'.
 */
import { GitCompare } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

/**
 * Diff view placeholder with a two-column fake diff layout.
 */
export function DiffView() {
  const { setActiveView, activeSuggestion } = useAppStore();

  const diffLines = [
    { type: 'context', text: '  const handler = async (req, res) => {' },
    { type: 'removed', text: '-   const data = await fetchData(req.body);' },
    { type: 'added', text: '+   const data = await fetchData(req.body, { timeout: 5000 });' },
    { type: 'context', text: '    if (!data) {' },
    { type: 'removed', text: '-     return res.status(404).json({ error: "not found" });' },
    { type: 'added', text: '+     return res.status(404).json({ error: "Not found", code: 404 });' },
    { type: 'context', text: '    }' },
  ];

  const lineColors: Record<string, string> = {
    context: 'transparent',
    removed: 'rgba(239, 68, 68, 0.12)',
    added: 'rgba(34, 197, 94, 0.12)',
  };

  const textColors: Record<string, string> = {
    context: 'var(--text-secondary)',
    removed: '#ef4444',
    added: '#22c55e',
  };

  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-4 px-6">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{ background: 'var(--surface-elevated)' }}
      >
        <GitCompare size={24} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
      </div>
      <div className="text-center">
        <h2 style={{ color: 'var(--text-primary)', fontSize: '18px', fontWeight: 500 }}>
          Diff View
        </h2>
        {activeSuggestion && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
            {activeSuggestion.title}
          </p>
        )}
      </div>

      {/* Fake diff block */}
      <div
        className="w-full rounded-xl overflow-hidden font-mono"
        style={{
          maxWidth: '640px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          fontSize: '11px',
        }}
      >
        {/* File header */}
        <div
          className="px-4 py-2"
          style={{
            background: 'var(--surface-elevated)',
            borderBottom: '1px solid var(--border)',
            color: 'var(--text-muted)',
            fontSize: '11px',
          }}
        >
          src/api/handler.ts
        </div>
        {diffLines.map((line, i) => (
          <div
            key={i}
            className="px-4 py-0.5"
            style={{ background: lineColors[line.type], color: textColors[line.type] }}
          >
            {line.text}
          </div>
        ))}
      </div>

      <button
        onClick={() => setActiveView('welcome')}
        className="px-4 py-2 rounded-lg text-sm cursor-pointer transition-all duration-150"
        style={{
          background: 'var(--surface-elevated)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border-strong)',
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
