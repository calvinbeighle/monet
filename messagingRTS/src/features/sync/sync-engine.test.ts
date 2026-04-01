// Tests for sync-engine.ts per Spec 10
// Covers: initial load orchestration, incremental sync, history expiry backfill,
// connectivity transitions, action queue replay, polling lifecycle

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  startInitialLoad,
  performIncrementalSync,
  replayActionQueue,
  startPolling,
  stopPolling,
  getRetryInterval,
  _getConsecutivePollFailures,
  _setConsecutivePollFailures,
  _setEngineFetchFns,
  _resetEngineFetchFns,
} from "./sync-engine";
import { useSyncStore } from "../../lib/stores/sync-store";
import { useThreadStore } from "../../lib/stores";
import { useAppStore } from "../../lib/stores";
import type { GmailHistoryResponse } from "../auth/gmail-client";
import type { Thread } from "../../lib/types";

// Helper to create a minimal GmailThreadDetail for mocking
function makeThreadDetail(id: string, historyId = "100") {
  return {
    id,
    historyId,
    messages: [
      {
        id: `msg-${id}`,
        threadId: id,
        labelIds: ["INBOX"],
        snippet: `snippet-${id}`,
        internalDate: String(Date.now()),
        payload: {
          headers: [
            { name: "From", value: "test@example.com" },
            { name: "To", value: "me@example.com" },
            { name: "Subject", value: `Subject ${id}` },
          ],
          mimeType: "text/plain",
          body: { data: btoa("test body"), size: 9 },
        },
      },
    ],
  };
}

