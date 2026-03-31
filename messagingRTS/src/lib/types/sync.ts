// Real-time sync types per Spec 10

export type SyncMode = "initial-load" | "incremental" | "backfill";

export type ConnectivityStatus = "connected" | "syncing" | "error" | "offline";

export type ActionQueueEntryStatus = "pending" | "in-flight" | "succeeded" | "failed";

export interface ActionQueueEntry {
  id: string;
  type: "reply" | "archive" | "label-change" | "draft-save" | "draft-discard";
  threadId: string;
  payload: unknown;
  userInitiatedTimestamp: number;
  retryCount: number;
  status: ActionQueueEntryStatus;
}

export interface SyncState {
  lastHistoryId: string | null;
  lastSuccessfulSync: number | null;
  syncMode: SyncMode;
  connectivityStatus: ConnectivityStatus;
  queuedActionCount: number;
  lastPositioningTick: number;
}

export type ThreadChangeType = "new-thread" | "new-message" | "label-change" | "read-state-change";

export interface ThreadChangeEvent {
  threadId: string;
  changeType: ThreadChangeType;
  historyId: string;
  timestamp: number;
}
