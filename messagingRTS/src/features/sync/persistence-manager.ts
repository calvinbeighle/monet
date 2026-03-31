// Persistence manager per Spec 09 and Spec 03
// Connects the thread store to IndexedDB for position persistence across sessions.
// Loads persisted threads on startup, debounces saves to avoid excessive writes.
// Re-evaluates scores on session resume to reflect accumulated neglect.

import { useThreadStore } from "../../lib/stores";
import { persistThreads, loadAllThreads } from "../../lib/utils/persistence";
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

// Save current thread state to IndexedDB
export async function saveThreadState(): Promise<void> {
  const threads = [...useThreadStore.getState().threads.values()];
  if (threads.length === 0) return;

  try {
    await persistThreads(threads);
    lastPersistTime = Date.now();
  } catch (err) {
    console.warn("[PersistenceManager] Failed to persist threads:", err);
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
