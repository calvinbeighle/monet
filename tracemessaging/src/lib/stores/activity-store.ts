// Activity store - Zustand store for client-side activity state
// Adapted from messagingRTS thread-store.ts pattern
// Map<string, ActivityRecord> for O(1) lookups, immutable updates

import { create } from "zustand";
import type { ActivityRecord, SourceType } from "../types";

type ActivityStore = {
  activities: Map<string, ActivityRecord>;

  // Actions
  addActivity: (activity: ActivityRecord) => void;
  addActivities: (activities: ActivityRecord[]) => void;
  updateActivity: (
    activityId: string,
    updates: Partial<ActivityRecord>,
  ) => void;
  removeActivity: (activityId: string) => void;
  setActivityWorkstream: (
    activityId: string,
    workstreamId: string | null,
    userOverride: boolean,
  ) => void;
  markViewed: (activityId: string) => void;

  // Queries
  getActivity: (activityId: string) => ActivityRecord | undefined;
  getActivitiesBySource: (source: SourceType) => ActivityRecord[];
  getActivitiesByWorkstream: (workstreamId: string) => ActivityRecord[];
  getUnassignedActivities: () => ActivityRecord[];
  getActivityCount: () => number;
};

export const useActivityStore = create<ActivityStore>((set, get) => ({
  activities: new Map(),

  addActivity: (activity) =>
    set((state) => {
      const next = new Map(state.activities);
      next.set(activity.activityId, activity);
      return { activities: next };
    }),

  addActivities: (activities) =>
    set((state) => {
      const next = new Map(state.activities);
      for (const activity of activities) {
        next.set(activity.activityId, activity);
      }
      return { activities: next };
    }),

  updateActivity: (activityId, updates) =>
    set((state) => {
      const activity = state.activities.get(activityId);
      if (!activity) return state;
      const next = new Map(state.activities);
      next.set(activityId, {
        ...activity,
        ...updates,
        lastModified: Date.now(),
      });
      return { activities: next };
    }),

  removeActivity: (activityId) =>
    set((state) => {
      const next = new Map(state.activities);
      next.delete(activityId);
      return { activities: next };
    }),

  setActivityWorkstream: (activityId, workstreamId, userOverride) =>
    set((state) => {
      const activity = state.activities.get(activityId);
      if (!activity) return state;
      const next = new Map(state.activities);
      next.set(activityId, {
        ...activity,
        workstreamId,
        userOverride,
        lastModified: Date.now(),
      });
      return { activities: next };
    }),

  markViewed: (activityId) =>
    set((state) => {
      const activity = state.activities.get(activityId);
      if (!activity || activity.viewed) return state;
      const next = new Map(state.activities);
      next.set(activityId, {
        ...activity,
        viewed: true,
        lastModified: Date.now(),
      });
      return { activities: next };
    }),

  // Queries (read from current state)
  getActivity: (activityId) => get().activities.get(activityId),

  getActivitiesBySource: (source) =>
    [...get().activities.values()].filter((a) => a.source === source),

  getActivitiesByWorkstream: (workstreamId) =>
    [...get().activities.values()].filter(
      (a) => a.workstreamId === workstreamId,
    ),

  getUnassignedActivities: () =>
    [...get().activities.values()].filter((a) => a.workstreamId === null),

  getActivityCount: () => get().activities.size,
}));
