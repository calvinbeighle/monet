// IndexedDB persistence layer per Spec 09 and Spec 10
// Uses idb for ergonomic IndexedDB access
// Stores threads, positions, scores for offline cache and session persistence
// Stores action queue entries for offline operation survival across tab close

import { openDB, type IDBPDatabase } from "idb";
import type { Thread, ActionQueueEntry } from "../types";
import type { DeploymentRecord } from "../stores/deployment-store";

const DB_NAME = "messaging-rts";
const DB_VERSION = 3;
const THREADS_STORE = "threads";
const ACTION_QUEUE_STORE = "action-queue";
const DEPLOYMENTS_STORE = "deployments";

// Retention limit for deployment history per Spec 06
const DEPLOYMENT_RETENTION_LIMIT = 100;

interface MessagingRTSDB {
  threads: {
    key: string;
    value: Thread;
    indexes: {
      "by-zone": string;
      "by-lifecycle": string;
      "by-last-modified": number;
    };
  };
  "action-queue": {
    key: string;
    value: ActionQueueEntry;
  };
  deployments: {
    key: string;
    value: DeploymentRecord;
    indexes: {
      "by-started-at": number;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<MessagingRTSDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<MessagingRTSDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MessagingRTSDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const store = db.createObjectStore(THREADS_STORE, { keyPath: "id" });
          store.createIndex("by-zone", "zone");
          store.createIndex("by-lifecycle", "lifecycleState");
          store.createIndex("by-last-modified", "lastModified");
        }
        if (oldVersion < 2) {
          db.createObjectStore(ACTION_QUEUE_STORE, { keyPath: "id" });
        }
        if (oldVersion < 3) {
          const deployStore = db.createObjectStore(DEPLOYMENTS_STORE, { keyPath: "id" });
          deployStore.createIndex("by-started-at", "startedAt");
        }
      },
    });
  }
  return dbPromise;
}

// Thread CRUD operations

export async function persistThread(thread: Thread): Promise<void> {
  const db = await getDB();
  await db.put(THREADS_STORE, thread);
}

export async function persistThreads(threads: Thread[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(THREADS_STORE, "readwrite");
  for (const thread of threads) {
    tx.store.put(thread);
  }
  await tx.done;
}

export async function loadThread(id: string): Promise<Thread | undefined> {
  const db = await getDB();
  return db.get(THREADS_STORE, id);
}

export async function loadAllThreads(): Promise<Thread[]> {
  const db = await getDB();
  return db.getAll(THREADS_STORE);
}

export async function loadThreadsByZone(zone: string): Promise<Thread[]> {
  const db = await getDB();
  return db.getAllFromIndex(THREADS_STORE, "by-zone", zone);
}

export async function deleteThread(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(THREADS_STORE, id);
}

export async function deleteAllThreads(): Promise<void> {
  const db = await getDB();
  await db.clear(THREADS_STORE);
}

export async function getThreadCount(): Promise<number> {
  const db = await getDB();
  return db.count(THREADS_STORE);
}

// Merge logic per Spec 09:
// Persisted state + fresh Gmail data on reload
// Core Gmail properties overwritten by fresh data
// Computed properties (position, scores, zone) preserved from persisted state
// New threads from Gmail not in storage treated as new
// Threads in storage but deleted from Gmail are removed
export function mergeThreadData(persisted: Thread, fresh: Partial<Thread>): Thread {
  return {
    ...persisted,
    // Overwrite core Gmail properties with fresh data
    subject: fresh.subject ?? persisted.subject,
    participants: fresh.participants ?? persisted.participants,
    messages: fresh.messages ?? persisted.messages,
    messageCount: fresh.messageCount ?? persisted.messageCount,
    latestMessageTimestamp: fresh.latestMessageTimestamp ?? persisted.latestMessageTimestamp,
    firstMessageTimestamp: fresh.firstMessageTimestamp ?? persisted.firstMessageTimestamp,
    gmailLabels: fresh.gmailLabels ?? persisted.gmailLabels,
    unread: fresh.unread ?? persisted.unread,
    snippet: fresh.snippet ?? persisted.snippet,
    // Preserve computed properties from persisted state
    // (position, scores, zone, lifecycle, etc. are NOT overwritten)
    lastModified: Date.now(),
  };
}

// --- Action Queue Persistence (Spec 10 Section 8) ---
// Actions queued while offline must survive tab close so they can be replayed on reconnect.

export async function persistActionQueue(entries: ActionQueueEntry[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(ACTION_QUEUE_STORE, "readwrite");
  // Clear existing and write fresh - queue is small and order matters
  await tx.store.clear();
  for (const entry of entries) {
    tx.store.put(entry);
  }
  await tx.done;
}

export async function loadActionQueue(): Promise<ActionQueueEntry[]> {
  const db = await getDB();
  return db.getAll(ACTION_QUEUE_STORE);
}

export async function clearActionQueue(): Promise<void> {
  const db = await getDB();
  await db.clear(ACTION_QUEUE_STORE);
}

// --- Deployment History Persistence (Spec 06 Section 12) ---
// Deployment records persist across sessions with a retention limit.

export async function persistDeployments(deployments: DeploymentRecord[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(DEPLOYMENTS_STORE, "readwrite");
  await tx.store.clear();
  // Only persist up to retention limit, most recent first
  const toKeep = deployments.slice(0, DEPLOYMENT_RETENTION_LIMIT);
  for (const record of toKeep) {
    tx.store.put(record);
  }
  await tx.done;
}

export async function loadDeployments(): Promise<DeploymentRecord[]> {
  const db = await getDB();
  const records = await db.getAll(DEPLOYMENTS_STORE);
  // Sort by startedAt descending (most recent first)
  return records.sort((a, b) => b.startedAt - a.startedAt);
}

export async function clearDeployments(): Promise<void> {
  const db = await getDB();
  await db.clear(DEPLOYMENTS_STORE);
}

// Close the database connection (useful for testing)
export async function closeDB(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
}
