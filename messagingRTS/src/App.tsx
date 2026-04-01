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
import { DeploymentHistoryPanel } from "./components/deployment-history-panel";
import { SessionSummaryModal, type SessionSummaryData } from "./components/session-summary-modal";
import { NotificationArea } from "./components/notification-area";
import { DeploymentConfirmation } from "./components/deployment-confirmation";
import { ResultsOverlay } from "./components/results-overlay";
import { BatchActionBar } from "./components/batch-action-bar";
import { FilterPanel } from "./components/filter-panel";
import { AlertList } from "./components/alert-list";
import {
  loadPersistedThreads,
  loadPersistedActionQueue,
  startPeriodicPersist,
  stopPeriodicPersist,
  flushPersist,
} from "./features/sync/persistence-manager";
import { startInitialLoad, startPolling, stopPolling } from "./features/sync/sync-engine";
import { useThreadStore, useFilterStore } from "./lib/stores";
import { useAgentStore } from "./lib/stores/agent-store";
import { useAuthStore } from "./features/auth/auth-store";
import type { AgentRole } from "./lib/types";
import { initClaudeClient, isClaudeClientConfigured } from "./features/agents/claude-client";
import { getAnthropicApiKey } from "./features/agents/ai-backend";
import { useNavigationStore } from "./features/navigation/navigation-store";

