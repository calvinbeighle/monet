// IndexedDB persistence layer for Trace Messaging
// Adapted from messagingRTS persistence.ts
// Three stores: activities, workstreams, summaryCache
// Split-ownership merge preserves app-computed fields across source refreshes

import { openDB } from "idb";
import type { IDBPDatabase } from "idb";
import type { ActivityRecord } from "../types/activity";
import type { Workstream } from "../types/workstream";
import type { WorkstreamSummary } from "../types/workstream";

const DB_NAME = "trace-messaging";
const DB_VERSION = 1;

type TraceDB = IDBPDatabase;

let dbPromise: Promise<TraceDB> | null = null;

export function getDB(): Promise<TraceDB> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Activities store
        if (!db.objectStoreNames.contains("activities")) {
          const activityStore = db.createObjectStore("activities", {
            keyPath: "activityId",
          });
          activityStore.createIndex("by-source", "source");
          activityStore.createIndex("by-workstreamId", "workstreamId");
          activityStore.createIndex("by-timestamp", "timestamp");
        }

        // Workstreams store
        if (!db.objectStoreNames.contains("workstreams")) {
          const workstreamStore = db.createObjectStore("workstreams", {
            keyPath: "id",
          });
          workstreamStore.createIndex("by-status", "status");
          workstreamStore.createIndex(
            "by-lastActivityTimestamp",
            "lastActivityTimestamp",
          );
        }

        // Summary cache store
        if (!db.objectStoreNames.contains("summaryCache")) {
          db.createObjectStore("summaryCache", {
            keyPath: "workstreamId",
          });
        }
      },
    });
  }
  return dbPromise;
}

// --- Activity CRUD ---

export async function persistActivity(activity: ActivityRecord): Promise<void> {
  const db = await getDB();
  await db.put("activities", activity);
}

export async function persistActivities(
  activities: ActivityRecord[],
): Promise<void> {
  if (activities.length === 0) return;
  const db = await getDB();
  const tx = db.transaction("activities", "readwrite");
  for (const activity of activities) {
    tx.store.put(activity);
  }
  await tx.done;
}

export async function loadActivity(
  activityId: string,
): Promise<ActivityRecord | undefined> {
  const db = await getDB();
  return db.get("activities", activityId);
}

export async function loadAllActivities(): Promise<ActivityRecord[]> {
  const db = await getDB();
  return db.getAll("activities");
}

export async function loadActivitiesBySource(
  source: string,
): Promise<ActivityRecord[]> {
  const db = await getDB();
  return db.getAllFromIndex("activities", "by-source", source);
}

export async function loadActivitiesByWorkstream(
  workstreamId: string,
): Promise<ActivityRecord[]> {
  const db = await getDB();
  return db.getAllFromIndex("activities", "by-workstreamId", workstreamId);
}

export async function loadUnassignedActivities(): Promise<ActivityRecord[]> {
  const db = await getDB();
  // IndexedDB can query by index value - null workstreamId means unassigned
  // But IDB doesn't index null well, so we filter in memory
  const all = await db.getAll("activities");
  return all.filter((a) => a.workstreamId === null);
}

export async function deleteActivity(activityId: string): Promise<void> {
  const db = await getDB();
  await db.delete("activities", activityId);
}

export async function deleteAllActivities(): Promise<void> {
  const db = await getDB();
  await db.clear("activities");
}

export async function getActivityCount(): Promise<number> {
  const db = await getDB();
  return db.count("activities");
}

// --- Workstream CRUD ---

export async function persistWorkstream(workstream: Workstream): Promise<void> {
  const db = await getDB();
  await db.put("workstreams", workstream);
}

export async function persistWorkstreams(
  workstreams: Workstream[],
): Promise<void> {
  if (workstreams.length === 0) return;
  const db = await getDB();
  const tx = db.transaction("workstreams", "readwrite");
  for (const workstream of workstreams) {
    tx.store.put(workstream);
  }
  await tx.done;
}

export async function loadWorkstream(
  id: string,
): Promise<Workstream | undefined> {
  const db = await getDB();
  return db.get("workstreams", id);
}

export async function loadAllWorkstreams(): Promise<Workstream[]> {
  const db = await getDB();
  return db.getAll("workstreams");
}

export async function loadWorkstreamsByStatus(
  status: string,
): Promise<Workstream[]> {
  const db = await getDB();
  return db.getAllFromIndex("workstreams", "by-status", status);
}

export async function deleteWorkstream(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("workstreams", id);
}

export async function deleteAllWorkstreams(): Promise<void> {
  const db = await getDB();
  await db.clear("workstreams");
}

export async function getWorkstreamCount(): Promise<number> {
  const db = await getDB();
  return db.count("workstreams");
}

// --- Summary Cache ---

type CachedSummary = WorkstreamSummary & { workstreamId: string };

export async function persistSummary(
  workstreamId: string,
  summary: WorkstreamSummary,
): Promise<void> {
  const db = await getDB();
  await db.put("summaryCache", { ...summary, workstreamId });
}

export async function loadSummary(
  workstreamId: string,
): Promise<WorkstreamSummary | undefined> {
  const db = await getDB();
  const result: CachedSummary | undefined = await db.get(
    "summaryCache",
    workstreamId,
  );
  if (!result) return undefined;
  // Strip the workstreamId key before returning
  const { workstreamId: _, ...summary } = result;
  return summary;
}

export async function deleteSummary(workstreamId: string): Promise<void> {
  const db = await getDB();
  await db.delete("summaryCache", workstreamId);
}

// --- Split-ownership merge ---
// Source-owned fields are overwritten on refresh from ingestion sources
// App-owned fields are preserved from the persisted copy
// This prevents source refreshes from clobbering user state

const SOURCE_OWNED_FIELDS: (keyof ActivityRecord)[] = [
  "timestamp",
  "title",
  "participants",
  "preview",
  "body",
  "labels",
  "metadata",
];

export function mergeActivityData(
  persisted: ActivityRecord,
  fresh: ActivityRecord,
): ActivityRecord {
  // Start with persisted (preserves all app-owned fields)
  const merged = { ...persisted };

  // Overwrite only source-owned fields from fresh data
  for (const field of SOURCE_OWNED_FIELDS) {
    (merged as Record<string, unknown>)[field] = fresh[field];
  }

  // Update lastModified
  merged.lastModified = Date.now();

  return merged;
}

// --- Cleanup ---

export function closeDB(): void {
  if (dbPromise) {
    dbPromise.then((db) => db.close());
    dbPromise = null;
  }
}
