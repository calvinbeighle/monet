// Agent AI backend orchestrator (4.2)
// Replaces work-simulator with real Claude API calls for agent intelligence.
// Falls back to simulated proposals when Claude API is not configured.

import type { AgentRole, Thread } from "../../lib/types";
import { AGENT_DEFINITIONS } from "../../lib/types";
import { isClaudeClientConfigured, sendMessage, ClaudeClientError } from "./claude-client";
import { packageMultipleThreads } from "./context-packager";
import { getPromptConfig, buildUserMessage } from "./prompt-templates";
import { parseAgentResponse, filterValidProposals } from "./output-parser";
import type { ParsedProposal } from "./output-parser";
import { generateSimulatedProposals } from "./work-simulator";

export interface AIBackendResult {
  proposals: ParsedProposal[];
  source: "ai" | "simulated";
  errors: string[];
  tokenUsage?: { inputTokens: number; outputTokens: number };
}

// Process threads for a given agent role using Claude API
// Falls back to simulated proposals if API is not configured or on failure
export async function processAgentWork(
  role: AgentRole,
  threadIds: string[],
  threads: Thread[],
): Promise<AIBackendResult> {
  const def = AGENT_DEFINITIONS[role];
  const assignedIds = threadIds.slice(0, def.capacity);

  // Fall back to simulation if Claude API not configured
  if (!isClaudeClientConfigured()) {
    const simulated = generateSimulatedProposals(role, assignedIds);
    return {
      proposals: simulated,
      source: "simulated",
      errors: [],
    };
  }

  // Resolve thread objects for assigned IDs
  const threadMap = new Map(threads.map((t) => [t.id, t]));
  const assignedThreads = assignedIds
    .map((id) => threadMap.get(id))
    .filter((t): t is Thread => t !== undefined);

  if (assignedThreads.length === 0) {
    return { proposals: [], source: "ai", errors: ["No valid threads found for assigned IDs"] };
  }

  try {
    const promptConfig = getPromptConfig(role);
    const threadContext = packageMultipleThreads(assignedThreads);
    const userMessage = buildUserMessage(role, threadContext);

    const response = await sendMessage({
      system: promptConfig.system,
      messages: [{ role: "user", content: userMessage }],
      tools: promptConfig.tools,
      maxTokens: 4096,
    });

    const parseResult = parseAgentResponse(role, response.content);

    // Filter proposals to only reference valid thread IDs
    const { valid, dropped } = filterValidProposals(parseResult.proposals, assignedIds);

    const errors: string[] = [];
    if (parseResult.errors.length > 0) {
      errors.push(
        ...parseResult.errors.map(
          (e) => `Parse error in tool call ${e.toolCallIndex} (${e.toolName}): ${e.error}`,
        ),
      );
    }
    if (dropped.length > 0) {
      errors.push(`${dropped.length} proposal(s) dropped: referenced invalid thread IDs`);
    }

    return {
      proposals: valid,
      source: "ai",
      errors,
      tokenUsage: response.usage,
    };
  } catch (error: unknown) {
    // On API failure, fall back to simulated proposals
    const errorMessage =
      error instanceof ClaudeClientError
        ? `Claude API error: ${error.message} (status: ${error.statusCode ?? "unknown"}, retryable: ${error.retryable})`
        : error instanceof Error
          ? `Unexpected error: ${error.message}`
          : "Unknown error during AI processing";

    console.error(`[AI Backend] ${role} failed, falling back to simulation:`, errorMessage);

    const simulated = generateSimulatedProposals(role, assignedIds);
    return {
      proposals: simulated,
      source: "simulated",
      errors: [errorMessage],
    };
  }
}

// Initialize the AI backend from environment config
export function getAnthropicApiKey(): string | undefined {
  return import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined;
}
