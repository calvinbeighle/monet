/**
 * App.tsx
 * Root layout component for the Monet application.
 * Renders the fixed TopBar, slide-in SidebarSheet, and the active view.
 * View switching is driven by the Zustand store's activeView state.
 */
import { useState, useEffect } from 'react';
import { TopBar } from '@/components/TopBar';
import { SidebarSheet } from '@/components/SidebarSheet';
import { HomeView } from '@/views/HomeView';
import { MonitorView } from '@/views/MonitorView';
import { ChatView } from '@/views/ChatView';
import { TinderView } from '@/views/TinderView';
import { DiffView } from '@/views/DiffView';
import { WhiteboardView } from '@/views/WhiteboardView';
import { useAppStore } from '@/stores/appStore';
import { AiLoader } from '@/components/ui/ai-loader';
import type { ActiveView } from '@/types';

/** Map of view names to their components */
const VIEW_MAP: Record<ActiveView, React.ReactNode> = {
  home: <HomeView />,
  monitor: <MonitorView />,
  chat: <ChatView />,
  tinder: <TinderView />,
  diff: <DiffView />,
  whiteboard: <WhiteboardView />,
};

/**
 * Renders the currently active view based on the store state.
 */
function ActiveViewRenderer() {
  const { activeView } = useAppStore();
  return <>{VIEW_MAP[activeView] ?? <HomeView />}</>;
}

/**
 * Root App component. Fixed TopBar at the top, Sheet sidebar overlay,
 * and main content area that fills the remaining space below the bar.
 */
function App() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 2500);
    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return <AiLoader text="monet" size={200} />;
  }

  return (
    <div className="w-full h-full overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Fixed 48px top bar */}
      <TopBar />

      {/* Sheet sidebar - overlays from left */}
      <SidebarSheet />

      {/* Main content - padded top to clear the fixed bar */}
      <div
        className="flex flex-col w-full h-full overflow-hidden"
        style={{ paddingTop: '48px' }}
      >
        <ActiveViewRenderer />
      </div>
    </div>
  );
}

export default App;
