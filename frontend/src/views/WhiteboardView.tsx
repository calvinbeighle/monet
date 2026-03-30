/**
 * views/WhiteboardView.tsx
 * Placeholder for the canvas-based whiteboard/node view.
 * Shown when activeView is 'whiteboard'.
 */
import { Network } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

/** A fake node on the whiteboard canvas */
function CanvasNode({ x, y, label, color }: { x: number; y: number; label: string; color: string }) {
  return (
    <div
      className="absolute rounded-xl px-3 py-2 text-xs font-medium"
      style={{
        left: x,
        top: y,
        background: 'var(--surface-elevated)',
        border: `1px solid ${color}44`,
        color: 'var(--text-secondary)',
        boxShadow: `0 0 0 1px ${color}22`,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color }}>{label}</span>
    </div>
  );
}

/**
 * Whiteboard view placeholder with a fake node canvas.
 */
export function WhiteboardView() {
  const { setActiveView, activeSuggestion } = useAppStore();

  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-4 px-6">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{ background: 'var(--surface-elevated)' }}
      >
        <Network size={24} strokeWidth={1.5} style={{ color: '#e6e6e6' }} />
      </div>
      <div className="text-center">
        <h2 style={{ color: 'var(--text-primary)', fontSize: '18px', fontWeight: 500 }}>
          Whiteboard View
        </h2>
        {activeSuggestion && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
            {activeSuggestion.title}
          </p>
        )}
        <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '4px' }}>
          Visual canvas with connected agent nodes
        </p>
      </div>

      {/* Fake canvas area */}
      <div
        className="relative w-full rounded-xl overflow-hidden"
        style={{
          maxWidth: '560px',
          height: '180px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          backgroundImage: 'radial-gradient(circle, var(--border-strong) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      >
        <CanvasNode x={60} y={40} label="Email Agent" color="var(--success)" />
        <CanvasNode x={220} y={80} label="Custom Templates" color="var(--accent)" />
        <CanvasNode x={370} y={35} label="Notion Sync" color="#e6e6e6" />

        {/* Fake connecting lines using SVG */}
        <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
          <line x1="130" y1="56" x2="220" y2="96" stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="4 4" />
          <line x1="320" y1="96" x2="370" y2="51" stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="4 4" />
        </svg>
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
