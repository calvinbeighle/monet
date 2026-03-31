// Workstream store - Zustand store for workstream state
// Lifecycle: active -> stale (7 days) -> archived (30 days)
// On every membership change, synchronously recompute derived fields

import { create } from "zustand";
import type {
  Workstream,
  WorkstreamStatus,
  StatusTransition,
  SourceBreakdown,
  EnrichedParticipant,
  TimelineEntry,
  ActivityRecord,
} from "../types";

const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ARCHIVE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

type WorkstreamStore = {
  workstreams: Map<string, Workstream>;

  // Actions
  setWorkstream: (workstream: Workstream) => void;
  setWorkstreams: (workstreams: Workstream[]) => void;
  updateWorkstream: (id: string, updates: Partial<Workstream>) => void;
  removeWorkstream: (id: string) => void;

  addActivityToWorkstream: (
    workstreamId: string,
    activity: ActivityRecord,
  ) => void;
  removeActivityFromWorkstream: (
    workstreamId: string,
    activityId: string,
  ) => void;

  transitionStatus: (id: string, to: WorkstreamStatus, trigger: string) => void;

  // Lifecycle check - call periodically to transition stale/archived
  checkLifecycles: (now?: number) => void;

  // Queries
  getWorkstream: (id: string) => Workstream | undefined;
  getActiveWorkstreams: () => Workstream[];
  getStaleWorkstreams: () => Workstream[];
  getWorkstreamCount: () => number;
  getSortedWorkstreams: () => Workstream[];
};

