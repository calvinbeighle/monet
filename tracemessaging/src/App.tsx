import { useEffect, useCallback } from "react";
import { useAppStore } from "./lib/stores";
import { useActivityStore } from "./lib/stores";
import { useWorkstreamStore } from "./lib/stores";
import { loadAllActivities, loadAllWorkstreams } from "./lib/utils";
import {
  startIngestion,
  stopIngestion,
} from "./lib/services/ingestion-orchestrator";
import { HeaderBar } from "./components/header-bar";
import { NotificationArea } from "./components/notification-area";
import { WorkstreamTimeline } from "./features/timeline/workstream-timeline";
import { WorkstreamDetail } from "./features/detail/workstream-detail";
import { SettingsPanel } from "./features/settings/settings-panel";
import { LoadingScreen } from "./components/loading-screen";
import { AuthPrompt } from "./components/auth-prompt";
import { ErrorBoundary } from "./components/error-boundary";

export function App() {
  const authState = useAppStore((s) => s.authState);
  const dataState = useAppStore((s) => s.dataState);
  const currentRoute = useAppStore((s) => s.currentRoute);
  const setAuthState = useAppStore((s) => s.setAuthState);
  const setDataState = useAppStore((s) => s.setDataState);
  const navigate = useAppStore((s) => s.navigate);
  const addActivities = useActivityStore((s) => s.addActivities);
  const setWorkstreams = useWorkstreamStore((s) => s.setWorkstreams);
  const checkLifecycles = useWorkstreamStore((s) => s.checkLifecycles);

  // Initialize: load from IndexedDB, check auth
  const initialize = useCallback(async () => {
    try {
      // Load persisted data
      const [activities, workstreams] = await Promise.all([
        loadAllActivities(),
        loadAllWorkstreams(),
      ]);

      if (activities.length > 0) {
        addActivities(activities);
      }
      if (workstreams.length > 0) {
        setWorkstreams(workstreams);
      }

      // Check lifecycle statuses
      checkLifecycles();

      // Skip auth for now - go straight to authenticated
      setAuthState("authenticated");
      setDataState(
        activities.length > 0 || workstreams.length > 0 ? "loaded" : "loading",
      );

      // Start data ingestion from all sources (backend + dev fixtures)
      startIngestion();
    } catch (err) {
      console.error("[App] initialization failed:", err);
      setDataState("error");
    }
  }, [
    addActivities,
    setWorkstreams,
    checkLifecycles,
    setAuthState,
    setDataState,
  ]);

  useEffect(() => {
    initialize();
    return () => stopIngestion();
  }, [initialize]);

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (event.state) {
        navigate(event.state);
      } else {
        navigate({ view: "timeline" });
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [navigate]);

  // Periodic lifecycle check (every 5 minutes)
  useEffect(() => {
    const interval = setInterval(() => checkLifecycles(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkLifecycles]);

  // Render based on state
  if (authState === "unauthenticated") {
    return <AuthPrompt />;
  }

  if (dataState === "loading" && authState === "authenticating") {
    return <LoadingScreen />;
  }

  const renderMainContent = () => {
    switch (currentRoute.view) {
      case "detail":
        return <WorkstreamDetail workstreamId={currentRoute.workstreamId} />;
      case "settings":
        return <SettingsPanel />;
      case "timeline":
      default:
        return <WorkstreamTimeline />;
    }
  };

  return (
    <div className="flex h-screen flex-col bg-[#0a0a0b] text-[rgba(255,255,255,0.92)]">
      <HeaderBar />
      <ErrorBoundary>
        <main className="flex-1 overflow-y-auto">{renderMainContent()}</main>
      </ErrorBoundary>
      <NotificationArea />
    </div>
  );
}
