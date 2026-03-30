/**
 * views/HomeView.tsx
 * Main home screen with two layout modes:
 * - Idle (no active agents, no decisions): centered 3D orbit + branding + command bar
 * - Active (agents running or have decisions): agent card row at top, command bar fixed at bottom
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
 * When agents are active, shows agent cards in a flex row + bottom command bar.
 */
export function HomeView() {
  const { agents, commandBarPosition } = useAppStore();

  const isActive = commandBarPosition === 'bottom';

  return (
    <div className="relative flex flex-col w-full h-full overflow-hidden bg-zinc-950">
      <AnimatePresence mode="wait">
        {isActive ? (
          /* Active layout - everything centered on screen */
          <motion.div
            key="active"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="flex flex-col items-center w-full h-full"
          >
            {/* Top spacer - pushes content to ~30% from top */}
            <div className="flex-[2]" />

            {/* Section label */}
            <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-500 font-medium mb-5">
              Active Agents
            </p>

            {/* Agent cards - centered row */}
            <div className="flex flex-row gap-4 justify-center flex-wrap px-8">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>

            {/* Bottom spacer + command bar */}
            <div className="flex-[3]" />

            <div className="w-full px-8 pb-8 shrink-0">
              <div className="mx-auto" style={{ maxWidth: '560px' }}>
                <CommandBar position="center" />
              </div>
            </div>
          </motion.div>
        ) : (
          /* Idle layout - centered orbit + branding + command bar */
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="flex flex-col items-center justify-center flex-1 w-full h-full"
            style={{ marginTop: '-5vh' }}
          >
            {/* 3D orbit visualization */}
            <AgentOrbitWithSuspense agents={agents} size={140} />

            {/* Branding block */}
            <div className="flex flex-col items-center mt-0 mb-12">
              <h1
                className="text-zinc-100"
                style={{
                  fontSize: '32px',
                  fontWeight: 200,
                  letterSpacing: '-0.03em',
                  lineHeight: 1,
                }}
              >
                monet
              </h1>
              <p className="text-zinc-500 mt-1" style={{ fontSize: '14px' }}>
                Your AI decision copilot
              </p>
            </div>

            {/* Command bar - inline centered, max 560px */}
            <CommandBar position="center" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom command bar removed - now inline in active layout */}
    </div>
  );
}
