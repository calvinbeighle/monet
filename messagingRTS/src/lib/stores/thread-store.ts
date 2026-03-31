// Thread store - Zustand store for client-side thread state
// Per Spec 09: threads are the atomic unit, managed centrally

import { create } from "zustand";
import type { Thread, ThreadLifecycleState, ZoneId } from "../types";

interface ThreadStore {
  threads: Map<string, Thread>;
  selectedThreadId: string | null;
  selectedThreadIds: Set<string>; // for batch operations

  // Actions
  setThread: (thread: Thread) => void;
  setThreads: (threads: Thread[]) => void;
  removeThread: (id: string) => void;
  updateThread: (id: string, updates: Partial<Thread>) => void;
  selectThread: (id: string | null) => void;
  toggleBatchSelect: (id: string) => void;
  clearBatchSelection: () => void;
  transitionState: (id: string, to: ThreadLifecycleState, trigger: string) => void;

  // Queries
  getThread: (id: string) => Thread | undefined;
  getThreadsByZone: (zone: ZoneId) => Thread[];
  getThreadCount: () => number;
}

export const useThreadStore = create<ThreadStore>((set, get) => ({
  threads: new Map(),
  selectedThreadId: null,
  selectedThreadIds: new Set(),

  setThread: (thread) =>
    set((state) => {
      const next = new Map(state.threads);
      next.set(thread.id, thread);
      return { threads: next };
    }),

  setThreads: (threads) =>
    set((state) => {
      const next = new Map(state.threads);
      for (const thread of threads) {
        next.set(thread.id, thread);
      }
      return { threads: next };
    }),

  removeThread: (id) =>
    set((state) => {
      const next = new Map(state.threads);
      next.delete(id);
      return { threads: next };
    }),

  updateThread: (id, updates) =>
    set((state) => {
      const thread = state.threads.get(id);
      if (!thread) return state;
      const next = new Map(state.threads);
      next.set(id, { ...thread, ...updates, lastModified: Date.now() });
      return { threads: next };
    }),

  selectThread: (id) => set({ selectedThreadId: id }),

  toggleBatchSelect: (id) =>
    set((state) => {
      const next = new Set(state.selectedThreadIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selectedThreadIds: next };
    }),

  clearBatchSelection: () => set({ selectedThreadIds: new Set() }),

  transitionState: (id, to, trigger) =>
    set((state) => {
      const thread = state.threads.get(id);
      if (!thread) return state;
      const transition = {
        from: thread.lifecycleState,
        to,
        timestamp: Date.now(),
        trigger,
      };
      const next = new Map(state.threads);
      next.set(id, {
        ...thread,
        lifecycleState: to,
        stateHistory: [...thread.stateHistory, transition],
        lastModified: Date.now(),
      });
      return { threads: next };
    }),

  getThread: (id) => get().threads.get(id),
  getThreadsByZone: (zone) => [...get().threads.values()].filter((t) => t.zone === zone),
  getThreadCount: () => get().threads.size,
}));
