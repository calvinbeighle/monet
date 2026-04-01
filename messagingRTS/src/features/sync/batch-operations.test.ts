// Batch operations tests per Spec 09 Section "Batch Operations"
// Why: Batch actions are applied to each selected thread independently.
// Tests verify: mark handled lifecycle + archive, move to zone + userOverride,
// apply label + Gmail API, assign agent + deployment flow, selection clearing.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  batchMarkHandled,
  batchMoveToZone,
  batchApplyLabel,
  batchAssignAgent,
  getSelectedThreads,
  getSelectedThreadCount,
  _setBatchFns,
  _resetBatchFns,
} from "./batch-operations";
import { useThreadStore } from "../../lib/stores/thread-store";
import { useAppStore } from "../../lib/stores/app-store";
import { useAgentStore } from "../../lib/stores/agent-store";
import { useDeploymentStore } from "../../lib/stores/deployment-store";
import { useSyncStore } from "../../lib/stores/sync-store";
import { createThread } from "../../lib/types";
import type { AgentRole, AgentInstance, ZoneId } from "../../lib/types";
import { createAgentInstance } from "../agents/agent-manager";

const ALL_ROLES: AgentRole[] = [
  "closer",
  "researcher",
  "scheduler",
  "cleaner",
  "drafter",
  "escalation-bot",
];

function createInitialAgentsForTest(): Map<AgentRole, AgentInstance> {
  const map = new Map<AgentRole, AgentInstance>();
  for (const role of ALL_ROLES) {
    map.set(role, createAgentInstance(role));
  }
  return map;
}

// Mock Gmail functions - batch ops should not make real API calls in tests
const mockArchive = vi.fn().mockResolvedValue(undefined);
const mockModifyLabels = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  // Reset all stores
  useThreadStore.setState({
    threads: new Map(),
    selectedThreadId: null,
    selectedThreadIds: new Set(),
  });
  useAppStore.getState().clearAllNotifications();
  useSyncStore.setState({ connectivityStatus: "connected", actionQueue: [] });
  // Reset agent store to fresh idle agents
  useAgentStore.setState({ agents: createInitialAgentsForTest() });

  // Inject test mocks
  _setBatchFns({
    archiveThread: mockArchive,
    modifyThreadLabels: mockModifyLabels,
  });

  mockArchive.mockClear();
  mockModifyLabels.mockClear();
});

afterEach(() => {
  _resetBatchFns();
});

// Helper: seed thread store with N threads
function seedThreads(count: number, overrides: Partial<ReturnType<typeof createThread>> = {}) {
  const threads: ReturnType<typeof createThread>[] = [];
  for (let i = 0; i < count; i++) {
    const t = createThread(`thread-${i}`, `Subject ${i}`, `preview ${i}`);
    Object.assign(t, { lifecycleState: "active" as const, gmailLabels: ["INBOX"], ...overrides });
    threads.push(t);
  }
  useThreadStore.getState().setThreads(threads);
  return threads.map((t) => t.id);
}

// Helper: select threads for batch
function selectThreads(ids: string[]) {
  for (const id of ids) {
    useThreadStore.getState().toggleBatchSelect(id);
  }
}

