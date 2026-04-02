// Agent manager per Spec 05
// Manages agent instance lifecycle: idle -> deployed -> working -> completed/failed -> cooldown -> idle
// Enforces capacity limits, cooldown timers, and proposal approval gates

import type {
  AgentRole,
  AgentStatus,
  AgentInstance,
  AgentProposal,
  ProposalStatus,
} from "../../lib/types";
import type { Thread } from "../../lib/types";
import { AGENT_DEFINITIONS } from "../../lib/types";
import { flagOpportunity } from "../game-mechanics/opportunity-system";

let instanceCounter = 0;
let proposalCounter = 0;

function generateInstanceId(): string {
  return `agent-${++instanceCounter}`;
}

function generateProposalId(): string {
  return `proposal-${++proposalCounter}`;
}

// Create a new idle agent instance
export function createAgentInstance(role: AgentRole): AgentInstance {
  return {
    id: generateInstanceId(),
    role,
    clusterId: null,
    threadIds: [],
    status: "idle",
    createdAt: Date.now(),
    deployedAt: null,
    startedAt: null,
    completedAt: null,
    cooldownExpiry: null,
    proposals: [],
    failedThreadIds: [],
    approvedCount: 0,
    rejectedCount: 0,
  };
}

// Valid status transitions per Spec 05
const VALID_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  idle: ["deployed"],
  deployed: ["working"],
  working: ["completed", "failed"],
  completed: ["cooldown"],
  failed: ["cooldown"],
  cooldown: ["idle"],
};

