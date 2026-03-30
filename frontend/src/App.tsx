/**
 * App.tsx
 * Root layout component for the Monet application.
 * Renders the sidebar, top bar, and the active view in a full-screen flex layout.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { WelcomeScreen } from './components/WelcomeScreen';
import { ChatView } from './views/ChatView';
import { TinderView } from './views/TinderView';
import { DiffView } from './views/DiffView';
import { WhiteboardView } from './views/WhiteboardView';
import { useAppStore } from './stores/appStore';

/** Maps active view name to the corresponding component */
function ActiveView() {
  const { activeView } = useAppStore();

  const viewComponents: Record<string, React.ReactNode> = {
    welcome: <WelcomeScreen />,
    chat: <ChatView />,
    tinder: <TinderView />,
    diff: <DiffView />,
    whiteboard: <WhiteboardView />,
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={activeView}
        className="flex flex-col flex-1 w-full h-full overflow-hidden"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        {viewComponents[activeView] ?? <WelcomeScreen />}
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Root App component. Lays out the sidebar on the left and the main content
 * area on the right, with a TopBar spanning the full width.
 */
function App() {
  return (
    <div
      className="flex w-full h-full overflow-hidden"
      style={{ background: 'var(--bg)' }}
    >
      {/* Sidebar - animates in/out */}
      <Sidebar />

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0 relative" style={{ background: 'var(--bg)' }}>
        {/* Top navigation bar - absolutely positioned to span full width within the main area */}
        <TopBar />

        {/* Content below the top bar */}
        <div className="flex flex-col flex-1 overflow-hidden" style={{ paddingTop: '48px' }}>
          <ActiveView />
        </div>
      </div>
    </div>
  );
}

export default App;
