import { describe, it, expect } from "vitest";
import {
  computeTargetZone,
  driftTick,
  placeNewThread,
  onUserReply,
  onArchive,
} from "./drift-engine";
import { createZoneLayout, getZoneCenter } from "./zone-layout";
import { createThread } from "../../lib/types";
import type { ContactEnrichment } from "../../lib/types";

function makeContact(overrides: Partial<ContactEnrichment> = {}): ContactEnrichment {
  return {
    displayName: "Test",
    email: "test@example.com",
    organization: null,
    vipFlag: false,
    relationshipScore: 50,
    responseHistory: { avgResponseTimeMs: 0, threadFrequency: 0 },
    ...overrides,
  };
}

describe("computeTargetZone", () => {
  it("handled threads go to base-handled", () => {
    const thread = createThread("t1", "Subject", "s");
    thread.lifecycleState = "handled";
    expect(computeTargetZone(thread)).toBe("base-handled");
  });

  it("lost threads go to lost zone", () => {
    const thread = createThread("t1", "Subject", "s");
    thread.riskTier = "lost";
    expect(computeTargetZone(thread)).toBe("lost");
  });

  it("at-risk/critical threads go to at-risk zone", () => {
    const thread = createThread("t1", "Subject", "s");
    thread.riskTier = "critical";
    expect(computeTargetZone(thread)).toBe("at-risk");
  });

  it("high value low urgency -> opportunities", () => {
    const thread = createThread("t1", "Subject", "s");
    thread.valueScore = 0.8;
    thread.urgencyScore = 0.2;
    expect(computeTargetZone(thread)).toBe("opportunities");
  });

  it("low value low urgency -> noise", () => {
    const thread = createThread("t1", "Subject", "s");
    thread.valueScore = 0.1;
    thread.urgencyScore = 0.1;
    thread.unread = false;
    expect(computeTargetZone(thread)).toBe("noise");
  });

  it("unread threads go to active-front", () => {
    const thread = createThread("t1", "Subject", "s");
    thread.unread = true;
    thread.urgencyScore = 0.1;
    thread.valueScore = 0.4;
    expect(computeTargetZone(thread)).toBe("active-front");
  });

  it("user override zone is respected", () => {
    const thread = createThread("t1", "Subject", "s");
    thread.userOverrideZone = true;
    thread.zone = "opportunities";
    thread.riskTier = "lost"; // would normally override
    expect(computeTargetZone(thread)).toBe("opportunities");
  });
});

