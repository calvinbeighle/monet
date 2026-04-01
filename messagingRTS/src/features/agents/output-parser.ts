// Output parser for agent AI backend (4.2)
// Parses Claude API responses (tool_use content blocks) into proposal objects.
// Handles both single-thread proposals and batch proposals (Cleaner).

import type Anthropic from "@anthropic-ai/sdk";
import type { AgentRole } from "../../lib/types";

export interface ParsedProposal {
  threadId: string;
  outputType: string;
  content: string;
}

export interface ParseError {
  toolCallIndex: number;
  toolName: string;
  error: string;
}

export interface ParseResult {
  proposals: ParsedProposal[];
  errors: ParseError[];
}

function isToolUseBlock(block: Anthropic.ContentBlock): block is Anthropic.ToolUseBlock {
  return block.type === "tool_use";
}

function parseSubmitProposal(
  input: Record<string, unknown>,
  index: number,
): { proposals: ParsedProposal[]; error?: ParseError } {
  const threadId = input.thread_id;
  const outputType = input.output_type;
  const content = input.content;

  if (typeof threadId !== "string" || !threadId) {
    return {
      proposals: [],
      error: {
        toolCallIndex: index,
        toolName: "submit_proposal",
        error: "Missing or invalid thread_id",
      },
    };
  }
  if (typeof outputType !== "string" || !outputType) {
    return {
      proposals: [],
      error: {
        toolCallIndex: index,
        toolName: "submit_proposal",
        error: "Missing or invalid output_type",
      },
    };
  }
  if (typeof content !== "string" || !content) {
    return {
      proposals: [],
      error: {
        toolCallIndex: index,
        toolName: "submit_proposal",
        error: "Missing or invalid content",
      },
    };
  }

  // Include tone label in content if present (Drafter variants)
  const toneLabel = input.tone_label;
  const finalContent =
    typeof toneLabel === "string" && toneLabel ? `[${toneLabel}] ${content}` : content;

  return { proposals: [{ threadId, outputType, content: finalContent }] };
}

function parseSubmitBatchProposal(
  input: Record<string, unknown>,
  index: number,
): { proposals: ParsedProposal[]; error?: ParseError } {
  const threadIds = input.thread_ids;
  const outputType = input.output_type;
  const content = input.content;
  const batchLabel = input.batch_label;

  if (!Array.isArray(threadIds) || threadIds.length === 0) {
    return {
      proposals: [],
      error: {
        toolCallIndex: index,
        toolName: "submit_batch_proposal",
        error: "Missing or empty thread_ids",
      },
    };
  }
  if (typeof outputType !== "string" || !outputType) {
    return {
      proposals: [],
      error: {
        toolCallIndex: index,
        toolName: "submit_batch_proposal",
        error: "Missing or invalid output_type",
      },
    };
  }
  if (typeof content !== "string" || !content) {
    return {
      proposals: [],
      error: {
        toolCallIndex: index,
        toolName: "submit_batch_proposal",
        error: "Missing or invalid content",
      },
    };
  }

  const label = typeof batchLabel === "string" ? batchLabel : "Batch";
  const batchContent = `[${label}] ${content}`;

  // Per Spec 05: Cleaner batch proposal is atomic - one proposal per thread in the batch,
  // all sharing the same batch content so approve/reject acts on the whole batch
  const proposals: ParsedProposal[] = threadIds
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .map((threadId) => ({
      threadId,
      outputType,
      content: batchContent,
    }));

  return { proposals };
}

export function parseAgentResponse(
  _role: AgentRole,
  contentBlocks: Anthropic.ContentBlock[],
): ParseResult {
  const proposals: ParsedProposal[] = [];
  const errors: ParseError[] = [];

  const toolBlocks = contentBlocks.filter(isToolUseBlock);

  for (let i = 0; i < toolBlocks.length; i++) {
    const block = toolBlocks[i];
    const input = block.input as Record<string, unknown>;

    if (block.name === "submit_proposal") {
      const result = parseSubmitProposal(input, i);
      proposals.push(...result.proposals);
      if (result.error) errors.push(result.error);
    } else if (block.name === "submit_batch_proposal") {
      const result = parseSubmitBatchProposal(input, i);
      proposals.push(...result.proposals);
      if (result.error) errors.push(result.error);
    } else {
      errors.push({
        toolCallIndex: i,
        toolName: block.name,
        error: `Unknown tool: ${block.name}`,
      });
    }
  }

  return { proposals, errors };
}

// Validate that proposals reference valid thread IDs from the deployment
export function filterValidProposals(
  proposals: ParsedProposal[],
  validThreadIds: string[],
): { valid: ParsedProposal[]; dropped: ParsedProposal[] } {
  const validSet = new Set(validThreadIds);
  const valid: ParsedProposal[] = [];
  const dropped: ParsedProposal[] = [];

  for (const p of proposals) {
    if (validSet.has(p.threadId)) {
      valid.push(p);
    } else {
      dropped.push(p);
    }
  }

  return { valid, dropped };
}