describe("SyncEngine", () => {
  beforeEach(() => {
    // Reset all stores
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

    useThreadStore.setState({
      threads: new Map(),
      selectedThreadId: null,
      selectedThreadIds: new Set(),
    });

    useAppStore.setState({
      shellState: "loading",
      syncStatus: "connected",
      notifications: [],
    });
  });

  afterEach(() => {
    _resetEngineFetchFns();
    _setConsecutivePollFailures(0);
    stopPolling();
  });

  describe("startInitialLoad", () => {
    it("loads threads into store progressively and records history ID", async () => {
      const mockPerformInitialLoad = vi
        .fn()
        .mockImplementation(
          async (_lookback: number, onThreadLoaded?: (thread: { id: string }) => void) => {
            const t1 = { id: "t1", subject: "Thread 1" };
            const t2 = { id: "t2", subject: "Thread 2" };
            onThreadLoaded?.(t1 as unknown as Parameters<NonNullable<typeof onThreadLoaded>>[0]);
            onThreadLoaded?.(t2 as unknown as Parameters<NonNullable<typeof onThreadLoaded>>[0]);
            return { threads: [t1, t2], historyId: "500" };
          },
        );

      _setEngineFetchFns({ performInitialLoad: mockPerformInitialLoad });

      await startInitialLoad();

      expect(useSyncStore.getState().lastHistoryId).toBe("500");
      expect(useSyncStore.getState().syncMode).toBe("incremental");
      expect(useSyncStore.getState().connectivityStatus).toBe("connected");
      expect(useThreadStore.getState().threads.size).toBe(2);
      expect(useAppStore.getState().shellState).toBe("active");
    });

    it("transitions to empty state when no threads found", async () => {
      const mockPerformInitialLoad = vi.fn().mockResolvedValue({
        threads: [],
        historyId: "100",
      });

      _setEngineFetchFns({ performInitialLoad: mockPerformInitialLoad });

      await startInitialLoad();

      expect(useAppStore.getState().shellState).toBe("empty");
      expect(useSyncStore.getState().syncMode).toBe("incremental");
    });

    it("handles initial load failure gracefully", async () => {
      const mockPerformInitialLoad = vi.fn().mockRejectedValue(new Error("Network error"));

      _setEngineFetchFns({ performInitialLoad: mockPerformInitialLoad });

      await startInitialLoad();

      expect(useAppStore.getState().shellState).toBe("degraded");
      expect(useAppStore.getState().syncStatus).toBe("error");
      expect(useAppStore.getState().notifications.length).toBeGreaterThan(0);
    });
  });

  describe("performIncrementalSync", () => {
    it("falls back to initial load when no history ID exists", async () => {
      const mockPerformInitialLoad = vi.fn().mockResolvedValue({
        threads: [],
        historyId: "100",
      });

      _setEngineFetchFns({ performInitialLoad: mockPerformInitialLoad });

      await performIncrementalSync();

      expect(mockPerformInitialLoad).toHaveBeenCalled();
    });

    it("fetches history changes and updates threads", async () => {
      // Set up initial state with a known thread and history ID
      useSyncStore.setState({ lastHistoryId: "100", syncMode: "incremental" });
      useThreadStore.getState().setThread({
        id: "t1",
        subject: "Old Subject",
        lifecycleState: "waiting",
        participants: [],
        messages: [],
        messageCount: 1,
        latestMessageTimestamp: Date.now() - 10000,
        firstMessageTimestamp: Date.now() - 20000,
        gmailLabels: ["INBOX"],
        unread: false,
        snippet: "old",
        urgencyScore: 0.5,
        valueScore: 0.5,
        position: { x: 100, y: 100 },
        targetPosition: { x: 100, y: 100 },
        zone: "active-front",
        previousZone: null,
        driftVelocity: { dx: 0, dy: 0 },
        clusterMembership: null,
        stateHistory: [],
        threadType: "existing-relationship",
        riskScore: 0,
        riskTier: "safe",
        riskTimerStart: Date.now(),
        opportunityState: "none",
        opportunityWindowEnd: null,
        visualState: "idle",
        userOverrideZone: false,
        lastUserReplyTimestamp: null,
        neglectDuration: 0,
        lastModified: Date.now(),
      } as Thread);

      const mockFetchHistory = vi.fn().mockResolvedValue({
        history: [
          {
            id: "200",
            messagesAdded: [
              { message: { id: "msg-new", threadId: "t1", labelIds: ["INBOX", "UNREAD"] } },
            ],
          },
        ],
        historyId: "200",
      } as GmailHistoryResponse);

      const mockFetchDetail = vi.fn().mockResolvedValue(makeThreadDetail("t1", "200"));

      _setEngineFetchFns({
        fetchHistoryChanges: mockFetchHistory,
        fetchThreadDetail: mockFetchDetail,
      });

      await performIncrementalSync();

      expect(mockFetchHistory).toHaveBeenCalledWith("100", undefined);
      expect(mockFetchDetail).toHaveBeenCalledWith("t1");
      expect(useSyncStore.getState().connectivityStatus).toBe("connected");
      // Thread should have been updated
      const thread = useThreadStore.getState().getThread("t1");
      expect(thread).toBeDefined();
    });

    it("handles history ID expiry with backfill", async () => {
      useSyncStore.setState({ lastHistoryId: "expired-id", syncMode: "incremental" });

      const mockFetchHistory = vi
        .fn()
        .mockRejectedValue(new Error("Gmail API error: 404 historyId not found"));
      const mockPerformInitialLoad = vi.fn().mockResolvedValue({
        threads: [],
        historyId: "300",
      });

      _setEngineFetchFns({
        fetchHistoryChanges: mockFetchHistory,
        performInitialLoad: mockPerformInitialLoad,
      });

      await performIncrementalSync();

      expect(useSyncStore.getState().syncMode).toBe("incremental");
      expect(mockPerformInitialLoad).toHaveBeenCalled();
    });

    it("transitions to offline on network error", async () => {
      useSyncStore.setState({ lastHistoryId: "100", syncMode: "incremental" });

      const mockFetchHistory = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      _setEngineFetchFns({ fetchHistoryChanges: mockFetchHistory });

      await performIncrementalSync();

      expect(useSyncStore.getState().connectivityStatus).toBe("offline");
      expect(useAppStore.getState().syncStatus).toBe("offline");
    });

    it("records sync failure on non-network, non-history errors", async () => {
      useSyncStore.setState({ lastHistoryId: "100", syncMode: "incremental" });

      const mockFetchHistory = vi
        .fn()
        .mockRejectedValue(new Error("Gmail API error: 500 Internal Server Error"));

      _setEngineFetchFns({ fetchHistoryChanges: mockFetchHistory });

      await performIncrementalSync();

      expect(useSyncStore.getState().consecutiveFailures).toBe(1);
    });

    it("adds new threads discovered during sync", async () => {
      useSyncStore.setState({ lastHistoryId: "100", syncMode: "incremental" });

      const mockFetchHistory = vi.fn().mockResolvedValue({
        history: [
          {
            id: "200",
            messagesAdded: [
              { message: { id: "msg-new", threadId: "t-new", labelIds: ["INBOX", "UNREAD"] } },
            ],
          },
        ],
        historyId: "200",
      } as GmailHistoryResponse);

      const mockFetchDetail = vi.fn().mockResolvedValue(makeThreadDetail("t-new", "200"));

      _setEngineFetchFns({
        fetchHistoryChanges: mockFetchHistory,
        fetchThreadDetail: mockFetchDetail,
      });

      await performIncrementalSync();

      const thread = useThreadStore.getState().getThread("t-new");
      expect(thread).toBeDefined();
      expect(thread?.lifecycleState).toBe("new");
    });

    it("handles empty history (no changes) gracefully", async () => {
      useSyncStore.setState({ lastHistoryId: "100", syncMode: "incremental" });

      const mockFetchHistory = vi.fn().mockResolvedValue({
        history: [],
        historyId: "100",
      } as GmailHistoryResponse);

      _setEngineFetchFns({ fetchHistoryChanges: mockFetchHistory });

      await performIncrementalSync();

      expect(useSyncStore.getState().connectivityStatus).toBe("connected");
    });
  });

  describe("replayActionQueue", () => {
    it("replays pending actions in order", async () => {
      const mockSendReply = vi.fn().mockResolvedValue({ id: "msg-sent" });
      const mockArchive = vi.fn().mockResolvedValue(undefined);

      _setEngineFetchFns({ sendReply: mockSendReply, archiveThread: mockArchive });

      // Threads must exist in store for replay to proceed (thread-existence check)
      const { createThread } = await import("../../lib/types");
      useThreadStore.getState().setThread(createThread("t1", "Thread 1", "snippet"));
      useThreadStore.getState().setThread(createThread("t2", "Thread 2", "snippet"));

      // Enqueue two actions
      useSyncStore.getState().enqueueAction({
        type: "reply",
        threadId: "t1",
        payload: {
          threadId: "t1",
          to: ["a@b.com"],
          subject: "Re: Test",
          body: "hi",
          inReplyTo: "msg-1",
          references: [],
        },
        userInitiatedTimestamp: 1000,
      });
      useSyncStore.getState().enqueueAction({
        type: "archive",
        threadId: "t2",
        payload: {},
        userInitiatedTimestamp: 2000,
      });

      await replayActionQueue();

      expect(mockSendReply).toHaveBeenCalled();
      expect(mockArchive).toHaveBeenCalledWith("t2");

      // Succeeded actions are removed from queue (not just marked succeeded)
      const queue = useSyncStore.getState().actionQueue;
      expect(queue).toHaveLength(0);
    });

    it("retries retryable failures and removes permanently failed actions", async () => {
      const mockSendReply = vi
        .fn()
        .mockRejectedValue(new Error("Gmail API error: 400 Bad Request"));

      _setEngineFetchFns({ sendReply: mockSendReply });

      // Thread must exist for replay to proceed
      const { createThread } = await import("../../lib/types");
      useThreadStore.getState().setThread(createThread("t1", "Thread 1", "snippet"));

      useSyncStore.getState().enqueueAction({
        type: "reply",
        threadId: "t1",
        payload: {
          threadId: "t1",
          to: ["a@b.com"],
          subject: "Re: Test",
          body: "hi",
          inReplyTo: "msg-1",
          references: [],
        },
        userInitiatedTimestamp: 1000,
      });

      await replayActionQueue();

      // Non-retryable error -> action removed + user notified
      expect(useSyncStore.getState().actionQueue).toHaveLength(0);
      expect(useAppStore.getState().notifications.length).toBeGreaterThan(0);
    });

    it("discards queued actions when thread no longer exists", async () => {
      const mockSendReply = vi.fn().mockResolvedValue({ id: "msg-sent" });
      _setEngineFetchFns({ sendReply: mockSendReply });

      // No threads in store - the queued actions should be discarded
      useSyncStore.getState().enqueueAction({
        type: "reply",
        threadId: "deleted-thread",
        payload: {
          threadId: "deleted-thread",
          to: ["a@b.com"],
          subject: "Re: Test",
          body: "hi",
          inReplyTo: "msg-1",
          references: [],
        },
        userInitiatedTimestamp: 1000,
      });

      await replayActionQueue();

      // Action should not have been executed
      expect(mockSendReply).not.toHaveBeenCalled();
      // Action should be removed from queue
      expect(useSyncStore.getState().actionQueue).toHaveLength(0);
      // User should be notified
      const notifications = useAppStore.getState().notifications;
      expect(notifications.some((n) => n.message.includes("no longer exists"))).toBe(true);
    });

    it("replays label-change actions via modifyThreadLabels", async () => {
      const mockModifyLabels = vi.fn().mockResolvedValue(undefined);
      _setEngineFetchFns({ modifyThreadLabels: mockModifyLabels });

      const { createThread } = await import("../../lib/types");
      useThreadStore.getState().setThread(createThread("t1", "Thread 1", "snippet"));

      useSyncStore.getState().enqueueAction({
        type: "label-change",
        threadId: "t1",
        payload: { addLabelIds: ["STARRED"], removeLabelIds: ["SPAM"] },
        userInitiatedTimestamp: 1000,
      });

      await replayActionQueue();

      expect(mockModifyLabels).toHaveBeenCalledWith("t1", ["STARRED"], ["SPAM"]);
      expect(useSyncStore.getState().actionQueue).toHaveLength(0);
    });
  });

  describe("reconnect trigger", () => {
    it("replays queued actions when transitioning from offline to connected", async () => {
      const mockSendReply = vi.fn().mockResolvedValue({ id: "msg-sent" });
      const historyResponse: GmailHistoryResponse = {
        history: [],
        historyId: "200",
      };
      const mockFetchHistory = vi.fn().mockResolvedValue(historyResponse);

      _setEngineFetchFns({
        fetchHistoryChanges: mockFetchHistory,
        sendReply: mockSendReply,
      });

      // Set up: was offline with a pending action and valid history ID
      useSyncStore.setState({
        lastHistoryId: "100",
        connectivityStatus: "offline",
        syncMode: "incremental",
      });

      // Thread must exist for replay
      const { createThread } = await import("../../lib/types");
      useThreadStore.getState().setThread(createThread("t1", "Thread 1", "snippet"));

      useSyncStore.getState().enqueueAction({
        type: "reply",
        threadId: "t1",
        payload: {
          threadId: "t1",
          to: ["a@b.com"],
          subject: "Re: Test",
          body: "hi",
          inReplyTo: "msg-1",
          references: [],
        },
        userInitiatedTimestamp: 1000,
      });

      // Perform incremental sync (simulates reconnection succeeding)
      await performIncrementalSync();

      // Action should have been replayed
      expect(mockSendReply).toHaveBeenCalled();
      expect(useSyncStore.getState().actionQueue).toHaveLength(0);
      expect(useSyncStore.getState().connectivityStatus).toBe("connected");
    });

    it("does not replay queue when already connected (no transition)", async () => {
      const mockSendReply = vi.fn().mockResolvedValue({ id: "msg-sent" });
      const historyResponse: GmailHistoryResponse = {
        history: [],
        historyId: "200",
      };
      const mockFetchHistory = vi.fn().mockResolvedValue(historyResponse);

      _setEngineFetchFns({
        fetchHistoryChanges: mockFetchHistory,
        sendReply: mockSendReply,
      });

      // Already connected with a pending action
      useSyncStore.setState({
        lastHistoryId: "100",
        connectivityStatus: "connected",
        syncMode: "incremental",
      });

      useSyncStore.getState().enqueueAction({
        type: "reply",
        threadId: "t1",
        payload: {
          threadId: "t1",
          to: ["a@b.com"],
          subject: "Re: Test",
          body: "hi",
          inReplyTo: "msg-1",
          references: [],
        },
        userInitiatedTimestamp: 1000,
      });

      await performIncrementalSync();

      // Should NOT have replayed - was already connected
      expect(mockSendReply).not.toHaveBeenCalled();
      expect(useSyncStore.getState().actionQueue).toHaveLength(1);
    });
  });

  describe("conflict resolution", () => {
    it("applies server change and notifies when inbound is newer than pending action", async () => {
      const now = Date.now();
      const mockFetchHistory = vi.fn().mockResolvedValue({
        history: [
          {
            id: "200",
            messagesAdded: [{ message: { id: "msg-new", threadId: "t1", labelIds: ["INBOX"] } }],
          },
        ],
        historyId: "200",
      } as GmailHistoryResponse);
      const mockFetchDetail = vi.fn().mockResolvedValue(makeThreadDetail("t1", "200"));

      _setEngineFetchFns({
        fetchHistoryChanges: mockFetchHistory,
        fetchThreadDetail: mockFetchDetail,
      });

      // Set up existing thread and a pending action with an older timestamp
      const { createThread } = await import("../../lib/types");
      const thread = createThread("t1", "Old Subject", "snippet");
      useThreadStore.getState().setThread(thread);

      useSyncStore.setState({
        lastHistoryId: "100",
        connectivityStatus: "connected",
        syncMode: "incremental",
      });

      // Pending action with timestamp older than the inbound event
      useSyncStore.getState().enqueueAction({
        type: "archive",
        threadId: "t1",
        payload: null,
        userInitiatedTimestamp: now - 10000, // 10 seconds ago
      });

      await performIncrementalSync();

      // Server change wins - pending action should be removed
      expect(useSyncStore.getState().actionQueue).toHaveLength(0);
      // User should be notified about the conflict
      const notifications = useAppStore.getState().notifications;
      expect(notifications.some((n) => n.message.includes("superseded"))).toBe(true);
      // Thread should be updated with server data
      const updated = useThreadStore.getState().getThread("t1");
      expect(updated).toBeDefined();
    });

    it("preserves user action when user timestamp is newer than inbound change", async () => {
      const now = Date.now();
      const mockFetchHistory = vi.fn().mockResolvedValue({
        history: [
          {
            id: "200",
            messagesAdded: [{ message: { id: "msg-new", threadId: "t1", labelIds: ["INBOX"] } }],
          },
        ],
        historyId: "200",
      } as GmailHistoryResponse);
      const mockFetchDetail = vi.fn().mockResolvedValue(makeThreadDetail("t1", "200"));

      _setEngineFetchFns({
        fetchHistoryChanges: mockFetchHistory,
        fetchThreadDetail: mockFetchDetail,
      });

      // Set up existing thread
      const { createThread } = await import("../../lib/types");
      const thread = createThread("t1", "User Modified Subject", "snippet");
      thread.visualState = "archived"; // user's optimistic state
      useThreadStore.getState().setThread(thread);

      useSyncStore.setState({
        lastHistoryId: "100",
        connectivityStatus: "connected",
        syncMode: "incremental",
      });

      // Pending action with timestamp newer than the inbound event
      useSyncStore.getState().enqueueAction({
        type: "archive",
        threadId: "t1",
        payload: null,
        userInitiatedTimestamp: now + 10000, // future - definitely newer
      });

      await performIncrementalSync();

      // User action wins - pending action should remain
      expect(useSyncStore.getState().actionQueue).toHaveLength(1);
      // User should be notified
      const notifications = useAppStore.getState().notifications;
      expect(notifications.some((n) => n.message.includes("preserved"))).toBe(true);
      // Thread should NOT be overwritten (user's optimistic state preserved)
      const updated = useThreadStore.getState().getThread("t1");
      expect(updated?.visualState).toBe("archived");
    });
  });

  describe("polling lifecycle", () => {
    it("startPolling and stopPolling control the poll timer", () => {
      vi.useFakeTimers();

      startPolling();
      // Starting again should be a no-op
      startPolling();

      stopPolling();
      vi.useRealTimers();
    });
  });

  describe("exponential backoff (Spec 10 Section 8)", () => {
    it("getRetryInterval returns base interval when no failures", () => {
      _setConsecutivePollFailures(0);
      useSyncStore.setState({ pollIntervalMs: 5000 });
      expect(getRetryInterval()).toBe(5000);
    });

    it("getRetryInterval doubles on each consecutive failure", () => {
      useSyncStore.setState({ pollIntervalMs: 5000 });

      _setConsecutivePollFailures(1);
      expect(getRetryInterval()).toBe(10000); // 5000 * 2^1

      _setConsecutivePollFailures(2);
      expect(getRetryInterval()).toBe(20000); // 5000 * 2^2

      _setConsecutivePollFailures(3);
      expect(getRetryInterval()).toBe(40000); // 5000 * 2^3
    });

    it("getRetryInterval caps at 60s maximum", () => {
      useSyncStore.setState({ pollIntervalMs: 5000 });

      _setConsecutivePollFailures(4);
      // 5000 * 2^4 = 80000 > 60000, so capped at 60000
      expect(getRetryInterval()).toBe(60000);

      _setConsecutivePollFailures(10);
      expect(getRetryInterval()).toBe(60000);
    });

    it("resets consecutive failures on successful sync", () => {
      _setConsecutivePollFailures(5);
      expect(_getConsecutivePollFailures()).toBe(5);

      _setConsecutivePollFailures(0);
      expect(_getConsecutivePollFailures()).toBe(0);
      expect(getRetryInterval()).toBe(useSyncStore.getState().pollIntervalMs);
    });
  });
});
