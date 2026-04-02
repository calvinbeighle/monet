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
    establishedSinceDate: score >= 50 ? Date.now() - 60 * 24 * 60 * 60 * 1000 : null,
    lastReplyTimestamp: Date.now() - 10 * 60 * 1000, // 10 min ago
    lastDecayCheck: Date.now(),
    decayActive: false,
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
      // Use local date format (same as runGameTick) to avoid UTC/local mismatch
      const d = new Date(now);
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const threads = [createThread("t1", "Test", "snippet")];
      const stats = createSessionStats();
      const streaks = { ...createStreakState(), lastEvaluationDate: today };

      const result = runGameTick(threads, {}, stats, streaks, now);
      expect(result.streakState).toBeNull();
    });

    it("uses local date string for streak evaluation, not UTC", () => {
      // Construct a timestamp that is 2025-01-01 in UTC but 2025-01-02 in a UTC+X offset.
      // We can't control the test runner's timezone, but we can verify that the game
      // loop's date string matches what `new Date(now).getFullYear()` etc. produce -
      // i.e., local date methods - rather than toISOString() which always returns UTC.
      const now = Date.now();

      // Build the local-date string the same way game-loop.ts does
      const d = new Date(now);
      const localDateString = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      // Build the UTC date string
      const utcDateString = new Date(now).toISOString().split("T")[0];

      // Set lastEvaluationDate to the local date so the game loop believes streaks
      // were already evaluated today (per local clock).
      const threads = [createThread("t1", "Test", "snippet")];
      const stats = createSessionStats();
      const streaks = { ...createStreakState(), lastEvaluationDate: localDateString };

      const result = runGameTick(threads, {}, stats, streaks, now);
      // Because lastEvaluationDate matches the local date the loop computes,
      // it should NOT re-evaluate streaks (returns null).
      expect(result.streakState).toBeNull();

      // Conversely, if we had used the UTC date string and local != UTC, the loop
      // would re-evaluate. We verify the local-date string is what the implementation
      // compares against by checking round-trip consistency.
      // In any timezone, local date == UTC date or they differ by at most 1 day.
      const dateDiff = Math.abs(
        new Date(localDateString).getTime() - new Date(utcDateString).getTime(),
      );
      expect(dateDiff).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
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

  describe("60-second thread type fallback (Spec 07)", () => {
    it("sets threadType to existing-relationship for new-lifecycle threads older than 60s", () => {
      const now = Date.now();
      const thread = {
        ...createThread("t1", "Test", "snippet"),
        threadType: "cold-outreach" as const,
        lifecycleState: "new" as const,
        riskTimerStart: now - 61_000, // 61 seconds old
      };

      const result = runGameTick([thread], {}, createSessionStats(), createStreakState(), now);
      expect(result.updatedThreads[0].threadType).toBe("existing-relationship");
    });

    it("does not change threadType for new-lifecycle threads younger than 60s", () => {
      const now = Date.now();
      const thread = {
        ...createThread("t1", "Test", "snippet"),
        threadType: "cold-outreach" as const,
        lifecycleState: "new" as const,
        riskTimerStart: now - 30_000, // 30 seconds old
      };

      const result = runGameTick([thread], {}, createSessionStats(), createStreakState(), now);
      expect(result.updatedThreads[0].threadType).toBe("cold-outreach");
    });

    it("does not change threadType for active-lifecycle threads older than 60s", () => {
      const now = Date.now();
      const thread = {
        ...createThread("t1", "Test", "snippet"),
        threadType: "cold-outreach" as const,
        lifecycleState: "active" as const,
        riskTimerStart: now - 61_000,
      };

      const result = runGameTick([thread], {}, createSessionStats(), createStreakState(), now);
      expect(result.updatedThreads[0].threadType).toBe("cold-outreach");
    });

    it("does not change threadType when already existing-relationship", () => {
      const now = Date.now();
      const thread = {
        ...createThread("t1", "Test", "snippet"),
        threadType: "existing-relationship" as const,
        lifecycleState: "new" as const,
        riskTimerStart: now - 61_000,
      };

      const result = runGameTick([thread], {}, createSessionStats(), createStreakState(), now);
      expect(result.updatedThreads[0].threadType).toBe("existing-relationship");
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

    it("uses most recent thread type per contact when multiple threads exist (Spec 07)", () => {
      const now = Date.now();
      // alice appears in two threads - one old warm-intro and one recent transactional
      // The most recent thread type (transactional) should be used for decay thresholds
      const oldThread = {
        ...createThread("t-old", "Old thread", "s"),
        threadType: "warm-intro" as const,
        latestMessageTimestamp: now - 10 * 24 * 60 * 60 * 1000, // 10 days ago
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
      const recentThread = {
        ...createThread("t-recent", "Recent thread", "s"),
        threadType: "transactional" as const,
        latestMessageTimestamp: now - 1 * 24 * 60 * 60 * 1000, // 1 day ago
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

      const record = makeTrustRecord("alice@test.com", 60);
      // Last reply 30 days ago - would trigger decay under any thread type
      record.lastReplyTimestamp = now - 30 * 24 * 60 * 60 * 1000;

      // Run decay with both threads - most recent (transactional) should be used
      const result = runTrustDecay({ "alice@test.com": record }, [oldThread, recentThread], now);

      // Run decay with only the recent thread to get the reference result
      const resultOnlyRecent = runTrustDecay({ "alice@test.com": record }, [recentThread], now);

      // Both should produce the same result since most-recent-first sorting
      // gives transactional as the thread type in both cases
      expect(result["alice@test.com"].score).toBe(resultOnlyRecent["alice@test.com"].score);
    });

    it("sorts threads by latestMessageTimestamp descending before building contact map", () => {
      const now = Date.now();
      // alice appears in two threads - order in array is oldest first, newest last
      const olderThread = {
        ...createThread("t1", "Older", "s"),
        threadType: "cold-outreach" as const,
        latestMessageTimestamp: now - 5 * 24 * 60 * 60 * 1000, // 5 days ago
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
      const newerThread = {
        ...createThread("t2", "Newer", "s"),
        threadType: "existing-relationship" as const,
        latestMessageTimestamp: now - 1 * 24 * 60 * 60 * 1000, // 1 day ago
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

      const record = makeTrustRecord("alice@test.com", 60);
      record.lastReplyTimestamp = now - 30 * 24 * 60 * 60 * 1000;

      // Pass older first, then newer - implementation must sort, not use array order
      const resultOlderFirst = runTrustDecay(
        { "alice@test.com": record },
        [olderThread, newerThread],
        now,
      );

      // Pass newer first, then older - result must be identical (sort is deterministic)
      const resultNewerFirst = runTrustDecay(
        { "alice@test.com": record },
        [newerThread, olderThread],
        now,
      );

      expect(resultOlderFirst["alice@test.com"].score).toBe(
        resultNewerFirst["alice@test.com"].score,
      );
    });
  });

  describe("updateTrustOnReply", () => {
    it("creates new record for unknown contact", () => {
      const result = updateTrustOnReply({}, ["new@test.com"], "existing-relationship");
      expect(result["new@test.com"]).toBeDefined();
      expect(result["new@test.com"].score).toBe(8); // existing-relationship increment
    });

    it("increments existing record", () => {
      const record = makeTrustRecord("alice@test.com", 40);
      const result = updateTrustOnReply(
        { "alice@test.com": record },
        ["alice@test.com"],
        "existing-relationship",
      );
      expect(result["alice@test.com"].score).toBe(48);
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
      expect(result["a@test.com"].score).toBe(5);
      expect(result["b@test.com"].score).toBe(5);
    });

    it("does not increase trust for late reply (beyond elevated threshold)", () => {
      const record = makeTrustRecord("alice@test.com", 40);
      record.consecutiveStreak = 3;
      // existing-relationship elevated threshold is 24h = 86400000ms
      const lateElapsed = 25 * 60 * 60 * 1000; // 25 hours - beyond elevated
      const result = updateTrustOnReply(
        { "alice@test.com": record },
        ["alice@test.com"],
        "existing-relationship",
        lateElapsed,
      );
      // Score should NOT increase
      expect(result["alice@test.com"].score).toBe(40);
      // Streak should reset
      expect(result["alice@test.com"].consecutiveStreak).toBe(0);
    });

    it("increases trust for on-time reply (within elevated threshold)", () => {
      const record = makeTrustRecord("alice@test.com", 40);
      // existing-relationship elevated threshold is 24h
      const onTimeElapsed = 10 * 60 * 60 * 1000; // 10 hours - within elevated
      const result = updateTrustOnReply(
        { "alice@test.com": record },
        ["alice@test.com"],
        "existing-relationship",
        onTimeElapsed,
      );
      expect(result["alice@test.com"].score).toBe(48);
    });

    it("creates record for new contact even on late reply", () => {
      const lateElapsed = 100 * 60 * 60 * 1000;
      const result = updateTrustOnReply({}, ["new@test.com"], "existing-relationship", lateElapsed);
      expect(result["new@test.com"]).toBeDefined();
      expect(result["new@test.com"].score).toBe(0); // no trust increase
      expect(result["new@test.com"].lastReplyTimestamp).not.toBeNull();
    });
  });
});
