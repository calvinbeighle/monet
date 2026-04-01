// Sync store per Spec 10 - Real-Time Sync
// Manages sync state: mode, connectivity, history cursor, action queue.
// The sync engine reads/writes this store; the UI reads connectivity status.

import { create } from "zustand";
import type {
  SyncMode,
  ConnectivityStatus,
  ActionQueueEntry,
  ActionQueueEntryStatus,
} from "../types";

interface SyncStore {
  // Sync cursor
  lastHistoryId: string | null;
  lastSuccessfulSync: number | null;
  syncMode: SyncMode;
  connectivityStatus: ConnectivityStatus;
  consecutiveFailures: number;

  // Action queue for offline operations
  actionQueue: ActionQueueEntry[];

  // Positioning tick per Spec 10
  lastPositioningTick: number;

  // Polling control
  pollIntervalMs: number;
  lookbackDays: number;

  // Actions
  setHistoryId: (id: string) => void;
  setSyncMode: (mode: SyncMode) => void;
  setConnectivityStatus: (status: ConnectivityStatus) => void;
  recordSyncSuccess: () => void;
  recordSyncFailure: () => void;

  // Action queue management
  enqueueAction: (entry: Omit<ActionQueueEntry, "id" | "retryCount" | "status">) => void;
  updateActionStatus: (id: string, status: ActionQueueEntryStatus) => void;
  incrementRetryCount: (id: string) => void;
  removeAction: (id: string) => void;
  getPendingActions: () => ActionQueueEntry[];
  getQueuedActionCount: () => number;
}

let actionCounter = 0;

export const useSyncStore = create<SyncStore>((set, get) => ({
  lastHistoryId: null,
  lastSuccessfulSync: null,
  syncMode: "initial-load",
  connectivityStatus: "connected",
  consecutiveFailures: 0,

  actionQueue: [],

  lastPositioningTick: 0,
  pollIntervalMs: 5000, // 5 seconds - spec says within 10 seconds
  lookbackDays: 30,

  setHistoryId: (id) => set({ lastHistoryId: id }),

  setSyncMode: (mode) => set({ syncMode: mode }),

  setConnectivityStatus: (status) => set({ connectivityStatus: status }),

  recordSyncSuccess: () =>
    set({
      lastSuccessfulSync: Date.now(),
      consecutiveFailures: 0,
      connectivityStatus: "connected",
    }),

  recordSyncFailure: () =>
    set((state) => {
      const failures = state.consecutiveFailures + 1;
      // Per Spec 10: error after 2+ consecutive failures
      // Per Spec 10: offline when network unreachable (caller determines this)
      return {
        consecutiveFailures: failures,
        connectivityStatus: failures >= 2 ? "error" : state.connectivityStatus,
      };
    }),

  enqueueAction: (entry) =>
    set((state) => ({
      actionQueue: [
        ...state.actionQueue,
        {
          ...entry,
          id: `action-${++actionCounter}`,
          retryCount: 0,
          status: "pending" as const,
        },
      ],
    })),

  updateActionStatus: (id, status) =>
    set((state) => ({
      actionQueue: state.actionQueue.map((a) => (a.id === id ? { ...a, status } : a)),
    })),

  incrementRetryCount: (id) =>
    set((state) => ({
      actionQueue: state.actionQueue.map((a) =>
        a.id === id ? { ...a, retryCount: a.retryCount + 1 } : a,
      ),
    })),

  removeAction: (id) =>
    set((state) => ({
      actionQueue: state.actionQueue.filter((a) => a.id !== id),
    })),

  getPendingActions: () => get().actionQueue.filter((a) => a.status === "pending"),

  getQueuedActionCount: () => get().actionQueue.filter((a) => a.status !== "succeeded").length,
}));
