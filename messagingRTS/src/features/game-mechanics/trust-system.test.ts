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

      // existing-relationship gives +8 (highest, proportional to 24h tolerance)
      const updated = onTimeReply(record, "existing-relationship");
      expect(updated.score).toBe(8);
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
      // existing-relationship gives +8, so 3 replies = 24 (building tier)
      for (let i = 0; i < 3; i++) {
        record = onTimeReply(record, "existing-relationship"); // +8 each
      }
      // Score should be 24
      expect(record.score).toBe(24);
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

    it("sets establishedSinceDate when first reaching established tier", () => {
      const now = Date.now();
      const record = createTrustRecord("test@example.com");
      record.score = 48; // building, about to cross to established
      record.tier = "building";

      const updated = onTimeReply(record, "existing-relationship", now); // +8 = 56
      expect(updated.tier).toBe("established");
      expect(updated.establishedSinceDate).toBe(now);
    });

    it("preserves establishedSinceDate on upward transition to high-trust", () => {
      const now = Date.now();
      const oldDate = now - 40 * DAY;
      const record = createTrustRecord("test@example.com");
      record.score = 78; // established, about to cross to high-trust
      record.tier = "established";
      record.establishedSinceDate = oldDate;

      const updated = onTimeReply(record, "existing-relationship", now); // +8 = 86
      expect(updated.tier).toBe("high-trust");
      // Should preserve the original date, not reset
      expect(updated.establishedSinceDate).toBe(oldDate);
    });
  });

  describe("createTrustRecord", () => {
    it("defaults decayActive to false", () => {
      const record = createTrustRecord("test@example.com");
      expect(record.decayActive).toBe(false);
    });
  });

  describe("decayActive flag (Spec 07)", () => {
    it("sets decayActive to true when decay is active", () => {
      const now = Date.now();
      const record = createTrustRecord("test@example.com");
      record.score = 50;
      record.tier = "established";
      // existing-relationship critical = 48h, so 2x = 96h
      record.lastReplyTimestamp = now - 100 * HOUR;
      record.tierEntryDate = now - 10 * DAY;
      record.establishedSinceDate = now - 10 * DAY;

      const decayed = evaluateDecay(record, "existing-relationship", now);
      expect(decayed.decayActive).toBe(true);
    });

    it("sets decayActive to false when within threshold (no decay)", () => {
      const now = Date.now();
      const record = createTrustRecord("test@example.com");
      record.score = 50;
      record.tier = "established";
      record.lastReplyTimestamp = now - 1 * HOUR; // recent, no decay
      record.decayActive = true; // was previously active

      const result = evaluateDecay(record, "existing-relationship", now);
      expect(result.decayActive).toBe(false);
    });

    it("onTimeReply clears decayActive", () => {
      const record = createTrustRecord("test@example.com");
      record.score = 40;
      record.tier = "building";
      record.decayActive = true;

      const updated = onTimeReply(record, "existing-relationship");
      expect(updated.decayActive).toBe(false);
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
      record.establishedSinceDate = now - 10 * DAY; // less than 30 days - no floor

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
      record.establishedSinceDate = now - 35 * DAY; // 35 days at or above established
      record.lastReplyTimestamp = now - 200 * HOUR; // well past decay threshold

      const decayed = evaluateDecay(record, "existing-relationship", now);
      // Should not drop below 50 (established floor)
      expect(decayed.score).toBeGreaterThanOrEqual(50);
    });

    it("floor protection survives upward tier transition (established -> high-trust)", () => {
      const now = Date.now();
      // Contact reached established 35 days ago, then was promoted to high-trust
      const record = createTrustRecord("test@example.com");
      record.score = 82; // high-trust
      record.tier = "high-trust";
      record.tierEntryDate = now - 5 * DAY; // only 5 days at high-trust
      record.establishedSinceDate = now - 35 * DAY; // but 35 days at or above established
      record.lastReplyTimestamp = now - 200 * HOUR; // well past decay threshold

      const decayed = evaluateDecay(record, "existing-relationship", now);
      // Floor protection should still apply because establishedSinceDate is 35+ days ago
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

  describe("trust increment proportionality (Spec 07)", () => {
    it("existing-relationship increment is significantly larger than internal", () => {
      const record = createTrustRecord("test@example.com");
      const existingReply = onTimeReply(record, "existing-relationship");
      const internalReply = onTimeReply(record, "internal");

      // Per Spec 07: "larger for high-latency-tolerance thread types (existing-relationship)
      // than for low-latency-tolerance types (internal)"
      // Gap should reflect 6x tolerance ratio (24h vs 4h)
      expect(existingReply.score - internalReply.score).toBeGreaterThanOrEqual(4);
    });

    it("warm-intro gets more than cold-outreach", () => {
      const record = createTrustRecord("test@example.com");
      const warmReply = onTimeReply(record, "warm-intro");
      const coldReply = onTimeReply(record, "cold-outreach");

      expect(warmReply.score).toBeGreaterThan(coldReply.score);
    });

    it("transactional gets the smallest increment", () => {
      const record = createTrustRecord("test@example.com");
      const transReply = onTimeReply(record, "transactional");
      const coldReply = onTimeReply(record, "cold-outreach");
      const internalReply = onTimeReply(record, "internal");

      expect(transReply.score).toBeLessThan(coldReply.score);
      expect(transReply.score).toBeLessThan(internalReply.score);
    });
  });
});
