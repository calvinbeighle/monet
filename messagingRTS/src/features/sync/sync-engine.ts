// Sync engine per Spec 10 - Real-Time Sync
// Orchestrates initial load, incremental polling, change event processing,
// history ID expiry recovery, and offline action queue replay.
// The sync engine is the single coordinator between Gmail and local state.

import {
  fetchThreadDetail,
  fetchHistoryChanges,
  sendReply,
  archiveThread,
  createDraft,
  updateDraft,
  deleteDraft,
  modifyThreadLabels,
} from "../auth/gmail-client";
import type { GmailHistoryResponse, SendReplyPayload, DraftPayload } from "../auth/gmail-client";
import { performInitialLoad, convertGmailThread } from "./thread-fetcher";
import { clearPersistedActionQueue } from "./persistence-manager";
import { useThreadStore } from "../../lib/stores";
import { useSyncStore } from "../../lib/stores/sync-store";
import { useAppStore } from "../../lib/stores";
import type { ThreadChangeEvent, ThreadChangeType, ActionQueueEntry } from "../../lib/types";
import { computeUrgencyScore, computeValueScore } from "../../lib/utils/scoring";
import { placeNewThread } from "../map/drift-engine";
import { createZoneLayout } from "../map/zone-layout";
import { evaluateClusters } from "../map/clustering";

// Injectable fetch functions for testing
let _fetchHistoryChanges = fetchHistoryChanges;
let _fetchThreadDetail = fetchThreadDetail;
let _performInitialLoad = performInitialLoad;
let _sendReply = sendReply;
let _archiveThread = archiveThread;
let _createDraft = createDraft;
let _updateDraft = updateDraft;
let _deleteDraft = deleteDraft;
let _modifyThreadLabels = modifyThreadLabels;

export function _setEngineFetchFns(fns: {
  fetchHistoryChanges?: typeof fetchHistoryChanges;
  fetchThreadDetail?: typeof fetchThreadDetail;
  performInitialLoad?: typeof performInitialLoad;
  sendReply?: typeof sendReply;
  archiveThread?: typeof archiveThread;
  createDraft?: typeof createDraft;
  updateDraft?: typeof updateDraft;
  deleteDraft?: typeof deleteDraft;
  modifyThreadLabels?: typeof modifyThreadLabels;
}): void {
  if (fns.fetchHistoryChanges) _fetchHistoryChanges = fns.fetchHistoryChanges;
  if (fns.fetchThreadDetail) _fetchThreadDetail = fns.fetchThreadDetail;
  if (fns.performInitialLoad) _performInitialLoad = fns.performInitialLoad;
  if (fns.sendReply) _sendReply = fns.sendReply;
  if (fns.archiveThread) _archiveThread = fns.archiveThread;
  if (fns.createDraft) _createDraft = fns.createDraft;
  if (fns.updateDraft) _updateDraft = fns.updateDraft;
  if (fns.deleteDraft) _deleteDraft = fns.deleteDraft;
  if (fns.modifyThreadLabels) _modifyThreadLabels = fns.modifyThreadLabels;
}

