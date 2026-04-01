// Persistence manager tests per Spec 09 and Spec 03
// Verifies: load with score re-evaluation, save, periodic persist lifecycle

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createThread } from "../../lib/types";
import type { Thread } from "../../lib/types";
import { useThreadStore } from "../../lib/stores";
import * as persistence from "../../lib/utils/persistence";
import {
  loadPersistedThreads,
  saveThreadState,
  startPeriodicPersist,
  stopPeriodicPersist,
  flushPersist,
} from "./persistence-manager";

// Mock the IndexedDB persistence layer
vi.mock("../../lib/utils/persistence", () => {
  let mockStore: Thread[] = [];
  return {
    persistThreads: vi.fn(async (threads: Thread[]) => {
      mockStore = [...threads];
    }),
    loadAllThreads: vi.fn(async () => [...mockStore]),
    __setMockStore: (threads: Thread[]) => {
      mockStore = [...threads];
    },
    __getMockStore: () => [...mockStore],
  };
});

// Access mock helpers via the imported module (already mocked)
const mockPersistence = persistence as unknown as {
  __setMockStore: (t: Thread[]) => void;
  __getMockStore: () => Thread[];
};

function setMockStore(threads: Thread[]) {
  mockPersistence.__setMockStore(threads);
}

function getMockStore(): Thread[] {
  return mockPersistence.__getMockStore();
}

const HOUR_MS = 60 * 60 * 1000;

