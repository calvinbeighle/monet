/**
 * App.tsx
 * Root layout component for the Monet application.
 *
 * ONE interface. The home screen is always visible.
 * Decision views (tinder/diff/whiteboard) render as modal overlays on top.
 * Chat responses appear inline on the home screen - no navigation needed.
 */
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HomeView } from '@/views/HomeView';
import { TinderView } from '@/views/TinderView';
import { DiffView } from '@/views/DiffView';
import { WhiteboardView } from '@/views/WhiteboardView';
import { useAppStore } from '@/stores/appStore';

/**
 * Renders the active decision overlay as a dark modal on top of the home screen.
 * The home screen remains visible (blurred) behind the overlay.
 * Clicking the backdrop does not close the overlay - use the Back button inside.
 */
function OverlayRenderer() {
  const { overlayView } = useAppStore();

  return (
    <AnimatePresence>
      {overlayView && (
        <motion.div
          key={overlayView}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'rgba(0,0,0,0.85)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 12 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{
              width: '100%',
              height: '100%',
              maxWidth: '900px',
              maxHeight: '90vh',
              overflowY: 'auto',
              borderRadius: '16px',
              background: '#000000',
              border: '1px solid rgba(255,255,255,0.07)',
              boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
            }}
          >
            {overlayView === 'tinder' && <TinderView />}
            {overlayView === 'diff' && <DiffView />}
            {overlayView === 'whiteboard' && <WhiteboardView />}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Root App component.
 * Renders the home screen full-screen at all times.
 * Decision views layer on top as modals via OverlayRenderer.
 * Starts background polling on mount to keep agent cards live.
 */
function App() {
  const { startPolling } = useAppStore();

  useEffect(() => {
    const stopPolling = startPolling();
    return stopPolling;
  }, [startPolling]);

  return (
    <div className="w-full h-full overflow-hidden" style={{ background: '#000000' }}>
      {/* Home screen - always rendered, always visible */}
      <HomeView />

      {/* Decision overlays - rendered on top of the home screen */}
      <OverlayRenderer />
    </div>
  );
}

export default App;
