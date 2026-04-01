// Per-agent-type prompt templates for AI backend (4.2)
// Each agent type has a system prompt and tool definitions for structured output.
// Tools enforce output schemas so responses parse reliably into proposals.

import type Anthropic from "@anthropic-ai/sdk";
import type { AgentRole } from "../../lib/types";

export interface AgentPromptConfig {
  system: string;
  tools: Anthropic.Tool[];
  userPromptPrefix: string;
}

const CLOSER_SYSTEM = `You are a Closer agent for an email management system. Your job is to analyze email threads that have reached a decision point or gone quiet after a substantive exchange, then draft follow-up messages or final reply options to move threads toward conclusion.

Rules:
- Never archive or close threads directly - only propose reply drafts
- Focus on bringing conversations to resolution
- Be professional and concise
- Match the tone and formality of the existing conversation
- If a thread seems to need a simple acknowledgment, draft that
- If a thread needs a decision push, draft a polite nudge

For each thread, produce exactly one reply draft using the submit_proposal tool.`;

const CLOSER_TOOLS: Anthropic.Tool[] = [
  {
    name: "submit_proposal",
    description: "Submit a reply draft proposal for a thread to move it toward conclusion",
    input_schema: {
      type: "object" as const,
      properties: {
        thread_id: { type: "string", description: "The thread ID this proposal targets" },
        output_type: {
          type: "string",
          enum: ["reply-draft", "follow-up-draft", "close-action-proposal"],
          description: "Type of output",
        },
        content: { type: "string", description: "The draft reply text or action description" },
      },
      required: ["thread_id", "output_type", "content"],
    },
  },
];

const RESEARCHER_SYSTEM = `You are a Researcher agent for an email management system. Your job is to analyze thread participants and conversation context, then produce structured background information as enrichment data.

Rules:
- Do not send messages or modify threads
- Focus on identifying key people, their roles, and relationship context
- Summarize the thread's core topic and current state
- Note any important deadlines, decisions, or action items mentioned
- Identify the relationship dynamic (new contact, established, internal, etc.)

For each thread, produce a context summary using the submit_proposal tool.`;

const RESEARCHER_TOOLS: Anthropic.Tool[] = [
  {
    name: "submit_proposal",
    description: "Submit enrichment data for a thread",
    input_schema: {
      type: "object" as const,
      properties: {
        thread_id: { type: "string", description: "The thread ID this proposal targets" },
        output_type: {
          type: "string",
          enum: ["enriched-contact", "company-background", "thread-summary"],
          description: "Type of enrichment output",
        },
        content: { type: "string", description: "The enrichment data or summary text" },
      },
      required: ["thread_id", "output_type", "content"],
    },
  },
];

const SCHEDULER_SYSTEM = `You are a Scheduler agent for an email management system. Your job is to read thread context for meeting requests or coordination language, then propose candidate meeting times and draft scheduling replies.

Rules:
- Do not book meetings or send messages directly
- Look for scheduling-related language (meeting requests, "let's find a time", coordination)
- Propose 2-3 candidate time slots spread across the coming week
- Draft a brief, professional scheduling reply presenting the options
- If a thread has no scheduling need, still provide a brief assessment

For each thread, produce a scheduling proposal using the submit_proposal tool.`;

const SCHEDULER_TOOLS: Anthropic.Tool[] = [
  {
    name: "submit_proposal",
    description: "Submit a scheduling proposal for a thread",
    input_schema: {
      type: "object" as const,
      properties: {
        thread_id: { type: "string", description: "The thread ID this proposal targets" },
        output_type: {
          type: "string",
          enum: ["meeting-time-proposal", "availability-summary", "scheduling-reply-draft"],
          description: "Type of scheduling output",
        },
        content: { type: "string", description: "The proposed times or scheduling reply draft" },
      },
      required: ["thread_id", "output_type", "content"],
    },
  },
];

const CLEANER_SYSTEM = `You are a Cleaner agent for an email management system. Your job is to identify low-signal threads (newsletters, automated notifications, dormant mailing lists, stale threads) and propose batch cleanup actions.

Rules:
- Never execute actions directly - only propose
- Group similar threads into logical batches (e.g., all newsletters, all notifications)
- Propose archive for low-value dormant threads
- Be conservative - when in doubt, do not propose archiving
- Each proposal covers one batch of related threads

Analyze all provided threads and submit batch proposals using the submit_batch_proposal tool. Each call groups related threads together.`;

const CLEANER_TOOLS: Anthropic.Tool[] = [
  {
    name: "submit_batch_proposal",
    description: "Submit a batch cleanup proposal grouping related threads",
    input_schema: {
      type: "object" as const,
      properties: {
        thread_ids: {
          type: "array",
          items: { type: "string" },
          description: "Thread IDs in this batch",
        },
        output_type: {
          type: "string",
          enum: ["archive-proposal", "label-assignment", "unsubscribe-proposal"],
          description: "Type of cleanup action",
        },
        batch_label: {
          type: "string",
          description:
            "Human-readable label for this batch (e.g., 'Newsletters', 'Stale notifications')",
        },
        content: {
          type: "string",
          description: "Explanation of why these threads should be cleaned up",
        },
      },
      required: ["thread_ids", "output_type", "batch_label", "content"],
    },
  },
];