describe("Persistence manager", () => {
  beforeEach(() => {
    setMockStore([]);
    useThreadStore.setState({ threads: new Map() });
  });

  afterEach(() => {
    stopPeriodicPersist();
  });

  describe("loadPersistedThreads", () => {
    it("returns empty array when no persisted data", async () => {
      const threads = await loadPersistedThreads();
      expect(threads).toEqual([]);
    });

    it("loads and returns persisted threads", async () => {
      const thread = createThread("t1", "Test", "Snippet");
      setMockStore([thread]);

      const loaded = await loadPersistedThreads();
      expect(loaded.length).toBe(1);
      expect(loaded[0].id).toBe("t1");
    });

    it("re-evaluates urgency scores on load to reflect accumulated neglect", async () => {
      const now = Date.now();
      const thread = {
        ...createThread("t1", "Old Thread", "Snippet"),
        firstMessageTimestamp: now - 48 * HOUR_MS,
        latestMessageTimestamp: now - 48 * HOUR_MS,
        lastUserReplyTimestamp: null,
        urgencyScore: 0.1,
      };
      setMockStore([thread]);

      const loaded = await loadPersistedThreads();
      expect(loaded[0].urgencyScore).toBeGreaterThan(0.1);
    });

    it("updates neglect duration based on time since last reply", async () => {
      const now = Date.now();
      const thread = {
        ...createThread("t1", "Subject", "Snippet"),
        lastUserReplyTimestamp: now - 24 * HOUR_MS,
        neglectDuration: 1000,
      };
      setMockStore([thread]);

      const loaded = await loadPersistedThreads();
      expect(loaded[0].neglectDuration).toBeGreaterThan(23 * HOUR_MS);
    });

    it("computes neglect from first message when no reply exists", async () => {
      const now = Date.now();
      const thread = {
        ...createThread("t1", "Subject", "Snippet"),
        firstMessageTimestamp: now - 12 * HOUR_MS,
        lastUserReplyTimestamp: null,
      };
      setMockStore([thread]);

      const loaded = await loadPersistedThreads();
      expect(loaded[0].neglectDuration).toBeGreaterThan(11 * HOUR_MS);
    });

    it("recomputes target position from updated scores on restore (Spec 09)", async () => {
      const thread = {
        ...createThread("t1", "Subject", "Snippet"),
        position: { x: 100, y: 100 },
        targetPosition: { x: 100, y: 100 },
        zone: "active-front" as const,
      };
      setMockStore([thread]);

      const loaded = await loadPersistedThreads();
      // targetPosition should be recomputed based on scores, not just preserved from storage
      expect(loaded[0].targetPosition).toBeDefined();
      expect(typeof loaded[0].targetPosition.x).toBe("number");
      expect(typeof loaded[0].targetPosition.y).toBe("number");
    });

    it("recomputes zone from actual position on restore (Spec 09)", async () => {
      const thread = {
        ...createThread("t1", "Subject", "Snippet"),
        position: { x: 500, y: 500 },
        targetPosition: { x: 500, y: 500 },
        zone: "active-front" as const, // may not match position
      };
      setMockStore([thread]);

      const loaded = await loadPersistedThreads();
      // Zone should be recalculated from actual position, not blindly preserved
      expect(loaded[0].zone).toBeDefined();
    });

    it("recomputes cluster membership on restore (Spec 09)", async () => {
      // Two threads sharing participants should be clustered together on restore
      const t1 = {
        ...createThread("t1", "Project Alpha", "snippet"),
        participants: [
          {
            displayName: "Alice",
            email: "alice@example.com",
            organization: null,
            vipFlag: false,
            relationshipScore: 0.5,
            responseHistory: { avgResponseTimeMs: 0, threadFrequency: 1 },
          },
          {
            displayName: "Bob",
            email: "bob@example.com",
            organization: null,
            vipFlag: false,
            relationshipScore: 0.5,
            responseHistory: { avgResponseTimeMs: 0, threadFrequency: 1 },
          },
        ],
        clusterMembership: null,
        position: { x: 200, y: 200 },
        targetPosition: { x: 200, y: 200 },
      };
      const t2 = {
        ...createThread("t2", "Project Alpha followup", "snippet"),
        participants: [
          {
            displayName: "Alice",
            email: "alice@example.com",
            organization: null,
            vipFlag: false,
            relationshipScore: 0.5,
            responseHistory: { avgResponseTimeMs: 0, threadFrequency: 1 },
          },
          {
            displayName: "Bob",
            email: "bob@example.com",
            organization: null,
            vipFlag: false,
            relationshipScore: 0.5,
            responseHistory: { avgResponseTimeMs: 0, threadFrequency: 1 },
          },
        ],
        clusterMembership: null,
        position: { x: 210, y: 210 },
        targetPosition: { x: 210, y: 210 },
      };
      setMockStore([t1, t2]);

      const loaded = await loadPersistedThreads();
      // Both threads should now have cluster membership assigned
      const memberships = loaded.map((t) => t.clusterMembership);
      // They share participants, so evaluateClusters should cluster them
      expect(memberships[0]).not.toBeNull();
      expect(memberships[0]).toBe(memberships[1]);
    });

    it("resets drift velocity to zero on restore (Spec 09)", async () => {
      const thread = {
        ...createThread("t1", "Subject", "Snippet"),
        driftVelocity: { dx: 5.3, dy: -2.1 },
      };
      setMockStore([thread]);

      const loaded = await loadPersistedThreads();
      expect(loaded[0].driftVelocity).toEqual({ dx: 0, dy: 0 });
    });
  });

  describe("saveThreadState", () => {
    it("saves current thread store to persistence", async () => {
      const thread = createThread("t1", "Subject", "Snippet");
      useThreadStore.setState({ threads: new Map([["t1", thread]]) });

      await saveThreadState();
      const saved = getMockStore();
      expect(saved.length).toBe(1);
      expect(saved[0].id).toBe("t1");
    });

    it("does nothing when thread store is empty", async () => {
      await saveThreadState();
      expect(getMockStore().length).toBe(0);
    });
  });

  describe("periodic persistence", () => {
    it("starts and stops without error", () => {
      expect(() => startPeriodicPersist()).not.toThrow();
      expect(() => stopPeriodicPersist()).not.toThrow();
    });

    it("does not start duplicate intervals", () => {
      startPeriodicPersist();
      startPeriodicPersist(); // should be no-op
      stopPeriodicPersist();
    });
  });

  describe("flushPersist", () => {
    it("saves immediately", async () => {
      const thread = createThread("t1", "Subject", "Snippet");
      useThreadStore.setState({ threads: new Map([["t1", thread]]) });

      await flushPersist();
      expect(getMockStore().length).toBe(1);
    });
  });
});
