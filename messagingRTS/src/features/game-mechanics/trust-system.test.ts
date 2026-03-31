import { describe, it, expect } from "vitest";
import { createTrustRecord, getTrustTier, onTimeReply, evaluateDecay } from "./trust-system";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("Trust system", () => {
  describe("getTrustTier", () => {
    it("returns correct tiers at boundaries", () => {
      expect(getTrustTier(0)).toBe("new");
      expect(getTrustTier(19)).toBe("new");
      expect(getTrustTier(20)).toBe("building");
      expect(getTrustTier(49)).toBe("building");
      expect(getTrustTier(50)).toBe("established");
      expect(getTrustTier(79)).toBe("established");
      expect(getTrustTier(80)).toBe("high-trust");
      expect(getTrustTier(100)).toBe("high-trust");
    });
  });

  describe("createTrustRecord", () => {
    it("starts at score 0, new tier", () => {
      const record = createTrustRecord("test@example.com");
      expect(record.score).toBe(0);
      expect(record.tier).toBe("new");
      expect(record.consecutiveStreak).toBe(0);
      expect(record.lastReplyTimestamp).toBeNull();
    });
  });

  describe("onTimeReply", () => {
    it("increases score by thread type amount", () => {
      const record = createTrustRecord("test@example.com");

      // existing-relationship gives +5
      const updated = onTimeReply(record, "existing-relationship");
      expect(updated.score).toBe(5);
      expect(updated.consecutiveStreak).toBe(1);
    });

    it("gives larger increment for personal thread types", () => {
      const record = createTrustRecord("test@example.com");

      const existingReply = onTimeReply(record, "existing-relationship");
      const transactionalReply = onTimeReply(record, "transactional");

      expect(existingReply.score).toBeGreaterThan(transactionalReply.score);
    });

    it("increments consecutive streak", () => {
      let record = createTrustRecord("test@example.com");
      record = onTimeReply(record, "existing-relationship");
      record = onTimeReply(record, "existing-relationship");
      record = onTimeReply(record, "existing-relationship");

      expect(record.consecutiveStreak).toBe(3);
    });

    it("transitions tier when crossing boundary", () => {
      let record = createTrustRecord("test@example.com");
      // Start at 0 (new), need 20 to reach building
      for (let i = 0; i < 4; i++) {
        record = onTimeReply(record, "existing-relationship"); // +5 each
      }
      // Score should be 20
      expect(record.score).toBe(20);
      expect(record.tier).toBe("building");
    });

    it("caps score at 100", () => {
      let record = createTrustRecord("test@example.com");
      record.score = 98;
      record.tier = "high-trust";

      record = onTimeReply(record, "existing-relationship"); // +5 but capped
      expect(record.score).toBe(100);
    });

    it("sets lastReplyTimestamp", () => {
      const now = Date.now();
      const record = createTrustRecord("test@example.com");
      const updated = onTimeReply(record, "existing-relationship", now);
      expect(updated.lastReplyTimestamp).toBe(now);
    });
  });

  describe("evaluateDecay", () => {
    it("does not decay when no prior interaction", () => {
      const record = createTrustRecord("test@example.com");
      const decayed = evaluateDecay(record, "existing-relationship");
      expect(decayed.score).toBe(0);
    });

    it("does not decay within threshold", () => {
      const now = Date.now();
      const record = createTrustRecord("test@example.com");
      record.score = 50;
      record.tier = "established";
      record.lastReplyTimestamp = now - 1 * HOUR; // recent reply

      const decayed = evaluateDecay(record, "existing-relationship", now);
      expect(decayed.score).toBe(50); // no decay
    });

    it("decays when past 2x critical threshold", () => {
      const now = Date.now();
      const record = createTrustRecord("test@example.com");
      record.score = 50;
      record.tier = "established";
      // existing-relationship critical = 48h, so 2x = 96h
      record.lastReplyTimestamp = now - 100 * HOUR;
      record.tierEntryDate = now - 10 * DAY; // less than 30 days

      const decayed = evaluateDecay(record, "existing-relationship", now);
      expect(decayed.score).toBeLessThan(50);
      expect(decayed.consecutiveStreak).toBe(0); // streak reset
    });

    it("respects established floor protection after 30 days", () => {
      const now = Date.now();
      const record = createTrustRecord("test@example.com");
      record.score = 52; // just above established minimum (50)
      record.tier = "established";
      record.tierEntryDate = now - 35 * DAY; // 35 days at tier (>30)
      record.lastReplyTimestamp = now - 200 * HOUR; // well past decay threshold

      const decayed = evaluateDecay(record, "existing-relationship", now);
      // Should not drop below 50 (established floor)
      expect(decayed.score).toBeGreaterThanOrEqual(50);
    });

    it("does not protect new contacts from decay", () => {
      const now = Date.now();
      const record = createTrustRecord("test@example.com");
      record.score = 30;
      record.tier = "building";
      record.tierEntryDate = now - 60 * DAY;
      record.lastReplyTimestamp = now - 200 * HOUR;

      const decayed = evaluateDecay(record, "existing-relationship", now);
      expect(decayed.score).toBeLessThan(30); // no floor protection
    });
  });
});
