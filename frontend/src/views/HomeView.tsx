/**
 * views/HomeView.tsx
 * Clean home screen - DIA-style with the 3D orbit visualization centered,
 * "monet" text below it, and the command bar. Nothing else.
 */
import { AgentOrbitWithSuspense } from '@/components/AgentOrbit';
import { CommandBar } from '@/components/CommandBar';
import { useAppStore } from '@/stores/appStore';

/**
 * HomeView renders the minimal landing screen.
 * Centered layout: 3D orbit -> "monet" heading -> command bar.
 */
export function HomeView() {
  const { agents } = useAppStore();

  return (
    <div className="flex flex-col items-center justify-center flex-1 w-full h-full gap-0">
      {/* 3D orbit visualization */}
      <AgentOrbitWithSuspense agents={agents} size={220} />

      {/* Branding */}
      <div className="flex flex-col items-center gap-1 mt-2 mb-10">
        <h1
          className="text-3xl font-light tracking-tight"
          style={{ color: 'var(--text-primary)', letterSpacing: '-0.5px' }}
        >
          monet
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Your AI decision copilot
        </p>
      </div>

      {/* Command bar - full width up to max */}
      <div className="w-full px-6" style={{ maxWidth: '600px' }}>
        <CommandBar />
      </div>
    </div>
  );
}
