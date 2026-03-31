// Application shell per Spec 12
// Layout: status bar (top), map viewport + right panel (center), agent dock (bottom)
// Shell lifecycle: initializing -> unauthenticated/loading -> empty/active/degraded
// Responsive: below RESPONSIVE_BREAKPOINT, panels overlay instead of shrinking map
// Focus zones: status-bar -> map -> agent-dock -> right-panel (tab order)

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore, RESPONSIVE_BREAKPOINT } from "./lib/stores";
import { StatusBar } from "./components/status-bar";
import { MapViewport } from "./features/map/map-viewport";
import { AgentDock } from "./components/agent-dock";
import { DetailPanel } from "./components/detail-panel";
import {
  DeploymentHistoryPanel,
  type DeploymentRecord,
} from "./components/deployment-history-panel";
import { SessionSummaryModal, type SessionSummaryData } from "./components/session-summary-modal";
import { NotificationArea } from "./components/notification-area";
import { DeploymentConfirmation } from "./components/deployment-confirmation";
import {
  loadPersistedThreads,
  startPeriodicPersist,
  stopPeriodicPersist,
  flushPersist,
} from "./features/sync/persistence-manager";
import { useThreadStore } from "./lib/stores";

export function App() {
  const shellState = useAppStore((s) => s.shellState);
  const setShellState = useAppStore((s) => s.setShellState);
  const setViewportDimensions = useAppStore((s) => s.setViewportDimensions);
  const activePanel = useAppStore((s) => s.activePanel);
  const setActivePanel = useAppStore((s) => s.setActivePanel);
  const focusZone = useAppStore((s) => s.focusZone);
  const setFocusZone = useAppStore((s) => s.setFocusZone);
  const viewportWidth = useAppStore((s) => s.viewportWidth);
  const syncStatus = useAppStore((s) => s.syncStatus);

  // Deployment history state (populated by agent system)
  const [deployments] = useState<DeploymentRecord[]>([]);

  // Session summary state
  const [sessionSummary] = useState<SessionSummaryData>({
    threadsHandled: 0,
    opportunitiesCaptured: 0,
    opportunitiesMissed: 0,
    risksMitigated: 0,
    agentsDeployed: 0,
    netHealthChange: 0,
    sessionDurationMs: 0,
  });
  const [summaryTrigger, setSummaryTrigger] = useState<HTMLElement | null>(null);

  const isCompact = viewportWidth > 0 && viewportWidth < RESPONSIVE_BREAKPOINT;
  const hasRightPanel = activePanel === "detail" || activePanel === "deployment-history";

  // Refs for focus zone management
  const statusBarRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => {
      setViewportDimensions(window.innerWidth, window.innerHeight);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setViewportDimensions]);

  // Initialization: load persisted threads, start periodic persist, transition to active
  useEffect(() => {
    if (shellState !== "initializing") return;

    let cancelled = false;

    const init = async () => {
      try {
        const persisted = await loadPersistedThreads();
        if (cancelled) return;

        if (persisted.length > 0) {
          useThreadStore.getState().setThreads(persisted);
        }

        startPeriodicPersist();
        setShellState("active");
      } catch (err) {
        console.warn("[App] Failed to load persisted threads:", err);
        if (!cancelled) {
          setShellState("active"); // proceed without persisted data
        }
      }
    };

    init();

    // Flush to IndexedDB before page unload
    const handleBeforeUnload = () => {
      flushPersist();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      cancelled = true;
      stopPeriodicPersist();
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [shellState, setShellState]);

  // Focus zone keyboard navigation (Tab cycles through zones per Spec 12)
  const handleGlobalKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Session summary modal traps all focus
      if (activePanel === "session-summary") return;

      if (e.key === "Escape") {
        // Close right panel if focused there
        if (focusZone === "right-panel" && hasRightPanel) {
          setActivePanel("none");
          setFocusZone("map");
          mapRef.current?.focus();
        }
      }
    },
    [activePanel, focusZone, hasRightPanel, setActivePanel, setFocusZone],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  const handleStatusBarSummaryClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    setSummaryTrigger(e.currentTarget);
    setActivePanel("session-summary");
  };

  const handleStatusBarHistoryClick = () => {
    setActivePanel("deployment-history");
  };

  // Initializing state
  if (shellState === "initializing") {
    return (
      <div
        className="flex h-full w-full items-center justify-center bg-[#0a0a12] text-gray-400"
        data-testid="shell-initializing"
      >
        Initializing...
      </div>
    );
  }

  // Unauthenticated state
  if (shellState === "unauthenticated") {
    return (
      <div className="flex h-full w-full flex-col bg-[#0a0a12]" data-testid="app-shell">
        <StatusBar />
        <div className="flex flex-1 items-center justify-center" data-testid="map-viewport">
          <div className="text-center" data-testid="auth-prompt">
            <h2 className="mb-2 text-lg text-gray-200">Welcome to Messaging RTS</h2>
            <p className="mb-4 text-sm text-gray-500">Connect your Gmail to get started</p>
            <button className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500">
              Connect Gmail
            </button>
          </div>
        </div>
        <AgentDock />
      </div>
    );
  }

  // Loading state
  if (shellState === "loading") {
    return (
      <div className="flex h-full w-full flex-col bg-[#0a0a12]" data-testid="app-shell">
        <StatusBar />
        <div className="flex flex-1 items-center justify-center" data-testid="map-viewport">
          <div className="text-center" data-testid="loading-indicator">
            <div className="mb-2 h-6 w-6 mx-auto animate-spin rounded-full border-2 border-gray-600 border-t-gray-300" />
            <span className="text-sm text-gray-500">Syncing your inbox...</span>
          </div>
        </div>
        <AgentDock />
      </div>
    );
  }

  // Empty state (synced but no threads)
  if (shellState === "empty") {
    return (
      <div className="flex h-full w-full flex-col bg-[#0a0a12]" data-testid="app-shell">
        <StatusBar />
        <div className="flex flex-1 items-center justify-center" data-testid="map-viewport">
          <div className="text-center" data-testid="empty-state">
            <h2 className="mb-2 text-lg text-gray-300">Your inbox is empty</h2>
            <p className="text-sm text-gray-600">
              New threads will appear on the map as they arrive
            </p>
          </div>
        </div>
        <AgentDock />
      </div>
    );
  }

  // Active and Degraded states - full shell layout
  return (
    <div className="flex h-full w-full flex-col bg-[#0a0a12]" data-testid="app-shell">
      {/* Status bar - always visible, full width */}
      <div
        ref={statusBarRef}
        tabIndex={0}
        onFocus={() => setFocusZone("status-bar")}
        data-testid="status-bar-zone"
      >
        <StatusBar
          onSummaryClick={handleStatusBarSummaryClick}
          onHistoryClick={handleStatusBarHistoryClick}
        />
      </div>

      {/* Degraded mode banner */}
      {shellState === "degraded" && (
        <div
          className="flex items-center justify-center bg-yellow-900/30 px-4 py-1 text-xs text-yellow-400"
          data-testid="degraded-banner"
        >
          Gmail unreachable - showing cached data. Sync status: {syncStatus}
        </div>
      )}

      {/* Main content area: map viewport + optional right panel */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Map viewport - fills remaining space */}
        <div
          ref={mapRef}
          className="relative flex-1 overflow-hidden"
          tabIndex={0}
          onFocus={() => setFocusZone("map")}
          data-testid="map-viewport-zone"
        >
          <MapViewport />

          {/* Notification area - bottom-left of map viewport, above agent dock */}
          <NotificationArea />
        </div>

        {/* Right panel area - detail or deployment history */}
        {hasRightPanel && (
          <div
            ref={rightPanelRef}
            tabIndex={0}
            onFocus={() => setFocusZone("right-panel")}
            className={isCompact ? "absolute right-0 top-0 z-30 h-full" : ""}
            data-testid="right-panel-zone"
          >
            {activePanel === "detail" && <DetailPanel />}
            {activePanel === "deployment-history" && (
              <DeploymentHistoryPanel deployments={deployments} />
            )}
          </div>
        )}
      </div>

      {/* Agent dock - always visible at bottom */}
      <div
        ref={dockRef}
        tabIndex={0}
        onFocus={() => setFocusZone("agent-dock")}
        data-testid="agent-dock-zone"
      >
        <AgentDock />
      </div>

      {/* Session summary modal - full-screen overlay */}
      {activePanel === "session-summary" && (
        <SessionSummaryModal data={sessionSummary} triggeredFrom={summaryTrigger} />
      )}

      {/* Deployment confirmation dialog - floats above everything */}
      <DeploymentConfirmation />
    </div>
  );
}
