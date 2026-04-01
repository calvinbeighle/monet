// Thread context packager for agent AI backend (4.2)
// Transforms Thread objects into structured text context for LLM consumption.
// Includes conversation history, participant data, and thread metadata.

import type { Thread, ThreadMessage, ContactEnrichment } from "../../lib/types";

export interface PackagedContext {
  threadId: string;
  summary: string;
  fullContext: string;
}

// Max messages to include per thread to stay within token limits
const MAX_MESSAGES_PER_THREAD = 20;
// Max body length per message
const MAX_BODY_LENGTH = 2000;

function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString();
}

function truncateBody(body: string, maxLength: number = MAX_BODY_LENGTH): string {
  if (body.length <= maxLength) return body;
  return body.slice(0, maxLength) + "... [truncated]";
}

function formatParticipant(contact: ContactEnrichment): string {
  const parts = [contact.displayName || contact.email];
  if (contact.organization) parts.push(`(${contact.organization})`);
  if (contact.vipFlag) parts.push("[VIP]");
  return parts.join(" ");
}

function formatMessage(msg: ThreadMessage, index: number): string {
  const lines: string[] = [];
  lines.push(`--- Message ${index + 1} ---`);
  lines.push(`From: ${msg.sender}`);
  if (msg.recipients.length > 0) lines.push(`To: ${msg.recipients.join(", ")}`);
  if (msg.cc.length > 0) lines.push(`CC: ${msg.cc.join(", ")}`);
  lines.push(`Date: ${formatTimestamp(msg.timestamp)}`);

  // Prefer plain text; fall back to stripped HTML
  const body = msg.bodyPlain || stripHtml(msg.bodyHtml);
  if (body) lines.push(`\n${truncateBody(body)}`);

  return lines.join("\n");
}

function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

export function packageThreadContext(thread: Thread): PackagedContext {
  const lines: string[] = [];

  // Thread metadata header
  lines.push(`Thread: ${thread.subject}`);
  lines.push(`ID: ${thread.id}`);
  lines.push(`Messages: ${thread.messageCount}`);
  lines.push(`First message: ${formatTimestamp(thread.firstMessageTimestamp)}`);
  lines.push(`Latest message: ${formatTimestamp(thread.latestMessageTimestamp)}`);
  lines.push(`Status: ${thread.lifecycleState}`);
  lines.push(`Zone: ${thread.zone}`);
  lines.push(`Thread type: ${thread.threadType}`);
  lines.push(`Risk tier: ${thread.riskTier}`);
  lines.push(`Urgency: ${(thread.urgencyScore * 100).toFixed(0)}%`);
  lines.push(`Value: ${(thread.valueScore * 100).toFixed(0)}%`);
  lines.push(`Unread: ${thread.unread}`);

  if (thread.opportunityState !== "none") {
    lines.push(`Opportunity: ${thread.opportunityState}`);
  }

  if (thread.neglectDuration > 0) {
    const hours = (thread.neglectDuration / (1000 * 60 * 60)).toFixed(1);
    lines.push(`Neglect duration: ${hours}h`);
  }

  // Labels
  if (thread.gmailLabels.length > 0) {
    lines.push(`Labels: ${thread.gmailLabels.join(", ")}`);
  }

  // Participants
  lines.push("");
  lines.push("=== Participants ===");
  for (const p of thread.participants) {
    lines.push(formatParticipant(p));
    if (p.relationshipScore > 0) {
      lines.push(`  Relationship score: ${p.relationshipScore}`);
    }
    if (p.responseHistory.avgResponseTimeMs > 0) {
      const avgHours = (p.responseHistory.avgResponseTimeMs / (1000 * 60 * 60)).toFixed(1);
      lines.push(`  Avg response time: ${avgHours}h`);
    }
  }

  // Messages (most recent first, limited)
  lines.push("");
  lines.push("=== Conversation ===");
  const messages = thread.messages.slice(-MAX_MESSAGES_PER_THREAD);
  if (messages.length < thread.messages.length) {
    lines.push(`[Showing last ${messages.length} of ${thread.messages.length} messages]`);
  }
  for (let i = 0; i < messages.length; i++) {
    lines.push(formatMessage(messages[i], i));
  }

  const fullContext = lines.join("\n");

  // Brief summary for quick reference
  const participantNames = thread.participants
    .map((p) => p.displayName || p.email)
    .slice(0, 5)
    .join(", ");
  const summary = `"${thread.subject}" with ${participantNames} (${thread.messageCount} messages, ${thread.lifecycleState}, ${thread.riskTier} risk)`;

  return {
    threadId: thread.id,
    summary,
    fullContext,
  };
}

export function packageMultipleThreads(threads: Thread[]): string {
  if (threads.length === 0) return "No threads provided.";

  const sections = threads.map((thread, index) => {
    const ctx = packageThreadContext(thread);
    return `\n========== Thread ${index + 1} of ${threads.length} ==========\n${ctx.fullContext}`;
  });

  return sections.join("\n\n");
}

export function packageThreadSummaries(threads: Thread[]): string {
  if (threads.length === 0) return "No threads provided.";

  return threads
    .map((thread, index) => {
      const ctx = packageThreadContext(thread);
      return `${index + 1}. ${ctx.summary}`;
    })
    .join("\n");
}
