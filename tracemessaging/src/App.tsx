import { useEffect } from "react";
import { useTerminalStore } from "./lib/stores/terminal-store";
import { WorkstreamTimeline } from "./features/timeline/workstream-timeline";
import { ErrorBoundary } from "./components/error-boundary";

export function App() {
  const fetchSessions = useTerminalStore((s) => s.fetchSessions);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  return (
    <ErrorBoundary>
      <WorkstreamTimeline />
    </ErrorBoundary>
  );
}
