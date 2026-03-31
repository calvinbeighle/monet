// Tests for sync-store.ts per Spec 10
// Covers: sync state management, action queue CRUD, connectivity transitions

import { describe, it, expect, beforeEach } from "vitest";
import { useSyncStore } from "./sync-store";

describe("SyncStore", () => {
  beforeEach(() => {
    // Reset store between tests
    useSyncStore.setState({
      lastHistoryId: null,
      lastSuccessfulSync: null,
      syncMode: "initial-load",
      connectivityStatus: "connected",
      consecutiveFailures: 0,
      actionQueue: [],
      pollIntervalMs: 5000,
      lookbackDays: 30,
    });
  });

  describe("sync cursor", () => {
    it("stores and retrieves history ID", () => {
      useSyncStore.getState().setHistoryId("12345");
      expect(useSyncStore.getState().lastHistoryId).toBe("12345");
    });

    it("updates sync mode", () => {
      useSyncStore.getState().setSyncMode("incremental");
      expect(useSyncStore.getState().syncMode).toBe("incremental");
    });

    it("updates connectivity status", () => {
      useSyncStore.getState().setConnectivityStatus("offline");
      expect(useSyncStore.getState().connectivityStatus).toBe("offline");
    });
  });

  describe("recordSyncSuccess", () => {
    it("records timestamp and resets failures", () => {
      useSyncStore.setState({ consecutiveFailures: 3 });
      useSyncStore.getState().recordSyncSuccess();

      const state = useSyncStore.getState();
      expect(state.consecutiveFailures).toBe(0);
      expect(state.lastSuccessfulSync).toBeGreaterThan(0);
      expect(state.connectivityStatus).toBe("connected");
    });
  });

  describe("recordSyncFailure", () => {
    it("increments consecutive failures", () => {
      useSyncStore.getState().recordSyncFailure();
      expect(useSyncStore.getState().consecutiveFailures).toBe(1);
    });

    it("transitions to error after 2 consecutive failures", () => {
      useSyncStore.getState().recordSyncFailure(); // 1st failure
      expect(useSyncStore.getState().connectivityStatus).toBe("connected");

      useSyncStore.getState().recordSyncFailure(); // 2nd failure
      expect(useSyncStore.getState().connectivityStatus).toBe("error");
    });

    it("stays in error state on continued failures", () => {
      useSyncStore.getState().recordSyncFailure();
      useSyncStore.getState().recordSyncFailure();
      useSyncStore.getState().recordSyncFailure();
      expect(useSyncStore.getState().connectivityStatus).toBe("error");
      expect(useSyncStore.getState().consecutiveFailures).toBe(3);
    });
  });

  describe("action queue", () => {
    it("enqueues an action with auto-generated ID and defaults", () => {
      useSyncStore.getState().enqueueAction({
        type: "reply",
        threadId: "t-1",
        payload: { body: "hello" },
        userInitiatedTimestamp: 1000,
      });

      const queue = useSyncStore.getState().actionQueue;
      expect(queue).toHaveLength(1);
      expect(queue[0].id).toMatch(/^action-/);
      expect(queue[0].type).toBe("reply");
      expect(queue[0].threadId).toBe("t-1");
      expect(queue[0].retryCount).toBe(0);
      expect(queue[0].status).toBe("pending");
    });

    it("maintains order of enqueued actions", () => {
      useSyncStore.getState().enqueueAction({
        type: "reply",
        threadId: "t-1",
        payload: {},
        userInitiatedTimestamp: 1000,
      });
      useSyncStore.getState().enqueueAction({
        type: "archive",
        threadId: "t-2",
        payload: {},
        userInitiatedTimestamp: 2000,
      });

      const queue = useSyncStore.getState().actionQueue;
      expect(queue[0].type).toBe("reply");
      expect(queue[1].type).toBe("archive");
    });

    it("updates action status", () => {
      useSyncStore.getState().enqueueAction({
        type: "reply",
        threadId: "t-1",
        payload: {},
        userInitiatedTimestamp: 1000,
      });
      const id = useSyncStore.getState().actionQueue[0].id;

      useSyncStore.getState().updateActionStatus(id, "in-flight");
      expect(useSyncStore.getState().actionQueue[0].status).toBe("in-flight");
    });

    it("increments retry count", () => {
      useSyncStore.getState().enqueueAction({
        type: "reply",
        threadId: "t-1",
        payload: {},
        userInitiatedTimestamp: 1000,
      });
      const id = useSyncStore.getState().actionQueue[0].id;

      useSyncStore.getState().incrementRetryCount(id);
      expect(useSyncStore.getState().actionQueue[0].retryCount).toBe(1);
    });

    it("removes an action from queue", () => {
      useSyncStore.getState().enqueueAction({
        type: "reply",
        threadId: "t-1",
        payload: {},
        userInitiatedTimestamp: 1000,
      });
      const id = useSyncStore.getState().actionQueue[0].id;

      useSyncStore.getState().removeAction(id);
      expect(useSyncStore.getState().actionQueue).toHaveLength(0);
    });

    it("getPendingActions returns only pending entries", () => {
      useSyncStore.getState().enqueueAction({
        type: "reply",
        threadId: "t-1",
        payload: {},
        userInitiatedTimestamp: 1000,
      });
      useSyncStore.getState().enqueueAction({
        type: "archive",
        threadId: "t-2",
        payload: {},
        userInitiatedTimestamp: 2000,
      });

      const id1 = useSyncStore.getState().actionQueue[0].id;
      useSyncStore.getState().updateActionStatus(id1, "in-flight");

      const pending = useSyncStore.getState().getPendingActions();
      expect(pending).toHaveLength(1);
      expect(pending[0].type).toBe("archive");
    });

    it("getQueuedActionCount excludes succeeded", () => {
      useSyncStore.getState().enqueueAction({
        type: "reply",
        threadId: "t-1",
        payload: {},
        userInitiatedTimestamp: 1000,
      });
      useSyncStore.getState().enqueueAction({
        type: "archive",
        threadId: "t-2",
        payload: {},
        userInitiatedTimestamp: 2000,
      });

      const id1 = useSyncStore.getState().actionQueue[0].id;
      useSyncStore.getState().updateActionStatus(id1, "succeeded");

      expect(useSyncStore.getState().getQueuedActionCount()).toBe(1);
    });
  });

  describe("defaults", () => {
    it("has 5-second poll interval", () => {
      expect(useSyncStore.getState().pollIntervalMs).toBe(5000);
    });

    it("has 30-day lookback", () => {
      expect(useSyncStore.getState().lookbackDays).toBe(30);
    });

    it("starts in initial-load mode", () => {
      expect(useSyncStore.getState().syncMode).toBe("initial-load");
    });
  });
});
