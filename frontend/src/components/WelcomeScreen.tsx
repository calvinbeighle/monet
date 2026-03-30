/**
 * components/WelcomeScreen.tsx
 * The default main view shown when no agent task is active.
 * Displays the Monet logo, command bar, and suggestion cards in a centered layout.
 */
import { motion, type Variants } from 'framer-motion';
import { CommandBar } from './CommandBar';
import { SuggestionCard } from './SuggestionCard';
import { useAppStore } from '../stores/appStore';
import type { Suggestion } from '../types';

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
  const { suggestions, setActiveView, setActiveSuggestion } = useAppStore();

  function handleSubmit(value: string) {
    console.log('Command submitted:', value);
    setActiveView('chat');
  }

  function handleSuggestionSelect(suggestion: Suggestion) {
    setActiveSuggestion(suggestion);
    setActiveView(suggestion.uiPattern);
  }

  return (
    <div className="flex flex-col items-center justify-center flex-1 w-full px-6">
      <motion.div
        className="w-full flex flex-col items-center gap-6"
        style={{ maxWidth: '680px' }}
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Logo */}
        <motion.div variants={itemVariants} className="flex flex-col items-center gap-1">
          <h1
            style={{
              fontSize: '32px',
              fontWeight: 300,
              color: 'var(--text-primary)',
              letterSpacing: '-0.5px',
            }}
          >
            monet
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: 400 }}>
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
