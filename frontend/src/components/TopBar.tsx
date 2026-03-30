/**
 * components/TopBar.tsx
 * Fixed 48px top bar with hamburger menu toggle and Monitor button.
 * Left: hamburger icon to toggle sidebar sheet.
 * Right: Monitor button with pending decision count badge.
 */
import { Menu, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/stores/appStore';

/**
 * TopBar renders a minimal fixed strip at the top of the viewport.
 * Hamburger on the left opens the sidebar Sheet.
 * Monitor button on the right switches to the Monitor view.
 */
export function TopBar() {
  const { toggleSidebar, setActiveView, decisions, activeView } = useAppStore();

  return (
    <div
      className="fixed top-0 left-0 right-0 flex items-center justify-between px-3 z-50"
      style={{
        height: '48px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
      }}
    >
      {/* Left: hamburger */}
      <Button
        variant="ghost"
        size="icon"
        className="w-8 h-8 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
        onClick={toggleSidebar}
        aria-label="Toggle sidebar"
      >
        <Menu size={16} strokeWidth={1.5} />
      </Button>

      {/* Right: Monitor button */}
      <Button
        variant={activeView === 'monitor' ? 'secondary' : 'ghost'}
        size="sm"
        className="h-7 text-xs gap-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
        onClick={() => setActiveView('monitor')}
      >
        <Activity size={13} strokeWidth={1.5} />
        Monitor
        {decisions.length > 0 && (
          <Badge
            variant="secondary"
            className="h-4 px-1 text-[10px] bg-violet-600/80 text-violet-100 ml-0.5"
          >
            {decisions.length}
          </Badge>
        )}
      </Button>
    </div>
  );
}
