// Application shell store - manages shell state per Spec 12
// Controls layout panels, auth state, sync status, focus zones, notifications, and selected thread

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

export type NotificationSeverity = "info" | "warning" | "critical" | "success";

export interface ShellNotification {
  id: string;
  message: string;
  severity: NotificationSeverity;
  dismissed: boolean;
  createdAt: number;
  autoResolveCondition?: string;
}

// Responsive breakpoint (px) - below this, panels overlay instead of shrink
export const RESPONSIVE_BREAKPOINT = 768;

// Max visible notifications before auto-dismiss
export const MAX_VISIBLE_NOTIFICATIONS = 5;

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
  selectedThreadId: string | null;
  notifications: ShellNotification[];

  // Actions
  setShellState: (state: ShellState) => void;
  setActivePanel: (panel: ActivePanel) => void;
  setFocusZone: (zone: FocusZone) => void;
  setSyncStatus: (status: ConnectivityStatus) => void;
  setFrontHealth: (score: number) => void;
  setViewportDimensions: (width: number, height: number) => void;
  setUnreadAlertCount: (count: number) => void;
  setSelectedThread: (threadId: string | null) => void;
  addNotification: (
    notification: Omit<ShellNotification, "id" | "dismissed" | "createdAt">,
  ) => void;
  dismissNotification: (id: string) => void;
  clearAllNotifications: () => void;
}

let notificationCounter = 0;

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
  selectedThreadId: null,
  notifications: [],

  setShellState: (shellState) => set({ shellState }),
  setActivePanel: (activePanel) => set({ activePanel }),
  setFocusZone: (focusZone) => set({ focusZone }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setFrontHealth: (frontHealthScore) => set({ frontHealthScore }),
  setViewportDimensions: (viewportWidth, viewportHeight) => set({ viewportWidth, viewportHeight }),
  setUnreadAlertCount: (unreadAlertCount) => set({ unreadAlertCount }),
  setSelectedThread: (threadId) =>
    set((state) => ({
      selectedThreadId: threadId,
      // Open detail panel when selecting, close when deselecting
      activePanel: threadId
        ? "detail"
        : state.activePanel === "detail"
          ? "none"
          : state.activePanel,
    })),
  addNotification: (notification) =>
    set((state) => {
      const id = `notif-${++notificationCounter}`;
      const newNotification: ShellNotification = {
        ...notification,
        id,
        dismissed: false,
        createdAt: Date.now(),
      };
      const updated = [newNotification, ...state.notifications];
      // Auto-dismiss oldest beyond max visible
      if (updated.filter((n) => !n.dismissed).length > MAX_VISIBLE_NOTIFICATIONS) {
        const visible = updated.filter((n) => !n.dismissed);
        for (let i = MAX_VISIBLE_NOTIFICATIONS; i < visible.length; i++) {
          visible[i].dismissed = true;
        }
      }
      return { notifications: updated };
    }),
  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.map((n) => (n.id === id ? { ...n, dismissed: true } : n)),
    })),
  clearAllNotifications: () => set({ notifications: [] }),
}));
