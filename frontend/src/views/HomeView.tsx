/**
 * views/HomeView.tsx
 * Main home screen with two layout modes:
 * - Idle (no active agents, no decisions): centered 3D orbit + branding + command bar
 * - Active (agents running or have decisions): agent card grid at top, command bar fixed at bottom
 *
 * Uses Framer Motion for the layout transition between modes.
 * AgentOrbit is always visible in the idle layout; hidden in the active layout.
 */
import { motion, AnimatePresence } from 'framer-motion';
import { AgentOrbitWithSuspense } from '@/components/AgentOrbit';
import { CommandBar } from '@/components/CommandBar';
import { AgentCard } from '@/components/AgentCard';
import { useAppStore } from '@/stores/appStore';

/**
 * HomeView renders the adaptive home screen.
 * When no agents are active, shows the centered orbit + command bar.
 * When agents are active, shows agent cards in a grid + bottom command bar.
 */
export function HomeView() {
  const { agents, commandBarPosition } = useAppStore();

  const isActive = commandBarPosition === 'bottom';

  return (
    <div
      className="relative flex flex-col w-full h-full overflow-hidden"
      style={{ background: 'var(--bg)' }}
    >
      <AnimatePresence mode="wait">
        {isActive ? (
          /* Active layout - agent cards grid */
          <motion.div
            key="active"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="flex flex-col w-full h-full"
            style={{ paddingBottom: '80px' }}
          >
            {/* Page header - minimal wordmark */}
            <div className="px-6 pt-8 pb-6">
              <h1
                className="text-xl font-light tracking-tight"
                style={{ color: 'var(--text-primary)', letterSpacing: '-0.5px' }}
              >
                monet
              </h1>
            </div>

            {/* Agent cards grid */}
            <div className="flex-1 px-6 overflow-y-auto">
              <div className="flex flex-wrap gap-4">
                {agents.map((agent) => (
                  <AgentCard key={agent.id} agent={agent} />
                ))}
              </div>
            </div>
          </motion.div>
        ) : (
          /* Idle layout - centered orbit + command bar */
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="flex flex-col items-center justify-center flex-1 w-full h-full gap-0"
          >
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

            {/* Command bar - inline centered */}
            <CommandBar position="center" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom command bar - rendered outside AnimatePresence so it animates in independently */}
      {isActive && <CommandBar position="bottom" />}
    </div>
  );
}