describe("batch-operations", () => {
  describe("batchMarkHandled", () => {
    it("transitions each thread to handled lifecycle state", async () => {
      const ids = seedThreads(3);
      const count = await batchMarkHandled(ids);
      expect(count).toBe(3);

      for (const id of ids) {
        const thread = useThreadStore.getState().getThread(id);
        expect(thread?.lifecycleState).toBe("handled");
      }
    });

    it("sets visual state to archived and removes INBOX label", async () => {
      const ids = seedThreads(2);
      await batchMarkHandled(ids);

      for (const id of ids) {
        const thread = useThreadStore.getState().getThread(id);
        expect(thread?.visualState).toBe("archived");
        expect(thread?.gmailLabels).not.toContain("INBOX");
      }
    });

    it("calls archiveThread for each thread when online", async () => {
      const ids = seedThreads(2);
      await batchMarkHandled(ids);
      expect(mockArchive).toHaveBeenCalledTimes(2);
      expect(mockArchive).toHaveBeenCalledWith("thread-0");
      expect(mockArchive).toHaveBeenCalledWith("thread-1");
    });

    it("queues archive actions when offline", async () => {
      useSyncStore.setState({ connectivityStatus: "offline" });
      const ids = seedThreads(2);
      await batchMarkHandled(ids);
      expect(mockArchive).not.toHaveBeenCalled();
      // Actions queued in sync store
      const queue = useSyncStore.getState().actionQueue;
      expect(queue.length).toBe(2);
      expect(queue[0].type).toBe("archive");
    });

    it("skips threads already in handled state", async () => {
      const ids = seedThreads(2, { lifecycleState: "handled" as const });
      const count = await batchMarkHandled(ids);
      expect(count).toBe(0);
    });

    it("skips nonexistent thread IDs", async () => {
      const count = await batchMarkHandled(["nonexistent-1", "nonexistent-2"]);
      expect(count).toBe(0);
    });

    it("clears batch selection after completion", async () => {
      const ids = seedThreads(2);
      selectThreads(ids);
      expect(useThreadStore.getState().selectedThreadIds.size).toBe(2);
      await batchMarkHandled(ids);
      expect(useThreadStore.getState().selectedThreadIds.size).toBe(0);
    });

    it("adds info notification on success", async () => {
      const ids = seedThreads(3);
      await batchMarkHandled(ids);
      const notifications = useAppStore.getState().notifications;
      expect(notifications.some((n) => n.message.includes("3 threads"))).toBe(true);
    });

    it("transitions each thread independently (partial failure resilient)", async () => {
      // Thread 0 is active, thread 1 is already handled
      const ids = seedThreads(1);
      const handledThread = createThread("thread-handled", "Already handled", "p");
      Object.assign(handledThread, { lifecycleState: "handled", gmailLabels: ["INBOX"] });
      useThreadStore.getState().setThread(handledThread);

      const count = await batchMarkHandled([...ids, "thread-handled"]);
      expect(count).toBe(1);
      expect(useThreadStore.getState().getThread("thread-0")?.lifecycleState).toBe("handled");
    });
  });

  describe("batchMoveToZone", () => {
    it("moves each thread to the target zone", () => {
      const ids = seedThreads(3, { zone: "active-front" as ZoneId });
      const count = batchMoveToZone(ids, "at-risk");
      expect(count).toBe(3);

      for (const id of ids) {
        const thread = useThreadStore.getState().getThread(id);
        expect(thread?.zone).toBe("at-risk");
      }
    });

    it("sets userOverrideZone flag per Spec 04", () => {
      const ids = seedThreads(1, { zone: "active-front" as ZoneId });
      batchMoveToZone(ids, "noise");

      const thread = useThreadStore.getState().getThread("thread-0");
      expect(thread?.userOverrideZone).toBe(true);
    });

    it("records previousZone", () => {
      const ids = seedThreads(1, { zone: "active-front" as ZoneId });
      batchMoveToZone(ids, "opportunities");

      const thread = useThreadStore.getState().getThread("thread-0");
      expect(thread?.previousZone).toBe("active-front");
    });

    it("skips threads already in target zone", () => {
      const ids = seedThreads(2, { zone: "noise" as ZoneId });
      const count = batchMoveToZone(ids, "noise");
      expect(count).toBe(0);
    });

    it("clears batch selection after completion", () => {
      const ids = seedThreads(2);
      selectThreads(ids);
      batchMoveToZone(ids, "lost");
      expect(useThreadStore.getState().selectedThreadIds.size).toBe(0);
    });

    it("adds info notification on success", () => {
      const ids = seedThreads(1);
      batchMoveToZone(ids, "opportunities");
      const notifications = useAppStore.getState().notifications;
      expect(notifications.some((n) => n.message.includes("opportunities"))).toBe(true);
    });
  });

  describe("batchApplyLabel", () => {
    it("adds label to each thread", async () => {
      const ids = seedThreads(3);
      const count = await batchApplyLabel(ids, "STARRED");
      expect(count).toBe(3);

      for (const id of ids) {
        const thread = useThreadStore.getState().getThread(id);
        expect(thread?.gmailLabels).toContain("STARRED");
      }
    });

    it("calls modifyThreadLabels for each thread when online", async () => {
      const ids = seedThreads(2);
      await batchApplyLabel(ids, "IMPORTANT");
      expect(mockModifyLabels).toHaveBeenCalledTimes(2);
      expect(mockModifyLabels).toHaveBeenCalledWith("thread-0", ["IMPORTANT"], []);
    });

    it("queues label-change actions when offline", async () => {
      useSyncStore.setState({ connectivityStatus: "offline" });
      const ids = seedThreads(2);
      await batchApplyLabel(ids, "STARRED");
      expect(mockModifyLabels).not.toHaveBeenCalled();
      const queue = useSyncStore.getState().actionQueue;
      expect(queue.length).toBe(2);
      expect(queue[0].type).toBe("label-change");
    });

    it("skips threads that already have the label", async () => {
      const ids = seedThreads(2, { gmailLabels: ["INBOX", "STARRED"] });
      const count = await batchApplyLabel(ids, "STARRED");
      expect(count).toBe(0);
    });

    it("preserves existing labels when adding new one", async () => {
      const ids = seedThreads(1, { gmailLabels: ["INBOX", "IMPORTANT"] });
      await batchApplyLabel(ids, "STARRED");
      const thread = useThreadStore.getState().getThread("thread-0");
      expect(thread?.gmailLabels).toEqual(["INBOX", "IMPORTANT", "STARRED"]);
    });

    it("clears batch selection after completion", async () => {
      const ids = seedThreads(2);
      selectThreads(ids);
      await batchApplyLabel(ids, "STARRED");
      expect(useThreadStore.getState().selectedThreadIds.size).toBe(0);
    });
  });

  describe("batchAssignAgent", () => {
    it("shows deployment confirmation dialog with selected thread IDs", () => {
      const ids = seedThreads(3);
      const result = batchAssignAgent(ids, "closer");
      expect(result).toBe(true);

      const confirmation = useDeploymentStore.getState().confirmation;
      expect(confirmation).not.toBeNull();
      expect(confirmation?.agentRole).toBe("closer");
      expect(confirmation?.threadIds).toEqual(ids);
    });

    it("caps thread IDs to agent capacity", () => {
      // Closer capacity is 5
      const ids = seedThreads(10);
      batchAssignAgent(ids, "closer");
      const confirmation = useDeploymentStore.getState().confirmation;
      expect(confirmation?.threadIds.length).toBeLessThanOrEqual(5);
    });

    it("returns false when agent is not available", () => {
      const ids = seedThreads(2);
      // Deploy the closer so it's not idle
      useAgentStore.getState().deploy("closer", "test-cluster", ["some-thread"]);
      const result = batchAssignAgent(ids, "closer");
      expect(result).toBe(false);
    });

    it("adds warning notification when agent unavailable", () => {
      const ids = seedThreads(2);
      useAgentStore.getState().deploy("closer", "test-cluster", ["some-thread"]);
      batchAssignAgent(ids, "closer");
      const notifications = useAppStore.getState().notifications;
      expect(notifications.some((n) => n.severity === "warning")).toBe(true);
    });

    it("clears batch selection", () => {
      const ids = seedThreads(2);
      selectThreads(ids);
      batchAssignAgent(ids, "researcher");
      expect(useThreadStore.getState().selectedThreadIds.size).toBe(0);
    });
  });

  describe("query helpers", () => {
    it("getSelectedThreads returns Thread objects for selected IDs", () => {
      seedThreads(3);
      selectThreads(["thread-0", "thread-2"]);
      const selected = getSelectedThreads();
      expect(selected).toHaveLength(2);
      expect(selected.map((t) => t.id).sort()).toEqual(["thread-0", "thread-2"]);
    });

    it("getSelectedThreads skips nonexistent IDs", () => {
      seedThreads(2);
      useThreadStore.getState().toggleBatchSelect("nonexistent");
      selectThreads(["thread-0"]);
      const selected = getSelectedThreads();
      expect(selected).toHaveLength(1);
    });

    it("getSelectedThreadCount returns selection size", () => {
      seedThreads(3);
      expect(getSelectedThreadCount()).toBe(0);
      selectThreads(["thread-0", "thread-1"]);
      expect(getSelectedThreadCount()).toBe(2);
    });
  });

  describe("selection lifecycle per Spec 09", () => {
    it("selection is distinct from individual thread state", () => {
      seedThreads(2);
      selectThreads(["thread-0"]);
      // Selection state lives on the store, not on the thread object
      const thread = useThreadStore.getState().getThread("thread-0");
      expect(thread).toBeDefined();
      expect(useThreadStore.getState().selectedThreadIds.has("thread-0")).toBe(true);
      // Thread object has no "selected" field
      expect("selected" in (thread as unknown as Record<string, unknown>)).toBe(false);
    });

    it("toggleBatchSelect adds and removes", () => {
      seedThreads(2);
      useThreadStore.getState().toggleBatchSelect("thread-0");
      expect(useThreadStore.getState().selectedThreadIds.has("thread-0")).toBe(true);
      useThreadStore.getState().toggleBatchSelect("thread-0");
      expect(useThreadStore.getState().selectedThreadIds.has("thread-0")).toBe(false);
    });

    it("clearBatchSelection empties the set", () => {
      seedThreads(3);
      selectThreads(["thread-0", "thread-1", "thread-2"]);
      expect(useThreadStore.getState().selectedThreadIds.size).toBe(3);
      useThreadStore.getState().clearBatchSelection();
      expect(useThreadStore.getState().selectedThreadIds.size).toBe(0);
    });
  });
});
