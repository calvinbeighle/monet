// Gmail client tests per Spec 01 - Email Integration
// Verifies: proxy routing, retry logic, rate limit handling, auth failure handling,
// thread list fetch, thread detail fetch, helper extraction functions

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  fetchThreadList,
  fetchThreadDetail,
  fetchHistoryChanges,
  sendReply,
  createDraft,
  updateDraft,
  deleteDraft,
  archiveThread,
  extractHeader,
  extractPlainTextBody,
  extractHtmlBody,
  extractAttachments,
  _setProxyFn,
  _resetProxyFn,
  type GmailMessage,
} from "./gmail-client";
import { useAuthStore } from "./auth-store";
import { useAppStore } from "../../lib/stores/app-store";
import { rateLimiter } from "../../lib/utils/rate-limiter";

// Create a mock proxy function that matches nangoProxy signature
function createMockProxy(responses: Array<Partial<Response>>) {
  let callIndex = 0;
  return vi.fn(async (_path: string, _options?: RequestInit): Promise<Response> => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return resp as Response;
  });
}

describe("Gmail client (Nango proxy)", () => {
  beforeEach(() => {
    _resetProxyFn();
    useAuthStore.setState({
      authState: "authenticated",
      connection: null,
      error: null,
    });
  });

  describe("fetchThreadList", () => {
    it("fetches thread list through Nango proxy", async () => {
      const mockData = {
        threads: [{ id: "t1", snippet: "Hello", historyId: "123" }],
        resultSizeEstimate: 1,
      };
      const proxy = createMockProxy([
        { ok: true, json: async () => mockData } as Partial<Response>,
      ]);
      _setProxyFn(proxy);

      const result = await fetchThreadList(50, undefined, "in:inbox");

      expect(result).toEqual(mockData);
      expect(proxy).toHaveBeenCalledOnce();
      const [path] = proxy.mock.calls[0];
      expect(path).toContain("/threads?");
      expect(path).toContain("maxResults=50");
      expect(path).toContain("q=in%3Ainbox");
    });

    it("passes pageToken when provided", async () => {
      const proxy = createMockProxy([
        {
          ok: true,
          json: async () => ({ threads: [], resultSizeEstimate: 0 }),
        } as Partial<Response>,
      ]);
      _setProxyFn(proxy);

      await fetchThreadList(25, "next-page-token");

      const [path] = proxy.mock.calls[0];
      expect(path).toContain("pageToken=next-page-token");
    });
  });

  describe("fetchThreadDetail", () => {
    it("fetches thread detail with format=full", async () => {
      const mockDetail = {
        id: "t1",
        historyId: "456",
        messages: [],
      };
      const proxy = createMockProxy([
        { ok: true, json: async () => mockDetail } as Partial<Response>,
      ]);
      _setProxyFn(proxy);

      const result = await fetchThreadDetail("t1");

      expect(result).toEqual(mockDetail);
      const [path] = proxy.mock.calls[0];
      expect(path).toContain("/threads/t1?format=full");
    });
  });

  describe("fetchHistoryChanges", () => {
    it("fetches history changes with startHistoryId", async () => {
      const mockHistory = { history: [], historyId: "789" };
      const proxy = createMockProxy([
        { ok: true, json: async () => mockHistory } as Partial<Response>,
      ]);
      _setProxyFn(proxy);

      const result = await fetchHistoryChanges("100");

      expect(result).toEqual(mockHistory);
      const [path] = proxy.mock.calls[0];
      expect(path).toContain("startHistoryId=100");
    });
  });

  describe("sendReply", () => {
    it("sends reply with raw encoded message", async () => {
      const mockMsg = { id: "msg-1", threadId: "t1" };
      const proxy = createMockProxy([{ ok: true, json: async () => mockMsg } as Partial<Response>]);
      _setProxyFn(proxy);

      await sendReply({
        threadId: "t1",
        to: ["alice@example.com"],
        subject: "Re: Test",
        body: "Hello",
        inReplyTo: "<msg-id@example.com>",
        references: ["<msg-id@example.com>"],
      });

      const [path, opts] = proxy.mock.calls[0];
      expect(path).toBe("/messages/send");
      expect(opts!.method).toBe("POST");
      const body = JSON.parse(opts!.body as string);
      expect(body.threadId).toBe("t1");
      expect(body.raw).toBeTruthy();
    });
  });

  describe("createDraft", () => {
    it("creates draft via proxy", async () => {
      const proxy = createMockProxy([
        { ok: true, json: async () => ({ id: "draft-1" }) } as Partial<Response>,
      ]);
      _setProxyFn(proxy);

      const result = await createDraft({
        threadId: "t1",
        to: ["alice@example.com"],
        subject: "Re: Test",
        body: "Draft body",
      });

      expect(result.id).toBe("draft-1");
      const [path, opts] = proxy.mock.calls[0];
      expect(path).toBe("/drafts");
      expect(opts!.method).toBe("POST");
    });
  });

  describe("updateDraft", () => {
    it("updates existing draft", async () => {
      const proxy = createMockProxy([
        { ok: true, json: async () => ({ id: "draft-1" }) } as Partial<Response>,
      ]);
      _setProxyFn(proxy);

      await updateDraft("draft-1", {
        threadId: "t1",
        to: ["alice@example.com"],
        subject: "Re: Test",
        body: "Updated body",
      });

      const [path, opts] = proxy.mock.calls[0];
      expect(path).toContain("/drafts/draft-1");
      expect(opts!.method).toBe("PUT");
    });
  });

  describe("deleteDraft", () => {
    it("deletes draft via proxy", async () => {
      const proxy = createMockProxy([{ ok: true } as Partial<Response>]);
      _setProxyFn(proxy);

      await deleteDraft("draft-1");

      const [path, opts] = proxy.mock.calls[0];
      expect(path).toContain("/drafts/draft-1");
      expect(opts!.method).toBe("DELETE");
    });
  });

  describe("archiveThread", () => {
    it("removes INBOX label via proxy", async () => {
      const proxy = createMockProxy([{ ok: true } as Partial<Response>]);
      _setProxyFn(proxy);

      await archiveThread("t1");

      const [path, opts] = proxy.mock.calls[0];
      expect(path).toContain("/threads/t1/modify");
      expect(opts!.method).toBe("POST");
      const body = JSON.parse(opts!.body as string);
      expect(body.removeLabelIds).toEqual(["INBOX"]);
    });
  });

  describe("daily quota exhaustion notification", () => {
    it("adds critical notification and sets quotaExhausted when canProceed returns daily quota exhausted", async () => {
      // Reset app store notifications and quota flag
      useAppStore.setState({ notifications: [], quotaExhausted: false });

      // Spy on rateLimiter.canProceed to simulate daily quota exhausted state.
      // gmail-client imports the same rateLimiter singleton so the spy takes effect.
      const canProceedSpy = vi.spyOn(rateLimiter, "canProceed").mockReturnValue({
        allowed: false,
        waitMs: 86400000,
        reason: "daily quota exhausted - read-only mode",
      });

      try {
        // The fetch should reject because canProceed disallows it
        await expect(fetchThreadList()).rejects.toThrow("Rate limited");

        // The critical notification should have been added to app store
        const notifications = useAppStore.getState().notifications;
        const criticalNotification = notifications.find((n) => n.severity === "critical");
        expect(criticalNotification).toBeDefined();
        expect(criticalNotification!.message).toContain("daily quota exhausted");

        // The quotaExhausted flag should be set per Spec 01 rate limiting
        expect(useAppStore.getState().quotaExhausted).toBe(true);
      } finally {
        canProceedSpy.mockRestore();
      }
    });

    it("clears quotaExhausted when day rolls and API call succeeds", async () => {
      // Start with quota exhausted
      useAppStore.setState({ quotaExhausted: true });

      // Mock rateLimiter.getStatus to report no longer exhausted (day rolled)
      const getStatusSpy = vi.spyOn(rateLimiter, "getStatus").mockReturnValue({
        dailyUsagePercent: 0,
        isExhausted: false,
        isNearExhaustion: false,
        isPaused: false,
      });

      const proxy = createMockProxy([
        { ok: true, json: async () => ({ threads: [] }) } as Partial<Response>,
      ]);
      _setProxyFn(proxy);

      try {
        await fetchThreadList();
        expect(useAppStore.getState().quotaExhausted).toBe(false);
      } finally {
        getStatusSpy.mockRestore();
      }
    });

    it("does not add notification for non-quota rate limit reason", async () => {
      useAppStore.setState({ notifications: [] });

      const canProceedSpy = vi.spyOn(rateLimiter, "canProceed").mockReturnValue({
        allowed: false,
        waitMs: 1000,
        reason: "paused after 429",
      });

      try {
        await expect(fetchThreadList()).rejects.toThrow("Rate limited");

        const notifications = useAppStore.getState().notifications;
        const criticalNotification = notifications.find((n) => n.severity === "critical");
        // No critical notification for non-quota rate limits
        expect(criticalNotification).toBeUndefined();
      } finally {
        canProceedSpy.mockRestore();
      }
    });
  });

  describe("retry logic", () => {
    it("retries on 500 server error with backoff", async () => {
      const proxy = createMockProxy([
        { ok: false, status: 500, headers: new Headers() } as Partial<Response>,
        { ok: false, status: 500, headers: new Headers() } as Partial<Response>,
        { ok: true, json: async () => ({ threads: [] }) } as Partial<Response>,
      ]);
      _setProxyFn(proxy);

      const result = await fetchThreadList();
      expect(result).toEqual({ threads: [] });
      expect(proxy).toHaveBeenCalledTimes(3);
    });

    it("handles 429 rate limit with Retry-After header", async () => {
      const headers = new Headers();
      headers.set("Retry-After", "0");
      const proxy = createMockProxy([
        { ok: false, status: 429, headers } as Partial<Response>,
        { ok: true, json: async () => ({ threads: [] }) } as Partial<Response>,
      ]);
      _setProxyFn(proxy);

      const result = await fetchThreadList();
      expect(result).toEqual({ threads: [] });
      expect(proxy).toHaveBeenCalledTimes(2);
    });

    it("transitions to reauthentication-required on 401", async () => {
      const proxy = createMockProxy([
        { ok: false, status: 401, headers: new Headers() } as Partial<Response>,
      ]);
      _setProxyFn(proxy);

      await expect(fetchThreadList()).rejects.toThrow("Authentication failed");
      expect(useAuthStore.getState().authState).toBe("reauthentication-required");
    });

    it("throws on non-retryable client error (4xx)", async () => {
      const proxy = createMockProxy([
        {
          ok: false,
          status: 403,
          headers: new Headers(),
          text: async () => "Forbidden",
        } as Partial<Response>,
      ]);
      _setProxyFn(proxy);

      await expect(fetchThreadList()).rejects.toThrow("Gmail API error: 403");
    });
  });

  describe("helper extraction functions", () => {
    const makeMessage = (overrides: Partial<GmailMessage> = {}): GmailMessage => ({
      id: "msg-1",
      threadId: "t1",
      labelIds: ["INBOX"],
      snippet: "Test",
      internalDate: "1700000000000",
      payload: {
        headers: [
          { name: "Subject", value: "Test Subject" },
          { name: "From", value: "alice@example.com" },
          { name: "To", value: "bob@example.com" },
          { name: "Message-ID", value: "<msg-1@example.com>" },
        ],
        mimeType: "multipart/alternative",
        parts: [
          {
            mimeType: "text/plain",
            body: { data: btoa("Hello plain"), size: 11 },
          },
          {
            mimeType: "text/html",
            body: { data: btoa("<b>Hello html</b>"), size: 17 },
          },
          {
            mimeType: "application/pdf",
            filename: "doc.pdf",
            body: { size: 1024 },
          },
        ],
      },
      ...overrides,
    });

    it("extractHeader returns header value case-insensitively", () => {
      const msg = makeMessage();
      expect(extractHeader(msg, "subject")).toBe("Test Subject");
      expect(extractHeader(msg, "Subject")).toBe("Test Subject");
      expect(extractHeader(msg, "from")).toBe("alice@example.com");
      expect(extractHeader(msg, "message-id")).toBe("<msg-1@example.com>");
    });

    it("extractHeader returns undefined for missing header", () => {
      const msg = makeMessage();
      expect(extractHeader(msg, "X-Custom")).toBeUndefined();
    });

    it("extractPlainTextBody extracts from parts", () => {
      const msg = makeMessage();
      const body = extractPlainTextBody(msg);
      expect(body).toBe("Hello plain");
    });

    it("extractPlainTextBody extracts from direct body", () => {
      const msg = makeMessage({
        payload: {
          headers: [],
          mimeType: "text/plain",
          body: { data: btoa("Direct body"), size: 11 },
        },
      });
      const body = extractPlainTextBody(msg);
      expect(body).toBe("Direct body");
    });

    it("extractPlainTextBody returns empty string when no text part", () => {
      const msg = makeMessage({
        payload: {
          headers: [],
          mimeType: "multipart/alternative",
          parts: [{ mimeType: "text/html", body: { data: btoa("<b>html</b>"), size: 11 } }],
        },
      });
      expect(extractPlainTextBody(msg)).toBe("");
    });

    it("extractHtmlBody extracts from parts", () => {
      const msg = makeMessage();
      const body = extractHtmlBody(msg);
      expect(body).toBe("<b>Hello html</b>");
    });

    it("extractAttachments returns attachment descriptors", () => {
      const msg = makeMessage();
      const attachments = extractAttachments(msg);
      expect(attachments).toHaveLength(1);
      expect(attachments[0]).toEqual({
        filename: "doc.pdf",
        mimeType: "application/pdf",
        size: 1024,
      });
    });

    it("extractAttachments returns empty array when no parts", () => {
      const msg = makeMessage({
        payload: {
          headers: [],
          mimeType: "text/plain",
          body: { data: btoa("text"), size: 4 },
        },
      });
      expect(extractAttachments(msg)).toEqual([]);
    });
  });
});
