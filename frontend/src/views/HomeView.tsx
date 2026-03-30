/**
 * views/HomeView.tsx
 * Main home screen with two layout modes:
 *
 * Idle  (no active agents, no decisions):
 *   - Centered 3D orbit + "monet" branding + command bar, all as one vertically
 *     centered group with a slight -3vh upward offset.
 *
 * Active (any agent running or has decisions):
 *   - Agent card row centered horizontally
 *   - Command bar 48px below the cards
 *   - The whole group is vertically centered with -3vh upward offset
 *   - NO "ACTIVE AGENTS" label
 *   - Command bar is NOT fixed - it flows naturally below the cards
 *
 * Uses Framer Motion AnimatePresence for the transition between modes.
 */
import { motion, AnimatePresence } from 'framer-motion';
import { AgentOrbitWithSuspense } from '@/components/AgentOrbit';
import { CommandBar } from '@/components/CommandBar';
import { AgentCard } from '@/components/AgentCard';
import { useAppStore } from '@/stores/appStore';

/**
 * HomeView renders the adaptive home screen.
 * commandBarPosition derives whether agents are active.
 */
export function HomeView() {
  const { agents, commandBarPosition } = useAppStore();

  const isActive = commandBarPosition === 'bottom';

  return (
    <div className="relative flex flex-col w-full h-full overflow-hidden bg-zinc-950">
      <AnimatePresence mode="wait">
        {isActive ? (
          /* ------------------------------------------------------------------ */
          /* Active layout                                                        */
          /* Cards + command bar as a centered block, slightly above center      */
          /* ------------------------------------------------------------------ */
          <motion.div
            key="active"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="flex flex-col items-center justify-center w-full h-full"
            style={{ marginTop: '-3vh' }}
          >
            {/* Agent cards row - centered, no wrapping on wide screens */}
            <div className="flex flex-row gap-4 justify-center flex-wrap px-8">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>

            {/* Command bar - 48px gap below cards, max 560px wide */}
            <div
              className="w-full px-8 shrink-0"
              style={{ marginTop: '48px', maxWidth: '600px' }}
            >
              <CommandBar position="center" />
            </div>
          </motion.div>
        ) : (
          /* ------------------------------------------------------------------ */
          /* Idle layout                                                          */
          /* Orbit + branding + command bar, all vertically centered             */
          /* ------------------------------------------------------------------ */
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="flex flex-col items-center justify-center flex-1 w-full h-full"
            style={{ marginTop: '-3vh' }}
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
    </div>
  );
}
