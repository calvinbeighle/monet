// Application shell store - manages shell state per Spec 12
// Controls layout panels, auth state, sync status, and focus zones

import { create } from "zustand";
import type { ConnectivityStatus } from "../types";

// Shell lifecycle per Spec 12:
// Initializing -> Unauthenticated / Loading -> Empty / Active / Degraded
export type ShellState =
  | "initializing"
  | "unauthenticated"
  | "loading"
  | "empty"
  | "active"
  | "degraded";

export type ActivePanel = "none" | "detail" | "deployment-history" | "session-summary" | "search";

export type FocusZone = "status-bar" | "map" | "agent-dock" | "right-panel";

interface AppStore {
  shellState: ShellState;
  activePanel: ActivePanel;
  focusZone: FocusZone;
  syncStatus: ConnectivityStatus;
  frontHealthScore: number;
  streakInboxZero: number;
  streakZeroLost: number;
  unreadAlertCount: number;
  viewportWidth: number;
  viewportHeight: number;

  // Actions
  setShellState: (state: ShellState) => void;
  setActivePanel: (panel: ActivePanel) => void;
  setFocusZone: (zone: FocusZone) => void;
  setSyncStatus: (status: ConnectivityStatus) => void;
  setFrontHealth: (score: number) => void;
  setViewportDimensions: (width: number, height: number) => void;
  setUnreadAlertCount: (count: number) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  shellState: "initializing",
  activePanel: "none",
  focusZone: "map",
  syncStatus: "connected",
  frontHealthScore: 100,
  streakInboxZero: 0,
  streakZeroLost: 0,
  unreadAlertCount: 0,
  viewportWidth: 0,
  viewportHeight: 0,

  setShellState: (shellState) => set({ shellState }),
  setActivePanel: (activePanel) => set({ activePanel }),
  setFocusZone: (focusZone) => set({ focusZone }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setFrontHealth: (frontHealthScore) => set({ frontHealthScore }),
  setViewportDimensions: (viewportWidth, viewportHeight) => set({ viewportWidth, viewportHeight }),
  setUnreadAlertCount: (unreadAlertCount) => set({ unreadAlertCount }),
}));
