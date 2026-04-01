// Tests for outbound-actions.ts per Spec 01 Sections 4-6, Spec 10 Section 4
// Covers: reply send + optimistic update + rollback, draft CRUD lifecycle,
// archive + optimistic update + rollback, offline queueing, validation

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  sendReplyAction,
  saveDraftAction,
  discardDraftAction,
  archiveThreadAction,
  beginDraft,
  updateDraftContent,
  getDraftRecord,
  getDraftState,
  _setOutboundFns,
  _resetOutboundFns,
  _clearDraftRecords,
} from "./outbound-actions";
import { useThreadStore } from "../../lib/stores";
import { useSyncStore } from "../../lib/stores/sync-store";
import { useAppStore } from "../../lib/stores";
import type { Thread } from "../../lib/types";
import { createThread } from "../../lib/types";

// Mock Gmail API functions
const mockSendReply = vi.fn();
const mockCreateDraft = vi.fn();
const mockUpdateDraft = vi.fn();
const mockDeleteDraft = vi.fn();
const mockArchiveThread = vi.fn();

function makeThread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    ...createThread(id, `Subject ${id}`, `Snippet ${id}`),
    participants: [
      {
        displayName: "Alice",
        email: "alice@example.com",
        organization: null,
        vipFlag: false,
        relationshipScore: 50,
        responseHistory: { avgResponseTimeMs: 0, threadFrequency: 0 },
      },
    ],
    messages: [
      {
        id: `msg-${id}-1`,
        sender: "alice@example.com",
        recipients: ["me@example.com"],
        cc: [],
        bcc: [],
        timestamp: Date.now() - 3600000,
        bodyPlain: "Hello there",
        bodyHtml: "",
        labelIds: ["INBOX"],
        attachments: [],
      },
    ],
    messageCount: 1,
    gmailLabels: ["INBOX"],
    riskTier: "elevated",
    ...overrides,
  };
}

