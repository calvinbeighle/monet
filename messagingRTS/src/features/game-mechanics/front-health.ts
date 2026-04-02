// Front health, streaks, and session summary per Spec 07
// Front health (0-100): weighted composite of risk load, trust average,
// opportunity capture rate, and loss rate

import type { Thread } from "../../lib/types";
import type { TrustRecord, SessionStats, StreakState } from "../../lib/types/game-mechanics";

// Health tier thresholds per Spec 07
export type HealthTier = "healthy" | "degraded" | "critical";

// Per Spec 07 state transition table: healthy >= 75, degraded >= 25, critical < 25
export function getHealthTier(score: number): HealthTier {
  if (score >= 75) return "healthy";
  if (score >= 25) return "degraded";
  return "critical";
}

// Weights for front health components
const WEIGHT_RISK = 0.35;
const WEIGHT_TRUST = 0.25;
const WEIGHT_OPPORTUNITY = 0.25;
const WEIGHT_LOSS = 0.15;

// Compute front health score per Spec 07
export function computeFrontHealth(
  threads: Thread[],
  trustRecords: TrustRecord[],
  sessionStats: SessionStats,
): number {
  if (threads.length === 0) return 100; // no threads = perfect health

  // Risk load: proportion of threads in safe/elevated vs critical/lost
  const riskScore = computeRiskLoad(threads);

  // Trust average: mean of all trust scores
  const trustScore = computeTrustAverage(trustRecords);

  // Opportunity capture rate
  const captureRate = computeCaptureRate(sessionStats);

  // Loss rate: inverse of lost thread proportion
  const lossScore = computeLossScore(threads, sessionStats);

  const health =
    riskScore * WEIGHT_RISK +
    trustScore * WEIGHT_TRUST +
    captureRate * WEIGHT_OPPORTUNITY +
    lossScore * WEIGHT_LOSS;

  return Math.round(Math.max(0, Math.min(100, health)));
}

// Thread type weights per Spec 07: "distribution of threads across risk tiers,
// weighted by thread type". Tighter tolerance windows = higher weight because
// a lost warm-intro is more damaging than a lost transactional thread.
const THREAD_TYPE_RISK_WEIGHT: Record<Thread["threadType"], number> = {
  internal: 1.5,
  "warm-intro": 1.4,
  "existing-relationship": 1.0,
  "cold-outreach": 0.8,
  transactional: 0.5,
};

function computeRiskLoad(threads: Thread[]): number {
  if (threads.length === 0) return 100;

  let weightedScore = 0;
  let totalWeight = 0;
  for (const t of threads) {
    const typeWeight = THREAD_TYPE_RISK_WEIGHT[t.threadType] ?? 1.0;
    let tierScore: number;
    switch (t.riskTier) {
      case "safe":
        tierScore = 100;
        break;
      case "elevated":
        tierScore = 60;
        break;
      case "critical":
        tierScore = 20;
        break;
      case "lost":
        tierScore = 0;
        break;
    }
    weightedScore += tierScore * typeWeight;
    totalWeight += typeWeight;
  }
  return totalWeight > 0 ? weightedScore / totalWeight : 100;
}

function computeTrustAverage(records: TrustRecord[]): number {
  if (records.length === 0) return 50; // neutral default
  const sum = records.reduce((acc, r) => acc + r.score, 0);
  return sum / records.length;
}

function computeCaptureRate(stats: SessionStats): number {
  const total = stats.opportunitiesCaptured + stats.opportunitiesMissed;
  if (total === 0) return 100; // no opportunities yet = perfect
  return (stats.opportunitiesCaptured / total) * 100;
}

function computeLossScore(threads: Thread[], stats: SessionStats): number {
  if (threads.length === 0) return 100;
  const lossRatio = stats.lostThreadCount / threads.length;
  return Math.max(0, (1 - lossRatio) * 100);
}

// Streak evaluation per Spec 07: at midnight local time
// sessionLostCount tracks threads that entered lost tier at any point during the day,
// even if they were later recovered - this is the correct metric per Spec 07.
// Per Spec 07 acceptance criteria: "A streak counter that resets to 0 after a missed day
// displays 0 (not the previous count) at the start of the following day's session."
export function evaluateStreaks(
  threads: Thread[],
  currentStreaks: StreakState,
  today: string, // YYYY-MM-DD
  sessionLostCount: number = 0,
): StreakState {
  if (currentStreaks.lastEvaluationDate === today) return currentStreaks;

  // Per Spec 07: if more than 1 day elapsed since last evaluation, we cannot verify
  // conditions were met on missed days - reset both streaks to 0 before evaluating today.
  // This ensures streaks don't survive app-closed gaps where threads may have been neglected.
  const missedDays =
    currentStreaks.lastEvaluationDate !== ""
      ? daysBetween(currentStreaks.lastEvaluationDate, today)
      : 0;
  const baseStreaks =
    missedDays > 1
      ? { inboxZeroDays: 0, zeroLostDays: 0 }
      : { inboxZeroDays: currentStreaks.inboxZeroDays, zeroLostDays: currentStreaks.zeroLostDays };

  // Inbox zero: all threads in safe tier at end of day
  const allSafe = threads.every((t) => t.riskTier === "safe" || t.lifecycleState === "handled");

  // Zero lost: no threads entered lost tier during the day (using session tracking)
  // Per Spec 07: "no threads entered the lost tier during the day" - this must use
  // session-tracked count, not current state, because recovered threads would be missed
  const anyLost = sessionLostCount > 0;

  return {
    inboxZeroDays: allSafe ? baseStreaks.inboxZeroDays + 1 : 0,
    zeroLostDays: !anyLost ? baseStreaks.zeroLostDays + 1 : 0,
    lastEvaluationDate: today,
  };
}

// Calculate days between two YYYY-MM-DD date strings
function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA + "T00:00:00");
  const b = new Date(dateB + "T00:00:00");
  return Math.round(Math.abs(b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

// Create initial session stats
export function createSessionStats(): SessionStats {
  return {
    threadsHandled: 0,
    opportunitiesCaptured: 0,
    opportunitiesMissed: 0,
    risksMitigated: 0,
    agentsDeployed: 0,
    lostThreadCount: 0,
    netHealthChange: 0,
    sessionStart: Date.now(),
  };
}

// Create initial streak state
export function createStreakState(): StreakState {
  return {
    inboxZeroDays: 0,
    zeroLostDays: 0,
    lastEvaluationDate: "",
  };
}
