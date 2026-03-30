/**
 * components/WelcomeScreen.tsx
 * The default main view shown when no agent task is active.
 * Displays the 3D AgentOrbit, the Monet wordmark, command bar, and suggestion cards.
 * The 3D canvas replaces the static text logo; the wordmark appears below it at 24px.
 * Three.js is lazy-loaded via React.lazy so the main bundle stays lean.
 */
import { lazy, Suspense } from 'react';
import { motion, type Variants } from 'framer-motion';
import { CommandBar } from './CommandBar';
import { SuggestionCard } from './SuggestionCard';
import { useAppStore } from '../stores/appStore';
import type { Suggestion, Agent } from '../types';

/**
 * Lazy-loaded AgentOrbit - Three.js chunk only downloads when WelcomeScreen mounts.
 * The named export must be wrapped because React.lazy requires a default export module.
 */
const AgentOrbitLazy = lazy(() =>
  import('./AgentOrbit').then((mod) => ({ default: mod.AgentOrbit }))
);

/**
 * Fallback shown while the Three.js bundle downloads.
 * Renders the same size placeholder so layout does not shift.
 */
function OrbitFallback({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span
        style={{
          fontSize: '32px',
          fontWeight: 300,
          color: 'var(--text-primary)',
          letterSpacing: '-0.5px',
        }}
      >
        monet
      </span>
    </div>
  );
}

/**
 * Thin wrapper that provides Suspense with the fallback,
 * then renders the lazily imported AgentOrbit canvas.
 */
function AgentOrbitWithSuspense({ agents, size }: { agents: Agent[]; size: number }) {
  return (
    <Suspense fallback={<OrbitFallback size={size} />}>
      <AgentOrbitLazy agents={agents} size={size} />
    </Suspense>
  );
}

/**
 * Container animation - children stagger in from below on mount.
 */
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } },
};

/**
 * Welcome screen with centered logo, command bar, and suggestion list.
 * Max width 680px, vertically centered in the available space.
 */
export function WelcomeScreen() {
  const { suggestions, agents, setActiveView, setActiveSuggestion } = useAppStore();

  function handleSubmit(value: string) {
    console.log('Command submitted:', value);
    setActiveView('chat');
  }

  function handleSuggestionSelect(suggestion: Suggestion) {
    setActiveSuggestion(suggestion);
    setActiveView(suggestion.uiPattern);
  }

  return (
    <div
      className="flex flex-col items-center justify-center flex-1 w-full px-6 relative"
      style={{
        /**
         * Subtle dot-grid CSS background behind everything.
         * Uses a radial gradient trick to paint faint dots at 24px intervals.
         */
        backgroundImage:
          'radial-gradient(circle, rgba(139,92,246,0.18) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      {/* Soft radial vignette so edges fade to the base bg color */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 40%, var(--bg) 100%)',
        }}
      />

      <motion.div
        className="w-full flex flex-col items-center gap-6 relative"
        style={{ maxWidth: '680px' }}
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* 3D Agent orbit visualization + wordmark */}
        <motion.div variants={itemVariants} className="flex flex-col items-center gap-0">
          <AgentOrbitWithSuspense agents={agents} size={200} />
          <p
            style={{
              fontSize: '24px',
              fontWeight: 300,
              color: 'var(--text-primary)',
              letterSpacing: '-0.5px',
              marginTop: '-12px',
            }}
          >
            monet
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: 400, marginTop: '4px' }}>
            Your AI decision copilot
          </p>
        </motion.div>

        {/* Command bar */}
        <motion.div variants={itemVariants} className="w-full">
          <CommandBar onSubmit={handleSubmit} />
        </motion.div>

        {/* Suggestion cards */}
        <motion.div
          variants={itemVariants}
          className="w-full rounded-xl overflow-hidden"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          {suggestions.map((suggestion, index) => (
            <SuggestionCard
              key={suggestion.id}
              suggestion={suggestion}
              isLast={index === suggestions.length - 1}
              onSelect={handleSuggestionSelect}
            />
          ))}
        </motion.div>
      </motion.div>
    </div>
  );
}
