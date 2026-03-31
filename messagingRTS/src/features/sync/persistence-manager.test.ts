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