export function isValidAgentTransition(from: AgentStatus, to: AgentStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

// Batch queue per Spec 05: threads beyond capacity are queued and processed
// after the current batch completes
const batchQueues = new Map<string, string[]>();

export function getBatchQueue(agentId: string): string[] {
  return batchQueues.get(agentId) ?? [];
}

export function clearBatchQueue(agentId: string): void {
  batchQueues.delete(agentId);
}

export function clearAllBatchQueues(): void {
  batchQueues.clear();
}

// Deploy agent to a cluster
export function deployAgent(
  agent: AgentInstance,
  clusterId: string,
  threadIds: string[],
  now: number = Date.now(),
): AgentInstance {
  if (agent.status !== "idle") {
    throw new Error(`Cannot deploy agent in status ${agent.status}`);
  }

  const def = AGENT_DEFINITIONS[agent.role];
  // Capacity enforcement per Spec 05: take up to capacity, queue the rest
  const assignedThreads = threadIds.slice(0, def.capacity);
  const overflow = threadIds.slice(def.capacity);

  if (overflow.length > 0) {
    batchQueues.set(agent.id, overflow);
  } else {
    batchQueues.delete(agent.id);
  }

  return {
    ...agent,
    status: "deployed",
    clusterId,
    threadIds: assignedThreads,
    deployedAt: now,
  };
}

// Check if there are queued threads to process in the next batch
export function hasQueuedThreads(agent: AgentInstance): boolean {
  return (batchQueues.get(agent.id)?.length ?? 0) > 0;
}

// Dequeue the next batch of threads for processing
// Returns null if no more queued threads
export function dequeueNextBatch(agent: AgentInstance): string[] | null {
  const queue = batchQueues.get(agent.id);
  if (!queue || queue.length === 0) return null;

  const def = AGENT_DEFINITIONS[agent.role];
  const nextBatch = queue.slice(0, def.capacity);
  const remaining = queue.slice(def.capacity);

  if (remaining.length > 0) {
    batchQueues.set(agent.id, remaining);
  } else {
    batchQueues.delete(agent.id);
  }

  return nextBatch;
}

// Start working (agent arrives at cluster)
export function startWorking(agent: AgentInstance, now: number = Date.now()): AgentInstance {
  if (agent.status !== "deployed") {
    throw new Error(`Cannot start working from status ${agent.status}`);
  }

  return {
    ...agent,
    status: "working",
    startedAt: now,
  };
}

// Complete agent work
export function completeAgent(
  agent: AgentInstance,
  proposals: Array<{ threadId: string; outputType: string; content: string }>,
  failedThreadIds: string[] = [],
  now: number = Date.now(),
): AgentInstance {
  if (agent.status !== "working") {
    throw new Error(`Cannot complete from status ${agent.status}`);
  }

  const agentProposals: AgentProposal[] = proposals.map((p) => ({
    id: generateProposalId(),
    agentInstanceId: agent.id,
    threadId: p.threadId,
    outputType: p.outputType,
    content: p.content,
    status: "pending" as ProposalStatus,
    createdAt: now,
    resolvedAt: null,
  }));

  return {
    ...agent,
    status: "completed",
    completedAt: now,
    proposals: agentProposals,
    failedThreadIds,
  };
}

// Mark agent as failed
export function failAgent(agent: AgentInstance, now: number = Date.now()): AgentInstance {
  if (agent.status !== "working") {
    throw new Error(`Cannot fail from status ${agent.status}`);
  }

  return {
    ...agent,
    status: "failed",
    completedAt: now,
  };
}

// Start cooldown after completion/failure
export function startCooldown(agent: AgentInstance, now: number = Date.now()): AgentInstance {
  if (agent.status !== "completed" && agent.status !== "failed") {
    throw new Error(`Cannot start cooldown from status ${agent.status}`);
  }

  const def = AGENT_DEFINITIONS[agent.role];
  return {
    ...agent,
    status: "cooldown",
    cooldownExpiry: now + def.cooldownMs,
  };
}

// Check if cooldown has expired and transition to idle
export function checkCooldown(agent: AgentInstance, now: number = Date.now()): AgentInstance {
  if (agent.status !== "cooldown") return agent;
  if (agent.cooldownExpiry === null) return agent;

  if (now >= agent.cooldownExpiry) {
    return {
      ...agent,
      status: "idle",
      clusterId: null,
      threadIds: [],
      cooldownExpiry: null,
    };
  }

  return agent;
}

// Recall agent (cancel in-progress deployment)
// Per Spec 06: partial output discarded, agent returns to idle (no cooldown)
export function recallAgent(agent: AgentInstance): AgentInstance {
  if (agent.status !== "deployed" && agent.status !== "working") {
    throw new Error(`Cannot recall agent in status ${agent.status}`);
  }

  return {
    ...agent,
    status: "idle",
    clusterId: null,
    threadIds: [],
    proposals: [], // partial output discarded
    deployedAt: null,
    startedAt: null,
    completedAt: null,
    cooldownExpiry: null,
  };
}

// Resolve a proposal (approve or reject)
// Per Spec 05: "No agent action is taken until the user explicitly approves"
export function resolveProposal(
  agent: AgentInstance,
  proposalId: string,
  resolution: "approved" | "rejected",
  now: number = Date.now(),
): AgentInstance {
  const proposalIndex = agent.proposals.findIndex((p) => p.id === proposalId);
  if (proposalIndex === -1) {
    throw new Error(`Proposal ${proposalId} not found`);
  }

  const proposal = agent.proposals[proposalIndex];
  if (proposal.status !== "pending") {
    throw new Error(`Proposal ${proposalId} already resolved`);
  }

  const updatedProposals = [...agent.proposals];
  updatedProposals[proposalIndex] = {
    ...proposal,
    status: resolution,
    resolvedAt: now,
  };

  return {
    ...agent,
    proposals: updatedProposals,
    approvedCount: resolution === "approved" ? agent.approvedCount + 1 : agent.approvedCount,
    rejectedCount: resolution === "rejected" ? agent.rejectedCount + 1 : agent.rejectedCount,
  };
}

// Get remaining cooldown time in ms
export function getCooldownRemaining(agent: AgentInstance, now: number = Date.now()): number {
  if (agent.status !== "cooldown" || agent.cooldownExpiry === null) return 0;
  return Math.max(0, agent.cooldownExpiry - now);
}

// Check if agent can be deployed
export function canDeploy(agent: AgentInstance): boolean {
  return agent.status === "idle";
}

// Reset counters for testing
export function resetCounters(): void {
  instanceCounter = 0;
  proposalCounter = 0;
}

// Per Spec 07: "Opportunity flag set by agent layer"
// Researcher and Closer agents may identify opportunity threads
export function evaluateOpportunityFlags(
  agent: AgentInstance,
  threads: Map<string, Thread>,
): Thread[] {
  if (agent.status !== "completed") return [];

  const flaggedThreads: Thread[] = [];
  for (const proposal of agent.proposals) {
    if (proposal.status !== "pending") continue;

    const thread = threads.get(proposal.threadId);
    if (!thread) continue;
    if (thread.opportunityState !== "none") continue; // already flagged

    // Researcher: enrichment data suggests high value
    // Closer: engagement opportunity detected
    // Escalation Bot: urgency signals (but these are escalations, not opportunities)
    if (
      (agent.role === "researcher" && proposal.outputType === "thread-context-summary") ||
      (agent.role === "closer" &&
        (proposal.outputType === "reply-draft" || proposal.outputType === "follow-up-draft"))
    ) {
      flaggedThreads.push(flagOpportunity(thread));
    }
  }

  return flaggedThreads;
}
