// Map alert system per Spec 07 (Map Alert Notifications)
// Alerts fire when conditions are detected, persist until acknowledged or auto-resolved.
// Four alert types: new-high-value, about-to-be-lost, agent-completed, streak-at-risk.
// Evaluation runs periodically alongside the drift tick.

import type { Thread } from "../../lib/types";
import type { MapAlert, MapAlertType } from "../../lib/types/game-mechanics";
import { getLatencyThresholds } from "../../lib/utils/scoring";

// Alert thresholds
const ABOUT_TO_BE_LOST_WINDOW_MS = 30 * 60 * 1000; // 30 minutes before lost threshold
const HIGH_VALUE_WINDOW_MS = 30 * 60 * 1000; // <30 min remaining on opportunity window
const STREAK_AT_RISK_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours before midnight
const HIGH_VALUE_SCORE_THRESHOLD = 0.7; // value score must exceed this

let alertIdCounter = 0;

function createAlert(
  type: MapAlertType,
  message: string,
  threadId: string | null = null,
): MapAlert {
  return {
    id: `alert-${++alertIdCounter}`,
    type,
    threadId,
    message,
    createdAt: Date.now(),
    acknowledged: false,
    autoResolved: false,
  };
}

// Check if a thread is within 30 minutes of being lost
export function isAboutToBeLost(thread: Thread, now: number): boolean {
  if (thread.riskTier === "lost" || thread.lifecycleState === "handled") return false;
  const thresholds = getLatencyThresholds(thread.threadType);
  const elapsed = now - thread.riskTimerStart;
  const timeToLost = thresholds.lost - elapsed;
  return timeToLost > 0 && timeToLost <= ABOUT_TO_BE_LOST_WINDOW_MS;
}

// Check if a thread is high-value with <30 min on opportunity window
export function isHighValueUrgent(thread: Thread, now: number): boolean {
  if (thread.opportunityState !== "ripe" && thread.opportunityState !== "fading") return false;
  if (thread.valueScore < HIGH_VALUE_SCORE_THRESHOLD) return false;
  if (!thread.opportunityWindowEnd) return false;
  const timeRemaining = thread.opportunityWindowEnd - now;
  return timeRemaining > 0 && timeRemaining <= HIGH_VALUE_WINDOW_MS;
}

// Check if streak is at risk (within 2h of midnight, inbox-zero not met)
export function isStreakAtRisk(
  threads: Thread[],
  now: number,
  currentInboxZeroStreak: number,
): boolean {
  if (currentInboxZeroStreak === 0) return false; // nothing to lose

  // Calculate time to midnight
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const timeToMidnight = midnight.getTime() - now;

  if (timeToMidnight > STREAK_AT_RISK_WINDOW_MS) return false;

  // Check if inbox-zero conditions are not met
  const hasUnsafe = threads.some(
    (t) =>
      t.lifecycleState !== "handled" &&
      (t.riskTier === "elevated" || t.riskTier === "critical" || t.riskTier === "lost"),
  );

  return hasUnsafe;
}

// Evaluate all alert conditions and produce new/updated alert set
// Preserves existing alerts that are still valid, auto-resolves those that aren't,
// and creates new alerts for newly detected conditions.
export function evaluateAlerts(
  threads: Thread[],
  existingAlerts: MapAlert[],
  now: number,
  inboxZeroStreak: number,
): MapAlert[] {
  const result: MapAlert[] = [];
  const existingByKey = new Map<string, MapAlert>();

  // Index existing alerts by a composite key for dedup
  for (const alert of existingAlerts) {
    if (alert.autoResolved) continue; // drop already resolved
    const key = alertKey(alert);
    existingByKey.set(key, alert);
  }

  // Evaluate per-thread conditions
  for (const thread of threads) {
    // About to be lost
    if (isAboutToBeLost(thread, now)) {
      const key = `about-to-be-lost:${thread.id}`;
      const existing = existingByKey.get(key);
      if (existing) {
        result.push(existing);
        existingByKey.delete(key);
      } else {
        result.push(
          createAlert(
            "about-to-be-lost",
            `"${truncate(thread.subject)}" is about to be lost`,
            thread.id,
          ),
        );
      }
    }

    // High value urgent
    if (isHighValueUrgent(thread, now)) {
      const key = `new-high-value:${thread.id}`;
      const existing = existingByKey.get(key);
      if (existing) {
        result.push(existing);
        existingByKey.delete(key);
      } else {
        result.push(
          createAlert(
            "new-high-value",
            `High-value thread: "${truncate(thread.subject)}" - act soon`,
            thread.id,
          ),
        );
      }
    }
  }

  // Streak at risk (global condition, not per-thread)
  if (isStreakAtRisk(threads, now, inboxZeroStreak)) {
    const key = "streak-at-risk:global";
    const existing = existingByKey.get(key);
    if (existing) {
      result.push(existing);
      existingByKey.delete(key);
    } else {
      result.push(
        createAlert(
          "streak-at-risk",
          "Inbox-zero streak at risk - unresolved threads before midnight",
        ),
      );
    }
  }

  // Auto-resolve remaining alerts that no longer match conditions
  for (const [, alert] of existingByKey) {
    if (!alert.acknowledged) {
      result.push({ ...alert, autoResolved: true });
    }
    // Acknowledged alerts that no longer match are simply dropped
  }

  return result;
}

// Create a resurfacing alert per Spec 09: hidden thread transitioned to at-risk/lost
export function createThreadResurfacedAlert(thread: Thread): MapAlert {
  return createAlert(
    "thread-resurfaced",
    `Filtered thread "${truncate(thread.subject)}" is now ${thread.lifecycleState === "lost" ? "lost" : "at risk"}`,
    thread.id,
  );
}

// Add an agent-completed alert (called externally when agent finishes)
export function createAgentCompletedAlert(agentName: string, threadCount: number): MapAlert {
  return createAlert(
    "agent-completed",
    `${agentName} completed work on ${threadCount} thread${threadCount !== 1 ? "s" : ""}`,
  );
}

// Acknowledge an alert (user action)
export function acknowledgeAlert(alerts: MapAlert[], alertId: string): MapAlert[] {
  return alerts.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a));
}

// Count unacknowledged, non-auto-resolved alerts
export function countActiveAlerts(alerts: MapAlert[]): number {
  return alerts.filter((a) => !a.acknowledged && !a.autoResolved).length;
}

// Helper: generate dedup key
function alertKey(alert: MapAlert): string {
  if (alert.threadId) {
    return `${alert.type}:${alert.threadId}`;
  }
  return `${alert.type}:global`;
}

// Helper: truncate subject for alert message
function truncate(text: string, maxLen: number = 40): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

// Reset counter (for testing)
export function resetAlertIdCounter(): void {
  alertIdCounter = 0;
}
