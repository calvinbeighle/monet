// Filter store tests per Spec 09 Section "Thread Filtering"
// Tests: filter criteria, visibility logic, escape hatch, persistence, store actions

import { describe, it, expect, beforeEach } from "vitest";
import {
  useFilterStore,
  isFilterActive,
  shouldHideThread,
  getVisibleThreads,
} from "./filter-store";
import type { ThreadFilter } from "./filter-store";
import { createThread } from "../types";
import type { Thread, ZoneId } from "../types";

// Helper: create a thread with specific properties for filter testing
function makeThread(overrides: Partial<Thread> = {}): Thread {
  const base = createThread(
    "t-" + Math.random().toString(36).slice(2, 8),
    "Test Subject",
    "preview",
  );
  return { ...base, ...overrides };
}

// Helper: create default empty filter
function emptyFilter(): ThreadFilter {
  return { zones: [], labels: [], senders: [], urgencyMin: 0, urgencyMax: 1 };
}

describe("filter-store pure functions", () => {
  describe("isFilterActive", () => {
    it("returns false for empty filter", () => {
      expect(isFilterActive(emptyFilter())).toBe(false);
    });

    it("returns true when zones filter is set", () => {
      expect(isFilterActive({ ...emptyFilter(), zones: ["active-front"] })).toBe(true);
    });

    it("returns true when labels filter is set", () => {
      expect(isFilterActive({ ...emptyFilter(), labels: ["INBOX"] })).toBe(true);
    });

    it("returns true when senders filter is set", () => {
      expect(isFilterActive({ ...emptyFilter(), senders: ["alice@example.com"] })).toBe(true);
    });

    it("returns true when urgency min is above 0", () => {
      expect(isFilterActive({ ...emptyFilter(), urgencyMin: 0.3 })).toBe(true);
    });

    it("returns true when urgency max is below 1", () => {
      expect(isFilterActive({ ...emptyFilter(), urgencyMax: 0.8 })).toBe(true);
    });

    it("returns false when urgency range is full (0-1)", () => {
      expect(isFilterActive({ ...emptyFilter(), urgencyMin: 0, urgencyMax: 1 })).toBe(false);
    });
  });

  describe("shouldHideThread", () => {
    it("returns false when no filter is active", () => {
      const thread = makeThread();
      expect(shouldHideThread(thread, emptyFilter())).toBe(false);
    });

    // Zone filter
    it("hides thread not in filtered zone", () => {
      const thread = makeThread({ zone: "noise" });
      const filter = { ...emptyFilter(), zones: ["active-front" as ZoneId] };
      expect(shouldHideThread(thread, filter)).toBe(true);
    });

    it("shows thread in filtered zone", () => {
      const thread = makeThread({ zone: "active-front" });
      const filter = { ...emptyFilter(), zones: ["active-front" as ZoneId] };
      expect(shouldHideThread(thread, filter)).toBe(false);
    });

    it("shows thread when it matches any of multiple filtered zones", () => {
      const thread = makeThread({ zone: "opportunities" });
      const filter = {
        ...emptyFilter(),
        zones: ["active-front" as ZoneId, "opportunities" as ZoneId],
      };
      expect(shouldHideThread(thread, filter)).toBe(false);
    });

    // Label filter
    it("hides thread without matching label", () => {
      const thread = makeThread({ gmailLabels: ["SENT"] });
      const filter = { ...emptyFilter(), labels: ["INBOX"] };
      expect(shouldHideThread(thread, filter)).toBe(true);
    });

    it("shows thread with matching label", () => {
      const thread = makeThread({ gmailLabels: ["INBOX", "IMPORTANT"] });
      const filter = { ...emptyFilter(), labels: ["INBOX"] };
      expect(shouldHideThread(thread, filter)).toBe(false);
    });

    // Sender filter - exact email
    it("hides thread without matching sender", () => {
      const thread = makeThread({
        participants: [
          {
            email: "bob@example.com",
            displayName: "Bob",
            organization: null,
            vipFlag: false,
            relationshipScore: 0,
            responseHistory: { avgResponseTimeMs: 0, threadFrequency: 0 },
          },
        ],
      });
      const filter = { ...emptyFilter(), senders: ["alice@example.com"] };
      expect(shouldHideThread(thread, filter)).toBe(true);
    });

    it("shows thread with matching sender (case-insensitive)", () => {
      const thread = makeThread({
        participants: [
          {
            email: "Alice@Example.Com",
            displayName: "Alice",
            organization: null,
            vipFlag: false,
            relationshipScore: 0,
            responseHistory: { avgResponseTimeMs: 0, threadFrequency: 0 },
          },
        ],
      });
      const filter = { ...emptyFilter(), senders: ["alice@example.com"] };
      expect(shouldHideThread(thread, filter)).toBe(false);
    });

    // Sender filter - domain pattern
    it("matches sender by @domain pattern", () => {
      const thread = makeThread({
        participants: [
          {
            email: "anyone@acme.com",
            displayName: "Anyone",
            organization: null,
            vipFlag: false,
            relationshipScore: 0,
            responseHistory: { avgResponseTimeMs: 0, threadFrequency: 0 },
          },
        ],
      });
      const filter = { ...emptyFilter(), senders: ["@acme.com"] };
      expect(shouldHideThread(thread, filter)).toBe(false);
    });

    it("hides thread when domain does not match", () => {
      const thread = makeThread({
        participants: [
          {
            email: "anyone@other.com",
            displayName: "Anyone",
            organization: null,
            vipFlag: false,
            relationshipScore: 0,
            responseHistory: { avgResponseTimeMs: 0, threadFrequency: 0 },
          },
        ],
      });
      const filter = { ...emptyFilter(), senders: ["@acme.com"] };
      expect(shouldHideThread(thread, filter)).toBe(true);
    });

    // Urgency range filter
    it("hides thread below urgency min", () => {
      const thread = makeThread({ urgencyScore: 0.2 });
      const filter = { ...emptyFilter(), urgencyMin: 0.5, urgencyMax: 1 };
      expect(shouldHideThread(thread, filter)).toBe(true);
    });

    it("hides thread above urgency max", () => {
      const thread = makeThread({ urgencyScore: 0.9 });
      const filter = { ...emptyFilter(), urgencyMin: 0, urgencyMax: 0.5 };
      expect(shouldHideThread(thread, filter)).toBe(true);
    });

    it("shows thread within urgency range", () => {
      const thread = makeThread({ urgencyScore: 0.6 });
      const filter = { ...emptyFilter(), urgencyMin: 0.3, urgencyMax: 0.8 };
      expect(shouldHideThread(thread, filter)).toBe(false);
    });

    // Combined filters (AND logic)
    it("requires all active filter criteria to match", () => {
      const thread = makeThread({
        zone: "active-front",
        gmailLabels: ["INBOX"],
        urgencyScore: 0.5,
        participants: [
          {
            email: "alice@example.com",
            displayName: "Alice",
            organization: null,
            vipFlag: false,
            relationshipScore: 0,
            responseHistory: { avgResponseTimeMs: 0, threadFrequency: 0 },
          },
        ],
      });
      const filter: ThreadFilter = {
        zones: ["active-front"],
        labels: ["INBOX"],
        senders: ["alice@example.com"],
        urgencyMin: 0.3,
        urgencyMax: 0.8,
      };
      expect(shouldHideThread(thread, filter)).toBe(false);
    });

    it("hides thread that fails one criterion even if others match", () => {
      const thread = makeThread({
        zone: "active-front",
        gmailLabels: ["SENT"], // fails label filter
        urgencyScore: 0.5,
      });
      const filter: ThreadFilter = {
        zones: ["active-front"],
        labels: ["INBOX"],
        senders: [],
        urgencyMin: 0,
        urgencyMax: 1,
      };
      expect(shouldHideThread(thread, filter)).toBe(true);
    });

    // Escape hatch: at-risk and lost threads always surface
    it("never hides at-risk threads regardless of filter", () => {
      const thread = makeThread({
        zone: "noise",
        lifecycleState: "at-risk",
        gmailLabels: [],
        urgencyScore: 0.1,
      });
      const filter: ThreadFilter = {
        zones: ["active-front"],
        labels: ["INBOX"],
        senders: ["nobody@example.com"],
        urgencyMin: 0.9,
        urgencyMax: 1,
      };
      expect(shouldHideThread(thread, filter)).toBe(false);
    });

    it("never hides lost threads regardless of filter", () => {
      const thread = makeThread({
        zone: "lost",
        lifecycleState: "lost",
        gmailLabels: [],
        urgencyScore: 0.05,
      });
      const filter: ThreadFilter = {
        zones: ["active-front"],
        labels: ["IMPORTANT"],
        senders: [],
        urgencyMin: 0.8,
        urgencyMax: 1,
      };
      expect(shouldHideThread(thread, filter)).toBe(false);
    });

    it("never hides drifting-lost threads regardless of filter", () => {
      const thread = makeThread({
        zone: "lost",
        lifecycleState: "drifting-lost" as Thread["lifecycleState"],
        gmailLabels: [],
        urgencyScore: 0.05,
      });
      const filter: ThreadFilter = {
        zones: ["active-front"],
        labels: ["IMPORTANT"],
        senders: [],
        urgencyMin: 0.8,
        urgencyMax: 1,
      };
      expect(shouldHideThread(thread, filter)).toBe(false);
    });

    it("still hides non-at-risk/lost threads that fail filter", () => {
      const thread = makeThread({
        zone: "noise",
        lifecycleState: "active",
      });
      const filter = { ...emptyFilter(), zones: ["active-front" as ZoneId] };
      expect(shouldHideThread(thread, filter)).toBe(true);
    });
  });

  describe("getVisibleThreads", () => {
    it("returns all threads when no filter is active", () => {
      const threads = [makeThread({ id: "a" }), makeThread({ id: "b" })];
      expect(getVisibleThreads(threads, emptyFilter())).toHaveLength(2);
    });

    it("filters out hidden threads", () => {
      const threads = [
        makeThread({ id: "a", zone: "active-front" }),
        makeThread({ id: "b", zone: "noise" }),
        makeThread({ id: "c", zone: "active-front" }),
      ];
      const filter = { ...emptyFilter(), zones: ["active-front" as ZoneId] };
      const visible = getVisibleThreads(threads, filter);
      expect(visible).toHaveLength(2);
      expect(visible.map((t) => t.id)).toEqual(["a", "c"]);
    });

    it("preserves at-risk threads in filtered results", () => {
      const threads = [
        makeThread({ id: "a", zone: "noise", lifecycleState: "active" }),
        makeThread({ id: "b", zone: "noise", lifecycleState: "at-risk" }),
      ];
      const filter = { ...emptyFilter(), zones: ["active-front" as ZoneId] };
      const visible = getVisibleThreads(threads, filter);
      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe("b");
    });

    it("preserves lost threads in filtered results", () => {
      const threads = [
        makeThread({ id: "a", zone: "lost", lifecycleState: "lost" }),
        makeThread({ id: "b", zone: "noise", lifecycleState: "new" }),
      ];
      const filter = { ...emptyFilter(), zones: ["active-front" as ZoneId] };
      const visible = getVisibleThreads(threads, filter);
      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe("a");
    });

    it("returns empty array when all threads are hidden", () => {
      const threads = [makeThread({ id: "a", zone: "noise", lifecycleState: "active" })];
      const filter = { ...emptyFilter(), zones: ["active-front" as ZoneId] };
      expect(getVisibleThreads(threads, filter)).toHaveLength(0);
    });
  });
});

