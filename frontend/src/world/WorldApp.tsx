/**
 * src/world/WorldApp.tsx
 * Root component for the Monet World 2D app.
 * Renders the forest scene with HTML overlay UI components
 * and overlay views (Tinder/Diff/Whiteboard).
 */

import { ForestScene } from './scene/ForestScene';
import { ChatPanel } from './ui/ChatPanel';
import { StatusBar } from './ui/StatusBar';
import { WorldCommandBar } from './ui/WorldCommandBar';
import { OverlayViewModal } from './ui/OverlayViewModal';


export function WorldApp() {
  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: '#0a0f0a',
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      {/* 2D Forest Scene - scale to fill viewport */}
      <ForestScene />

      {/* HTML UI overlays */}
      <StatusBar />
      <WorldCommandBar />
      <ChatPanel />
      <OverlayViewModal />

      {/* Monet branding */}
      <div style={{
        position: 'fixed',
        bottom: '28px',
        left: '24px',
        fontSize: '14px',
        fontWeight: 300,
        color: 'rgba(255,255,255,0.15)',
        letterSpacing: '-0.02em',
        userSelect: 'none',
        zIndex: 10,
      }}>
        monet world
      </div>
    </div>
  );
}
