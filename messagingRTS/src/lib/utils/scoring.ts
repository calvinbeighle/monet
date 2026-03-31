// Urgency and value scoring per Spec 03
// These scores drive thread positioning, zone assignment, and game mechanics

import type { Thread } from "../types";

// Urgency score (0.0 - 1.0) inputs per Spec 03:
// - Time since last user reply (higher = more urgent)
// - Sender importance (VIP flag)
// - Thread age + unresolved status
// - Explicit deadlines in content (future: NLP extraction)
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

  // Keyword signals in subject (basic heuristic)
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
  const keywordMatch = valuableKeywords.some((kw) => subjectLower.includes(kw));
  if (keywordMatch) {
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

// Compute risk tier based on time since risk timer started
export function computeRiskTier(thread: Thread, now: number = Date.now()): Thread["riskTier"] {
  const elapsed = now - thread.riskTimerStart;
  const thresholds = getLatencyThresholds(thread.threadType);

  if (elapsed >= thresholds.lost) return "lost";
  if (elapsed >= thresholds.critical) return "critical";
  if (elapsed >= thresholds.elevated) return "elevated";
  return "safe";
}
