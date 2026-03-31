// Simulated agent work output per Spec 05
// Generates placeholder proposals based on agent type and assigned threads.
// This module will be replaced by the real Claude API backend (4.2).

import type { AgentRole } from "../../lib/types";
import { AGENT_DEFINITIONS } from "../../lib/types";

interface SimulatedProposal {
  threadId: string;
  outputType: string;
  content: string;
}

// Per Spec 05: each agent type produces specific output types
const OUTPUT_GENERATORS: Record<
  AgentRole,
  (threadId: string, index: number) => SimulatedProposal[]
> = {
  closer: (threadId) => [
    {
      threadId,
      outputType: "reply-draft",
      content: `[Simulated] Suggested close reply for thread ${threadId}. This draft aims to bring the conversation to resolution.`,
    },
  ],
  researcher: (threadId) => [
    {
      threadId,
      outputType: "thread-summary",
      content: `[Simulated] Context summary for thread ${threadId}. Key participants, timeline, and discussion points analyzed.`,
    },
  ],
  scheduler: (threadId) => [
    {
      threadId,
      outputType: "meeting-time-proposal",
      content: `[Simulated] Proposed meeting times for thread ${threadId}: Mon 10am, Tue 2pm, Wed 11am.`,
    },
  ],
  cleaner: (threadId) => [
    {
      threadId,
      outputType: "archive-proposal",
      content: `[Simulated] Recommend archiving thread ${threadId} - no recent activity, low value.`,
    },
  ],
  drafter: (threadId, index) => {
    const proposals: SimulatedProposal[] = [
      {
        threadId,
        outputType: "reply-draft",
        content: `[Simulated] Primary reply draft for thread ${threadId}. Professional tone.`,
      },
    ];
    // Per Spec 05: Drafter produces 1 primary + up to 2 tone variants
    if (index < 2) {
      proposals.push({
        threadId,
        outputType: "tone-variant",
        content: `[Simulated] Casual tone variant for thread ${threadId}.`,
      });
    }
    return proposals;
  },
  "escalation-bot": (threadId) => [
    {
      threadId,
      outputType: "escalation-flag",
      content: `[Simulated] Escalation flag for thread ${threadId} - urgency signals detected.`,
    },
  ],
};

export function generateSimulatedProposals(
  role: AgentRole,
  threadIds: string[],
): SimulatedProposal[] {
  const def = AGENT_DEFINITIONS[role];
  const assignedThreads = threadIds.slice(0, def.capacity);
  const generator = OUTPUT_GENERATORS[role];

  return assignedThreads.flatMap((threadId, index) => generator(threadId, index));
}

// Simulated work duration in ms (shorter than real API calls for testing)
export const SIMULATED_WORK_DURATION_MS = 3000;
