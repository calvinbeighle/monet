// Agent unit definitions per Spec 05
// Six agent types with fixed definitions, capacity, cooldown, and output types

export type AgentRole =
  | "closer"
  | "researcher"
  | "scheduler"
  | "cleaner"
  | "drafter"
  | "escalation-bot";

export type AgentStatus = "idle" | "deployed" | "working" | "completed" | "failed" | "cooldown";

export type ProposalStatus = "pending" | "approved" | "rejected";

export interface AgentDefinition {
  role: AgentRole;
  name: string;
  color: number; // hex for PixiJS
  capacity: number; // max threads per deployment
  cooldownMs: number;
  description: string;
  outputTypes: string[];
}

export const AGENT_DEFINITIONS: Record<AgentRole, AgentDefinition> = {
  closer: {
    role: "closer",
    name: "Closer",
    color: 0xffbf00,
    capacity: 5,
    cooldownMs: 10 * 60 * 1000,
    description: "Drafts replies and follow-ups to close conversations",
    outputTypes: ["reply-draft", "follow-up-draft", "close-action-proposal"],
  },
  researcher: {
    role: "researcher",
    name: "Researcher",
    color: 0x008080,
    capacity: 8,
    cooldownMs: 5 * 60 * 1000,
    description: "Enriches contact data and provides thread context",
    outputTypes: ["enriched-contact", "company-background", "thread-summary"],
  },
  scheduler: {
    role: "scheduler",
    name: "Scheduler",
    color: 0x4169e1,
    capacity: 4,
    cooldownMs: 8 * 60 * 1000,
    description: "Proposes meeting times and drafts scheduling replies",
    outputTypes: ["meeting-time-proposal", "availability-summary", "scheduling-reply-draft"],
  },
  cleaner: {
    role: "cleaner",
    name: "Cleaner",
    color: 0x808080,
    capacity: 20,
    cooldownMs: 15 * 60 * 1000,
    description: "Proposes archive, label, and unsubscribe actions in bulk",
    outputTypes: ["archive-proposal", "label-assignment", "unsubscribe-proposal", "bulk-batch"],
  },
  drafter: {
    role: "drafter",
    name: "Drafter",
    color: 0x228b22,
    capacity: 6,
    cooldownMs: 5 * 60 * 1000,
    description: "Produces reply drafts with tone variants",
    outputTypes: ["reply-draft", "tone-variant"],
  },
  "escalation-bot": {
    role: "escalation-bot",
    name: "Escalation Bot",
    color: 0xdc143c,
    capacity: 15,
    cooldownMs: 2 * 60 * 1000,
    description: "Detects urgency signals and flags escalations",
    outputTypes: ["escalation-flag", "urgency-notification", "sla-breach-alert"],
  },
};

export interface AgentProposal {
  id: string;
  agentInstanceId: string;
  threadId: string;
  outputType: string;
  content: string;
  status: ProposalStatus;
  createdAt: number;
  resolvedAt: number | null;
}

export interface AgentInstance {
  id: string;
  role: AgentRole;
  clusterId: string | null;
  threadIds: string[];
  status: AgentStatus;
  createdAt: number;
  deployedAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  cooldownExpiry: number | null;
  proposals: AgentProposal[];
  approvedCount: number;
  rejectedCount: number;
}
