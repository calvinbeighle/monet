// Persistence manager per Spec 09 and Spec 03
// Connects the thread store to IndexedDB for position persistence across sessions.
// Loads persisted threads on startup, debounces saves to avoid excessive writes.
// Re-evaluates scores on session resume to reflect accumulated neglect.

import { useThreadStore } from "../../lib/stores";
import { useSyncStore } from "../../lib/stores/sync-store";
import {
  persistThreads,
  loadAllThreads,
  persistActionQueue,
  loadActionQueue,
  clearActionQueue,
} from "../../lib/utils/persistence";
import { computeUrgencyScore, computeValueScore } from "../../lib/utils/scoring";
import type { Thread } from "../../lib/types";

// Save interval: persist thread state every 5 seconds (avoids excessive IndexedDB writes
// during the 200ms drift tick). Thread positions drift continuously, so batching is fine.
const PERSIST_INTERVAL_MS = 5000;

let persistInterval: ReturnType<typeof setInterval> | null = null;
let lastPersistTime = 0;

// Load persisted threads and re-evaluate scores per Spec 03:
// On session resume, urgency and value scores must reflect accumulated neglect
// since the last session. Scores drive position targets, so recalculating them
// before the first drift tick ensures threads start drifting from the right state.
export async function loadPersistedThreads(): Promise<Thread[]> {
  const persisted = await loadAllThreads();
  if (persisted.length === 0) return [];

  const now = Date.now();

  // Re-evaluate scores to reflect time elapsed since last session
  const reEvaluated = persisted.map((thread) => ({
    ...thread,
    urgencyScore: computeUrgencyScore(thread, now),
    valueScore: computeValueScore(thread),
    // Update neglect duration: time since last user action
    neglectDuration: thread.lastUserReplyTimestamp
      ? now - thread.lastUserReplyTimestamp
      : now - thread.firstMessageTimestamp,
  }));

  return reEvaluated;
}

// Save current thread state and action queue to IndexedDB
export async function saveThreadState(): Promise<void> {
  const threads = [...useThreadStore.getState().threads.values()];

  try {
    if (threads.length > 0) {
      await persistThreads(threads);
    }
    // Always persist the action queue - losing queued actions is worse than
    // losing a position update, so we save even when the queue is empty
    // (to clear previously persisted entries after successful replay).
    const queue = useSyncStore.getState().actionQueue;
    await persistActionQueue(queue);
    lastPersistTime = Date.now();
  } catch (err) {
    console.warn("[PersistenceManager] Failed to persist state:", err);
  }
}

// Load persisted action queue and restore to sync store.
// Called during app init so offline actions survive tab close.
export async function loadPersistedActionQueue(): Promise<void> {
  try {
    const queue = await loadActionQueue();
    if (queue.length > 0) {
      // Restore each entry into the sync store's action queue.
      // We set the queue directly rather than using enqueueAction to preserve
      // the original IDs and retry counts.
      useSyncStore.setState({ actionQueue: queue });
      console.log(`[PersistenceManager] Restored ${queue.length} queued actions from IndexedDB`);
    }
  } catch (err) {
    console.warn("[PersistenceManager] Failed to load action queue:", err);
  }
}

// Clear persisted action queue after successful replay
export async function clearPersistedActionQueue(): Promise<void> {
  try {
    await clearActionQueue();
  } catch (err) {
    console.warn("[PersistenceManager] Failed to clear action queue:", err);
  }
}

// Start periodic persistence - call once during app initialization
export function startPeriodicPersist(): void {
  if (persistInterval) return; // already running

  persistInterval = setInterval(() => {
    saveThreadState();
  }, PERSIST_INTERVAL_MS);
}

// Stop periodic persistence - call on app teardown
export function stopPeriodicPersist(): void {
  if (persistInterval) {
    clearInterval(persistInterval);
    persistInterval = null;
  }
}

// Force an immediate save (e.g., before page unload)
export async function flushPersist(): Promise<void> {
  await saveThreadState();
}

// Get time since last persist (useful for debugging)
export function getLastPersistTime(): number {
  return lastPersistTime;
}
