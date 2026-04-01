import { describe, it, expect } from "vitest";
import {
  evaluateOpportunity,
  flagOpportunity,
  captureOpportunity,
  tickOpportunities,
  DEFAULT_WINDOW_MS,
} from "./opportunity-system";
import { createThread } from "../../lib/types";

describe("Opportunity system", () => {
  describe("evaluateOpportunity", () => {
    it("returns none for unflagged thread", () => {
      const thread = createThread("t1", "S", "s");
      const result = evaluateOpportunity(thread);
      expect(result.state).toBe("none");
    });

    it("returns ripe when >50% window remaining", () => {
      const now = Date.now();
      const thread = createThread("t1", "S", "s");
      thread.opportunityState = "ripe";
      thread.opportunityWindowEnd = now + DEFAULT_WINDOW_MS; // full window

      const result = evaluateOpportunity(thread, now);
      expect(result.state).toBe("ripe");
    });

    it("returns fading when <50% window remaining", () => {
      const now = Date.now();
      const thread = createThread("t1", "S", "s");
      thread.opportunityState = "ripe";
      // Window end = now + 1h (less than half of 4h window)
      thread.opportunityWindowEnd = now + 60 * 60 * 1000;

      const result = evaluateOpportunity(thread, now);
      expect(result.state).toBe("fading");
    });

    it("returns expired when window has elapsed", () => {
      const now = Date.now();
      const thread = createThread("t1", "S", "s");
      thread.opportunityState = "ripe";
      thread.opportunityWindowEnd = now - 1000; // past

      const result = evaluateOpportunity(thread, now);
      expect(result.state).toBe("expired");
    });

    it("preserves captured state", () => {
      const thread = createThread("t1", "S", "s");
      thread.opportunityState = "captured";
      thread.opportunityWindowEnd = Date.now() - 1000;

      const result = evaluateOpportunity(thread);
      expect(result.state).toBe("captured");
    });

    it("preserves expired state", () => {
      const thread = createThread("t1", "S", "s");
      thread.opportunityState = "expired";

      const result = evaluateOpportunity(thread);
      expect(result.state).toBe("expired");
    });

    it("uses stored window start for custom duration windows (Spec 07)", () => {
      const now = Date.now();
      const thread = createThread("t1", "S", "s");
      const customWindow = 2 * 60 * 60 * 1000; // 2 hours

      // Flag with custom window
      thread.opportunityState = "ripe";
      thread.opportunityWindowStart = now;
      thread.opportunityWindowEnd = now + customWindow;

      // At 40% through window (48 min) - should be ripe (< 50%)
      const result40 = evaluateOpportunity(thread, now + customWindow * 0.4);
      expect(result40.state).toBe("ripe");

      // At 60% through window (72 min) - should be fading (> 50%)
      const result60 = evaluateOpportunity(thread, now + customWindow * 0.6);
      expect(result60.state).toBe("fading");
    });
  });

  describe("flagOpportunity", () => {
    it("sets ripe state with window end", () => {
      const now = Date.now();
      const thread = createThread("t1", "S", "s");
      const flagged = flagOpportunity(thread, DEFAULT_WINDOW_MS, now);

      expect(flagged.opportunityState).toBe("ripe");
      expect(flagged.opportunityWindowEnd).toBe(now + DEFAULT_WINDOW_MS);
    });

    it("stores opportunity window start timestamp (Spec 07)", () => {
      const now = Date.now();
      const thread = createThread("t1", "S", "s");
      const flagged = flagOpportunity(thread, DEFAULT_WINDOW_MS, now);

      expect(flagged.opportunityWindowStart).toBe(now);
    });

    it("uses custom window duration correctly with stored start", () => {
      const now = Date.now();
      const thread = createThread("t1", "S", "s");
      const customWindow = 2 * 60 * 60 * 1000; // 2 hours
      const flagged = flagOpportunity(thread, customWindow, now);

      expect(flagged.opportunityWindowStart).toBe(now);
      expect(flagged.opportunityWindowEnd).toBe(now + customWindow);
    });
  });

  describe("captureOpportunity", () => {
    it("captures when ripe", () => {
      const thread = createThread("t1", "S", "s");
      thread.opportunityState = "ripe";
      thread.opportunityWindowEnd = Date.now() + DEFAULT_WINDOW_MS;

      const captured = captureOpportunity(thread);
      expect(captured.opportunityState).toBe("captured");
    });

    it("captures when fading", () => {
      const thread = createThread("t1", "S", "s");
      thread.opportunityState = "fading";
      thread.opportunityWindowEnd = Date.now() + 1000;

      const captured = captureOpportunity(thread);
      expect(captured.opportunityState).toBe("captured");
    });

    it("does not capture when none", () => {
      const thread = createThread("t1", "S", "s");
      const result = captureOpportunity(thread);
      expect(result.opportunityState).toBe("none");
    });

    it("does not capture when already expired", () => {
      const thread = createThread("t1", "S", "s");
      thread.opportunityState = "expired";
      const result = captureOpportunity(thread);
      expect(result.opportunityState).toBe("expired");
    });
  });

  describe("tickOpportunities", () => {
    it("transitions ripe to expired when window elapses", () => {
      const now = Date.now();
      const thread = createThread("t1", "S", "s");
      thread.opportunityState = "ripe";
      thread.opportunityWindowEnd = now - 1000; // past

      const [updated] = tickOpportunities([thread], now);
      expect(updated.opportunityState).toBe("expired");
    });

    it("leaves none threads unchanged", () => {
      const thread = createThread("t1", "S", "s");
      const [updated] = tickOpportunities([thread]);
      expect(updated.opportunityState).toBe("none");
    });

    it("transitions ripe to fading at 50% threshold", () => {
      const now = Date.now();
      const thread = createThread("t1", "S", "s");
      thread.opportunityState = "ripe";
      // Set window end so that we're past the half point
      thread.opportunityWindowEnd = now + DEFAULT_WINDOW_MS * 0.3; // 30% remaining

      const [updated] = tickOpportunities([thread], now);
      expect(updated.opportunityState).toBe("fading");
    });

    it("does not modify captured threads", () => {
      const thread = createThread("t1", "S", "s");
      thread.opportunityState = "captured";

      const [updated] = tickOpportunities([thread]);
      expect(updated.opportunityState).toBe("captured");
    });
  });
});
