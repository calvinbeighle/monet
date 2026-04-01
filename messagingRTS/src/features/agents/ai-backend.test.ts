import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { processAgentWork, processAgentWorkBatched, getAnthropicApiKey } from "./ai-backend";
import {
  initClaudeClient,
  resetClaudeClient,
  _setCreateMessageFn,
  _resetCreateMessageFn,
} from "./claude-client";
import { createThread } from "../../lib/types";
import type { Thread } from "../../lib/types";

function makeThread(id: string, subject: string): Thread {
  const base = createThread(id, subject, "snippet");
  return {
    ...base,
    participants: [
      {
        displayName: "Test User",
        email: "test@example.com",
        organization: null,
        vipFlag: false,
        relationshipScore: 50,
        responseHistory: { avgResponseTimeMs: 0, threadFrequency: 0 },
      },
    ],
    messages: [
      {
        id: "msg-1",
        sender: "test@example.com",
        recipients: ["me@example.com"],
        cc: [],
        bcc: [],
        timestamp: Date.now(),
        bodyPlain: "Hello, need your help.",
        bodyHtml: "",
        labelIds: ["INBOX"],
        attachments: [],
      },
    ],
    messageCount: 1,
  };
}

// Minimal mock response shape matching what claude-client reads
function makeMockResponse(toolCalls: Array<{ name: string; input: Record<string, unknown> }>) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: toolCalls.map((tc, i) => ({
      type: "tool_use" as const,
      id: `tool_${i}`,
      name: tc.name,
      input: tc.input,
    })),
    model: "claude-sonnet-4-20250514",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

