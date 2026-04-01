import { describe, it, expect } from "vitest";
import { parseAgentResponse, filterValidProposals } from "./output-parser";
import type Anthropic from "@anthropic-ai/sdk";

// Cast helpers to bypass strict SDK type requirements in tests
function makeToolUseBlock(name: string, input: Record<string, unknown>): Anthropic.ContentBlock {
  return {
    type: "tool_use",
    id: `tool_${Math.random().toString(36).slice(2)}`,
    name,
    input,
  } as unknown as Anthropic.ContentBlock;
}

function makeTextBlock(text: string): Anthropic.ContentBlock {
  return { type: "text", text } as unknown as Anthropic.ContentBlock;
}

describe("output-parser", () => {
  describe("parseAgentResponse", () => {
    it("parses submit_proposal tool calls into proposals", () => {
      const blocks: Anthropic.ContentBlock[] = [
        makeToolUseBlock("submit_proposal", {
          thread_id: "t1",
          output_type: "reply-draft",
          content: "Here is a draft reply.",
        }),
      ];

      const result = parseAgentResponse("closer", blocks);
      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]).toEqual({
        threadId: "t1",
        outputType: "reply-draft",
        content: "Here is a draft reply.",
      });
      expect(result.errors).toHaveLength(0);
    });

    it("parses multiple tool calls", () => {
      const blocks: Anthropic.ContentBlock[] = [
        makeToolUseBlock("submit_proposal", {
          thread_id: "t1",
          output_type: "reply-draft",
          content: "Draft 1",
        }),
        makeToolUseBlock("submit_proposal", {
          thread_id: "t2",
          output_type: "reply-draft",
          content: "Draft 2",
        }),
      ];

      const result = parseAgentResponse("drafter", blocks);
      expect(result.proposals).toHaveLength(2);
    });

    it("ignores text blocks", () => {
      const blocks: Anthropic.ContentBlock[] = [
        makeTextBlock("I will analyze the threads."),
        makeToolUseBlock("submit_proposal", {
          thread_id: "t1",
          output_type: "reply-draft",
          content: "Draft",
        }),
      ];

      const result = parseAgentResponse("closer", blocks);
      expect(result.proposals).toHaveLength(1);
    });

    it("includes tone label in drafter content", () => {
      const blocks: Anthropic.ContentBlock[] = [
        makeToolUseBlock("submit_proposal", {
          thread_id: "t1",
          output_type: "tone-variant",
          tone_label: "warm",
          content: "Hey! Great to hear from you.",
        }),
      ];

      const result = parseAgentResponse("drafter", blocks);
      expect(result.proposals[0].content).toBe("[warm] Hey! Great to hear from you.");
    });

    it("handles submit_batch_proposal for cleaner", () => {
      const blocks: Anthropic.ContentBlock[] = [
        makeToolUseBlock("submit_batch_proposal", {
          thread_ids: ["t1", "t2", "t3"],
          output_type: "archive-proposal",
          batch_label: "Newsletters",
          content: "These are all newsletter subscriptions.",
        }),
      ];

      const result = parseAgentResponse("cleaner", blocks);
      expect(result.proposals).toHaveLength(3);
      expect(result.proposals[0].threadId).toBe("t1");
      expect(result.proposals[1].threadId).toBe("t2");
      expect(result.proposals[2].threadId).toBe("t3");
      for (const p of result.proposals) {
        expect(p.outputType).toBe("archive-proposal");
        expect(p.content).toContain("[Newsletters]");
      }
    });

    it("records error for missing thread_id", () => {
      const blocks: Anthropic.ContentBlock[] = [
        makeToolUseBlock("submit_proposal", {
          output_type: "reply-draft",
          content: "Draft",
        }),
      ];

      const result = parseAgentResponse("closer", blocks);
      expect(result.proposals).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain("thread_id");
    });

    it("records error for missing content", () => {
      const blocks: Anthropic.ContentBlock[] = [
        makeToolUseBlock("submit_proposal", {
          thread_id: "t1",
          output_type: "reply-draft",
        }),
      ];

      const result = parseAgentResponse("closer", blocks);
      expect(result.proposals).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain("content");
    });

    it("records error for missing output_type", () => {
      const blocks: Anthropic.ContentBlock[] = [
        makeToolUseBlock("submit_proposal", {
          thread_id: "t1",
          content: "Draft",
        }),
      ];

      const result = parseAgentResponse("closer", blocks);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain("output_type");
    });

    it("records error for empty batch thread_ids", () => {
      const blocks: Anthropic.ContentBlock[] = [
        makeToolUseBlock("submit_batch_proposal", {
          thread_ids: [],
          output_type: "archive-proposal",
          batch_label: "Empty",
          content: "Nothing here",
        }),
      ];

      const result = parseAgentResponse("cleaner", blocks);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain("thread_ids");
    });

    it("records error for unknown tool name", () => {
      const blocks: Anthropic.ContentBlock[] = [makeToolUseBlock("unknown_tool", { data: "test" })];

      const result = parseAgentResponse("closer", blocks);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain("Unknown tool");
    });

    it("returns empty proposals for empty content blocks", () => {
      const result = parseAgentResponse("closer", []);
      expect(result.proposals).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it("filters invalid entries from batch thread_ids", () => {
      const blocks: Anthropic.ContentBlock[] = [
        makeToolUseBlock("submit_batch_proposal", {
          thread_ids: ["t1", "", "t3"],
          output_type: "archive-proposal",
          batch_label: "Mixed",
          content: "Clean up",
        }),
      ];

      const result = parseAgentResponse("cleaner", blocks);
      expect(result.proposals).toHaveLength(2);
      expect(result.proposals.map((p) => p.threadId)).toEqual(["t1", "t3"]);
    });
  });

  describe("filterValidProposals", () => {
    it("keeps proposals with valid thread IDs", () => {
      const proposals = [
        { threadId: "t1", outputType: "reply-draft", content: "Draft 1" },
        { threadId: "t2", outputType: "reply-draft", content: "Draft 2" },
      ];

      const { valid, dropped } = filterValidProposals(proposals, ["t1", "t2", "t3"]);
      expect(valid).toHaveLength(2);
      expect(dropped).toHaveLength(0);
    });

    it("drops proposals with invalid thread IDs", () => {
      const proposals = [
        { threadId: "t1", outputType: "reply-draft", content: "Draft 1" },
        { threadId: "t99", outputType: "reply-draft", content: "Bad" },
      ];

      const { valid, dropped } = filterValidProposals(proposals, ["t1", "t2"]);
      expect(valid).toHaveLength(1);
      expect(valid[0].threadId).toBe("t1");
      expect(dropped).toHaveLength(1);
      expect(dropped[0].threadId).toBe("t99");
    });

    it("handles empty proposals", () => {
      const { valid, dropped } = filterValidProposals([], ["t1"]);
      expect(valid).toHaveLength(0);
      expect(dropped).toHaveLength(0);
    });
  });
});