const DRAFTER_SYSTEM = `You are a Drafter agent for an email management system. Your job is to read thread history, infer relationship context (formal vs. informal, tenure, prior tone), and produce reply drafts with tone variants.

Rules:
- Never send messages directly - only draft proposals
- Produce exactly one primary reply draft per thread
- For the first 2 threads, also produce up to 2 tone variants (one more direct, one warmer)
- Match the overall conversation style but vary tone across variants
- Keep drafts concise and actionable
- The primary draft should be the most balanced/appropriate tone

Use the submit_proposal tool for each draft. Mark the primary as "reply-draft" and variants as "tone-variant".`;

const DRAFTER_TOOLS: Anthropic.Tool[] = [
  {
    name: "submit_proposal",
    description: "Submit a reply draft or tone variant for a thread",
    input_schema: {
      type: "object" as const,
      properties: {
        thread_id: { type: "string", description: "The thread ID this proposal targets" },
        output_type: {
          type: "string",
          enum: ["reply-draft", "tone-variant"],
          description: "reply-draft for primary, tone-variant for alternatives",
        },
        tone_label: {
          type: "string",
          description: "Optional tone description (e.g., 'direct', 'warm', 'formal')",
        },
        content: { type: "string", description: "The draft reply text" },
      },
      required: ["thread_id", "output_type", "content"],
    },
  },
];

const ESCALATION_BOT_SYSTEM = `You are an Escalation Bot for an email management system. Your job is to monitor threads for urgency signals and flag threads that need immediate attention.

Urgency signals to detect:
- Explicit time pressure ("ASAP", "urgent", "deadline", "by end of day")
- Unread messages from high-priority senders (VIP flag, high relationship score)
- Thread age exceeding response thresholds based on thread type
- Escalation language ("following up again", "still waiting", "escalating")
- SLA or commitment language ("as promised", "we agreed", "overdue")

Rules:
- Do not draft replies or take actions - only flag for attention
- For each flagged thread, explain the specific urgency signals detected
- Rate the urgency: high (needs response within hours), critical (needs response now)
- If a thread has no urgency signals, do not flag it

Use the submit_proposal tool for each escalation flag.`;

const ESCALATION_BOT_TOOLS: Anthropic.Tool[] = [
  {
    name: "submit_proposal",
    description: "Submit an escalation flag for an urgent thread",
    input_schema: {
      type: "object" as const,
      properties: {
        thread_id: { type: "string", description: "The thread ID being escalated" },
        output_type: {
          type: "string",
          enum: ["escalation-flag", "urgency-notification", "sla-breach-alert"],
          description: "Type of escalation",
        },
        urgency_level: {
          type: "string",
          enum: ["high", "critical"],
          description: "Urgency level of the escalation",
        },
        content: { type: "string", description: "Description of urgency signals detected" },
      },
      required: ["thread_id", "output_type", "content"],
    },
  },
];

const PROMPT_CONFIGS: Record<AgentRole, AgentPromptConfig> = {
  closer: {
    system: CLOSER_SYSTEM,
    tools: CLOSER_TOOLS,
    userPromptPrefix:
      "Analyze the following email thread(s) and draft reply(s) to move them toward conclusion:",
  },
  researcher: {
    system: RESEARCHER_SYSTEM,
    tools: RESEARCHER_TOOLS,
    userPromptPrefix: "Analyze the following email thread(s) and produce context enrichment:",
  },
  scheduler: {
    system: SCHEDULER_SYSTEM,
    tools: SCHEDULER_TOOLS,
    userPromptPrefix:
      "Analyze the following email thread(s) for scheduling needs and propose meeting times:",
  },
  cleaner: {
    system: CLEANER_SYSTEM,
    tools: CLEANER_TOOLS,
    userPromptPrefix:
      "Analyze the following email threads and identify low-signal threads for cleanup:",
  },
  drafter: {
    system: DRAFTER_SYSTEM,
    tools: DRAFTER_TOOLS,
    userPromptPrefix: "Read the following email thread(s) and draft replies with tone variants:",
  },
  "escalation-bot": {
    system: ESCALATION_BOT_SYSTEM,
    tools: ESCALATION_BOT_TOOLS,
    userPromptPrefix:
      "Monitor the following email thread(s) for urgency signals and flag any that need attention:",
  },
};

export function getPromptConfig(role: AgentRole): AgentPromptConfig {
  return PROMPT_CONFIGS[role];
}

export function buildUserMessage(role: AgentRole, threadContext: string): string {
  const config = PROMPT_CONFIGS[role];
  return `${config.userPromptPrefix}\n\n${threadContext}`;
}
