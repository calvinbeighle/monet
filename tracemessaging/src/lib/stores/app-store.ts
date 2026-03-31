// Application shell store - manages auth, data state, routing, sync, notifications
// Two orthogonal dimensions: AuthState x DataState (per spec 14)

import { create } from "zustand";
import type {
  AuthState,
  DataState,
  ViewRoute,
  ConnectivityStatus,
  NotificationItem,
  NotificationType,
  SourceType,
  SourceSyncState,
} from "../types";

export const MAX_VISIBLE_NOTIFICATIONS = 3;

type AppStore = {
  // Two-dimensional state
  authState: AuthState;
  dataState: DataState;

  // Routing
  currentRoute: ViewRoute;

  // Sync
  syncStatus: ConnectivityStatus;
  sourceSyncStates: Map<SourceType, SourceSyncState>;

  // Notifications
  notifications: NotificationItem[];

  // Search
  searchQuery: string;
  searchOpen: boolean;

  // Actions
  setAuthState: (state: AuthState) => void;
  setDataState: (state: DataState) => void;
  navigate: (route: ViewRoute) => void;
  setSyncStatus: (status: ConnectivityStatus) => void;
  updateSourceSync: (
    source: SourceType,
    state: Partial<SourceSyncState>,
  ) => void;
  addNotification: (
    message: string,
    type: NotificationType,
    autoDismissMs?: number | null,
  ) => void;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
  setSearchQuery: (query: string) => void;
  setSearchOpen: (open: boolean) => void;
};

let notificationCounter = 0;

export const useAppStore = create<AppStore>((set) => ({
  authState: "unauthenticated",
  dataState: "loading",
  currentRoute: { view: "timeline" },
  syncStatus: "connected",
  sourceSyncStates: new Map(),
  notifications: [],
  searchQuery: "",
  searchOpen: false,

  setAuthState: (authState) => set({ authState }),
  setDataState: (dataState) => set({ dataState }),

  navigate: (route) => {
    set({ currentRoute: route });
    // Update browser URL
    const path =
      route.view === "detail"
        ? `/workstream/${route.workstreamId}`
        : route.view === "settings"
          ? "/settings"
          : "/";
    window.history.pushState(route, "", path);
  },

  setSyncStatus: (syncStatus) => set({ syncStatus }),

  updateSourceSync: (source, state) =>
    set((prev) => {
      const next = new Map(prev.sourceSyncStates);
      const existing = next.get(source) ?? {
        mode: "initial-load" as const,
        status: "connected" as const,
        lastSyncAt: null,
        cursor: null,
        error: null,
        itemCount: 0,
      };
      next.set(source, { ...existing, ...state });
      return { sourceSyncStates: next };
    }),

  addNotification: (message, type, autoDismissMs) => {
    const id = `notif-${++notificationCounter}`;
    const defaultDismiss =
      type === "info" ? 5000 : type === "warning" ? 10000 : null;
    const notification: NotificationItem = {
      id,
      message,
      type,
      timestamp: Date.now(),
      dismissable: true,
      autoDismissMs:
        autoDismissMs !== undefined ? autoDismissMs : defaultDismiss,
    };
    set((state) => {
      const updated = [notification, ...state.notifications];
      // Keep only MAX_VISIBLE_NOTIFICATIONS + some buffer
      return {
        notifications: updated.slice(0, MAX_VISIBLE_NOTIFICATIONS + 5),
      };
    });
  },

  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  clearNotifications: () => set({ notifications: [] }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
}));