// Recompute derived fields after membership changes
function recomputeDerived(
  workstream: Workstream,
  allActivities: ActivityRecord[],
): Workstream {
  const memberActivities = allActivities.filter((a) =>
    workstream.activityIds.includes(a.activityId),
  );

  // Source breakdown
  const sourceBreakdown: SourceBreakdown = {};
  for (const a of memberActivities) {
    sourceBreakdown[a.source] = (sourceBreakdown[a.source] ?? 0) + 1;
  }

  // Participants - deduplicate by email
  const participantMap = new Map<string, EnrichedParticipant>();
  for (const a of memberActivities) {
    for (const p of a.participants) {
      const existing = participantMap.get(p.email);
      if (!existing || p.lastSeenTimestamp > existing.lastSeenTimestamp) {
        participantMap.set(p.email, { ...p, enrichment: null });
      }
    }
  }

  // Primary participant - most frequent non-self
  const emailCounts = new Map<string, number>();
  for (const a of memberActivities) {
    for (const p of a.participants) {
      emailCounts.set(p.email, (emailCounts.get(p.email) ?? 0) + 1);
    }
  }
  let primaryEmail: string | null = null;
  let maxCount = 0;
  for (const [email, count] of emailCounts) {
    if (count > maxCount) {
      maxCount = count;
      primaryEmail = email;
    }
  }

  // Activity timeline (sparse, ordered)
  const timeline: TimelineEntry[] = memberActivities
    .map((a) => ({
      timestamp: a.timestamp,
      activityId: a.activityId,
      source: a.source,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  // Last activity timestamp
  const lastActivityTimestamp =
    memberActivities.length > 0
      ? Math.max(...memberActivities.map((a) => a.timestamp))
      : workstream.lastActivityTimestamp;

  // Unread count
  const unreadCount = memberActivities.filter((a) => !a.viewed).length;

  return {
    ...workstream,
    sourceBreakdown,
    participants: [...participantMap.values()],
    primaryParticipantEmail: primaryEmail,
    activityTimeline: timeline,
    lastActivityTimestamp,
    unreadCount,
    lastPersistedTimestamp: Date.now(),
  };
}

export const useWorkstreamStore = create<WorkstreamStore>((set, get) => ({
  workstreams: new Map(),

  setWorkstream: (workstream) =>
    set((state) => {
      const next = new Map(state.workstreams);
      next.set(workstream.id, workstream);
      return { workstreams: next };
    }),

  setWorkstreams: (workstreams) =>
    set((state) => {
      const next = new Map(state.workstreams);
      for (const ws of workstreams) {
        next.set(ws.id, ws);
      }
      return { workstreams: next };
    }),

  updateWorkstream: (id, updates) =>
    set((state) => {
      const ws = state.workstreams.get(id);
      if (!ws) return state;
      const next = new Map(state.workstreams);
      next.set(id, {
        ...ws,
        ...updates,
        lastPersistedTimestamp: Date.now(),
      });
      return { workstreams: next };
    }),

  removeWorkstream: (id) =>
    set((state) => {
      const next = new Map(state.workstreams);
      next.delete(id);
      return { workstreams: next };
    }),

  addActivityToWorkstream: (workstreamId, activity) =>
    set((state) => {
      const ws = state.workstreams.get(workstreamId);
      if (!ws) return state;
      if (ws.activityIds.includes(activity.activityId)) return state;

      const updated: Workstream = {
        ...ws,
        activityIds: [...ws.activityIds, activity.activityId],
        // Reset to active if was stale/archived
        status: "active",
      };

      // We need all member activities to recompute.
      // For now, do a lightweight update - full recompute happens on load
      const newTimeline: TimelineEntry = {
        timestamp: activity.timestamp,
        activityId: activity.activityId,
        source: activity.source,
      };

      updated.activityTimeline = [...ws.activityTimeline, newTimeline].sort(
        (a, b) => a.timestamp - b.timestamp,
      );

      updated.lastActivityTimestamp = Math.max(
        ws.lastActivityTimestamp,
        activity.timestamp,
      );

      updated.sourceBreakdown = { ...ws.sourceBreakdown };
      updated.sourceBreakdown[activity.source] =
        (updated.sourceBreakdown[activity.source] ?? 0) + 1;

      if (!activity.viewed) {
        updated.unreadCount = ws.unreadCount + 1;
      }

      updated.lastPersistedTimestamp = Date.now();

      const next = new Map(state.workstreams);
      next.set(workstreamId, updated);
      return { workstreams: next };
    }),

  removeActivityFromWorkstream: (workstreamId, activityId) =>
    set((state) => {
      const ws = state.workstreams.get(workstreamId);
      if (!ws) return state;

      const updated: Workstream = {
        ...ws,
        activityIds: ws.activityIds.filter((id) => id !== activityId),
        activityTimeline: ws.activityTimeline.filter(
          (t) => t.activityId !== activityId,
        ),
        lastPersistedTimestamp: Date.now(),
      };

      const next = new Map(state.workstreams);
      next.set(workstreamId, updated);
      return { workstreams: next };
    }),

  transitionStatus: (id, to, trigger) =>
    set((state) => {
      const ws = state.workstreams.get(id);
      if (!ws || ws.status === to) return state;

      const transition: StatusTransition = {
        from: ws.status,
        to,
        timestamp: Date.now(),
        trigger,
      };

      const next = new Map(state.workstreams);
      next.set(id, {
        ...ws,
        status: to,
        statusHistory: [...ws.statusHistory, transition],
        lastPersistedTimestamp: Date.now(),
      });
      return { workstreams: next };
    }),

  checkLifecycles: (now = Date.now()) =>
    set((state) => {
      let changed = false;
      const next = new Map(state.workstreams);

      for (const [id, ws] of next) {
        const elapsed = now - ws.lastActivityTimestamp;
        let newStatus: WorkstreamStatus | null = null;

        if (ws.status === "active" && elapsed >= STALE_THRESHOLD_MS) {
          newStatus = "stale";
        } else if (ws.status === "stale" && elapsed >= ARCHIVE_THRESHOLD_MS) {
          newStatus = "archived";
        }

        if (newStatus) {
          changed = true;
          const transition: StatusTransition = {
            from: ws.status,
            to: newStatus,
            timestamp: now,
            trigger: "lifecycle-check",
          };
          next.set(id, {
            ...ws,
            status: newStatus,
            statusHistory: [...ws.statusHistory, transition],
            lastPersistedTimestamp: now,
          });
        }
      }

      return changed ? { workstreams: next } : state;
    }),

  // Queries
  getWorkstream: (id) => get().workstreams.get(id),

  getActiveWorkstreams: () =>
    [...get().workstreams.values()].filter((ws) => ws.status === "active"),

  getStaleWorkstreams: () =>
    [...get().workstreams.values()].filter((ws) => ws.status === "stale"),

  getWorkstreamCount: () => get().workstreams.size,

  // Sorted: active first by lastActivity desc, then by unreadCount desc
  getSortedWorkstreams: () =>
    [...get().workstreams.values()]
      .filter((ws) => ws.status !== "archived")
      .sort((a, b) => {
        // Active before stale
        if (a.status !== b.status) {
          return a.status === "active" ? -1 : 1;
        }
        // By lastActivityTimestamp desc
        if (a.lastActivityTimestamp !== b.lastActivityTimestamp) {
          return b.lastActivityTimestamp - a.lastActivityTimestamp;
        }
        // By unreadCount desc
        return b.unreadCount - a.unreadCount;
      }),
}));

export { recomputeDerived };
