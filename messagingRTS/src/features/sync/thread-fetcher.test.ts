// Tests for thread-fetcher.ts per Spec 01 (Initial Thread Load) and Spec 10 (Initial Load)
// Covers: Gmail-to-Thread conversion, address parsing, progressive loading, history ID capture

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  convertGmailMessage,
  convertGmailThread,
  extractEmailAddress,
  extractDisplayName,
  parseAddressList,
  performInitialLoad,
  _setFetchFns,
  _resetFetchFns,
} from "./thread-fetcher";
import type {
  GmailMessage,
  GmailThreadDetail,
  GmailThreadListResponse,
} from "../auth/gmail-client";

// --- Test helpers ---

function makeGmailMessage(overrides: Partial<GmailMessage> = {}): GmailMessage {
  return {
    id: "msg-1",
    threadId: "thread-1",
    labelIds: ["INBOX", "UNREAD"],
    snippet: "Hey there",
    internalDate: String(Date.now()),
    payload: {
      headers: [
        { name: "From", value: "Alice <alice@example.com>" },
        { name: "To", value: "Bob <bob@example.com>" },
        { name: "Subject", value: "Test subject" },
        { name: "Cc", value: "" },
      ],
      mimeType: "text/plain",
      body: { data: btoa("Hello world"), size: 11 },
    },
    ...overrides,
  };
}

function makeGmailThreadDetail(overrides: Partial<GmailThreadDetail> = {}): GmailThreadDetail {
  return {
    id: "thread-1",
    historyId: "12345",
    messages: [makeGmailMessage()],
    ...overrides,
  };
}

// --- Address parsing ---

describe("extractEmailAddress", () => {
  it("extracts email from angle bracket format", () => {
    expect(extractEmailAddress("Alice Smith <alice@example.com>")).toBe("alice@example.com");
  });

  it("extracts plain email address", () => {
    expect(extractEmailAddress("alice@example.com")).toBe("alice@example.com");
  });

  it("lowercases the email", () => {
    expect(extractEmailAddress("Alice@Example.COM")).toBe("alice@example.com");
  });

  it("returns empty string for non-email input", () => {
    expect(extractEmailAddress("not-an-email")).toBe("");
  });
});

describe("extractDisplayName", () => {
  it("extracts name from angle bracket format", () => {
    expect(extractDisplayName("Alice Smith <alice@example.com>")).toBe("Alice Smith");
  });

  it("strips surrounding quotes from name", () => {
    expect(extractDisplayName('"Alice Smith" <alice@example.com>')).toBe("Alice Smith");
  });

  it("returns raw string when no angle brackets", () => {
    expect(extractDisplayName("alice@example.com")).toBe("alice@example.com");
  });
});

