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
    decayActive: false,
  };
}

describe("Front health", () => {
  describe("getHealthTier", () => {
    it("returns correct tiers per Spec 07: >=50 healthy, >=25 degraded, <25 critical", () => {
      expect(getHealthTier(100)).toBe("healthy");
      expect(getHealthTier(75)).toBe("healthy");
      expect(getHealthTier(74)).toBe("healthy");
      expect(getHealthTier(50)).toBe("healthy");
      expect(getHealthTier(49)).toBe("degraded");
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

    it("weights risk load by thread type (Spec 07)", () => {
      // A lost warm-intro (high weight) should hurt health more than a lost transactional (low weight)
      const warmIntroLost = {
        ...createThread("t1", "S", "s"),
        riskTier: "lost" as const,
        threadType: "warm-intro" as const,
      };
      const transactionalLost = {
        ...createThread("t2", "S", "s"),
        riskTier: "lost" as const,
        threadType: "transactional" as const,
      };
      const safeThread = {
        ...createThread("t3", "S", "s"),
        riskTier: "safe" as const,
        threadType: "existing-relationship" as const,
      };

      const stats = createSessionStats();

      // One warm-intro lost + one safe
      const healthWarmLost = computeFrontHealth([warmIntroLost, safeThread], [], {
        ...stats,
        lostThreadCount: 1,
      });

      // One transactional lost + one safe
      const healthTransLost = computeFrontHealth([transactionalLost, safeThread], [], {
        ...stats,
        lostThreadCount: 1,
      });

      // Warm-intro lost should produce lower health than transactional lost
      expect(healthWarmLost).toBeLessThan(healthTransLost);
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

  it("resets zero-lost streak when session has lost threads", () => {
    const threads = [
      {
        ...createThread("t1", "S", "s"),
        riskTier: "lost" as const,
        lifecycleState: "lost" as const,
      },
    ];
    const streaks = { ...createStreakState(), zeroLostDays: 10, lastEvaluationDate: "2026-03-30" };
    // Per Spec 07: sessionLostCount tracks threads that entered lost tier at any point
    const updated = evaluateStreaks(threads, streaks, "2026-03-31", 1);

    expect(updated.zeroLostDays).toBe(0);
  });

  it("increments zero-lost streak when sessionLostCount is 0 even if a thread is currently lost", () => {
    // A thread that shows as lost now but sessionLostCount=0 means it was already lost
    // before the day started - so the day is considered zero-lost
    const threads = [
      {
        ...createThread("t1", "S", "s"),
        riskTier: "lost" as const,
        lifecycleState: "lost" as const,
      },
    ];
    const streaks = { ...createStreakState(), zeroLostDays: 5, lastEvaluationDate: "2026-03-30" };
    const updated = evaluateStreaks(threads, streaks, "2026-03-31", 0);

    expect(updated.zeroLostDays).toBe(6);
  });

  it("resets zero-lost streak when sessionLostCount > 0 even if no threads are currently lost", () => {
    // Thread was lost but recovered - sessionLostCount still captures it
    const threads = [
      {
        ...createThread("t1", "S", "s"),
        riskTier: "safe" as const,
        lifecycleState: "active" as const,
      },
    ];
    const streaks = { ...createStreakState(), zeroLostDays: 3, lastEvaluationDate: "2026-03-30" };
    const updated = evaluateStreaks(threads, streaks, "2026-03-31", 2);

    expect(updated.zeroLostDays).toBe(0);
  });

  it("defaults sessionLostCount to 0 when not provided", () => {
    const threads = [{ ...createThread("t1", "S", "s"), riskTier: "safe" as const }];
    const streaks = { ...createStreakState(), zeroLostDays: 4, lastEvaluationDate: "2026-03-30" };
    // No sessionLostCount argument - defaults to 0
    const updated = evaluateStreaks(threads, streaks, "2026-03-31");

    expect(updated.zeroLostDays).toBe(5);
  });

  it("resets streaks when more than 1 day is missed (app closed overnight)", () => {
    // Per Spec 07: "A streak counter that resets to 0 after a missed day"
    // If the app was closed for 3 days, we cannot verify conditions were met
    const threads = [{ ...createThread("t1", "S", "s"), riskTier: "safe" as const }];
    const streaks = {
      ...createStreakState(),
      inboxZeroDays: 10,
      zeroLostDays: 7,
      lastEvaluationDate: "2026-03-28", // 3 days ago
    };
    const updated = evaluateStreaks(threads, streaks, "2026-03-31");

    // Streaks reset to 0 due to missed days, then evaluate today (all safe, no lost)
    // so they increment from 0 -> 1
    expect(updated.inboxZeroDays).toBe(1);
    expect(updated.zeroLostDays).toBe(1);
  });

  it("does not reset streaks when exactly 1 day elapsed (normal overnight)", () => {
    const threads = [{ ...createThread("t1", "S", "s"), riskTier: "safe" as const }];
    const streaks = {
      ...createStreakState(),
      inboxZeroDays: 5,
      zeroLostDays: 3,
      lastEvaluationDate: "2026-03-30", // exactly 1 day ago
    };
    const updated = evaluateStreaks(threads, streaks, "2026-03-31");

    // Normal overnight - streaks continue
    expect(updated.inboxZeroDays).toBe(6);
    expect(updated.zeroLostDays).toBe(4);
  });

  it("resets streaks on multi-day gap even if current state is good", () => {
    // Even though current threads are all safe and no lost, the 5-day gap means
    // we don't know what happened on the missed days
    const threads = [
      {
        ...createThread("t1", "S", "s"),
        riskTier: "safe" as const,
        lifecycleState: "handled" as const,
      },
    ];
    const streaks = {
      ...createStreakState(),
      inboxZeroDays: 20,
      zeroLostDays: 15,
      lastEvaluationDate: "2026-03-26", // 5 days ago
    };
    const updated = evaluateStreaks(threads, streaks, "2026-03-31");

    // Reset from multi-day gap, then evaluate today: all safe, no lost -> both = 1
    expect(updated.inboxZeroDays).toBe(1);
    expect(updated.zeroLostDays).toBe(1);
  });
});
