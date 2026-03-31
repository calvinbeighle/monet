// IndexedDB persistence layer per Spec 09
// Uses idb for ergonomic IndexedDB access
// Stores threads, positions, scores for offline cache and session persistence

import { openDB, type IDBPDatabase } from "idb";
import type { Thread } from "../types";

const DB_NAME = "messaging-rts";
const DB_VERSION = 1;
const THREADS_STORE = "threads";

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
}

let dbPromise: Promise<IDBPDatabase<MessagingRTSDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<MessagingRTSDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MessagingRTSDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore(THREADS_STORE, { keyPath: "id" });
        store.createIndex("by-zone", "zone");
        store.createIndex("by-lifecycle", "lifecycleState");
        store.createIndex("by-last-modified", "lastModified");
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

// Close the database connection (useful for testing)
export async function closeDB(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
}
