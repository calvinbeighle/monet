// Sync and connectivity types - adapted from messagingRTS sync.ts

export type SyncMode = "initial-load" | "incremental" | "backfill";

export type ConnectivityStatus = "connected" | "syncing" | "error" | "offline";

export type ActionQueueEntryStatus =
  | "pending"
  | "in-flight"
  | "succeeded"
  | "failed";

export type ActionQueueEntryType =
  | "reply-email"
  | "archive-email"
  | "label-change"
  | "draft-save"
  | "draft-discard";

export type ActionQueueEntry = {
  id: string;
  type: ActionQueueEntryType;
  activityId: string;
  payload: Record<string, unknown>;
  retryCount: number;
  maxRetries: number;
  status: ActionQueueEntryStatus;
  createdAt: number;
  lastAttemptAt: number | null;
  error: string | null;
};

// Per-source sync state
export type SourceSyncState = {
  mode: SyncMode;
  status: ConnectivityStatus;
  lastSyncAt: number | null;
  cursor: string | null; // source-specific sync cursor (e.g. Gmail historyId)
  error: string | null;
  itemCount: number;
};

// Auth state (orthogonal dimension from data state per spec 14)
export type AuthState = "unauthenticated" | "authenticating" | "authenticated";

// Data state (orthogonal dimension from auth state)
export type DataState = "loading" | "loaded" | "error" | "offline";

// View routing
export type ViewRoute =
  | { view: "timeline" }
  | { view: "detail"; workstreamId: string }
  | { view: "settings" };

// Notification types
export type NotificationType = "info" | "warning" | "error";

export type NotificationItem = {
  id: string;
  message: string;
  type: NotificationType;
  timestamp: number;
  dismissable: boolean;
  autoDismissMs: number | null; // null = manual dismiss only
};

// Activity change events for real-time updates
export type ActivityChangeType =
  | "new-activity"
  | "updated-activity"
  | "workstream-assigned"
  | "workstream-removed";

export type ActivityChangeEvent = {
  type: ActivityChangeType;
  activityId: string;
  workstreamId: string | null;
  timestamp: number;
};