// Session idle auto-trigger per Spec 07: auto-present summary after no interaction
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes of inactivity

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
  const authState = useAuthStore((s) => s.authState);

  // Find agent roles with completed status (for results overlay)
  const agents = useAgentStore((s) => s.agents);
  const completedAgentRole: AgentRole | null = (() => {
    for (const [role, agent] of agents) {
      if (
        agent.status === "completed" &&
        (agent.proposals.length > 0 || agent.failedThreadIds.length > 0)
      ) {
        return role;
      }
    }
    return null;
  })();
  const completedAgentFailedThreadIds: string[] =
    completedAgentRole != null ? (agents.get(completedAgentRole)?.failedThreadIds ?? []) : [];

  // Session summary wired to live stats per Spec 07
  const sessionStats = useAppStore((s) => s.sessionStats);
  const frontHealthScore = useAppStore((s) => s.frontHealthScore);
  const initialHealthScore = useAppStore((s) => s.initialHealthScore);
  const sessionSummary: SessionSummaryData = {
    threadsHandled: sessionStats.threadsHandled,
    opportunitiesCaptured: sessionStats.opportunitiesCaptured,
    opportunitiesMissed: sessionStats.opportunitiesMissed,
    risksMitigated: sessionStats.risksMitigated,
    agentsDeployed: sessionStats.agentsDeployed,
    lostThreadCount: sessionStats.lostThreadCount,
    netHealthChange: frontHealthScore - initialHealthScore,
    sessionDurationMs: Date.now() - sessionStats.sessionStart,
  };
  const [summaryTrigger, setSummaryTrigger] = useState<HTMLElement | null>(null);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showAlertList, setShowAlertList] = useState(false);

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (shellState !== "active" && shellState !== "degraded") return;

    const resetIdleTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        // Only auto-trigger if no modal is already open
        if (
          useAppStore.getState().activePanel === "none" ||
          useAppStore.getState().activePanel === "detail"
        ) {
          setActivePanel("session-summary");
        }
      }, IDLE_TIMEOUT_MS);
    };

    const events = ["mousedown", "keydown", "scroll", "touchstart"] as const;
    for (const evt of events) window.addEventListener(evt, resetIdleTimer);
    resetIdleTimer();

    return () => {
      for (const evt of events) window.removeEventListener(evt, resetIdleTimer);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [shellState, setActivePanel]);

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

  // Initialization: check auth via Nango, load persisted threads, transition to active
  useEffect(() => {
    if (shellState !== "initializing") return;

    let cancelled = false;

    const init = async () => {
      // Step 0: Initialize Claude API client if key is configured (4.2)
      if (!isClaudeClientConfigured()) {
        const apiKey = getAnthropicApiKey();
        if (apiKey) {
          initClaudeClient({ apiKey });
          console.info("[App] Claude API client initialized for agent AI backend");
        } else {
          console.info("[App] No Anthropic API key - agents will use simulated proposals");
        }
      }

      // Step 0b: Restore persisted filter state (Spec 09 - filter persists across refresh)
      useFilterStore.getState().loadPersistedFilter();

      // Step 1: Check Nango connection status
      await useAuthStore.getState().checkConnection();
      if (cancelled) return;

      const authState = useAuthStore.getState().authState;
      if (authState !== "authenticated") {
        setShellState("unauthenticated");
        return;
      }

      // Step 2: Load persisted threads and action queue for immediate display
      try {
        const persisted = await loadPersistedThreads();
        if (cancelled) return;

        if (persisted.length > 0) {
          useThreadStore.getState().setThreads(persisted);
        }

        // Restore offline action queue from IndexedDB (Spec 10 Section 8)
        await loadPersistedActionQueue();

        startPeriodicPersist();
      } catch (err) {
        console.warn("[App] Failed to load persisted state:", err);
      }

      if (cancelled) return;

      // Step 3: Fetch fresh threads from Gmail via Nango proxy (Spec 10 initial load).
      // This transitions shell to active/empty/degraded based on result.
      // Persisted threads show immediately while fresh data loads in background.
      setShellState("loading");
      await startInitialLoad();
      if (cancelled) return;

      // Step 4: Start incremental sync polling (Spec 10)
      startPolling();
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
      stopPolling();
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [shellState, setShellState]);

  // Focus zone keyboard navigation (Tab cycles through zones per Spec 12 Section 12)
  // Tab order: status-bar -> map -> agent-dock -> right-panel (if open) -> status-bar
  const handleGlobalKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Session summary modal traps all focus internally
      if (activePanel === "session-summary") return;

      // Search overlay intercepts full tab cycle per Spec 12 Section 6
      if (useNavigationStore.getState().searchActive) return;

      if (e.key === "Tab") {
        // Build zone cycle order per Spec 12 Section 12
        const zones: Array<{ id: string; ref: React.RefObject<HTMLDivElement | null> }> = [
          { id: "status-bar", ref: statusBarRef },
          { id: "map", ref: mapRef },
          { id: "agent-dock", ref: dockRef },
        ];
        if (hasRightPanel) {
          zones.push({ id: "right-panel", ref: rightPanelRef });
        }

        const currentIdx = zones.findIndex((z) => z.id === focusZone);
        if (currentIdx === -1) return; // Focus not in a known zone, let browser handle

        e.preventDefault();
        const direction = e.shiftKey ? -1 : 1;
        const nextIdx = (currentIdx + direction + zones.length) % zones.length;
        const nextZone = zones[nextIdx];
        setFocusZone(nextZone.id as typeof focusZone);
        nextZone.ref.current?.focus();
      }

      if (e.key === "Escape") {
        // Close filter/alert popovers first
        if (showFilterPanel) {
          setShowFilterPanel(false);
          statusBarRef.current?.focus();
          return;
        }
        if (showAlertList) {
          setShowAlertList(false);
          statusBarRef.current?.focus();
          return;
        }
        // Close right panel - from map focus or right-panel focus per Spec 12 Section 5
        if (hasRightPanel && (focusZone === "right-panel" || focusZone === "map")) {
          setActivePanel("none");
          setFocusZone("map");
          mapRef.current?.focus();
        }
      }
    },
    [
      activePanel,
      focusZone,
      hasRightPanel,
      setActivePanel,
      setFocusZone,
      showFilterPanel,
      showAlertList,
    ],
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

  const handleStatusBarFilterClick = () => {
    setShowFilterPanel((prev) => !prev);
    setShowAlertList(false);
  };

  const handleStatusBarAlertClick = () => {
    setShowAlertList((prev) => !prev);
    setShowFilterPanel(false);
  };

  // Initializing state - per Spec 12: status bar always visible in all states
  if (shellState === "initializing") {
    return (
      <div className="flex h-full w-full flex-col bg-[#0a0a12]" data-testid="shell-initializing">
        <StatusBar />
        <div className="flex flex-1 items-center justify-center text-gray-400">Initializing...</div>
      </div>
    );
  }

  // Unauthenticated state
  if (shellState === "unauthenticated") {
    const authError = useAuthStore.getState().error;
    const handleConnect = () => {
      useAuthStore.getState().startAuth();
    };

    return (
      <div className="flex h-full w-full flex-col bg-[#0a0a12]" data-testid="app-shell">
        <StatusBar />
        <div className="flex flex-1 items-center justify-center" data-testid="map-viewport">
          <div className="text-center" data-testid="auth-prompt">
            <h2 className="mb-2 text-lg text-gray-200">Welcome to Messaging RTS</h2>
            <p className="mb-4 text-sm text-gray-500">Connect your Gmail to get started</p>
            {authError && (
              <p className="mb-3 text-xs text-red-400" data-testid="auth-error">
                {authError}
              </p>
            )}
            <button
              onClick={handleConnect}
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500"
              data-testid="connect-gmail-btn"
            >
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
        role="region"
        aria-label="Status bar"
        className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500/60 focus-visible:outline-offset-[-2px]"
      >
        <StatusBar
          onSummaryClick={handleStatusBarSummaryClick}
          onHistoryClick={handleStatusBarHistoryClick}
          onFilterClick={handleStatusBarFilterClick}
          onAlertClick={handleStatusBarAlertClick}
        />
        {/* Filter panel popover - anchored below status bar */}
        {showFilterPanel && (
          <div className="absolute left-4 top-10 z-40" data-testid="filter-panel-popover">
            <FilterPanel onClose={() => setShowFilterPanel(false)} />
          </div>
        )}
        {/* Alert list popover - anchored below status bar on right */}
        {showAlertList && (
          <div className="absolute right-4 top-10 z-40" data-testid="alert-list-popover">
            <AlertList onClose={() => setShowAlertList(false)} />
          </div>
        )}
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

      {/* Reauthentication-required banner - shown when Gmail 401 is received mid-session */}
      {authState === "reauthentication-required" && (
        <div
          className="flex items-center justify-between bg-red-900/40 px-4 py-2 text-xs text-red-300"
          data-testid="reauth-banner"
          role="alert"
        >
          <span>Gmail connection lost. Reconnect to resume syncing.</span>
          <button
            onClick={() => useAuthStore.getState().startAuth()}
            className="ml-4 rounded bg-red-700/60 px-3 py-1 text-xs text-red-100 hover:bg-red-600/70"
            data-testid="reconnect-gmail-btn"
          >
            Reconnect Gmail
          </button>
        </div>
      )}

      {/* Batch action bar - visible when threads are multi-selected per Spec 09 */}
      <BatchActionBar />

      {/* Main content area: map viewport + optional right panel */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Map viewport - fills remaining space */}
        <div
          ref={mapRef}
          className="relative flex-1 overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500/60 focus-visible:outline-offset-[-2px]"
          tabIndex={0}
          onFocus={() => setFocusZone("map")}
          data-testid="map-viewport-zone"
          role="region"
          aria-label="Map viewport"
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
            className={`focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500/60 focus-visible:outline-offset-[-2px] ${isCompact ? "absolute right-0 top-0 z-30 h-full" : ""}`}
            data-testid="right-panel-zone"
            role="region"
            aria-label="Detail panel"
          >
            {activePanel === "detail" && <DetailPanel />}
            {activePanel === "deployment-history" && <DeploymentHistoryPanel />}
          </div>
        )}
      </div>

      {/* Agent dock - always visible at bottom */}
      <div
        ref={dockRef}
        tabIndex={0}
        onFocus={() => setFocusZone("agent-dock")}
        data-testid="agent-dock-zone"
        role="region"
        aria-label="Agent dock"
        className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500/60 focus-visible:outline-offset-[-2px]"
      >
        <AgentDock isCompact={isCompact} onHistoryClick={handleStatusBarHistoryClick} />
      </div>

      {/* Session summary modal - full-screen overlay */}
      {activePanel === "session-summary" && (
        <SessionSummaryModal data={sessionSummary} triggeredFrom={summaryTrigger} />
      )}

      {/* Deployment confirmation dialog - floats above everything */}
      <DeploymentConfirmation />

      {/* Results overlay - shows proposals after agent completion, no auto-dismiss */}
      {completedAgentRole && (
        <ResultsOverlay
          agentRole={completedAgentRole}
          failedThreadIds={completedAgentFailedThreadIds}
        />
      )}
    </div>
  );
}
