// Urgency and value scoring per Spec 03
// These scores drive thread positioning, zone assignment, and game mechanics

import type { Thread } from "../types";

// Deadline detection phrases per Spec 03:
// "Presence of explicit deadlines in message content - detected deadline phrases raise urgency"
const DEADLINE_PATTERNS = [
  /\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bby\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}/i,
  /\bdeadline\b/i,
  /\bdue\s+(date|by|on)\b/i,
  /\beod\b/i,
  /\bend\s+of\s+(day|week|month)\b/i,
  /\basap\b/i,
  /\burgent\s*:?\s*(deadline|by|before)\b/i,
  /\bno\s+later\s+than\b/i,
  /\bmust\s+(respond|reply|submit|complete|finish)\s+by\b/i,
  /\btime[- ]?sensitive\b/i,
  /\bexpir(es?|ing)\s+(on|by|in)\b/i,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, // date patterns like 3/15/2026
  /\b\d{4}-\d{2}-\d{2}\b/, // ISO date patterns
];

// Check message content for deadline phrases
export function detectDeadline(text: string): boolean {
  return DEADLINE_PATTERNS.some((pattern) => pattern.test(text));
}

// Urgency score (0.0 - 1.0) inputs per Spec 03:
// - Time since last user reply (higher = more urgent)
// - Sender importance (VIP flag)
// - Thread age + unresolved status
// - Explicit deadlines in message content
export function computeUrgencyScore(thread: Thread, now: number = Date.now()): number {
  let score = 0;

  // Time since last user reply - primary urgency driver
  // No reply = high urgency; recent reply = low urgency
  const timeSinceReply = thread.lastUserReplyTimestamp
    ? now - thread.lastUserReplyTimestamp
    : now - thread.firstMessageTimestamp;

  // Normalize: 0h = 0, 24h = 0.5, 48h+ = approaching 1.0
  const hoursNeglected = timeSinceReply / (1000 * 60 * 60);
  const neglectFactor = Math.min(hoursNeglected / 48, 1.0) * 0.4;
  score += neglectFactor;

  // VIP sender boost
  const hasVIP = thread.participants.some((p) => p.vipFlag);
  if (hasVIP) {
    score += 0.2;
  }

  // Unread boost
  if (thread.unread) {
    score += 0.15;
  }

  // Thread age factor: older unresolved threads are more urgent
  const threadAge = now - thread.firstMessageTimestamp;
  const daysOld = threadAge / (1000 * 60 * 60 * 24);
  if (thread.lifecycleState !== "handled" && daysOld > 3) {
    score += Math.min(daysOld / 30, 1.0) * 0.15;
  }

  // Recent activity boost: last message within 2 hours gets a bump
  const hoursSinceActivity = (now - thread.latestMessageTimestamp) / (1000 * 60 * 60);
  if (hoursSinceActivity < 2) {
    score += 0.1;
  }

  // Deadline detection per Spec 03: scan subject and message bodies for deadline phrases
  const hasDeadlineInSubject = detectDeadline(thread.subject);
  const hasDeadlineInBody = thread.messages.some(
    (m) => detectDeadline(m.bodyPlain) || detectDeadline(m.bodyHtml),
  );
  if (hasDeadlineInSubject || hasDeadlineInBody) {
    score += 0.15;
  }

  return Math.min(Math.max(score, 0), 1.0);
}

// Value score (0.0 - 1.0) inputs per Spec 03:
// - Sender relationship category (relationship score)
// - Subject/body keywords (deals, commitments)
// - Thread length/engagement depth
// - Starred/labeled by user
export function computeValueScore(thread: Thread): number {
  let score = 0;

  // Relationship score from participants (highest relationship score wins)
  const maxRelationship = Math.max(0, ...thread.participants.map((p) => p.relationshipScore));
  // Normalize 0-100 relationship to 0-0.35
  score += (maxRelationship / 100) * 0.35;

  // VIP participants boost value
  const vipCount = thread.participants.filter((p) => p.vipFlag).length;
  if (vipCount > 0) {
    score += Math.min(vipCount * 0.1, 0.2);
  }

  // Engagement depth: more messages = more invested conversation
  const msgDepth = Math.min(thread.messageCount / 10, 1.0);
  score += msgDepth * 0.15;

  // User labels/stars as value signal
  const hasImportantLabel = thread.gmailLabels.some((l) => l === "IMPORTANT" || l === "STARRED");
  if (hasImportantLabel) {
    score += 0.15;
  }

  // Keyword signals in subject AND body per Spec 03:
  // "Subject and body keyword signals - keywords associated with deals,
  // commitments, or high-stakes topics raise value"
  const valuableKeywords = [
    "deal",
    "contract",
    "proposal",
    "meeting",
    "schedule",
    "urgent",
    "opportunity",
    "partnership",
    "invoice",
    "payment",
  ];
  const subjectLower = thread.subject.toLowerCase();
  const keywordInSubject = valuableKeywords.some((kw) => subjectLower.includes(kw));
  const keywordInBody = thread.messages.some((m) => {
    const bodyText = (m.bodyPlain || m.bodyHtml || "").toLowerCase();
    return valuableKeywords.some((kw) => bodyText.includes(kw));
  });
  if (keywordInSubject || keywordInBody) {
    score += 0.15;
  }

  return Math.min(Math.max(score, 0), 1.0);
}

// Latency tolerance table per Spec 07
// Returns thresholds in milliseconds
const LATENCY_TABLE = {
  "cold-outreach": { elevated: 12, critical: 24, lost: 48 },
  "warm-intro": { elevated: 6, critical: 12, lost: 24 },
  "existing-relationship": { elevated: 24, critical: 48, lost: 96 },
  internal: { elevated: 4, critical: 8, lost: 16 },
  transactional: { elevated: 48, critical: 96, lost: 168 },
} as const;

const HOUR_MS = 60 * 60 * 1000;

export function getLatencyThresholds(threadType: Thread["threadType"]) {
  const hours = LATENCY_TABLE[threadType];
  return {
    elevated: hours.elevated * HOUR_MS,
    critical: hours.critical * HOUR_MS,
    lost: hours.lost * HOUR_MS,
  };
}

// Compute continuous risk score (0-100) per Spec 07
// Rises continuously between thresholds, not in discrete jumps
export function computeRiskScore(thread: Thread, now: number = Date.now()): number {
  const elapsed = now - thread.riskTimerStart;
  const thresholds = getLatencyThresholds(thread.threadType);

  if (elapsed <= 0) return 0;
  if (elapsed >= thresholds.lost) return 100;

  // Piecewise linear: 0->elevated = 0-33, elevated->critical = 33-66, critical->lost = 66-100
  if (elapsed < thresholds.elevated) {
    return (elapsed / thresholds.elevated) * 33;
  }
  if (elapsed < thresholds.critical) {
    return (
      33 + ((elapsed - thresholds.elevated) / (thresholds.critical - thresholds.elevated)) * 33
    );
  }
  return 66 + ((elapsed - thresholds.critical) / (thresholds.lost - thresholds.critical)) * 34;
}

// Compute risk tier based on time since risk timer started
export function computeRiskTier(thread: Thread, now: number = Date.now()): Thread["riskTier"] {
  const elapsed = now - thread.riskTimerStart;
  const thresholds = getLatencyThresholds(thread.threadType);

  if (elapsed >= thresholds.lost) return "lost";
  if (elapsed >= thresholds.critical) return "critical";
  if (elapsed >= thresholds.elevated) return "elevated";
  return "safe";
}
