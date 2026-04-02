// Filter store - thread visibility filtering per Spec 09 Section "Thread Filtering"
// Filters: zone, label, sender/domain, urgency range
// Hidden threads continue to drift and receive messages
// At-risk/lost threads surface back regardless of active filter (escape hatch)
// Filter state persists across browser refresh via localStorage

import { create } from "zustand";
import type { Thread, ZoneId } from "../types";

const FILTER_STORAGE_KEY = "messaging-rts-filter-state";

export interface ThreadFilter {
  zones: ZoneId[]; // empty = all zones shown
  labels: string[]; // empty = all labels shown
  senders: string[]; // email addresses or @domain patterns; empty = all
  urgencyMin: number; // 0.0
  urgencyMax: number; // 1.0
}

const DEFAULT_FILTER: ThreadFilter = {
  zones: [],
  labels: [],
  senders: [],
  urgencyMin: 0,
  urgencyMax: 1,
};

interface FilterStore {
  filter: ThreadFilter;

  // Actions
  setZoneFilter: (zones: ZoneId[]) => void;
  toggleZoneFilter: (zone: ZoneId) => void;
  setLabelFilter: (labels: string[]) => void;
  toggleLabelFilter: (label: string) => void;
  setSenderFilter: (senders: string[]) => void;
  toggleSenderFilter: (sender: string) => void;
  setUrgencyRange: (min: number, max: number) => void;
  clearAllFilters: () => void;
  loadPersistedFilter: () => void;

  // Queries (pure, no side effects)
  isFilterActive: () => boolean;
  isThreadHidden: (thread: Thread) => boolean;
  getVisibleThreads: (threads: Thread[]) => Thread[];
}

// Pure function: check if any filter criteria is set
export function isFilterActive(filter: ThreadFilter): boolean {
  return (
    filter.zones.length > 0 ||
    filter.labels.length > 0 ||
    filter.senders.length > 0 ||
    filter.urgencyMin > 0 ||
    filter.urgencyMax < 1
  );
}

// Pure function: does a thread match the sender filter?
// Supports exact email match and @domain pattern match
function matchesSenderFilter(thread: Thread, senders: string[]): boolean {
  if (senders.length === 0) return true;
  for (const participant of thread.participants) {
    for (const senderPattern of senders) {
      if (senderPattern.startsWith("@")) {
        // Domain match
        const domain = senderPattern.toLowerCase();
        if (participant.email.toLowerCase().endsWith(domain)) return true;
      } else {
        // Exact email match (case-insensitive)
        if (participant.email.toLowerCase() === senderPattern.toLowerCase()) return true;
      }
    }
  }
  return false;
}

// Pure function: does a thread match the label filter?
function matchesLabelFilter(thread: Thread, labels: string[]): boolean {
  if (labels.length === 0) return true;
  for (const label of labels) {
    if (thread.gmailLabels.includes(label)) return true;
  }
  return false;
}

// Pure function: should a thread be hidden by the current filter?
// Returns true if the thread should be HIDDEN (not visible)
export function shouldHideThread(thread: Thread, filter: ThreadFilter): boolean {
  if (!isFilterActive(filter)) return false;

  // Escape hatch per Spec 09: at-risk, drifting-lost, and lost threads always surface
  if (
    thread.lifecycleState === "at-risk" ||
    thread.lifecycleState === "drifting-lost" ||
    thread.lifecycleState === "lost"
  ) {
    return false;
  }

  // Zone filter: thread must be in one of the selected zones
  if (filter.zones.length > 0 && !filter.zones.includes(thread.zone)) {
    return true;
  }

  // Label filter: thread must have at least one matching label
  if (!matchesLabelFilter(thread, filter.labels)) {
    return true;
  }

  // Sender filter: thread must have at least one matching participant
  if (!matchesSenderFilter(thread, filter.senders)) {
    return true;
  }

  // Urgency range filter
  if (thread.urgencyScore < filter.urgencyMin || thread.urgencyScore > filter.urgencyMax) {
    return true;
  }

  return false;
}

// Pure function: get visible threads from a list
export function getVisibleThreads(threads: Thread[], filter: ThreadFilter): Thread[] {
  if (!isFilterActive(filter)) return threads;
  return threads.filter((t) => !shouldHideThread(t, filter));
}

// Persist filter to localStorage
function persistFilter(filter: ThreadFilter): void {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filter));
  } catch {
    // localStorage may be unavailable (SSR, private browsing quota exceeded)
  }
}

// Load filter from localStorage
function loadFilter(): ThreadFilter {
  try {
    const stored = localStorage.getItem(FILTER_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<ThreadFilter>;
      return {
        zones: Array.isArray(parsed.zones) ? parsed.zones : [],
        labels: Array.isArray(parsed.labels) ? parsed.labels : [],
        senders: Array.isArray(parsed.senders) ? parsed.senders : [],
        urgencyMin: typeof parsed.urgencyMin === "number" ? parsed.urgencyMin : 0,
        urgencyMax: typeof parsed.urgencyMax === "number" ? parsed.urgencyMax : 1,
      };
    }
  } catch {
    // Corrupted or unavailable localStorage
  }
  return { ...DEFAULT_FILTER };
}

export const useFilterStore = create<FilterStore>((set, get) => ({
  filter: { ...DEFAULT_FILTER },

  setZoneFilter: (zones) =>
    set((state) => {
      const filter = { ...state.filter, zones };
      persistFilter(filter);
      return { filter };
    }),

  toggleZoneFilter: (zone) =>
    set((state) => {
      const zones = state.filter.zones.includes(zone)
        ? state.filter.zones.filter((z) => z !== zone)
        : [...state.filter.zones, zone];
      const filter = { ...state.filter, zones };
      persistFilter(filter);
      return { filter };
    }),

  setLabelFilter: (labels) =>
    set((state) => {
      const filter = { ...state.filter, labels };
      persistFilter(filter);
      return { filter };
    }),

  toggleLabelFilter: (label) =>
    set((state) => {
      const labels = state.filter.labels.includes(label)
        ? state.filter.labels.filter((l) => l !== label)
        : [...state.filter.labels, label];
      const filter = { ...state.filter, labels };
      persistFilter(filter);
      return { filter };
    }),

  setSenderFilter: (senders) =>
    set((state) => {
      const filter = { ...state.filter, senders };
      persistFilter(filter);
      return { filter };
    }),

  toggleSenderFilter: (sender) =>
    set((state) => {
      const senders = state.filter.senders.includes(sender)
        ? state.filter.senders.filter((s) => s !== sender)
        : [...state.filter.senders, sender];
      const filter = { ...state.filter, senders };
      persistFilter(filter);
      return { filter };
    }),

  setUrgencyRange: (min, max) =>
    set((state) => {
      const filter = { ...state.filter, urgencyMin: min, urgencyMax: max };
      persistFilter(filter);
      return { filter };
    }),

  clearAllFilters: () => {
    const filter = { ...DEFAULT_FILTER };
    persistFilter(filter);
    set({ filter });
  },

  loadPersistedFilter: () => {
    const filter = loadFilter();
    set({ filter });
  },

  isFilterActive: () => isFilterActive(get().filter),

  isThreadHidden: (thread) => shouldHideThread(thread, get().filter),

  getVisibleThreads: (threads) => getVisibleThreads(threads, get().filter),
}));