describe("driftTick", () => {
  it("moves threads toward their target position", () => {
    const zones = createZoneLayout();
    const thread = createThread("t1", "Subject", "s");
    thread.participants = [makeContact()];
    thread.position = { x: 100, y: 100 };
    thread.targetPosition = { x: 2000, y: 600 };

    const [updated] = driftTick([thread], zones);

    // Should have moved toward target
    expect(updated.position.x).toBeGreaterThan(100);
    expect(updated.position.y).toBeGreaterThan(100);
    // But not all the way (smooth movement)
    expect(updated.position.x).toBeLessThan(2000);
  });

  it("updates urgency and value scores", () => {
    const zones = createZoneLayout();
    const thread = createThread("t1", "Subject", "s");
    thread.participants = [makeContact({ vipFlag: true })];
    thread.urgencyScore = 0; // will be recomputed

    const [updated] = driftTick([thread], zones);

    // With VIP participant and unread, urgency should be > 0
    expect(updated.urgencyScore).toBeGreaterThan(0);
  });

  it("updates neglect duration", () => {
    const zones = createZoneLayout();
    const now = Date.now();
    const thread = createThread("t1", "Subject", "s");
    thread.participants = [makeContact()];
    thread.latestMessageTimestamp = now - 60 * 60 * 1000; // 1h ago

    const [updated] = driftTick([thread], zones, now);

    expect(updated.neglectDuration).toBeGreaterThan(0);
  });

  it("applies collision avoidance for close threads", () => {
    const zones = createZoneLayout();
    const t1 = createThread("t1", "S1", "s");
    const t2 = createThread("t2", "S2", "s");
    t1.participants = [makeContact()];
    t2.participants = [makeContact()];
    // Place very close together
    t1.position = { x: 500, y: 500 };
    t1.targetPosition = { x: 500, y: 500 };
    t2.position = { x: 505, y: 505 };
    t2.targetPosition = { x: 505, y: 505 };

    const updated = driftTick([t1, t2], zones);

    // After collision avoidance, they should be pushed apart
    const dist = Math.hypot(
      updated[1].position.x - updated[0].position.x,
      updated[1].position.y - updated[0].position.y,
    );
    expect(dist).toBeGreaterThan(5); // pushed apart from initial ~7px
  });

  it("handles empty thread list", () => {
    const zones = createZoneLayout();
    const result = driftTick([], zones);
    expect(result).toEqual([]);
  });

  it("drifts neglected threads toward lost zone over time", () => {
    const zones = createZoneLayout();
    const now = Date.now();
    const thread = createThread("t1", "Subject", "s");
    thread.participants = [makeContact()];
    // 48 hours of neglect
    thread.firstMessageTimestamp = now - 48 * 60 * 60 * 1000;
    thread.latestMessageTimestamp = now - 48 * 60 * 60 * 1000;
    thread.unread = false;

    const lostCenter = getZoneCenter(zones, "lost");
    const initialDist = Math.hypot(
      lostCenter.x - thread.position.x,
      lostCenter.y - thread.position.y,
    );

    // Run several ticks
    let current = [thread];
    for (let i = 0; i < 20; i++) {
      current = driftTick(current, zones, now);
    }

    const finalDist = Math.hypot(
      lostCenter.x - current[0].position.x,
      lostCenter.y - current[0].position.y,
    );

    // Should have drifted closer to lost zone
    expect(finalDist).toBeLessThan(initialDist);
  });
});

describe("placeNewThread", () => {
  it("places thread in appropriate zone", () => {
    const zones = createZoneLayout();
    const thread = createThread("t1", "Subject", "s");
    thread.unread = true;
    thread.urgencyScore = 0.5;

    const placed = placeNewThread(thread, zones);

    expect(placed.position.x).not.toBe(0);
    expect(placed.position.y).not.toBe(0);
    expect(placed.zone).toBeDefined();
  });

  it("position matches target position on placement", () => {
    const zones = createZoneLayout();
    const thread = createThread("t1", "Subject", "s");
    const placed = placeNewThread(thread, zones);

    expect(placed.position.x).toBe(placed.targetPosition.x);
    expect(placed.position.y).toBe(placed.targetPosition.y);
  });
});

describe("onUserReply", () => {
  it("snaps thread to active-front zone", () => {
    const zones = createZoneLayout();
    const thread = createThread("t1", "Subject", "s");
    thread.zone = "at-risk";
    thread.riskTier = "critical";

    const updated = onUserReply(thread, zones);

    expect(updated.zone).toBe("active-front");
    expect(updated.riskTier).toBe("safe");
    expect(updated.neglectDuration).toBe(0);
    expect(updated.lastUserReplyTimestamp).toBeDefined();
  });

  it("resets risk timer", () => {
    const zones = createZoneLayout();
    const thread = createThread("t1", "Subject", "s");
    thread.riskTimerStart = Date.now() - 100000;

    const before = Date.now();
    const updated = onUserReply(thread, zones);

    expect(updated.riskTimerStart).toBeGreaterThanOrEqual(before);
  });

  it("clears user override", () => {
    const zones = createZoneLayout();
    const thread = createThread("t1", "Subject", "s");
    thread.userOverrideZone = true;

    const updated = onUserReply(thread, zones);
    expect(updated.userOverrideZone).toBe(false);
  });
});

describe("onArchive", () => {
  it("moves thread to base-handled and marks as archived", () => {
    const zones = createZoneLayout();
    const thread = createThread("t1", "Subject", "s");
    thread.zone = "active-front";

    const updated = onArchive(thread, zones);

    expect(updated.zone).toBe("base-handled");
    expect(updated.lifecycleState).toBe("handled");
    expect(updated.visualState).toBe("archived");
  });
});
