/**
 * App.tsx
 * Root layout component for the Monet application.
 * No sidebar, no top bar, no fake loading screen.
 * Just renders the active view full-screen.
 * AiLoader is an overlay shown only when isLoading is true in the store.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { HomeView } from '@/views/HomeView';
import { ChatView } from '@/views/ChatView';
import { TinderView } from '@/views/TinderView';
import { DiffView } from '@/views/DiffView';
import { WhiteboardView } from '@/views/WhiteboardView';
import { useAppStore } from '@/stores/appStore';
import { AiLoader } from '@/components/ui/ai-loader';
import type { ActiveView } from '@/types';

/** Map of view names to their React components */
const VIEW_COMPONENTS: Record<ActiveView, React.ReactNode> = {
  home: <HomeView />,
  monitor: <HomeView />, // monitor is folded into home (agent cards on home screen)
  chat: <ChatView />,
  tinder: <TinderView />,
  diff: <DiffView />,
  whiteboard: <WhiteboardView />,
};

/**
 * Renders the currently active view based on the store state.
 * Wrapped in AnimatePresence for smooth view transitions.
 */
function ActiveViewRenderer() {
  const { activeView } = useAppStore();
  const content = VIEW_COMPONENTS[activeView] ?? <HomeView />;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={activeView}
        className="w-full h-full"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        {content}
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Root App component.
 * Full-screen view container with an overlay AiLoader that appears
 * only when isLoading is true in the Zustand store.
 */
function App() {
  const { isLoading } = useAppStore();

  return (
    <div className="w-full h-full overflow-hidden bg-zinc-950">
      <ActiveViewRenderer />

      {/* Loading overlay - only shown when actually waiting for something */}
      <AnimatePresence>
        {isLoading && (
          <motion.div
            key="loader"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-xl"
          >
            <AiLoader text="monet" size={160} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
