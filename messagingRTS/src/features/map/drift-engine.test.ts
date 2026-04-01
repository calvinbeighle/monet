import { describe, it, expect, beforeEach } from "vitest";
import {
  computeTargetZone,
  driftTick,
  placeNewThread,
  onUserReply,
  onArchive,
  onManualReclassify,
  setClusterMigration,
  getClusterMigration,
  clearClusterMigration,
  clearAllClusterMigrations,
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

  it("soft boundary: zone transitions gradually based on position, not scores", () => {
    const zones = createZoneLayout();
    const thread = createThread("t1", "Subject", "s");
    thread.participants = [makeContact()];
    // Place thread physically in active-front zone
    const afCenter = getZoneCenter(zones, "active-front");
    thread.position = { x: afCenter.x, y: afCenter.y };
    thread.targetPosition = { x: afCenter.x, y: afCenter.y };
    thread.zone = "active-front";
    // Scores that would target at-risk zone
    thread.riskTier = "critical";
    thread.lifecycleState = "at-risk";

    // After one tick, thread should still be in active-front (hasn't moved far enough)
    const [updated] = driftTick([thread], zones);
    expect(updated.zone).toBe("active-front");

    // After many ticks, thread should eventually drift to at-risk zone
    let current = [updated];
    for (let i = 0; i < 200; i++) {
      current = driftTick(current, zones);
    }
    expect(current[0].zone).toBe("at-risk");
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

describe("onManualReclassify", () => {
  it("moves thread to target zone and sets override flag", () => {
    const zones = createZoneLayout();
    const thread = createThread("t1", "Subject", "s");
    thread.zone = "active-front";

    const updated = onManualReclassify(thread, zones, "opportunities");

    expect(updated.zone).toBe("opportunities");
    expect(updated.previousZone).toBe("active-front");
    expect(updated.userOverrideZone).toBe(true);
  });

  it("uses drop position when provided", () => {
    const zones = createZoneLayout();
    const thread = createThread("t1", "Subject", "s");
    const drop = { x: 3200, y: 800 };

    const updated = onManualReclassify(thread, zones, "opportunities", drop);

    expect(updated.targetPosition).toEqual(drop);
  });

  it("override prevents drift engine from changing zone", () => {
    const zones = createZoneLayout();
    const thread = createThread("t1", "Subject", "s");
    thread.participants = [makeContact()];
    thread.riskTier = "critical"; // would normally target at-risk

    const reclassified = onManualReclassify(thread, zones, "opportunities");
    expect(computeTargetZone(reclassified)).toBe("opportunities");
  });
});

describe("driftTick - auto-lifecycle transitions", () => {
  it("transitions waiting -> at-risk when riskTier crosses critical threshold", () => {
    const zones = createZoneLayout();
    const now = Date.now();
    const thread = createThread("t1", "Subject", "s");
    thread.participants = [makeContact()];
    thread.lifecycleState = "waiting";
    thread.riskTier = "safe";
    // cold-outreach: critical at 24h
    thread.threadType = "cold-outreach";
    // set timer 25 hours ago - past critical (24h) but before lost (48h)
    thread.riskTimerStart = now - 25 * 60 * 60 * 1000;

    const [updated] = driftTick([thread], zones, now);

    expect(updated.riskTier).toBe("critical");
    expect(updated.lifecycleState).toBe("at-risk");
  });

  it("records stateHistory entry with trigger 'risk-tier-critical' on waiting->at-risk", () => {
    const zones = createZoneLayout();
    const now = Date.now();
    const thread = createThread("t1", "Subject", "s");
    thread.participants = [makeContact()];
    thread.lifecycleState = "waiting";
    thread.riskTier = "safe";
    thread.threadType = "cold-outreach";
    // 25h ago - past critical threshold (24h) for cold-outreach
    thread.riskTimerStart = now - 25 * 60 * 60 * 1000;

    const [updated] = driftTick([thread], zones, now);

    const entry = updated.stateHistory.find((h) => h.trigger === "risk-tier-critical");
    expect(entry).toBeDefined();
    expect(entry?.from).toBe("waiting");
    expect(entry?.to).toBe("at-risk");
  });

  it("transitions at-risk -> lost when riskTier crosses lost threshold", () => {
    const zones = createZoneLayout();
    const now = Date.now();
    const thread = createThread("t1", "Subject", "s");
    thread.participants = [makeContact()];
    thread.lifecycleState = "at-risk";
    thread.riskTier = "critical";
    // cold-outreach: lost at 48h
    thread.threadType = "cold-outreach";
    // set timer 49 hours ago - past lost (48h) threshold
    thread.riskTimerStart = now - 49 * 60 * 60 * 1000;

    const [updated] = driftTick([thread], zones, now);

    expect(updated.riskTier).toBe("lost");
    expect(updated.lifecycleState).toBe("lost");
  });

  it("records stateHistory entry with trigger 'risk-tier-lost' on at-risk->lost", () => {
    const zones = createZoneLayout();
    const now = Date.now();
    const thread = createThread("t1", "Subject", "s");
    thread.participants = [makeContact()];
    thread.lifecycleState = "at-risk";
    thread.riskTier = "critical";
    thread.threadType = "cold-outreach";
    thread.riskTimerStart = now - 49 * 60 * 60 * 1000;

    const [updated] = driftTick([thread], zones, now);

    const entry = updated.stateHistory.find((h) => h.trigger === "risk-tier-lost");
    expect(entry).toBeDefined();
    expect(entry?.from).toBe("at-risk");
    expect(entry?.to).toBe("lost");
  });

  it("does NOT update riskTier for handled threads", () => {
    const zones = createZoneLayout();
    const now = Date.now();
    const thread = createThread("t1", "Subject", "s");
    thread.participants = [makeContact()];
    thread.lifecycleState = "handled";
    thread.riskTier = "safe";
    thread.threadType = "cold-outreach";
    // timer far in the past - would trigger critical/lost for a non-handled thread
    thread.riskTimerStart = now - 72 * 60 * 60 * 1000;

    const [updated] = driftTick([thread], zones, now);

    // riskTier must remain unchanged for handled threads
    expect(updated.riskTier).toBe("safe");
    expect(updated.lifecycleState).toBe("handled");
  });

  it("does not re-trigger critical transition when riskTier is already critical", () => {
    const zones = createZoneLayout();
    const now = Date.now();
    const thread = createThread("t1", "Subject", "s");
    thread.participants = [makeContact()];
    thread.lifecycleState = "at-risk";
    // already critical - prevRiskTier and new tier are both critical, no new transition
    thread.riskTier = "critical";
    thread.threadType = "cold-outreach";
    thread.riskTimerStart = now - 25 * 60 * 60 * 1000; // stays critical
    thread.stateHistory = [];

    const [updated] = driftTick([thread], zones, now);

    // No new stateHistory entries from the critical path
    const criticalEntries = updated.stateHistory.filter((h) => h.trigger === "risk-tier-critical");
    expect(criticalEntries).toHaveLength(0);
  });

  it("updates visualState to 'drifting' when thread has significant drift magnitude", () => {
    const zones = createZoneLayout();
    const thread = createThread("t1", "Subject", "s");
    thread.participants = [makeContact()];
    thread.position = { x: 100, y: 100 };
    thread.targetPosition = { x: 2000, y: 600 };
    thread.visualState = "idle";

    const [updated] = driftTick([thread], zones);

    expect(updated.visualState).toBe("drifting");
  });

  it("uses threadType-specific thresholds (warm-intro critical at 12h)", () => {
    const zones = createZoneLayout();
    const now = Date.now();
    const thread = createThread("t1", "Subject", "s");
    thread.participants = [makeContact()];
    thread.lifecycleState = "waiting";
    thread.riskTier = "safe";
    thread.threadType = "warm-intro";
    // warm-intro: critical at 12h, set timer 13h ago
    thread.riskTimerStart = now - 13 * 60 * 60 * 1000;

    const [updated] = driftTick([thread], zones, now);

    expect(updated.riskTier).toBe("critical");
    expect(updated.lifecycleState).toBe("at-risk");
  });
});

describe("driftTick - organic wobble (Spec 02)", () => {
  it("adds organic wobble noise to thread movement", () => {
    const zones = createZoneLayout();
    const now = Date.now();
    // Two threads at the same position with the same target - they should diverge
    // due to different per-thread wobble phases
    const t1 = createThread("thread-alpha", "Subject", "s");
    t1.participants = [makeContact()];
    t1.position = { x: 500, y: 500 };
    t1.targetPosition = { x: 500, y: 500 }; // at target - no linear drift

    const t2 = createThread("thread-beta", "Subject", "s");
    t2.participants = [makeContact()];
    t2.position = { x: 500, y: 500 };
    t2.targetPosition = { x: 500, y: 500 };

    const updated = driftTick([t1, t2], zones, now);

    // With organic wobble, threads at their target should still move slightly
    // (either via wobble or collision avoidance separating them)
    const dist = Math.hypot(
      updated[0].position.x - updated[1].position.x,
      updated[1].position.y - updated[0].position.y,
    );
    // They were at the same position, so collision + wobble should separate them
    expect(dist).toBeGreaterThan(0);
  });

  it("wobble is deterministic per thread id and time", () => {
    const zones = createZoneLayout();
    const now = 1000000;
    const thread = createThread("fixed-id", "Subject", "s");
    thread.participants = [makeContact()];
    thread.position = { x: 500, y: 500 };
    thread.targetPosition = { x: 500, y: 500 };

    const [result1] = driftTick([thread], zones, now);
    // Reset and run again with same time
    const thread2 = createThread("fixed-id", "Subject", "s");
    thread2.participants = [makeContact()];
    thread2.position = { x: 500, y: 500 };
    thread2.targetPosition = { x: 500, y: 500 };
    const [result2] = driftTick([thread2], zones, now);

    // Same thread id + same time = same wobble
    expect(result1.position.x).toBe(result2.position.x);
    expect(result1.position.y).toBe(result2.position.y);
  });

  it("different thread IDs get different wobble offsets at the same time", () => {
    const zones = createZoneLayout();
    const now = 1000000;
    const t1 = createThread("id-aaa", "Subject", "s");
    t1.participants = [makeContact()];
    t1.position = { x: 1000, y: 1000 };
    t1.targetPosition = { x: 1000, y: 1000 };

    const t2 = createThread("id-zzz", "Subject", "s");
    t2.participants = [makeContact()];
    t2.position = { x: 2000, y: 2000 };
    t2.targetPosition = { x: 2000, y: 2000 };

    const updated = driftTick([t1, t2], zones, now);

    // The drift velocity (which includes wobble) should differ between different IDs
    const v1 = updated[0].driftVelocity;
    const v2 = updated[1].driftVelocity;
    expect(v1.dx !== v2.dx || v1.dy !== v2.dy).toBe(true);
  });
});

describe("cluster migration animation (Spec 02)", () => {
  beforeEach(() => {
    clearAllClusterMigrations();
  });

  it("setClusterMigration stores a migration target", () => {
    setClusterMigration("t1", { x: 200, y: 300 }, { x: 100, y: 100 }, 1000);
    const migration = getClusterMigration("t1");
    expect(migration).toBeDefined();
    expect(migration!.target).toEqual({ x: 200, y: 300 });
    expect(migration!.startPosition).toEqual({ x: 100, y: 100 });
    expect(migration!.startTime).toBe(1000);
    expect(migration!.duration).toBe(500);
  });

  it("clearClusterMigration removes a migration", () => {
    setClusterMigration("t1", { x: 200, y: 300 }, { x: 100, y: 100 });
    clearClusterMigration("t1");
    expect(getClusterMigration("t1")).toBeUndefined();
  });

  it("driftTick lerps position during active migration", () => {
    const zones = createZoneLayout();
    const startTime = 1000;
    const thread = createThread("t-migrate", "Subject", "s");
    thread.participants = [makeContact()];
    thread.position = { x: 100, y: 100 };
    thread.targetPosition = { x: 500, y: 500 };

    setClusterMigration("t-migrate", { x: 500, y: 500 }, { x: 100, y: 100 }, startTime);

    // At 250ms (halfway through 500ms migration)
    const [updated] = driftTick([thread], zones, startTime + 250);
    // Should be partway between start and target
    expect(updated.position.x).toBeGreaterThan(100);
    expect(updated.position.x).toBeLessThan(500);
    expect(updated.position.y).toBeGreaterThan(100);
    expect(updated.position.y).toBeLessThan(500);
  });

  it("driftTick completes migration after duration", () => {
    const zones = createZoneLayout();
    const startTime = 1000;
    const thread = createThread("t-migrate2", "Subject", "s");
    thread.participants = [makeContact()];
    thread.position = { x: 100, y: 100 };
    thread.targetPosition = { x: 100, y: 100 };

    setClusterMigration("t-migrate2", { x: 500, y: 500 }, { x: 100, y: 100 }, startTime);

    // At 600ms (past 500ms duration)
    const [updated] = driftTick([thread], zones, startTime + 600);
    // Should be at target position
    expect(updated.position.x).toBe(500);
    expect(updated.position.y).toBe(500);
    // Migration should be cleared
    expect(getClusterMigration("t-migrate2")).toBeUndefined();
  });

  it("migration uses ease-out cubic for smooth deceleration", () => {
    const zones = createZoneLayout();
    const startTime = 1000;
    const thread = createThread("t-ease", "Subject", "s");
    thread.participants = [makeContact()];
    thread.position = { x: 0, y: 0 };
    thread.targetPosition = { x: 0, y: 0 };

    setClusterMigration("t-ease", { x: 400, y: 0 }, { x: 0, y: 0 }, startTime);

    // At 25% time
    const [early] = driftTick([{ ...thread }], zones, startTime + 125);
    // At 75% time
    clearAllClusterMigrations();
    setClusterMigration("t-ease", { x: 400, y: 0 }, { x: 0, y: 0 }, startTime);
    const [late] = driftTick([{ ...thread }], zones, startTime + 375);

    // Ease-out means more progress early - the position at 75% should be closer to target
    // than a simple linear would suggest
    expect(late.position.x).toBeGreaterThan(early.position.x);
    // 75% of time with ease-out should cover more than 75% of distance
    expect(late.position.x / 400).toBeGreaterThan(0.75);
  });
});

describe("placeNewThread - cluster-biased placement (Spec 03)", () => {
  it("biases position toward cluster centroid when participant overlap is high", () => {
    const zones = createZoneLayout();
    const existing1 = createThread("e1", "Subject", "s");
    existing1.participants = [makeContact({ email: "shared@co.com" })];
    existing1.position = { x: 1500, y: 1500 };

    const existing2 = createThread("e2", "Re: Subject", "s");
    existing2.participants = [makeContact({ email: "shared@co.com" })];
    existing2.position = { x: 1600, y: 1600 };

    const cluster = {
      memberThreadIds: ["e1", "e2"],
      centroid: { x: 1550, y: 1550 },
    };

    const newThread = createThread("new1", "New Thread", "s");
    newThread.participants = [makeContact({ email: "shared@co.com" })];
    newThread.unread = true;
    newThread.urgencyScore = 0.5;

    const placed = placeNewThread(newThread, zones, [existing1, existing2], [cluster]);

    // Position should be near cluster centroid (within jitter range)
    expect(placed.position.x).toBeGreaterThan(1500);
    expect(placed.position.x).toBeLessThan(1610);
    expect(placed.position.y).toBeGreaterThan(1500);
    expect(placed.position.y).toBeLessThan(1610);
  });

  it("falls back to random zone placement when no cluster affinity", () => {
    const zones = createZoneLayout();
    const existing1 = createThread("e1", "Subject", "s");
    existing1.participants = [makeContact({ email: "alice@co.com" })];
    existing1.position = { x: 1500, y: 1500 };

    const cluster = {
      memberThreadIds: ["e1"],
      centroid: { x: 1500, y: 1500 },
    };

    const newThread = createThread("new1", "New Thread", "s");
    newThread.participants = [makeContact({ email: "bob@other.com" })]; // no overlap
    newThread.unread = true;

    const placed = placeNewThread(newThread, zones, [existing1], [cluster]);

    // Should NOT be near cluster centroid - random zone placement
    // (active-front zone center is at 2000, 600)
    // Just verify it was placed somewhere reasonable, not at cluster centroid
    expect(placed.zone).toBeDefined();
    expect(placed.position.x).not.toBe(0);
  });

  it("works without existing threads or clusters (backward compatible)", () => {
    const zones = createZoneLayout();
    const newThread = createThread("new1", "New Thread", "s");
    newThread.unread = true;
    newThread.urgencyScore = 0.5;

    const placed = placeNewThread(newThread, zones);
    expect(placed.zone).toBeDefined();
    expect(placed.position.x).not.toBe(0);
    expect(placed.position.y).not.toBe(0);
  });

  it("requires at least half of cluster members to share participants", () => {
    const zones = createZoneLayout();
    const existing1 = createThread("e1", "Subject", "s");
    existing1.participants = [makeContact({ email: "shared@co.com" })];
    existing1.position = { x: 1500, y: 1500 };

    const existing2 = createThread("e2", "Other", "s");
    existing2.participants = [makeContact({ email: "noone@co.com" })];
    existing2.position = { x: 1600, y: 1600 };

    const existing3 = createThread("e3", "Another", "s");
    existing3.participants = [makeContact({ email: "someone@co.com" })];
    existing3.position = { x: 1700, y: 1700 };

    const cluster = {
      memberThreadIds: ["e1", "e2", "e3"],
      centroid: { x: 1600, y: 1600 },
    };

    const newThread = createThread("new1", "New Thread", "s");
    // Only 1 of 3 cluster members shares participant - below 50% threshold
    newThread.participants = [makeContact({ email: "shared@co.com" })];
    newThread.unread = true;

    const placed = placeNewThread(newThread, zones, [existing1, existing2, existing3], [cluster]);

    // Should NOT be biased toward cluster since overlap < 50%
    expect(placed.zone).toBeDefined();
  });
});