export function _resetEngineFetchFns(): void {
  _fetchHistoryChanges = fetchHistoryChanges;
  _fetchThreadDetail = fetchThreadDetail;
  _performInitialLoad = performInitialLoad;
  _sendReply = sendReply;
  _archiveThread = archiveThread;
  _createDraft = createDraft;
  _updateDraft = updateDraft;
  _deleteDraft = deleteDraft;
  _modifyThreadLabels = modifyThreadLabels;
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let isPolling = false;
let consecutivePollFailures = 0;
const MAX_RETRY_INTERVAL_MS = 60000; // 60s cap per Spec 10 Section 8

// --- Initial Load ---
// Per Spec 10: fetch all inbox threads within lookback window, progressive loading,
// record history ID, transition from initial-load to incremental mode.

export async function startInitialLoad(): Promise<void> {
  const syncStore = useSyncStore.getState();
  const threadStore = useThreadStore.getState();
  const appStore = useAppStore.getState();

  useSyncStore.setState({ syncMode: "initial-load" });
  appStore.setSyncStatus("syncing");

  try {
    const result = await _performInitialLoad(syncStore.lookbackDays, (thread) => {
      // Progressive: add each thread to store as it loads
      threadStore.setThread(thread);
    });

    useSyncStore.getState().setHistoryId(result.historyId);
    useSyncStore.getState().setSyncMode("incremental");
    useSyncStore.getState().recordSyncSuccess();
    useAppStore.getState().setSyncStatus("connected");

    // Transition shell state based on thread count
    const threadCount = useThreadStore.getState().getThreadCount();
    if (threadCount === 0) {
      useAppStore.getState().setShellState("empty");
    } else {
      useAppStore.getState().setShellState("active");
    }
  } catch (err) {
    console.error("[SyncEngine] Initial load failed:", err);
    useSyncStore.getState().recordSyncFailure();
    useAppStore.getState().setSyncStatus("error");
    useAppStore.getState().setShellState("degraded");
    useAppStore.getState().addNotification({
      message: "Failed to load inbox. Will retry automatically.",
      severity: "critical",
    });
  }
}

// --- Incremental Sync ---
// Per Spec 10: poll for changes using history API, process change events,
// handle history ID expiry with backfill.

export async function performIncrementalSync(): Promise<void> {
  const syncState = useSyncStore.getState();
  const wasOffline =
    syncState.connectivityStatus === "offline" || syncState.connectivityStatus === "error";

  if (!syncState.lastHistoryId) {
    // No history ID - need initial load first
    await startInitialLoad();
    return;
  }

  useSyncStore.setState({ connectivityStatus: "syncing" });

  try {
    const changeEvents = await fetchAllHistoryChanges(syncState.lastHistoryId);

    if (changeEvents.length > 0) {
      await processChangeEvents(changeEvents);
    }

    useSyncStore.getState().recordSyncSuccess();

    // Per Spec 10 Section 8: when connectivity is restored, replay queued actions
    // in the order they were initiated before resuming normal sync.
    if (wasOffline) {
      const pendingCount = useSyncStore.getState().getPendingActions().length;
      if (pendingCount > 0) {
        console.log(`[SyncEngine] Connectivity restored, replaying ${pendingCount} queued actions`);
        await replayActionQueue();
      }
      // Clear persisted queue after successful replay
      await clearPersistedActionQueue();

      // Restore shell state if it was degraded due to offline
      const shellState = useAppStore.getState().shellState;
      if (shellState === "degraded") {
        const threadCount = useThreadStore.getState().getThreadCount();
        useAppStore.getState().setShellState(threadCount > 0 ? "active" : "empty");
      }
    }
  } catch (err) {
    if (isHistoryExpiredError(err)) {
      // Per Spec 10: history ID expired - fall back to full re-fetch (backfill)
      console.warn("[SyncEngine] History ID expired, performing backfill");
      useSyncStore.setState({ syncMode: "backfill" });
      useAppStore.getState().addNotification({
        message: "Sync cursor expired. Performing full inbox refresh.",
        severity: "warning",
      });
      await startInitialLoad();
      return;
    }

    if (isNetworkError(err)) {
      useSyncStore.setState({ connectivityStatus: "offline" });
      useAppStore.getState().setSyncStatus("offline");
      useAppStore.getState().setShellState("degraded");
      return;
    }

    console.error("[SyncEngine] Incremental sync failed:", err);
    useSyncStore.getState().recordSyncFailure();
    // Per Spec 10: propagate error status to app after 2+ consecutive failures
    const syncState = useSyncStore.getState();
    if (syncState.connectivityStatus === "error") {
      useAppStore.getState().setSyncStatus("error");
      useAppStore.getState().setShellState("degraded");
    }
  }
}

// Fetch all history changes, paginating through results
async function fetchAllHistoryChanges(startHistoryId: string): Promise<ThreadChangeEvent[]> {
  const events: ThreadChangeEvent[] = [];
  let pageToken: string | undefined;
  let latestHistoryId = startHistoryId;

  do {
    const response: GmailHistoryResponse = await _fetchHistoryChanges(startHistoryId, pageToken);

    // Process history entries into change events
    if (response.history) {
      for (const entry of response.history) {
        const historyId = entry.id;

        if (entry.messagesAdded) {
          for (const added of entry.messagesAdded) {
            events.push({
              threadId: added.message.threadId,
              changeType: determineChangeType(added.message.labelIds ?? [], "added"),
              historyId,
              timestamp: Date.now(),
            });
          }
        }

        if (entry.labelsAdded) {
          for (const labelChange of entry.labelsAdded) {
            events.push({
              threadId: labelChange.message.threadId,
              changeType: "label-change",
              historyId,
              timestamp: Date.now(),
            });
          }
        }

        if (entry.labelsRemoved) {
          for (const labelChange of entry.labelsRemoved) {
            events.push({
              threadId: labelChange.message.threadId,
              changeType: "label-change",
              historyId,
              timestamp: Date.now(),
            });
          }
        }
      }
    }

    // Advance cursor
    if (response.historyId > latestHistoryId) {
      latestHistoryId = response.historyId;
    }

    pageToken = response.nextPageToken;
  } while (pageToken);

  // Update the stored history ID
  useSyncStore.getState().setHistoryId(latestHistoryId);

  // Deduplicate: if multiple events reference the same thread, keep the most significant
  return deduplicateEvents(events);
}

function determineChangeType(labelIds: string[], action: "added" | "deleted"): ThreadChangeType {
  // Label-change events: labels are added or removed without new content
  if (action === "deleted") {
    return "label-change";
  }

  // UNREAD added typically means new content arrived
  if (labelIds.includes("UNREAD")) {
    return "new-message";
  }

  // Read state changes (UNREAD removed is handled by action=deleted above)
  if (labelIds.length === 1 && labelIds[0] === "INBOX") {
    return "new-message";
  }

  // Default to label-change for other label additions (STARRED, category labels, etc.)
  return "label-change";
}

// Deduplicate events per thread - keep latest event per thread
function deduplicateEvents(events: ThreadChangeEvent[]): ThreadChangeEvent[] {
  const byThread = new Map<string, ThreadChangeEvent>();
  for (const event of events) {
    const existing = byThread.get(event.threadId);
    if (!existing || event.timestamp >= existing.timestamp) {
      byThread.set(event.threadId, event);
    }
  }
  return [...byThread.values()];
}

// Process change events by re-fetching affected threads.
// Includes conflict detection per Spec 10 Section 6: when an inbound change
// affects a thread that has a pending optimistic update, apply last-write-wins
// and notify the user.
async function processChangeEvents(events: ThreadChangeEvent[]): Promise<void> {
  const threadStore = useThreadStore.getState();
  const now = Date.now();

  for (const event of events) {
    try {
      const detail = await _fetchThreadDetail(event.threadId);
      const thread = convertGmailThread(detail);

      const existingThread = threadStore.getThread(event.threadId);

      if (existingThread) {
        // Conflict detection per Spec 10 Section 6:
        // Check if there are pending/in-flight actions for this thread
        const pendingActions = useSyncStore
          .getState()
          .actionQueue.filter(
            (a) =>
              a.threadId === event.threadId && (a.status === "pending" || a.status === "in-flight"),
          );

        if (pendingActions.length > 0) {
          // Last-write-wins: compare inbound change timestamp vs user action timestamp
          const latestUserAction = Math.max(...pendingActions.map((a) => a.userInitiatedTimestamp));
          const inboundTimestamp = event.timestamp;

          if (inboundTimestamp > latestUserAction) {
            // Inbound change wins - apply server state, notify user
            console.log(
              `[SyncEngine] Conflict on thread ${event.threadId}: server change (${inboundTimestamp}) supersedes user action (${latestUserAction})`,
            );
            useAppStore.getState().addNotification({
              message: `A change to "${thread.subject}" was made elsewhere and superseded your pending action.`,
              severity: "info",
            });
            // Remove the conflicting pending actions since server state wins
            for (const action of pendingActions) {
              useSyncStore.getState().removeAction(action.id);
            }
          } else {
            // User action wins - preserve local optimistic state, skip server merge for
            // the conflicting fields. Still update non-conflicting Gmail data.
            console.log(
              `[SyncEngine] Conflict on thread ${event.threadId}: user action (${latestUserAction}) takes precedence over server change (${inboundTimestamp})`,
            );
            useAppStore.getState().addNotification({
              message: `Your pending action on "${thread.subject}" was preserved over a conflicting change.`,
              severity: "info",
            });
            // Skip the merge for this thread - user's optimistic state is authoritative
            continue;
          }
        }

        // Merge: preserve computed position/scores/zone from existing, update Gmail data
        const merged = {
          ...existingThread,
          // Gmail-sourced fields overwritten
          subject: thread.subject,
          participants: thread.participants,
          messages: thread.messages,
          messageCount: thread.messageCount,
          latestMessageTimestamp: thread.latestMessageTimestamp,
          firstMessageTimestamp: thread.firstMessageTimestamp,
          gmailLabels: thread.gmailLabels,
          unread: thread.unread,
          snippet: thread.snippet,
          // Recompute scores with updated data
          urgencyScore: computeUrgencyScore(
            { ...existingThread, ...thread, position: existingThread.position },
            now,
          ),
          valueScore: computeValueScore({
            ...existingThread,
            ...thread,
            position: existingThread.position,
          }),
          lastModified: now,
        };

        // Check if thread was archived (INBOX label removed)
        if (!thread.gmailLabels.includes("INBOX") && existingThread.gmailLabels.includes("INBOX")) {
          merged.visualState = "archived";
        }

        threadStore.setThread(merged as typeof existingThread);

        // If new message arrived, evaluate lifecycle transition
        if (event.changeType === "new-message" && existingThread.lifecycleState !== "handled") {
          // Inbound message can transition waiting/at-risk/lost -> active
          const validTransitions = ["waiting", "at-risk", "lost"];
          if (validTransitions.includes(existingThread.lifecycleState)) {
            threadStore.transitionState(event.threadId, "active", "inbound-message");
          }
        }
      } else {
        // New thread - place with cluster bias per Spec 11 Section 3
        thread.lifecycleState = "new";
        const allThreads = [...threadStore.threads.values()];
        const { clusters } = evaluateClusters(allThreads, []);
        const zones = createZoneLayout();
        const placed = placeNewThread(thread, zones, allThreads, clusters);
        threadStore.setThread(placed);
      }
    } catch (err) {
      // If we can't fetch a specific thread (deleted?), remove it from store
      console.warn(`[SyncEngine] Failed to fetch thread ${event.threadId}:`, err);
      threadStore.removeThread(event.threadId);
    }
  }
}

// --- Polling Control ---

export function startPolling(): void {
  if (isPolling) return;
  isPolling = true;
  schedulePoll();
}

export function stopPolling(): void {
  isPolling = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

// Compute retry interval with exponential backoff per Spec 10 Section 8
// On success (0 consecutive failures), use base poll interval.
// On failure, use min(base * 2^failures, maxRetryInterval).
export function getRetryInterval(): number {
  const baseInterval = useSyncStore.getState().pollIntervalMs;
  if (consecutivePollFailures === 0) return baseInterval;
  const exponential = baseInterval * Math.pow(2, consecutivePollFailures);
  return Math.min(exponential, MAX_RETRY_INTERVAL_MS);
}

function schedulePoll(): void {
  if (!isPolling) return;
  const interval = getRetryInterval();
  pollTimer = setTimeout(async () => {
    const failuresBefore = useSyncStore.getState().consecutiveFailures;
    await performIncrementalSync();
    const failuresAfter = useSyncStore.getState().consecutiveFailures;

    if (failuresAfter > failuresBefore) {
      consecutivePollFailures++;
    } else if (failuresAfter === 0) {
      consecutivePollFailures = 0;
    }

    schedulePoll();
  }, interval);
}

// Exported for testing
export function _getConsecutivePollFailures(): number {
  return consecutivePollFailures;
}

export function _setConsecutivePollFailures(n: number): void {
  consecutivePollFailures = n;
}

// --- Action Queue Replay ---
// Per Spec 10: when connectivity is restored, replay queued actions in order.

export async function replayActionQueue(): Promise<void> {
  const syncStore = useSyncStore.getState();
  const pendingActions = syncStore.getPendingActions();

  for (const action of pendingActions) {
    // Per Spec 10 Section 8: if a queued action can no longer be applied
    // (e.g., thread deleted from Gmail), discard and notify the user.
    if (action.type !== "draft-save" && action.type !== "draft-discard") {
      const thread = useThreadStore.getState().getThread(action.threadId);
      if (!thread) {
        console.warn(
          `[SyncEngine] Discarding queued ${action.type} - thread ${action.threadId} no longer exists`,
        );
        useAppStore.getState().addNotification({
          message: `Queued ${action.type} was discarded because the thread no longer exists.`,
          severity: "warning",
        });
        useSyncStore.getState().removeAction(action.id);
        continue;
      }
    }

    syncStore.updateActionStatus(action.id, "in-flight");

    try {
      await executeAction(action);
      // Clean up succeeded entries immediately per Spec 10
      useSyncStore.getState().removeAction(action.id);
    } catch (err) {
      const retryable = isRetryableError(err);
      if (retryable && action.retryCount < 3) {
        useSyncStore.getState().updateActionStatus(action.id, "pending");
        useSyncStore.getState().incrementRetryCount(action.id);
      } else {
        // Per Spec 10: every failure surfaced to user, no silent drops
        useAppStore.getState().addNotification({
          message: `Failed to ${action.type} thread. The action was discarded.`,
          severity: "warning",
        });
        useSyncStore.getState().removeAction(action.id);
      }
    }
  }
}

async function executeAction(action: ActionQueueEntry): Promise<void> {
  switch (action.type) {
    case "reply": {
      const payload = action.payload as SendReplyPayload;
      await _sendReply(payload);
      break;
    }
    case "archive": {
      await _archiveThread(action.threadId);
      break;
    }
    case "draft-save": {
      const payload = action.payload as DraftPayload;
      if (payload.draftId) {
        await _updateDraft(payload.draftId, payload);
      } else {
        await _createDraft(payload);
      }
      break;
    }
    case "draft-discard": {
      const { draftId } = action.payload as { draftId: string };
      await _deleteDraft(draftId);
      break;
    }
    case "label-change": {
      const { addLabelIds, removeLabelIds } = action.payload as {
        addLabelIds: string[];
        removeLabelIds: string[];
      };
      await _modifyThreadLabels(action.threadId, addLabelIds ?? [], removeLabelIds ?? []);
      break;
    }
    default:
      console.warn(`[SyncEngine] Unhandled action type: ${action.type}`);
  }
}

// --- Error Classification ---

function isHistoryExpiredError(err: unknown): boolean {
  if (err instanceof Error) {
    // Gmail returns 404 when history ID is no longer valid
    return err.message.includes("404") || err.message.includes("historyId");
  }
  return false;
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof Error) {
    return (
      err.message.includes("fetch") ||
      err.message.includes("network") ||
      err.message.includes("ECONNREFUSED") ||
      err.name === "TypeError" // fetch throws TypeError on network failure
    );
  }
  return false;
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    return (
      err.message.includes("429") || err.message.includes("500") || err.message.includes("503")
    );
  }
  return false;
}
