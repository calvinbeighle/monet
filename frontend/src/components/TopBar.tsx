/**
 * components/TopBar.tsx
 * Top navigation bar with sidebar toggle, navigation arrows, and action buttons.
 * Sits above both the sidebar and main content as a fixed strip.
 */
import { ChevronLeft, ChevronRight, RotateCw, Menu, Zap, User } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

/** A small icon button with hover effect */
function IconButton({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-7 h-7 flex items-center justify-center rounded-md cursor-pointer transition-all duration-150"
      style={{ color: 'var(--text-muted)', background: 'transparent' }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = 'var(--surface-elevated)';
        el.style.color = 'var(--text-secondary)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = 'transparent';
        el.style.color = 'var(--text-muted)';
      }}
    >
      {children}
    </button>
  );
}

/** A small pill button for Skills / Personalization */
function PillButton({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <button
      className="flex items-center gap-1.5 px-3 h-7 rounded-full text-xs font-medium cursor-pointer transition-all duration-150"
      style={{
        background: 'var(--surface)',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border-strong)',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = 'var(--surface-elevated)';
        el.style.color = 'var(--text-primary)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = 'var(--surface)';
        el.style.color = 'var(--text-secondary)';
      }}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * TopBar component renders a 48px tall navigation strip across the full width.
 * Left side: hamburger, back, forward, reload. Right side: Skills, Personalization.
 */
export function TopBar() {
  const { toggleSidebar } = useAppStore();

  return (
    <div
      className="flex items-center justify-between px-3 w-full flex-shrink-0"
      style={{
        height: '48px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
      }}
    >
      {/* Left nav controls */}
      <div className="flex items-center gap-1">
        <IconButton onClick={toggleSidebar}>
          <Menu size={15} strokeWidth={1.5} />
        </IconButton>
        <div style={{ width: '1px', height: '16px', background: 'var(--border-strong)', margin: '0 4px' }} />
        <IconButton>
          <ChevronLeft size={15} strokeWidth={1.5} />
        </IconButton>
        <IconButton>
          <ChevronRight size={15} strokeWidth={1.5} />
        </IconButton>
        <IconButton>
          <RotateCw size={13} strokeWidth={1.5} />
        </IconButton>
      </div>

      {/* Right action pills */}
      <div className="flex items-center gap-2">
        <PillButton label="Skills" icon={<Zap size={11} strokeWidth={1.5} />} />
        <PillButton label="Personalization" icon={<User size={11} strokeWidth={1.5} />} />
      </div>
    </div>
  );
}
