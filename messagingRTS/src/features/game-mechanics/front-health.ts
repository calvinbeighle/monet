// Front health, streaks, and session summary per Spec 07
// Front health (0-100): weighted composite of risk load, trust average,
// opportunity capture rate, and loss rate

import type { Thread } from "../../lib/types";
import type { TrustRecord, SessionStats, StreakState } from "../../lib/types/game-mechanics";

// Health tier thresholds per Spec 07
export type HealthTier = "healthy" | "degraded" | "critical";

export function getHealthTier(score: number): HealthTier {
  if (score >= 75) return "healthy";
  if (score >= 50) return "degraded";
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

function computeRiskLoad(threads: Thread[]): number {
  if (threads.length === 0) return 100;

  let score = 0;
  for (const t of threads) {
    switch (t.riskTier) {
      case "safe":
        score += 100;
        break;
      case "elevated":
        score += 60;
        break;
      case "critical":
        score += 20;
        break;
      case "lost":
        score += 0;
        break;
    }
  }
  return score / threads.length;
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
export function evaluateStreaks(
  threads: Thread[],
  currentStreaks: StreakState,
  today: string, // YYYY-MM-DD
): StreakState {
  if (currentStreaks.lastEvaluationDate === today) return currentStreaks;

  // Inbox zero: all threads in safe tier at end of day
  const allSafe = threads.every((t) => t.riskTier === "safe" || t.lifecycleState === "handled");

  // Zero lost: no threads entered lost tier during the day
  const anyLost = threads.some((t) => t.riskTier === "lost" && t.lifecycleState !== "handled");

  return {
    inboxZeroDays: allSafe ? currentStreaks.inboxZeroDays + 1 : 0,
    zeroLostDays: !anyLost ? currentStreaks.zeroLostDays + 1 : 0,
    lastEvaluationDate: today,
  };
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
