import { describe, it, expect, beforeEach } from "vitest";
import {
  initClaudeClient,
  isClaudeClientConfigured,
  resetClaudeClient,
  sendMessage,
  ClaudeClientError,
  _setCreateMessageFn,
  _resetCreateMessageFn,
} from "./claude-client";

// Minimal mock response shape - only fields we actually read
function makeMockMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "Hello back" }],
    model: "claude-sonnet-4-20250514",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...overrides,
  };
}

describe("claude-client", () => {
  beforeEach(() => {
    resetClaudeClient();
    _resetCreateMessageFn();
  });

  describe("initialization", () => {
    it("is not configured by default", () => {
      expect(isClaudeClientConfigured()).toBe(false);
    });

    it("is configured after init", () => {
      initClaudeClient({ apiKey: "test-key" });
      expect(isClaudeClientConfigured()).toBe(true);
    });

    it("resets to unconfigured", () => {
      initClaudeClient({ apiKey: "test-key" });
      resetClaudeClient();
      expect(isClaudeClientConfigured()).toBe(false);
    });
  });

  describe("sendMessage", () => {
    it("throws if client not initialized", async () => {
      await expect(
        sendMessage({
          system: "test",
          messages: [{ role: "user", content: "hello" }],
        }),
      ).rejects.toThrow("Claude client not initialized");
    });

    it("sends message and returns parsed response", async () => {
      initClaudeClient({ apiKey: "test-key" });
      _setCreateMessageFn(async () => makeMockMessage());

      const result = await sendMessage({
        system: "You are helpful",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(result.content).toEqual([{ type: "text", text: "Hello back" }]);
      expect(result.stopReason).toBe("end_turn");
      expect(result.usage.inputTokens).toBe(10);
      expect(result.usage.outputTokens).toBe(5);
    });

    it("returns tool_use content blocks", async () => {
      initClaudeClient({ apiKey: "test-key" });
      _setCreateMessageFn(async () =>
        makeMockMessage({
          content: [
            {
              type: "tool_use",
              id: "tool_1",
              name: "submit_proposal",
              input: { thread_id: "t1", output_type: "reply-draft", content: "Draft" },
            },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      );

      const result = await sendMessage({
        system: "Agent",
        messages: [{ role: "user", content: "Process threads" }],
        tools: [
          {
            name: "submit_proposal",
            description: "Submit proposal",
            input_schema: { type: "object" as const, properties: {} },
          },
        ],
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("tool_use");
      expect(result.stopReason).toBe("tool_use");
    });

    it("respects concurrency limit", async () => {
      initClaudeClient({ apiKey: "test-key", maxConcurrent: 1 });

      let concurrentCalls = 0;
      let maxConcurrent = 0;

      _setCreateMessageFn(async () => {
        concurrentCalls++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
        await new Promise((r) => setTimeout(r, 50));
        concurrentCalls--;
        return makeMockMessage({ usage: { input_tokens: 1, output_tokens: 1 } });
      });

      await Promise.all([
        sendMessage({ system: "s", messages: [{ role: "user", content: "1" }] }),
        sendMessage({ system: "s", messages: [{ role: "user", content: "2" }] }),
        sendMessage({ system: "s", messages: [{ role: "user", content: "3" }] }),
      ]);

      expect(maxConcurrent).toBe(1);
    });
  });

  describe("ClaudeClientError", () => {
    it("carries status code and retryable flag", () => {
      const err = new ClaudeClientError("Rate limited", 429, true);
      expect(err.message).toBe("Rate limited");
      expect(err.statusCode).toBe(429);
      expect(err.retryable).toBe(true);
      expect(err.name).toBe("ClaudeClientError");
    });

    it("defaults retryable to false", () => {
      const err = new ClaudeClientError("Bad request", 400);
      expect(err.retryable).toBe(false);
    });
  });
});
