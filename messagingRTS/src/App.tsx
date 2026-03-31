// Application shell per Spec 12
// Layout: status bar (top), map viewport (center), agent dock (bottom)

import { useEffect } from "react";
import { useAppStore } from "./lib/stores";
import { StatusBar } from "./components/status-bar";
import { MapViewport } from "./features/map/map-viewport";
import { AgentDock } from "./components/agent-dock";

export function App() {
  const shellState = useAppStore((s) => s.shellState);
  const setShellState = useAppStore((s) => s.setShellState);
  const setViewportDimensions = useAppStore((s) => s.setViewportDimensions);

  useEffect(() => {
    const handleResize = () => {
      setViewportDimensions(window.innerWidth, window.innerHeight);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setViewportDimensions]);

  // Transition from initializing to active (auth will gate this later)
  useEffect(() => {
    if (shellState === "initializing") {
      setShellState("active");
    }
  }, [shellState, setShellState]);

  if (shellState === "initializing") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#0a0a12] text-gray-400">
        Initializing...
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-[#0a0a12]" data-testid="app-shell">
      <StatusBar />
      <div className="relative flex-1 overflow-hidden">
        <MapViewport />
      </div>
      <AgentDock />
    </div>
  );
}
