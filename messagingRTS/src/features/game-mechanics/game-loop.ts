// Game loop - orchestrates game mechanics on each drift tick
// Per Spec 07: front health, opportunity windows, trust decay, streaks, session stats
// Called from map-viewport.tsx drift tick interval (200ms)
// Throttles expensive operations (trust decay, streaks) to avoid unnecessary work

import type { Thread } from "../../lib/types";
import type { TrustRecord, SessionStats, StreakState } from "../../lib/types/game-mechanics";
import { tickOpportunities } from "./opportunity-system";
import { computeFrontHealth, evaluateStreaks } from "./front-health";
import { evaluateDecay, createTrustRecord, onTimeReply as trustOnTimeReply } from "./trust-system";
import type { ThreadType } from "../../lib/types";

// Throttle trust decay evaluation to every 30 seconds (heavy computation, slow-changing)
const TRUST_DECAY_INTERVAL_MS = 30_000;
let lastTrustDecayTime = 0;

// Throttle streak evaluation - only meaningful once per day, check every 60s
const STREAK_CHECK_INTERVAL_MS = 60_000;
let lastStreakCheckTime = 0;

// Throttle front health computation to every 5 seconds
const HEALTH_COMPUTE_INTERVAL_MS = 5_000;
let lastHealthComputeTime = 0;

export interface GameTickResult {
  updatedThreads: Thread[];
  frontHealthScore: number | null; // null = no update this tick
  streakState: StreakState | null; // null = no update this tick
  sessionStatsDelta: Partial<SessionStats> | null; // null = no update this tick
}

// Track previous opportunity states to detect transitions for session stats
let previousOpportunityStates: Map<string, string> = new Map();

// Main game tick - called on every drift tick (200ms)
export function runGameTick(
  threads: Thread[],
  trustRecords: Record<string, TrustRecord>,
  sessionStats: SessionStats,
  streakState: StreakState,
  now: number = Date.now(),
): GameTickResult {
  const result: GameTickResult = {
    updatedThreads: threads,
    frontHealthScore: null,
    streakState: null,
    sessionStatsDelta: null,
  };

  // 1. Tick opportunity windows - transitions ripe -> fading -> expired
  const preOpportunityStates = new Map<string, string>();
  for (const t of threads) {
    preOpportunityStates.set(t.id, t.opportunityState);
  }
  result.updatedThreads = tickOpportunities(threads, now);

  // Track opportunity transitions for session stats
  let newMissed = 0;
  for (const t of result.updatedThreads) {
    const prev = preOpportunityStates.get(t.id);
    if (prev !== "expired" && t.opportunityState === "expired") {
      newMissed++;
    }
  }

  // Track lost thread transitions for session stats
  let newLost = 0;
  for (const t of result.updatedThreads) {
    const prevState = previousOpportunityStates.get(t.id);
    // Check if thread newly entered "lost" risk tier
    if (t.riskTier === "lost" && prevState !== "lost-tracked") {
      newLost++;
      previousOpportunityStates.set(t.id, "lost-tracked");
    }
  }

  if (newMissed > 0 || newLost > 0) {
    result.sessionStatsDelta = {
      ...(newMissed > 0
        ? { opportunitiesMissed: sessionStats.opportunitiesMissed + newMissed }
        : {}),
      ...(newLost > 0 ? { lostThreadCount: sessionStats.lostThreadCount + newLost } : {}),
    };
  }

  // 2. Compute front health score (throttled to every 5s)
  if (now - lastHealthComputeTime >= HEALTH_COMPUTE_INTERVAL_MS) {
    lastHealthComputeTime = now;
    const trustArray = Object.values(trustRecords);
    const effectiveStats = result.sessionStatsDelta
      ? { ...sessionStats, ...result.sessionStatsDelta }
      : sessionStats;
    result.frontHealthScore = computeFrontHealth(result.updatedThreads, trustArray, effectiveStats);
  }

  // 3. Trust decay evaluation (throttled to every 30s)
  if (now - lastTrustDecayTime >= TRUST_DECAY_INTERVAL_MS) {
    lastTrustDecayTime = now;
    // Trust decay is handled by the caller (app store) since it mutates trust records
    // We signal that a decay check is due by returning a non-null result
    // The actual decay is applied in the drift tick handler
  }

  // 4. Streak evaluation (throttled to every 60s)
  if (now - lastStreakCheckTime >= STREAK_CHECK_INTERVAL_MS) {
    lastStreakCheckTime = now;
    // Use local date per Spec 07: "midnight in the user's local timezone"
    const d = new Date(now);
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const newStreaks = evaluateStreaks(result.updatedThreads, streakState, today);
    if (
      newStreaks.inboxZeroDays !== streakState.inboxZeroDays ||
      newStreaks.zeroLostDays !== streakState.zeroLostDays ||
      newStreaks.lastEvaluationDate !== streakState.lastEvaluationDate
    ) {
      result.streakState = newStreaks;
    }
  }

  // Update tracking map for next tick
  for (const t of result.updatedThreads) {
    if (t.riskTier !== "lost") {
      previousOpportunityStates.delete(t.id);
    }
  }

  return result;
}

// Check if trust decay is due (called from drift tick to avoid importing trust system everywhere)
export function isTrustDecayDue(now: number = Date.now()): boolean {
  return now - lastTrustDecayTime >= TRUST_DECAY_INTERVAL_MS;
}

// Run trust decay on all records - returns updated records (only changed ones)
export function runTrustDecay(
  trustRecords: Record<string, TrustRecord>,
  threads: Thread[],
  now: number = Date.now(),
): Record<string, TrustRecord> {
  lastTrustDecayTime = now;
  const updated = { ...trustRecords };
  let changed = false;

  // Build a map of contact email -> thread type (use most recent thread type)
  const contactThreadTypes = new Map<string, ThreadType>();
  for (const thread of threads) {
    for (const p of thread.participants) {
      if (!contactThreadTypes.has(p.email)) {
        contactThreadTypes.set(p.email, thread.threadType);
      }
    }
  }

  for (const [email, record] of Object.entries(trustRecords)) {
    const threadType = contactThreadTypes.get(email) ?? "existing-relationship";
    const decayed = evaluateDecay(record, threadType, now);
    if (decayed.score !== record.score) {
      updated[email] = decayed;
      changed = true;
    }
  }

  return changed ? updated : trustRecords;
}

// Handle trust update on user reply - called from outbound actions
export function updateTrustOnReply(
  trustRecords: Record<string, TrustRecord>,
  participantEmails: string[],
  threadType: ThreadType,
  now: number = Date.now(),
): Record<string, TrustRecord> {
  const updated = { ...trustRecords };
  for (const email of participantEmails) {
    const existing = updated[email] ?? createTrustRecord(email);
    updated[email] = trustOnTimeReply(existing, threadType, now);
  }
  return updated;
}

// Reset throttle timers (for testing)
export function _resetGameLoopTimers(): void {
  lastTrustDecayTime = 0;
  lastStreakCheckTime = 0;
  lastHealthComputeTime = 0;
  previousOpportunityStates = new Map();
}