describe("OutboundActions", () => {
  beforeEach(() => {
    // Reset stores
    useThreadStore.setState({ threads: new Map(), selectedThreadId: null });
    useSyncStore.setState({
      connectivityStatus: "connected",
      actionQueue: [],
      consecutiveFailures: 0,
    });
    useAppStore.getState().notifications = [];

    // Reset mocks
    vi.clearAllMocks();
    mockSendReply.mockResolvedValue({ id: "sent-msg-1", threadId: "t1" });
    mockCreateDraft.mockResolvedValue({ id: "draft-1" });
    mockUpdateDraft.mockResolvedValue({ id: "draft-1" });
    mockDeleteDraft.mockResolvedValue(undefined);
    mockArchiveThread.mockResolvedValue(undefined);

    _setOutboundFns({
      sendReply: mockSendReply,
      createDraft: mockCreateDraft,
      updateDraft: mockUpdateDraft,
      deleteDraft: mockDeleteDraft,
      archiveThread: mockArchiveThread,
    });

    _clearDraftRecords();
  });

  // --- Reply Tests (Spec 01 Section 4) ---

  describe("sendReplyAction", () => {
    it("sends reply and applies optimistic update", async () => {
      const thread = makeThread("t1");
      useThreadStore.getState().setThread(thread);

      const payload = {
        threadId: "t1",
        to: ["alice@example.com"],
        subject: "Re: Subject t1",
        body: "Thanks for the email",
        inReplyTo: "msg-t1-1",
        references: ["msg-t1-1"],
      };

      const result = await sendReplyAction("t1", payload);
      expect(result).toBe(true);
      expect(mockSendReply).toHaveBeenCalledWith(payload);

      // Thread should have new message with real Gmail ID
      const updated = useThreadStore.getState().getThread("t1")!;
      expect(updated.messageCount).toBe(2);
      expect(updated.messages[1].id).toBe("sent-msg-1");
      expect(updated.messages[1].bodyPlain).toBe("Thanks for the email");
    });

    it("resets risk tier to safe on successful reply", async () => {
      const thread = makeThread("t1", { riskTier: "critical" });
      useThreadStore.getState().setThread(thread);

      await sendReplyAction("t1", {
        threadId: "t1",
        to: ["alice@example.com"],
        subject: "Re: Subject t1",
        body: "Reply",
        inReplyTo: "msg-t1-1",
        references: ["msg-t1-1"],
      });

      const updated = useThreadStore.getState().getThread("t1")!;
      expect(updated.riskTier).toBe("safe");
      expect(updated.neglectDuration).toBe(0);
      expect(updated.lastUserReplyTimestamp).toBeGreaterThan(0);
    });

    it("rolls back on send failure", async () => {
      const thread = makeThread("t1");
      useThreadStore.getState().setThread(thread);
      mockSendReply.mockRejectedValue(new Error("Gmail API error: 500"));

      const result = await sendReplyAction("t1", {
        threadId: "t1",
        to: ["alice@example.com"],
        subject: "Re: Subject t1",
        body: "Reply",
        inReplyTo: "msg-t1-1",
        references: ["msg-t1-1"],
      });

      expect(result).toBe(false);
      // Thread state should be rolled back
      const restored = useThreadStore.getState().getThread("t1")!;
      expect(restored.messageCount).toBe(1);
      expect(restored.riskTier).toBe("elevated");
    });

    it("notifies user on send failure", async () => {
      const thread = makeThread("t1");
      useThreadStore.getState().setThread(thread);
      mockSendReply.mockRejectedValue(new Error("Network error"));

      await sendReplyAction("t1", {
        threadId: "t1",
        to: ["alice@example.com"],
        subject: "Re: Subject t1",
        body: "Reply",
        inReplyTo: "msg-t1-1",
        references: ["msg-t1-1"],
      });

      const notifications = useAppStore.getState().notifications;
      expect(notifications.some((n) => n.message.includes("Failed to send reply"))).toBe(true);
    });

    it("rejects empty body", async () => {
      const thread = makeThread("t1");
      useThreadStore.getState().setThread(thread);

      const result = await sendReplyAction("t1", {
        threadId: "t1",
        to: ["alice@example.com"],
        subject: "Re: Subject t1",
        body: "   ",
        inReplyTo: "msg-t1-1",
        references: ["msg-t1-1"],
      });

      expect(result).toBe(false);
      expect(mockSendReply).not.toHaveBeenCalled();
    });

    it("rejects empty recipients", async () => {
      const thread = makeThread("t1");
      useThreadStore.getState().setThread(thread);

      const result = await sendReplyAction("t1", {
        threadId: "t1",
        to: [],
        subject: "Re: Subject t1",
        body: "Reply",
        inReplyTo: "msg-t1-1",
        references: ["msg-t1-1"],
      });

      expect(result).toBe(false);
      expect(mockSendReply).not.toHaveBeenCalled();
    });

    it("returns false for nonexistent thread", async () => {
      const result = await sendReplyAction("nonexistent", {
        threadId: "nonexistent",
        to: ["alice@example.com"],
        subject: "Re: test",
        body: "Reply",
        inReplyTo: "msg-1",
        references: ["msg-1"],
      });
      expect(result).toBe(false);
    });

    it("queues reply when offline", async () => {
      const thread = makeThread("t1");
      useThreadStore.getState().setThread(thread);
      useSyncStore.setState({ connectivityStatus: "offline" });

      const payload = {
        threadId: "t1",
        to: ["alice@example.com"],
        subject: "Re: Subject t1",
        body: "Offline reply",
        inReplyTo: "msg-t1-1",
        references: ["msg-t1-1"],
      };

      const result = await sendReplyAction("t1", payload);
      expect(result).toBe(true);
      expect(mockSendReply).not.toHaveBeenCalled();

      // Action should be queued
      const queue = useSyncStore.getState().actionQueue;
      expect(queue).toHaveLength(1);
      expect(queue[0].type).toBe("reply");
      expect(queue[0].status).toBe("pending");

      // Optimistic update still applied
      const updated = useThreadStore.getState().getThread("t1")!;
      expect(updated.messageCount).toBe(2);
    });

    it("clears draft on successful send", async () => {
      const thread = makeThread("t1");
      useThreadStore.getState().setThread(thread);
      beginDraft("t1", "Draft content");

      await sendReplyAction("t1", {
        threadId: "t1",
        to: ["alice@example.com"],
        subject: "Re: Subject t1",
        body: "Final reply",
        inReplyTo: "msg-t1-1",
        references: ["msg-t1-1"],
      });

      expect(getDraftState("t1")).toBe("none");
    });

    it("deletes Gmail draft on successful send per Spec 01", async () => {
      const thread = makeThread("t1");
      useThreadStore.getState().setThread(thread);

      // Save draft first to get a gmailDraftId
      beginDraft("t1", "Draft content");
      mockCreateDraft.mockResolvedValue({ id: "gmail-draft-123" });
      await saveDraftAction("t1", {
        threadId: "t1",
        to: ["alice@example.com"],
        subject: "Re: Subject t1",
        body: "Draft content",
        inReplyTo: "msg-t1-1",
        references: ["msg-t1-1"],
      });

      // Now send - should delete the Gmail draft
      await sendReplyAction("t1", {
        threadId: "t1",
        to: ["alice@example.com"],
        subject: "Re: Subject t1",
        body: "Final reply",
        inReplyTo: "msg-t1-1",
        references: ["msg-t1-1"],
      });

      expect(mockDeleteDraft).toHaveBeenCalledWith("gmail-draft-123");
    });
  });

  // --- Draft Tests (Spec 01 Section 5) ---

  describe("draft lifecycle", () => {
    it("begins draft in unsaved state", () => {
      beginDraft("t1", "Hello");
      expect(getDraftState("t1")).toBe("unsaved");
      expect(getDraftRecord("t1")?.body).toBe("Hello");
    });

    it("transitions saved -> dirty on content change", async () => {
      const thread = makeThread("t1");
      useThreadStore.getState().setThread(thread);

      beginDraft("t1", "Initial");
      await saveDraftAction("t1", {
        threadId: "t1",
        to: ["alice@example.com"],
        subject: "Re: Subject t1",
        body: "Initial",
      });

      expect(getDraftState("t1")).toBe("saved");

      updateDraftContent("t1", "Modified");
      expect(getDraftState("t1")).toBe("dirty");
      expect(getDraftRecord("t1")?.body).toBe("Modified");
    });

    it("creates new Gmail draft on first save", async () => {
      beginDraft("t1", "Draft body");
      await saveDraftAction("t1", {
        threadId: "t1",
        to: ["alice@example.com"],
        subject: "Re: Subject t1",
        body: "Draft body",
      });

      expect(mockCreateDraft).toHaveBeenCalled();
      expect(mockUpdateDraft).not.toHaveBeenCalled();
      expect(getDraftRecord("t1")?.gmailDraftId).toBe("draft-1");
      expect(getDraftState("t1")).toBe("saved");
    });

    it("updates existing Gmail draft on subsequent saves", async () => {
      beginDraft("t1", "Draft v1");
      await saveDraftAction("t1", {
        threadId: "t1",
        to: ["alice@example.com"],
        subject: "Re: Subject t1",
        body: "Draft v1",
      });

      updateDraftContent("t1", "Draft v2");
      await saveDraftAction("t1", {
        threadId: "t1",
        to: ["alice@example.com"],
        subject: "Re: Subject t1",
        body: "Draft v2",
      });

      expect(mockCreateDraft).toHaveBeenCalledTimes(1);
      expect(mockUpdateDraft).toHaveBeenCalledTimes(1);
      expect(getDraftState("t1")).toBe("saved");
    });

    it("discards draft and deletes from Gmail", async () => {
      beginDraft("t1", "Draft");
      await saveDraftAction("t1", {
        threadId: "t1",
        to: ["alice@example.com"],
        subject: "Re: Subject t1",
        body: "Draft",
      });

      await discardDraftAction("t1");

      expect(mockDeleteDraft).toHaveBeenCalledWith("draft-1");
      expect(getDraftState("t1")).toBe("none");
      expect(getDraftRecord("t1")).toBeUndefined();
    });

    it("discards unsaved draft without API call", async () => {
      beginDraft("t1", "Unsaved draft");
      await discardDraftAction("t1");

      expect(mockDeleteDraft).not.toHaveBeenCalled();
      expect(getDraftState("t1")).toBe("none");
    });

    it("returns true when discarding nonexistent draft", async () => {
      const result = await discardDraftAction("t1");
      expect(result).toBe(true);
    });

    it("notifies on save failure", async () => {
      mockCreateDraft.mockRejectedValue(new Error("API error"));
      beginDraft("t1", "Draft");

      const result = await saveDraftAction("t1", {
        threadId: "t1",
        to: ["alice@example.com"],
        subject: "Re: test",
        body: "Draft",
      });

      expect(result).toBe(false);
      const notifications = useAppStore.getState().notifications;
      expect(notifications.some((n) => n.message.includes("Failed to save draft"))).toBe(true);
    });

    it("queues draft save when offline", async () => {
      useSyncStore.setState({ connectivityStatus: "offline" });
      beginDraft("t1", "Offline draft");

      await saveDraftAction("t1", {
        threadId: "t1",
        to: ["alice@example.com"],
        subject: "Re: test",
        body: "Offline draft",
      });

      expect(mockCreateDraft).not.toHaveBeenCalled();
      const queue = useSyncStore.getState().actionQueue;
      expect(queue).toHaveLength(1);
      expect(queue[0].type).toBe("draft-save");
      // Optimistic: draft marked as saved locally
      expect(getDraftState("t1")).toBe("saved");
    });
  });

  describe("updateDraftContent", () => {
    it("creates draft record if none exists and body is non-empty", () => {
      updateDraftContent("t1", "New content");
      expect(getDraftState("t1")).toBe("unsaved");
    });

    it("does not create draft record for empty body", () => {
      updateDraftContent("t1", "");
      expect(getDraftState("t1")).toBe("none");
    });

    it("preserves unsaved state on content change", () => {
      beginDraft("t1", "Initial");
      updateDraftContent("t1", "Modified");
      expect(getDraftState("t1")).toBe("unsaved");
    });
  });

  // --- Archive Tests (Spec 01 Section 6) ---

  describe("archiveThreadAction", () => {
    it("archives thread and removes INBOX label optimistically", async () => {
      const thread = makeThread("t1", { gmailLabels: ["INBOX", "IMPORTANT"] });
      useThreadStore.getState().setThread(thread);

      const result = await archiveThreadAction("t1");
      expect(result).toBe(true);
      expect(mockArchiveThread).toHaveBeenCalledWith("t1");

      const updated = useThreadStore.getState().getThread("t1")!;
      expect(updated.gmailLabels).not.toContain("INBOX");
      expect(updated.gmailLabels).toContain("IMPORTANT");
      expect(updated.visualState).toBe("archived");
    });

    it("rolls back on archive failure", async () => {
      const thread = makeThread("t1", { gmailLabels: ["INBOX"] });
      useThreadStore.getState().setThread(thread);
      mockArchiveThread.mockRejectedValue(new Error("API error"));

      const result = await archiveThreadAction("t1");
      expect(result).toBe(false);

      const restored = useThreadStore.getState().getThread("t1")!;
      expect(restored.gmailLabels).toContain("INBOX");
      expect(restored.visualState).not.toBe("archived");
    });

    it("notifies user on archive failure", async () => {
      const thread = makeThread("t1");
      useThreadStore.getState().setThread(thread);
      mockArchiveThread.mockRejectedValue(new Error("API error"));

      await archiveThreadAction("t1");

      const notifications = useAppStore.getState().notifications;
      expect(notifications.some((n) => n.message.includes("Failed to archive"))).toBe(true);
    });

    it("returns false for nonexistent thread", async () => {
      const result = await archiveThreadAction("nonexistent");
      expect(result).toBe(false);
    });

    it("queues archive when offline", async () => {
      const thread = makeThread("t1");
      useThreadStore.getState().setThread(thread);
      useSyncStore.setState({ connectivityStatus: "offline" });

      const result = await archiveThreadAction("t1");
      expect(result).toBe(true);
      expect(mockArchiveThread).not.toHaveBeenCalled();

      // Action queued
      const queue = useSyncStore.getState().actionQueue;
      expect(queue).toHaveLength(1);
      expect(queue[0].type).toBe("archive");

      // Optimistic update still applied
      const updated = useThreadStore.getState().getThread("t1")!;
      expect(updated.visualState).toBe("archived");
    });
  });

  // --- Snapshot/Rollback Tests ---

  describe("snapshot rollback fidelity", () => {
    it("restores messages array on rollback (not shared reference)", async () => {
      const thread = makeThread("t1");
      useThreadStore.getState().setThread(thread);
      mockSendReply.mockRejectedValue(new Error("fail"));

      await sendReplyAction("t1", {
        threadId: "t1",
        to: ["alice@example.com"],
        subject: "Re: Subject t1",
        body: "Reply",
        inReplyTo: "msg-t1-1",
        references: ["msg-t1-1"],
      });

      const restored = useThreadStore.getState().getThread("t1")!;
      expect(restored.messages).toHaveLength(1);
      expect(restored.messages[0].id).toBe("msg-t1-1");
    });

    it("restores gmailLabels on archive rollback (not shared reference)", async () => {
      const thread = makeThread("t1", { gmailLabels: ["INBOX", "STARRED"] });
      useThreadStore.getState().setThread(thread);
      mockArchiveThread.mockRejectedValue(new Error("fail"));

      await archiveThreadAction("t1");

      const restored = useThreadStore.getState().getThread("t1")!;
      expect(restored.gmailLabels).toEqual(["INBOX", "STARRED"]);
    });
  });
});
