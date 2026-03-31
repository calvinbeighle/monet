import { describe, it, expect } from "vitest";
import { createThread } from "./thread";

describe("Thread data model", () => {
  it("creates a thread with correct defaults", () => {
    const thread = createThread("t1", "Test Subject", "snippet");

    expect(thread.id).toBe("t1");
    expect(thread.subject).toBe("Test Subject");
    expect(thread.snippet).toBe("snippet");
    expect(thread.lifecycleState).toBe("new");
    expect(thread.riskTier).toBe("safe");
    expect(thread.urgencyScore).toBe(0.5);
    expect(thread.valueScore).toBe(0.5);
    expect(thread.zone).toBe("active-front");
    expect(thread.unread).toBe(true);
    expect(thread.participants).toEqual([]);
    expect(thread.messages).toEqual([]);
    expect(thread.stateHistory).toEqual([]);
    expect(thread.threadType).toBe("existing-relationship");
    expect(thread.opportunityState).toBe("none");
    expect(thread.visualState).toBe("idle");
    expect(thread.userOverrideZone).toBe(false);
    expect(thread.lastUserReplyTimestamp).toBeNull();
    expect(thread.neglectDuration).toBe(0);
    expect(thread.clusterMembership).toBeNull();
  });

  it("sets timestamps to current time", () => {
    const before = Date.now();
    const thread = createThread("t2", "Subject", "snip");
    const after = Date.now();

    expect(thread.latestMessageTimestamp).toBeGreaterThanOrEqual(before);
    expect(thread.latestMessageTimestamp).toBeLessThanOrEqual(after);
    expect(thread.firstMessageTimestamp).toBeGreaterThanOrEqual(before);
    expect(thread.lastModified).toBeGreaterThanOrEqual(before);
    expect(thread.riskTimerStart).toBeGreaterThanOrEqual(before);
  });
});