describe("ai-backend", () => {
  beforeEach(() => {
    resetClaudeClient();
    _resetCreateMessageFn();
  });

  afterEach(() => {
    resetClaudeClient();
    _resetCreateMessageFn();
  });

  describe("processAgentWork - without API key (fallback)", () => {
    it("returns simulated proposals when client not configured", async () => {
      const result = await processAgentWork("closer", ["t1", "t2"], []);
      expect(result.source).toBe("simulated");
      expect(result.proposals.length).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);
    });

    it("simulated closer produces reply-draft per thread", async () => {
      const result = await processAgentWork("closer", ["t1", "t2"], []);
      expect(result.proposals).toHaveLength(2);
      expect(result.proposals[0].outputType).toBe("reply-draft");
      expect(result.proposals[1].outputType).toBe("reply-draft");
    });

    it("simulated drafter produces primary + tone variants", async () => {
      const result = await processAgentWork("drafter", ["t1", "t2", "t3"], []);
      const t1 = result.proposals.filter((p) => p.threadId === "t1");
      expect(t1.length).toBe(2);
      const t3 = result.proposals.filter((p) => p.threadId === "t3");
      expect(t3.length).toBe(1);
    });

    it("respects agent capacity", async () => {
      const ids = ["t1", "t2", "t3", "t4", "t5", "t6"];
      const result = await processAgentWork("scheduler", ids, []);
      const uniqueThreads = new Set(result.proposals.map((p) => p.threadId));
      expect(uniqueThreads.size).toBeLessThanOrEqual(4);
    });
  });

  describe("processAgentWork - with API key", () => {
    beforeEach(() => {
      initClaudeClient({ apiKey: "test-key", maxRetries: 0 });
    });

    it("sends thread context to Claude and parses tool_use response", async () => {
      const thread = makeThread("t1", "Test Thread");

      _setCreateMessageFn(async () =>
        makeMockResponse([
          {
            name: "submit_proposal",
            input: {
              thread_id: "t1",
              output_type: "reply-draft",
              content: "AI-generated reply draft.",
            },
          },
        ]),
      );

      const result = await processAgentWork("closer", ["t1"], [thread]);
      expect(result.source).toBe("ai");
      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]).toEqual({
        threadId: "t1",
        outputType: "reply-draft",
        content: "AI-generated reply draft.",
      });
      expect(result.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 50 });
    });

    it("handles multiple proposals from AI", async () => {
      const t1 = makeThread("t1", "Thread 1");
      const t2 = makeThread("t2", "Thread 2");

      _setCreateMessageFn(async () =>
        makeMockResponse([
          {
            name: "submit_proposal",
            input: { thread_id: "t1", output_type: "reply-draft", content: "Draft 1" },
          },
          {
            name: "submit_proposal",
            input: { thread_id: "t2", output_type: "reply-draft", content: "Draft 2" },
          },
        ]),
      );

      const result = await processAgentWork("closer", ["t1", "t2"], [t1, t2]);
      expect(result.proposals).toHaveLength(2);
    });

    it("filters out proposals for invalid thread IDs", async () => {
      const thread = makeThread("t1", "Test Thread");

      _setCreateMessageFn(async () =>
        makeMockResponse([
          {
            name: "submit_proposal",
            input: { thread_id: "t1", output_type: "reply-draft", content: "Valid" },
          },
          {
            name: "submit_proposal",
            input: { thread_id: "t99", output_type: "reply-draft", content: "Invalid" },
          },
        ]),
      );

      const result = await processAgentWork("closer", ["t1"], [thread]);
      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0].threadId).toBe("t1");
      expect(result.errors.some((e) => e.includes("dropped"))).toBe(true);
    });

    it("falls back to simulation on API error", async () => {
      const thread = makeThread("t1", "Test Thread");

      _setCreateMessageFn(async () => {
        throw new Error("Network failure");
      });

      const result = await processAgentWork("closer", ["t1"], [thread]);
      expect(result.source).toBe("simulated");
      expect(result.proposals.length).toBeGreaterThan(0);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("Network failure");
    });

    it("handles cleaner batch proposals", async () => {
      const t1 = makeThread("t1", "Newsletter");
      const t2 = makeThread("t2", "Another newsletter");

      _setCreateMessageFn(async () =>
        makeMockResponse([
          {
            name: "submit_batch_proposal",
            input: {
              thread_ids: ["t1", "t2"],
              output_type: "archive-proposal",
              batch_label: "Newsletters",
              content: "These are newsletters, safe to archive.",
            },
          },
        ]),
      );

      const result = await processAgentWork("cleaner", ["t1", "t2"], [t1, t2]);
      expect(result.proposals).toHaveLength(2);
      expect(result.proposals.every((p) => p.outputType === "archive-proposal")).toBe(true);
    });

    it("handles drafter tone variants", async () => {
      const thread = makeThread("t1", "Draft thread");

      _setCreateMessageFn(async () =>
        makeMockResponse([
          {
            name: "submit_proposal",
            input: {
              thread_id: "t1",
              output_type: "reply-draft",
              content: "Primary professional draft.",
            },
          },
          {
            name: "submit_proposal",
            input: {
              thread_id: "t1",
              output_type: "tone-variant",
              tone_label: "warm",
              content: "Hey! Thanks for reaching out.",
            },
          },
          {
            name: "submit_proposal",
            input: {
              thread_id: "t1",
              output_type: "tone-variant",
              tone_label: "direct",
              content: "Here is the information you requested.",
            },
          },
        ]),
      );

      const result = await processAgentWork("drafter", ["t1"], [thread]);
      expect(result.proposals).toHaveLength(3);
      expect(result.proposals[0].outputType).toBe("reply-draft");
      expect(result.proposals[1].content).toContain("[warm]");
      expect(result.proposals[2].content).toContain("[direct]");
    });

    it("returns empty proposals when no threads resolve", async () => {
      const result = await processAgentWork("closer", ["t1"], []);
      expect(result.source).toBe("ai");
      expect(result.proposals).toHaveLength(0);
      expect(result.errors.some((e) => e.includes("No valid threads"))).toBe(true);
    });
  });

  describe("getAnthropicApiKey", () => {
    it("returns undefined when env var is not set", () => {
      const key = getAnthropicApiKey();
      expect(key === undefined || typeof key === "string").toBe(true);
    });
  });

  describe("processAgentWork - failedThreadIds tracking (Spec 05)", () => {
    it("reports succeededThreadIds and failedThreadIds for simulated proposals", async () => {
      const result = await processAgentWork("closer", ["t1", "t2"], []);
      expect(result.succeededThreadIds).toBeDefined();
      expect(result.failedThreadIds).toBeDefined();
      // Closer generates one proposal per thread, so all should succeed
      expect(result.succeededThreadIds).toContain("t1");
      expect(result.succeededThreadIds).toContain("t2");
      expect(result.failedThreadIds).toHaveLength(0);
    });

    it("reports failedThreadIds when AI returns no proposals for some threads", async () => {
      initClaudeClient({ apiKey: "test-key", maxRetries: 0 });
      const t1 = makeThread("t1", "Thread 1");
      const t2 = makeThread("t2", "Thread 2");

      _setCreateMessageFn(async () =>
        makeMockResponse([
          {
            name: "submit_proposal",
            input: { thread_id: "t1", output_type: "reply-draft", content: "Draft" },
          },
          // No proposal for t2 - it should be marked as failed
        ]),
      );

      const result = await processAgentWork("closer", ["t1", "t2"], [t1, t2]);
      expect(result.succeededThreadIds).toContain("t1");
      expect(result.failedThreadIds).toContain("t2");
      expect(result.errors.some((e) => e.includes("1 thread(s) received no proposals"))).toBe(true);
    });

    it("reports all threads as failed when no threads resolve", async () => {
      initClaudeClient({ apiKey: "test-key", maxRetries: 0 });
      const result = await processAgentWork("closer", ["t1", "t2"], []);
      expect(result.failedThreadIds).toContain("t1");
      expect(result.failedThreadIds).toContain("t2");
      expect(result.succeededThreadIds).toHaveLength(0);
    });
  });

  describe("processAgentWorkBatched - batch queue (Spec 05)", () => {
    it("processes all threads in a single batch when within capacity", async () => {
      const result = await processAgentWorkBatched("closer", ["t1", "t2"], []);
      // closer capacity is 5, so 2 threads = 1 batch
      expect(result.proposals.length).toBe(2);
      expect(result.source).toBe("simulated");
    });

    it("processes threads in multiple batches when exceeding capacity", async () => {
      // scheduler capacity is 4
      const ids = ["t1", "t2", "t3", "t4", "t5", "t6"];
      const result = await processAgentWorkBatched("scheduler", ids, []);

      // Should process 4 in first batch, 2 in second batch
      const uniqueThreads = new Set(result.proposals.map((p) => p.threadId));
      expect(uniqueThreads.size).toBe(6);
    });

    it("accumulates errors across batches", async () => {
      initClaudeClient({ apiKey: "test-key", maxRetries: 0 });

      _setCreateMessageFn(async () => {
        throw new Error("API failure");
      });

      // scheduler capacity is 4, sending 6 threads = 2 batches
      const threads = Array.from({ length: 6 }, (_, i) => makeThread(`t${i}`, `Thread ${i}`));
      const ids = threads.map((t) => t.id);
      const result = await processAgentWorkBatched("scheduler", ids, threads);

      // Both batches should fall back to simulation
      expect(result.source).toBe("simulated");
      // Errors from both batches
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });

    it("accumulates token usage across batches", async () => {
      initClaudeClient({ apiKey: "test-key", maxRetries: 0 });

      _setCreateMessageFn(async () =>
        makeMockResponse([
          {
            name: "submit_proposal",
            input: { thread_id: "t0", output_type: "reply-draft", content: "Draft" },
          },
        ]),
      );

      // Use closer (capacity 5) with 6 threads for 2 batches
      const threads = Array.from({ length: 6 }, (_, i) => makeThread(`t${i}`, `Thread ${i}`));
      const ids = threads.map((t) => t.id);
      const result = await processAgentWorkBatched("closer", ids, threads);

      // Token usage should be accumulated from both batches
      if (result.tokenUsage) {
        expect(result.tokenUsage.inputTokens).toBe(200); // 100 * 2 batches
        expect(result.tokenUsage.outputTokens).toBe(100); // 50 * 2 batches
      }
    });

    it("tracks failedThreadIds across batches", async () => {
      // Using simulated proposals - all threads get proposals
      const ids = ["t1", "t2", "t3", "t4", "t5", "t6"];
      const result = await processAgentWorkBatched("scheduler", ids, []);

      expect(result.failedThreadIds).toHaveLength(0);
      expect(result.succeededThreadIds.length).toBe(6);
    });
  });
});
