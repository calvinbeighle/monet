/**
 * App.tsx
 * Root layout component for the Monet application.
 * No sidebar, no top bar, no fake loading screen.
 * Just renders the active view full-screen.
 * AiLoader is an overlay shown only when isLoading is true in the store.
 */
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { HomeView } from '@/views/HomeView';
import { ChatView } from '@/views/ChatView';
import { TinderView } from '@/views/TinderView';
import { DiffView } from '@/views/DiffView';
import { WhiteboardView } from '@/views/WhiteboardView';
import { useAppStore } from '@/stores/appStore';
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
 *
 * Starts background polling of /agents and /decisions on mount so agent
 * cards show live decision counts without requiring manual refresh.
 */
function App() {
  const { startPolling } = useAppStore();

  useEffect(() => {
    const stopPolling = startPolling();
    return stopPolling;
  }, [startPolling]);

  return (
    <div className="w-full h-full overflow-hidden" style={{ background: '#000000' }}>
      <ActiveViewRenderer />
    </div>
  );
}

export default App;
