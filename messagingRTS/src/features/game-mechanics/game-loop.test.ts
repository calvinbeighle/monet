import { describe, it, expect, beforeEach } from "vitest";
import {
  runGameTick,
  isTrustDecayDue,
  runTrustDecay,
  updateTrustOnReply,
  _resetGameLoopTimers,
} from "./game-loop";
import { createThread } from "../../lib/types";
import { createSessionStats, createStreakState } from "./front-health";
import type { TrustRecord } from "../../lib/types/game-mechanics";

function makeTrustRecord(email: string, score: number): TrustRecord {
  return {
    contactEmail: email,
    score,
    tier:
      score >= 80 ? "high-trust" : score >= 50 ? "established" : score >= 20 ? "building" : "new",
    consecutiveStreak: 0,
    tierEntryDate: Date.now() - 60 * 24 * 60 * 60 * 1000, // 60 days ago
    lastReplyTimestamp: Date.now() - 10 * 60 * 1000, // 10 min ago
    lastDecayCheck: Date.now(),
  };
}

describe("Game loop", () => {
  beforeEach(() => {
    _resetGameLoopTimers();
  });

  describe("runGameTick", () => {
    it("returns threads unchanged when no opportunities are active", () => {
      const threads = [createThread("t1", "Test", "snippet")];
      const stats = createSessionStats();
      const streaks = createStreakState();

      const result = runGameTick(threads, {}, stats, streaks);
      expect(result.updatedThreads).toHaveLength(1);
      expect(result.updatedThreads[0].opportunityState).toBe("none");
    });

    it("transitions ripe to fading when past half window", () => {
      const now = Date.now();
      const windowEnd = now + 1000; // 1 second left out of 4hr window = well past half
      const thread = {
        ...createThread("t1", "Test", "snippet"),
        opportunityState: "ripe" as const,
        opportunityWindowEnd: windowEnd,
      };

      const result = runGameTick([thread], {}, createSessionStats(), createStreakState(), now);
      expect(result.updatedThreads[0].opportunityState).toBe("fading");
    });

    it("transitions fading to expired when window elapses", () => {
      const now = Date.now();
      const thread = {
        ...createThread("t1", "Test", "snippet"),
        opportunityState: "fading" as const,
        opportunityWindowEnd: now - 1000, // expired
      };

      const result = runGameTick([thread], {}, createSessionStats(), createStreakState(), now);
      expect(result.updatedThreads[0].opportunityState).toBe("expired");
    });

    it("tracks missed opportunities in session stats delta", () => {
      const now = Date.now();
      const thread = {
        ...createThread("t1", "Test", "snippet"),
        opportunityState: "ripe" as const,
        opportunityWindowEnd: now - 1000, // expired
      };
      const stats = createSessionStats();

      const result = runGameTick([thread], {}, stats, createStreakState(), now);
      expect(result.sessionStatsDelta).toBeTruthy();
      expect(result.sessionStatsDelta!.opportunitiesMissed).toBe(1);
    });

    it("computes front health on first tick (timer starts at 0)", () => {
      const threads = [createThread("t1", "Test", "snippet")];
      const stats = createSessionStats();
      const streaks = createStreakState();

      const result = runGameTick(threads, {}, stats, streaks);
      // Timer starts at 0, so first call always computes
      expect(result.frontHealthScore).not.toBeNull();
      expect(result.frontHealthScore).toBeGreaterThanOrEqual(0);
      expect(result.frontHealthScore).toBeLessThanOrEqual(100);
    });

    it("throttles front health computation", () => {
      const threads = [createThread("t1", "Test", "snippet")];
      const stats = createSessionStats();
      const streaks = createStreakState();
      const now = Date.now();

      // First call computes
      const result1 = runGameTick(threads, {}, stats, streaks, now);
      expect(result1.frontHealthScore).not.toBeNull();

      // Second call 1s later should skip (< 5s throttle)
      const result2 = runGameTick(threads, {}, stats, streaks, now + 1000);
      expect(result2.frontHealthScore).toBeNull();

      // Third call 6s later should compute
      const result3 = runGameTick(threads, {}, stats, streaks, now + 6000);
      expect(result3.frontHealthScore).not.toBeNull();
    });

    it("evaluates streaks when date changes", () => {
      const threads = [
        {
          ...createThread("t1", "Test", "snippet"),
          riskTier: "safe" as const,
          lifecycleState: "active" as const,
        },
      ];
      const stats = createSessionStats();
      const streaks = createStreakState();

      const result = runGameTick(threads, {}, stats, streaks);
      // Streaks should be evaluated on first tick (lastEvaluationDate is "")
      expect(result.streakState).not.toBeNull();
      expect(result.streakState!.inboxZeroDays).toBe(1); // all safe
      expect(result.streakState!.zeroLostDays).toBe(1); // no lost
    });

    it("does not update streaks when already evaluated today", () => {
      const now = Date.now();
      const today = new Date(now).toISOString().split("T")[0];
      const threads = [createThread("t1", "Test", "snippet")];
      const stats = createSessionStats();
      const streaks = { ...createStreakState(), lastEvaluationDate: today };

      const result = runGameTick(threads, {}, stats, streaks, now);
      expect(result.streakState).toBeNull();
    });

    it("tracks lost thread count in session stats", () => {
      const now = Date.now();
      const thread = {
        ...createThread("t1", "Test", "snippet"),
        riskTier: "lost" as const,
      };
      const stats = createSessionStats();

      const result = runGameTick([thread], {}, stats, createStreakState(), now);
      expect(result.sessionStatsDelta).toBeTruthy();
      expect(result.sessionStatsDelta!.lostThreadCount).toBe(1);

      // Second tick should not double-count
      const result2 = runGameTick([thread], {}, stats, createStreakState(), now + 200);
      expect(result2.sessionStatsDelta).toBeNull();
    });
  });

  describe("isTrustDecayDue", () => {
    it("returns true when enough time has passed", () => {
      const now = Date.now();
      expect(isTrustDecayDue(now)).toBe(true); // timer starts at 0
    });

    it("returns false immediately after a game tick that triggered decay", () => {
      const now = Date.now();
      // Run a tick to set the decay timer
      runGameTick(
        [createThread("t1", "Test", "snippet")],
        {},
        createSessionStats(),
        createStreakState(),
        now,
      );
      // 1 second later, not due yet
      expect(isTrustDecayDue(now + 1000)).toBe(false);
    });
  });

  describe("runTrustDecay", () => {
    it("applies decay to neglected contacts", () => {
      const now = Date.now();
      // Last reply was 30 days ago - well past 2x critical threshold for existing-relationship
      const record = makeTrustRecord("alice@test.com", 60);
      record.lastReplyTimestamp = now - 30 * 24 * 60 * 60 * 1000;

      const thread = {
        ...createThread("t1", "Test", "snippet"),
        participants: [
          {
            email: "alice@test.com",
            displayName: "Alice",
            organization: "",
            vipFlag: false,
            relationshipScore: 0,
            responseHistory: { avgResponseTimeMs: 0, threadFrequency: 0 },
          },
        ],
      };

      const result = runTrustDecay({ "alice@test.com": record }, [thread], now);
      expect(result["alice@test.com"].score).toBeLessThan(60);
    });

    it("returns same object reference when no changes", () => {
      const record = makeTrustRecord("alice@test.com", 60);
      // Recent reply, no decay
      record.lastReplyTimestamp = Date.now() - 1000;

      const records = { "alice@test.com": record };
      const result = runTrustDecay(records, [], Date.now());
      expect(result).toBe(records); // same reference = no changes
    });
  });

  describe("updateTrustOnReply", () => {
    it("creates new record for unknown contact", () => {
      const result = updateTrustOnReply({}, ["new@test.com"], "existing-relationship");
      expect(result["new@test.com"]).toBeDefined();
      expect(result["new@test.com"].score).toBe(5); // existing-relationship increment
    });

    it("increments existing record", () => {
      const record = makeTrustRecord("alice@test.com", 40);
      const result = updateTrustOnReply(
        { "alice@test.com": record },
        ["alice@test.com"],
        "existing-relationship",
      );
      expect(result["alice@test.com"].score).toBe(45);
    });

    it("uses correct increment per thread type", () => {
      const result1 = updateTrustOnReply({}, ["a@test.com"], "cold-outreach");
      expect(result1["a@test.com"].score).toBe(2);

      const result2 = updateTrustOnReply({}, ["b@test.com"], "transactional");
      expect(result2["b@test.com"].score).toBe(1);
    });

    it("updates multiple participants", () => {
      const result = updateTrustOnReply({}, ["a@test.com", "b@test.com"], "warm-intro");
      expect(Object.keys(result)).toHaveLength(2);
      expect(result["a@test.com"].score).toBe(3);
      expect(result["b@test.com"].score).toBe(3);
    });
  });
});