describe("filter-store Zustand actions", () => {
  beforeEach(() => {
    useFilterStore.getState().clearAllFilters();
    // Clear localStorage mock
    try {
      localStorage.removeItem("messaging-rts-filter-state");
    } catch {
      // localStorage may not exist in test env
    }
  });

  it("starts with empty filter", () => {
    const { filter } = useFilterStore.getState();
    expect(filter.zones).toEqual([]);
    expect(filter.labels).toEqual([]);
    expect(filter.senders).toEqual([]);
    expect(filter.urgencyMin).toBe(0);
    expect(filter.urgencyMax).toBe(1);
  });

  it("isFilterActive returns false initially", () => {
    expect(useFilterStore.getState().isFilterActive()).toBe(false);
  });

  describe("zone filter actions", () => {
    it("setZoneFilter sets zones", () => {
      useFilterStore.getState().setZoneFilter(["active-front", "at-risk"]);
      expect(useFilterStore.getState().filter.zones).toEqual(["active-front", "at-risk"]);
      expect(useFilterStore.getState().isFilterActive()).toBe(true);
    });

    it("toggleZoneFilter adds zone when absent", () => {
      useFilterStore.getState().toggleZoneFilter("noise");
      expect(useFilterStore.getState().filter.zones).toEqual(["noise"]);
    });

    it("toggleZoneFilter removes zone when present", () => {
      useFilterStore.getState().setZoneFilter(["noise", "lost"]);
      useFilterStore.getState().toggleZoneFilter("noise");
      expect(useFilterStore.getState().filter.zones).toEqual(["lost"]);
    });
  });

  describe("label filter actions", () => {
    it("setLabelFilter sets labels", () => {
      useFilterStore.getState().setLabelFilter(["INBOX", "STARRED"]);
      expect(useFilterStore.getState().filter.labels).toEqual(["INBOX", "STARRED"]);
    });

    it("toggleLabelFilter adds and removes", () => {
      useFilterStore.getState().toggleLabelFilter("INBOX");
      expect(useFilterStore.getState().filter.labels).toEqual(["INBOX"]);
      useFilterStore.getState().toggleLabelFilter("INBOX");
      expect(useFilterStore.getState().filter.labels).toEqual([]);
    });
  });

  describe("sender filter actions", () => {
    it("setSenderFilter sets senders", () => {
      useFilterStore.getState().setSenderFilter(["alice@example.com", "@acme.com"]);
      expect(useFilterStore.getState().filter.senders).toEqual(["alice@example.com", "@acme.com"]);
    });

    it("toggleSenderFilter adds and removes", () => {
      useFilterStore.getState().toggleSenderFilter("bob@test.com");
      expect(useFilterStore.getState().filter.senders).toEqual(["bob@test.com"]);
      useFilterStore.getState().toggleSenderFilter("bob@test.com");
      expect(useFilterStore.getState().filter.senders).toEqual([]);
    });
  });

  describe("urgency range actions", () => {
    it("setUrgencyRange updates min and max", () => {
      useFilterStore.getState().setUrgencyRange(0.3, 0.8);
      expect(useFilterStore.getState().filter.urgencyMin).toBe(0.3);
      expect(useFilterStore.getState().filter.urgencyMax).toBe(0.8);
      expect(useFilterStore.getState().isFilterActive()).toBe(true);
    });
  });

  describe("clearAllFilters", () => {
    it("resets all filter criteria to defaults", () => {
      useFilterStore.getState().setZoneFilter(["active-front"]);
      useFilterStore.getState().setLabelFilter(["INBOX"]);
      useFilterStore.getState().setSenderFilter(["alice@test.com"]);
      useFilterStore.getState().setUrgencyRange(0.2, 0.9);

      useFilterStore.getState().clearAllFilters();

      const { filter } = useFilterStore.getState();
      expect(filter.zones).toEqual([]);
      expect(filter.labels).toEqual([]);
      expect(filter.senders).toEqual([]);
      expect(filter.urgencyMin).toBe(0);
      expect(filter.urgencyMax).toBe(1);
      expect(useFilterStore.getState().isFilterActive()).toBe(false);
    });
  });

  describe("store query methods", () => {
    it("isThreadHidden delegates to pure function", () => {
      useFilterStore.getState().setZoneFilter(["active-front"]);
      const hidden = makeThread({ zone: "noise", lifecycleState: "active" });
      const visible = makeThread({ zone: "active-front" });
      expect(useFilterStore.getState().isThreadHidden(hidden)).toBe(true);
      expect(useFilterStore.getState().isThreadHidden(visible)).toBe(false);
    });

    it("getVisibleThreads filters thread array", () => {
      useFilterStore.getState().setZoneFilter(["active-front"]);
      const threads = [
        makeThread({ id: "vis", zone: "active-front" }),
        makeThread({ id: "hid", zone: "noise", lifecycleState: "active" }),
      ];
      const visible = useFilterStore.getState().getVisibleThreads(threads);
      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe("vis");
    });
  });

  describe("persistence", () => {
    it("persists filter state to localStorage on change", () => {
      useFilterStore.getState().setZoneFilter(["active-front"]);
      const stored = localStorage.getItem("messaging-rts-filter-state");
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed.zones).toEqual(["active-front"]);
    });

    it("loadPersistedFilter restores from localStorage", () => {
      localStorage.setItem(
        "messaging-rts-filter-state",
        JSON.stringify({
          zones: ["lost"],
          labels: ["STARRED"],
          senders: ["@test.com"],
          urgencyMin: 0.1,
          urgencyMax: 0.9,
        }),
      );
      useFilterStore.getState().loadPersistedFilter();
      const { filter } = useFilterStore.getState();
      expect(filter.zones).toEqual(["lost"]);
      expect(filter.labels).toEqual(["STARRED"]);
      expect(filter.senders).toEqual(["@test.com"]);
      expect(filter.urgencyMin).toBe(0.1);
      expect(filter.urgencyMax).toBe(0.9);
    });

    it("loadPersistedFilter handles corrupted data gracefully", () => {
      localStorage.setItem("messaging-rts-filter-state", "not valid json{{{");
      useFilterStore.getState().loadPersistedFilter();
      const { filter } = useFilterStore.getState();
      // Should fall back to defaults
      expect(filter.zones).toEqual([]);
      expect(filter.urgencyMin).toBe(0);
      expect(filter.urgencyMax).toBe(1);
    });

    it("loadPersistedFilter handles missing fields gracefully", () => {
      localStorage.setItem(
        "messaging-rts-filter-state",
        JSON.stringify({ zones: ["active-front"] }),
      );
      useFilterStore.getState().loadPersistedFilter();
      const { filter } = useFilterStore.getState();
      expect(filter.zones).toEqual(["active-front"]);
      expect(filter.labels).toEqual([]);
      expect(filter.senders).toEqual([]);
      expect(filter.urgencyMin).toBe(0);
      expect(filter.urgencyMax).toBe(1);
    });

    it("clearAllFilters also clears persisted state", () => {
      useFilterStore.getState().setZoneFilter(["active-front"]);
      expect(localStorage.getItem("messaging-rts-filter-state")).toBeTruthy();
      useFilterStore.getState().clearAllFilters();
      const stored = JSON.parse(localStorage.getItem("messaging-rts-filter-state")!);
      expect(stored.zones).toEqual([]);
    });
  });
});
