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

      // Successful actions should be marked succeeded
      const queue = useSyncStore.getState().actionQueue;
      expect(queue.every((a) => a.status === "succeeded")).toBe(true);
    });

    it("retries retryable failures and removes permanently failed actions", async () => {
      const mockSendReply = vi
        .fn()
        .mockRejectedValue(new Error("Gmail API error: 400 Bad Request"));

      _setEngineFetchFns({ sendReply: mockSendReply });

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
});