describe("parseAddressList", () => {
  it("parses comma-separated addresses", () => {
    expect(parseAddressList("a@b.com, c@d.com")).toEqual(["a@b.com", "c@d.com"]);
  });

  it("returns empty array for empty string", () => {
    expect(parseAddressList("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(parseAddressList("   ")).toEqual([]);
  });

  it("handles single address", () => {
    expect(parseAddressList("a@b.com")).toEqual(["a@b.com"]);
  });
});

// --- Gmail message conversion ---

describe("convertGmailMessage", () => {
  it("extracts sender from From header", () => {
    const msg = convertGmailMessage(makeGmailMessage());
    expect(msg.sender).toBe("Alice <alice@example.com>");
  });

  it("extracts recipients from To header", () => {
    const msg = convertGmailMessage(makeGmailMessage());
    expect(msg.recipients).toEqual(["Bob <bob@example.com>"]);
  });

  it("parses timestamp from internalDate", () => {
    const now = Date.now();
    const msg = convertGmailMessage(makeGmailMessage({ internalDate: String(now) }));
    expect(msg.timestamp).toBe(now);
  });

  it("extracts plain text body", () => {
    const msg = convertGmailMessage(makeGmailMessage());
    expect(msg.bodyPlain).toBe("Hello world");
  });

  it("preserves label IDs", () => {
    const msg = convertGmailMessage(makeGmailMessage({ labelIds: ["INBOX", "STARRED"] }));
    expect(msg.labelIds).toEqual(["INBOX", "STARRED"]);
  });

  it("handles missing Cc/Bcc headers gracefully", () => {
    const msg = convertGmailMessage(makeGmailMessage());
    expect(msg.cc).toEqual([]);
    expect(msg.bcc).toEqual([]);
  });
});

// --- Gmail thread conversion ---

describe("convertGmailThread", () => {
  it("creates thread with correct id", () => {
    const thread = convertGmailThread(makeGmailThreadDetail());
    expect(thread.id).toBe("thread-1");
  });

  it("extracts canonical subject from first message", () => {
    const thread = convertGmailThread(makeGmailThreadDetail());
    expect(thread.subject).toBe("Test subject");
  });

  it("computes message count", () => {
    const detail = makeGmailThreadDetail({
      messages: [
        makeGmailMessage({ id: "msg-1", internalDate: "1000" }),
        makeGmailMessage({ id: "msg-2", internalDate: "2000" }),
      ],
    });
    const thread = convertGmailThread(detail);
    expect(thread.messageCount).toBe(2);
  });

  it("derives unique participants from all messages", () => {
    const detail = makeGmailThreadDetail({
      messages: [
        makeGmailMessage({
          id: "msg-1",
          payload: {
            headers: [
              { name: "From", value: "alice@example.com" },
              { name: "To", value: "bob@example.com" },
              { name: "Subject", value: "Test" },
            ],
            mimeType: "text/plain",
            body: { data: btoa("hi"), size: 2 },
          },
        }),
        makeGmailMessage({
          id: "msg-2",
          payload: {
            headers: [
              { name: "From", value: "bob@example.com" },
              { name: "To", value: "alice@example.com, carol@example.com" },
              { name: "Subject", value: "Re: Test" },
            ],
            mimeType: "text/plain",
            body: { data: btoa("hi back"), size: 7 },
          },
        }),
      ],
    });
    const thread = convertGmailThread(detail);
    const emails = thread.participants.map((p) => p.email);
    expect(emails).toContain("alice@example.com");
    expect(emails).toContain("bob@example.com");
    expect(emails).toContain("carol@example.com");
    expect(thread.participants.length).toBe(3);
  });

  it("collects all labels across messages", () => {
    const detail = makeGmailThreadDetail({
      messages: [
        makeGmailMessage({ id: "msg-1", labelIds: ["INBOX", "UNREAD"] }),
        makeGmailMessage({ id: "msg-2", labelIds: ["INBOX", "STARRED"] }),
      ],
    });
    const thread = convertGmailThread(detail);
    expect(thread.gmailLabels).toContain("INBOX");
    expect(thread.gmailLabels).toContain("UNREAD");
    expect(thread.gmailLabels).toContain("STARRED");
  });

  it("sets unread=true when any message has UNREAD label", () => {
    const detail = makeGmailThreadDetail({
      messages: [
        makeGmailMessage({ id: "msg-1", labelIds: ["INBOX"] }),
        makeGmailMessage({ id: "msg-2", labelIds: ["INBOX", "UNREAD"] }),
      ],
    });
    const thread = convertGmailThread(detail);
    expect(thread.unread).toBe(true);
  });

  it("sets unread=false when no message has UNREAD label", () => {
    const detail = makeGmailThreadDetail({
      messages: [makeGmailMessage({ id: "msg-1", labelIds: ["INBOX"] })],
    });
    const thread = convertGmailThread(detail);
    expect(thread.unread).toBe(false);
  });

  it("sets lifecycle state to new", () => {
    const thread = convertGmailThread(makeGmailThreadDetail());
    expect(thread.lifecycleState).toBe("new");
  });

  it("computes initial urgency and value scores", () => {
    const thread = convertGmailThread(makeGmailThreadDetail());
    expect(thread.urgencyScore).toBeGreaterThanOrEqual(0);
    expect(thread.urgencyScore).toBeLessThanOrEqual(1);
    expect(thread.valueScore).toBeGreaterThanOrEqual(0);
    expect(thread.valueScore).toBeLessThanOrEqual(1);
  });

  it("orders messages by timestamp", () => {
    const detail = makeGmailThreadDetail({
      messages: [
        makeGmailMessage({ id: "msg-2", internalDate: "2000" }),
        makeGmailMessage({ id: "msg-1", internalDate: "1000" }),
      ],
    });
    const thread = convertGmailThread(detail);
    expect(thread.messages[0].timestamp).toBeLessThan(thread.messages[1].timestamp);
  });

  it("sets firstMessageTimestamp and latestMessageTimestamp correctly", () => {
    const detail = makeGmailThreadDetail({
      messages: [
        makeGmailMessage({ id: "msg-1", internalDate: "1000" }),
        makeGmailMessage({ id: "msg-2", internalDate: "5000" }),
      ],
    });
    const thread = convertGmailThread(detail);
    expect(thread.firstMessageTimestamp).toBe(1000);
    expect(thread.latestMessageTimestamp).toBe(5000);
  });

  it("handles (no subject) when Subject header is missing", () => {
    const detail = makeGmailThreadDetail({
      messages: [
        makeGmailMessage({
          payload: {
            headers: [
              { name: "From", value: "a@b.com" },
              { name: "To", value: "c@d.com" },
            ],
            mimeType: "text/plain",
            body: { data: btoa("hi"), size: 2 },
          },
        }),
      ],
    });
    const thread = convertGmailThread(detail);
    expect(thread.subject).toBe("(no subject)");
  });
});

// --- Progressive initial load ---

describe("performInitialLoad", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    _resetFetchFns();
    vi.useRealTimers();
  });

  it("fetches threads and returns them with history ID", async () => {
    const mockList = vi.fn().mockResolvedValue({
      threads: [
        { id: "t1", snippet: "s1", historyId: "100" },
        { id: "t2", snippet: "s2", historyId: "101" },
      ],
      resultSizeEstimate: 2,
    } as GmailThreadListResponse);

    const mockDetail = vi.fn().mockImplementation((id: string) =>
      Promise.resolve(
        makeGmailThreadDetail({
          id,
          historyId: id === "t1" ? "100" : "200",
          messages: [makeGmailMessage({ threadId: id })],
        }),
      ),
    );

    _setFetchFns(mockList, mockDetail);

    const result = await performInitialLoad(30);

    expect(result.threads).toHaveLength(2);
    expect(result.threads[0].id).toBe("t1");
    expect(result.threads[1].id).toBe("t2");
    // History ID should be the highest one seen
    expect(result.historyId).toBe("200");
  });

  it("calls onThreadLoaded progressively for each thread", async () => {
    const mockList = vi.fn().mockResolvedValue({
      threads: [
        { id: "t1", snippet: "s1", historyId: "100" },
        { id: "t2", snippet: "s2", historyId: "101" },
      ],
      resultSizeEstimate: 2,
    });

    const mockDetail = vi
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(
          makeGmailThreadDetail({ id, messages: [makeGmailMessage({ threadId: id })] }),
        ),
      );

    _setFetchFns(mockList, mockDetail);

    const loaded: string[] = [];
    await performInitialLoad(30, (thread) => loaded.push(thread.id));

    expect(loaded).toContain("t1");
    expect(loaded).toContain("t2");
    expect(loaded).toHaveLength(2);
  });

  it("paginates through multiple pages of thread list", async () => {
    const mockList = vi
      .fn()
      .mockResolvedValueOnce({
        threads: [{ id: "t1", snippet: "s1", historyId: "100" }],
        nextPageToken: "page2",
        resultSizeEstimate: 2,
      })
      .mockResolvedValueOnce({
        threads: [{ id: "t2", snippet: "s2", historyId: "101" }],
        resultSizeEstimate: 2,
      });

    const mockDetail = vi
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(
          makeGmailThreadDetail({ id, messages: [makeGmailMessage({ threadId: id })] }),
        ),
      );

    _setFetchFns(mockList, mockDetail);

    const result = await performInitialLoad(30);

    expect(mockList).toHaveBeenCalledTimes(2);
    expect(result.threads).toHaveLength(2);
  });

  it("passes lookback window as Gmail query", async () => {
    const mockList = vi.fn().mockResolvedValue({
      threads: [],
      resultSizeEstimate: 0,
    });
    const mockDetail = vi.fn();

    _setFetchFns(mockList, mockDetail);

    await performInitialLoad(7);

    expect(mockList).toHaveBeenCalledWith(
      50,
      undefined,
      expect.stringContaining("in:inbox after:"),
    );
  });

  it("returns empty result when no threads exist", async () => {
    const mockList = vi.fn().mockResolvedValue({
      threads: [],
      resultSizeEstimate: 0,
    });
    const mockDetail = vi.fn();

    _setFetchFns(mockList, mockDetail);

    const result = await performInitialLoad(30);

    expect(result.threads).toHaveLength(0);
    expect(result.historyId).toBe("");
  });

  it("fetches thread details with bounded concurrency (max 5 in-flight at once)", async () => {
    // Build a list of 12 threads to ensure the concurrency limit is exercised
    const THREAD_COUNT = 12;
    const threadIds = Array.from({ length: THREAD_COUNT }, (_, i) => `t${i + 1}`);

    const mockList = vi.fn().mockResolvedValue({
      threads: threadIds.map((id) => ({ id, snippet: id, historyId: "100" })),
      resultSizeEstimate: THREAD_COUNT,
    });

    let maxInFlight = 0;
    let currentInFlight = 0;

    // Each detail fetch tracks its own in-flight count and returns after a microtask
    const mockDetail = vi.fn().mockImplementation((id: string) => {
      currentInFlight++;
      if (currentInFlight > maxInFlight) {
        maxInFlight = currentInFlight;
      }
      return Promise.resolve(
        makeGmailThreadDetail({ id, messages: [makeGmailMessage({ threadId: id })] }),
      ).finally(() => {
        currentInFlight--;
      });
    });

    _setFetchFns(mockList, mockDetail);

    await performInitialLoad(30);

    // Must have fetched all threads
    expect(mockDetail).toHaveBeenCalledTimes(THREAD_COUNT);
    // Must never have exceeded the concurrency cap of 5
    expect(maxInFlight).toBeLessThanOrEqual(5);
    // Must have actually parallelised (more than 1 concurrent fetch observed)
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
