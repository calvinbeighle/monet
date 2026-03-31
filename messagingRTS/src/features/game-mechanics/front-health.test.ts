import { describe, it, expect } from "vitest";
import {
  computeFrontHealth,
  getHealthTier,
  evaluateStreaks,
  createSessionStats,
  createStreakState,
} from "./front-health";
import { createThread } from "../../lib/types";
import type { TrustRecord } from "../../lib/types/game-mechanics";

function makeTrustRecord(score: number): TrustRecord {
  return {
    contactEmail: "test@example.com",
    score,
    tier:
      score >= 80 ? "high-trust" : score >= 50 ? "established" : score >= 20 ? "building" : "new",
    consecutiveStreak: 0,
    tierEntryDate: Date.now(),
    lastReplyTimestamp: null,
    lastDecayCheck: Date.now(),
  };
}

describe("Front health", () => {
  describe("getHealthTier", () => {
    it("returns correct tiers", () => {
      expect(getHealthTier(100)).toBe("healthy");
      expect(getHealthTier(75)).toBe("healthy");
      expect(getHealthTier(50)).toBe("degraded");
      expect(getHealthTier(25)).toBe("degraded");
      expect(getHealthTier(24)).toBe("critical");
      expect(getHealthTier(0)).toBe("critical");
    });
  });

  describe("computeFrontHealth", () => {
    it("returns 100 with no threads", () => {
      const stats = createSessionStats();
      expect(computeFrontHealth([], [], stats)).toBe(100);
    });

    it("returns high health with all safe threads and good trust", () => {
      const threads = [
        { ...createThread("t1", "S", "s"), riskTier: "safe" as const },
        { ...createThread("t2", "S", "s"), riskTier: "safe" as const },
      ];
      const trust = [makeTrustRecord(80), makeTrustRecord(90)];
      const stats = createSessionStats();

      const health = computeFrontHealth(threads, trust, stats);
      expect(health).toBeGreaterThan(75);
    });

    it("returns low health with critical/lost threads", () => {
      const threads = [
        { ...createThread("t1", "S", "s"), riskTier: "critical" as const },
        { ...createThread("t2", "S", "s"), riskTier: "lost" as const },
        { ...createThread("t3", "S", "s"), riskTier: "lost" as const },
      ];
      const trust = [makeTrustRecord(10)];
      const stats = { ...createSessionStats(), lostThreadCount: 2 };

      const health = computeFrontHealth(threads, trust, stats);
      expect(health).toBeLessThan(50);
    });

    it("accounts for opportunity capture rate", () => {
      const threads = [{ ...createThread("t1", "S", "s"), riskTier: "safe" as const }];
      const trust = [makeTrustRecord(50)];

      const goodCapture = {
        ...createSessionStats(),
        opportunitiesCaptured: 8,
        opportunitiesMissed: 2,
      };
      const badCapture = {
        ...createSessionStats(),
        opportunitiesCaptured: 1,
        opportunitiesMissed: 9,
      };

      const healthGood = computeFrontHealth(threads, trust, goodCapture);
      const healthBad = computeFrontHealth(threads, trust, badCapture);

      expect(healthGood).toBeGreaterThan(healthBad);
    });

    it("is bounded between 0 and 100", () => {
      const threads = [{ ...createThread("t1", "S", "s"), riskTier: "lost" as const }];
      const stats = { ...createSessionStats(), lostThreadCount: 100 };

      const health = computeFrontHealth(threads, [], stats);
      expect(health).toBeGreaterThanOrEqual(0);
      expect(health).toBeLessThanOrEqual(100);
    });
  });
});

describe("Streaks", () => {
  it("creates initial streak state", () => {
    const state = createStreakState();
    expect(state.inboxZeroDays).toBe(0);
    expect(state.zeroLostDays).toBe(0);
    expect(state.lastEvaluationDate).toBe("");
  });

  it("increments inbox-zero streak when all threads are safe", () => {
    const threads = [
      { ...createThread("t1", "S", "s"), riskTier: "safe" as const },
      {
        ...createThread("t2", "S", "s"),
        lifecycleState: "handled" as const,
        riskTier: "safe" as const,
      },
    ];
    const streaks = createStreakState();
    const updated = evaluateStreaks(threads, streaks, "2026-03-31");

    expect(updated.inboxZeroDays).toBe(1);
  });

  it("resets inbox-zero streak when threads are not safe", () => {
    const threads = [
      {
        ...createThread("t1", "S", "s"),
        riskTier: "elevated" as const,
        lifecycleState: "active" as const,
      },
    ];
    const streaks = { ...createStreakState(), inboxZeroDays: 5, lastEvaluationDate: "2026-03-30" };
    const updated = evaluateStreaks(threads, streaks, "2026-03-31");

    expect(updated.inboxZeroDays).toBe(0);
  });

  it("does not re-evaluate on same day", () => {
    const threads = [{ ...createThread("t1", "S", "s"), riskTier: "safe" as const }];
    const streaks = { ...createStreakState(), inboxZeroDays: 3, lastEvaluationDate: "2026-03-31" };
    const updated = evaluateStreaks(threads, streaks, "2026-03-31");

    expect(updated.inboxZeroDays).toBe(3); // unchanged
  });

  it("increments zero-lost streak when no threads are lost", () => {
    const threads = [{ ...createThread("t1", "S", "s"), riskTier: "safe" as const }];
    const streaks = createStreakState();
    const updated = evaluateStreaks(threads, streaks, "2026-03-31");

    expect(updated.zeroLostDays).toBe(1);
  });

  it("resets zero-lost streak when a thread is lost", () => {
    const threads = [
      {
        ...createThread("t1", "S", "s"),
        riskTier: "lost" as const,
        lifecycleState: "lost" as const,
      },
    ];
    const streaks = { ...createStreakState(), zeroLostDays: 10, lastEvaluationDate: "2026-03-30" };
    const updated = evaluateStreaks(threads, streaks, "2026-03-31");

    expect(updated.zeroLostDays).toBe(0);
  });
});
