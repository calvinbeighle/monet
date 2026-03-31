// Map alerts tests per Spec 07 (Map Alert Notifications)
// Verifies: alert trigger conditions, auto-resolve, acknowledge, dedup, agent-completed

import { describe, it, expect, beforeEach } from "vitest";
import { createThread } from "../../lib/types";
import type { Thread } from "../../lib/types";
import type { MapAlert } from "../../lib/types/game-mechanics";
import {
  isAboutToBeLost,
  isHighValueUrgent,
  isStreakAtRisk,
  evaluateAlerts,
  createAgentCompletedAlert,
  acknowledgeAlert,
  countActiveAlerts,
  resetAlertIdCounter,
} from "./map-alerts";

const HOUR_MS = 60 * 60 * 1000;

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return { ...createThread("t1", "Test Subject", "Preview"), ...overrides };
}

describe("Map alerts", () => {
  beforeEach(() => {
    resetAlertIdCounter();
  });

  describe("isAboutToBeLost", () => {
    it("returns true when thread is within 30 min of lost threshold", () => {
      const now = Date.now();
      // existing-relationship: lost at 96h
      const thread = makeThread({
        threadType: "existing-relationship",
        riskTimerStart: now - 96 * HOUR_MS + 20 * 60 * 1000, // 20 min before lost
        riskTier: "critical",
      });
      expect(isAboutToBeLost(thread, now)).toBe(true);
    });

    it("returns false when thread has more than 30 min to lost", () => {
      const now = Date.now();
      const thread = makeThread({
        threadType: "existing-relationship",
        riskTimerStart: now - 90 * HOUR_MS, // 6 hours to lost
        riskTier: "critical",
      });
      expect(isAboutToBeLost(thread, now)).toBe(false);
    });

    it("returns false when thread is already lost", () => {
      const now = Date.now();
      const thread = makeThread({
        threadType: "existing-relationship",
        riskTimerStart: now - 97 * HOUR_MS,
        riskTier: "lost",
      });
      expect(isAboutToBeLost(thread, now)).toBe(false);
    });

    it("returns false when thread is handled", () => {
      const now = Date.now();
      const thread = makeThread({
        threadType: "existing-relationship",
        riskTimerStart: now - 96 * HOUR_MS + 10 * 60 * 1000,
        riskTier: "critical",
        lifecycleState: "handled",
      });
      expect(isAboutToBeLost(thread, now)).toBe(false);
    });

    it("works with cold-outreach latency (lost at 48h)", () => {
      const now = Date.now();
      const thread = makeThread({
        threadType: "cold-outreach",
        riskTimerStart: now - 48 * HOUR_MS + 15 * 60 * 1000, // 15 min before lost
        riskTier: "critical",
      });
      expect(isAboutToBeLost(thread, now)).toBe(true);
    });
  });

  describe("isHighValueUrgent", () => {
    it("returns true for high-value ripe thread with <30 min on window", () => {
      const now = Date.now();
      const thread = makeThread({
        valueScore: 0.8,
        opportunityState: "ripe",
        opportunityWindowEnd: now + 20 * 60 * 1000, // 20 min remaining
      });
      expect(isHighValueUrgent(thread, now)).toBe(true);
    });

    it("returns true for fading thread with <30 min", () => {
      const now = Date.now();
      const thread = makeThread({
        valueScore: 0.75,
        opportunityState: "fading",
        opportunityWindowEnd: now + 10 * 60 * 1000,
      });
      expect(isHighValueUrgent(thread, now)).toBe(true);
    });

    it("returns false when value score is below threshold", () => {
      const now = Date.now();
      const thread = makeThread({
        valueScore: 0.5,
        opportunityState: "ripe",
        opportunityWindowEnd: now + 20 * 60 * 1000,
      });
      expect(isHighValueUrgent(thread, now)).toBe(false);
    });

    it("returns false when opportunity is none", () => {
      const now = Date.now();
      const thread = makeThread({
        valueScore: 0.9,
        opportunityState: "none",
        opportunityWindowEnd: null,
      });
      expect(isHighValueUrgent(thread, now)).toBe(false);
    });

    it("returns false when more than 30 min remaining", () => {
      const now = Date.now();
      const thread = makeThread({
        valueScore: 0.8,
        opportunityState: "ripe",
        opportunityWindowEnd: now + 2 * HOUR_MS, // 2 hours remaining
      });
      expect(isHighValueUrgent(thread, now)).toBe(false);
    });

    it("returns false when window has already expired", () => {
      const now = Date.now();
      const thread = makeThread({
        valueScore: 0.8,
        opportunityState: "ripe",
        opportunityWindowEnd: now - 1000, // expired
      });
      expect(isHighValueUrgent(thread, now)).toBe(false);
    });
  });

  describe("isStreakAtRisk", () => {
    it("returns true when streak > 0, unsafe threads, within 2h of midnight", () => {
      // Set now to 11pm (1h before midnight)
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);
      const now = midnight.getTime() - 1 * HOUR_MS;

      const threads = [makeThread({ riskTier: "elevated", lifecycleState: "active" })];
      expect(isStreakAtRisk(threads, now, 5)).toBe(true);
    });

    it("returns false when streak is 0 (nothing to lose)", () => {
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);
      const now = midnight.getTime() - 1 * HOUR_MS;

      const threads = [makeThread({ riskTier: "elevated", lifecycleState: "active" })];
      expect(isStreakAtRisk(threads, now, 0)).toBe(false);
    });

    it("returns false when more than 2h to midnight", () => {
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);
      const now = midnight.getTime() - 5 * HOUR_MS;

      const threads = [makeThread({ riskTier: "critical", lifecycleState: "active" })];
      expect(isStreakAtRisk(threads, now, 3)).toBe(false);
    });

    it("returns false when all threads are safe or handled", () => {
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);
      const now = midnight.getTime() - 1 * HOUR_MS;

      const threads = [
        makeThread({ riskTier: "safe", lifecycleState: "active" }),
        makeThread({ id: "t2", riskTier: "safe", lifecycleState: "handled" }),
      ];
      expect(isStreakAtRisk(threads, now, 5)).toBe(false);
    });
  });

  describe("evaluateAlerts", () => {
    it("creates about-to-be-lost alert for thread near lost threshold", () => {
      const now = Date.now();
      const thread = makeThread({
        threadType: "cold-outreach",
        riskTimerStart: now - 48 * HOUR_MS + 15 * 60 * 1000,
        riskTier: "critical",
      });

      const alerts = evaluateAlerts([thread], [], now, 0);
      expect(alerts.length).toBe(1);
      expect(alerts[0].type).toBe("about-to-be-lost");
      expect(alerts[0].threadId).toBe("t1");
      expect(alerts[0].acknowledged).toBe(false);
      expect(alerts[0].autoResolved).toBe(false);
    });

    it("preserves existing alert if condition still holds", () => {
      const now = Date.now();
      const thread = makeThread({
        threadType: "cold-outreach",
        riskTimerStart: now - 48 * HOUR_MS + 15 * 60 * 1000,
        riskTier: "critical",
      });

      const existingAlert: MapAlert = {
        id: "alert-existing",
        type: "about-to-be-lost",
        threadId: "t1",
        message: "existing message",
        createdAt: now - 5000,
        acknowledged: false,
        autoResolved: false,
      };

      const alerts = evaluateAlerts([thread], [existingAlert], now, 0);
      expect(alerts.length).toBe(1);
      expect(alerts[0].id).toBe("alert-existing"); // same alert preserved
    });

    it("auto-resolves alert when condition no longer holds", () => {
      const now = Date.now();
      const thread = makeThread({
        threadType: "cold-outreach",
        riskTimerStart: now - 20 * HOUR_MS, // far from lost
        riskTier: "elevated",
      });

      const existingAlert: MapAlert = {
        id: "alert-old",
        type: "about-to-be-lost",
        threadId: "t1",
        message: "was about to be lost",
        createdAt: now - 60000,
        acknowledged: false,
        autoResolved: false,
      };

      const alerts = evaluateAlerts([thread], [existingAlert], now, 0);
      const resolved = alerts.find((a) => a.id === "alert-old");
      expect(resolved).toBeDefined();
      expect(resolved!.autoResolved).toBe(true);
    });

    it("drops acknowledged alerts that no longer match", () => {
      const now = Date.now();
      const thread = makeThread({
        riskTier: "safe",
        riskTimerStart: now,
      });

      const existingAlert: MapAlert = {
        id: "alert-acked",
        type: "about-to-be-lost",
        threadId: "t1",
        message: "was about to be lost",
        createdAt: now - 60000,
        acknowledged: true,
        autoResolved: false,
      };

      const alerts = evaluateAlerts([thread], [existingAlert], now, 0);
      expect(alerts.find((a) => a.id === "alert-acked")).toBeUndefined();
    });

    it("creates high-value alert for thread near opportunity window end", () => {
      const now = Date.now();
      const thread = makeThread({
        valueScore: 0.8,
        opportunityState: "ripe",
        opportunityWindowEnd: now + 20 * 60 * 1000,
      });

      const alerts = evaluateAlerts([thread], [], now, 0);
      const hvAlert = alerts.find((a) => a.type === "new-high-value");
      expect(hvAlert).toBeDefined();
      expect(hvAlert!.threadId).toBe("t1");
    });

    it("creates streak-at-risk alert when conditions met", () => {
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);
      const now = midnight.getTime() - 1 * HOUR_MS;

      const threads = [makeThread({ riskTier: "elevated", lifecycleState: "active" })];

      const alerts = evaluateAlerts(threads, [], now, 5);
      const streakAlert = alerts.find((a) => a.type === "streak-at-risk");
      expect(streakAlert).toBeDefined();
      expect(streakAlert!.threadId).toBeNull();
    });

    it("does not duplicate alerts for same thread and type", () => {
      const now = Date.now();
      const thread = makeThread({
        threadType: "cold-outreach",
        riskTimerStart: now - 48 * HOUR_MS + 15 * 60 * 1000,
        riskTier: "critical",
      });

      const alerts1 = evaluateAlerts([thread], [], now, 0);
      const alerts2 = evaluateAlerts([thread], alerts1, now, 0);
      expect(alerts2.length).toBe(1);
      expect(alerts2[0].id).toBe(alerts1[0].id); // same alert
    });

    it("handles multiple alerts from different threads", () => {
      const now = Date.now();
      const thread1 = makeThread({
        id: "t1",
        threadType: "cold-outreach",
        riskTimerStart: now - 48 * HOUR_MS + 10 * 60 * 1000,
        riskTier: "critical",
      });
      const thread2 = makeThread({
        id: "t2",
        subject: "Deal proposal",
        threadType: "warm-intro",
        riskTimerStart: now - 24 * HOUR_MS + 5 * 60 * 1000,
        riskTier: "critical",
      });

      const alerts = evaluateAlerts([thread1, thread2], [], now, 0);
      expect(alerts.filter((a) => a.type === "about-to-be-lost").length).toBe(2);
    });
  });

  describe("createAgentCompletedAlert", () => {
    it("creates an agent-completed alert", () => {
      const alert = createAgentCompletedAlert("Closer", 3);
      expect(alert.type).toBe("agent-completed");
      expect(alert.message).toContain("Closer");
      expect(alert.message).toContain("3 threads");
      expect(alert.threadId).toBeNull();
    });

    it("uses singular for 1 thread", () => {
      const alert = createAgentCompletedAlert("Drafter", 1);
      expect(alert.message).toContain("1 thread");
      expect(alert.message).not.toContain("1 threads");
    });
  });

  describe("acknowledgeAlert", () => {
    it("marks the specified alert as acknowledged", () => {
      const alerts: MapAlert[] = [
        {
          id: "a1",
          type: "about-to-be-lost",
          threadId: "t1",
          message: "msg",
          createdAt: Date.now(),
          acknowledged: false,
          autoResolved: false,
        },
        {
          id: "a2",
          type: "streak-at-risk",
          threadId: null,
          message: "msg2",
          createdAt: Date.now(),
          acknowledged: false,
          autoResolved: false,
        },
      ];

      const updated = acknowledgeAlert(alerts, "a1");
      expect(updated.find((a) => a.id === "a1")!.acknowledged).toBe(true);
      expect(updated.find((a) => a.id === "a2")!.acknowledged).toBe(false);
    });
  });

  describe("countActiveAlerts", () => {
    it("counts only unacknowledged, non-auto-resolved alerts", () => {
      const alerts: MapAlert[] = [
        {
          id: "a1",
          type: "about-to-be-lost",
          threadId: "t1",
          message: "m",
          createdAt: Date.now(),
          acknowledged: false,
          autoResolved: false,
        },
        {
          id: "a2",
          type: "streak-at-risk",
          threadId: null,
          message: "m",
          createdAt: Date.now(),
          acknowledged: true,
          autoResolved: false,
        },
        {
          id: "a3",
          type: "new-high-value",
          threadId: "t2",
          message: "m",
          createdAt: Date.now(),
          acknowledged: false,
          autoResolved: true,
        },
        {
          id: "a4",
          type: "agent-completed",
          threadId: null,
          message: "m",
          createdAt: Date.now(),
          acknowledged: false,
          autoResolved: false,
        },
      ];

      expect(countActiveAlerts(alerts)).toBe(2); // a1 and a4
    });
  });
});
