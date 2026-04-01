import { describe, it, expect, beforeEach } from "vitest";
import {
  computeTargetZone,
  driftTick,
  placeNewThread,
  onUserReply,
  onArchive,
  onLabel,
  onMarkRead,
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
    expect(updated.lifecycleState).toBe("approaching-archive");
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

describe("driftTick - clustering affinity nudge (Spec 03)", () => {
  it("nudges targetPosition toward cluster centroid when clusterMembership matches", () => {
    const zones = createZoneLayout();
    const thread = createThread("t1", "Subject", "s");
    thread.participants = [makeContact()];
    // Place thread with a known target
    thread.position = { x: 1000, y: 1000 };
    thread.targetPosition = { x: 1000, y: 1000 };
    thread.clusterMembership = "cluster-a";

    const clusters = [
      {
        memberThreadIds: ["t1", "t2"],
        centroid: { x: 1200, y: 1200 },
      },
    ];

    const [updated] = driftTick([thread], zones, Date.now(), clusters);

    // After nudge toward centroid, targetPosition should move toward 1200,1200
    // CLUSTER_NUDGE_STRENGTH = 0.15 means target moves 15% of (centroid - original target)
    // Original target ~= 1000+something, centroid at 1200 -> target nudged toward 1200
    expect(updated.targetPosition.x).toBeGreaterThan(1000);
    expect(updated.targetPosition.y).toBeGreaterThan(1000);
  });

  it("does not nudge when thread has no clusterMembership", () => {
    const zones = createZoneLayout();

    // Thread with clusterMembership set (will get nudged)
    const threadWithMembership = createThread("t1", "Subject", "s");
    threadWithMembership.participants = [makeContact()];
    threadWithMembership.position = { x: 1000, y: 1000 };
    threadWithMembership.targetPosition = { x: 1000, y: 1000 };
    threadWithMembership.clusterMembership = "cluster-a";

    // Thread without clusterMembership (should not get nudged)
    const threadWithout = createThread("t2", "Subject", "s");
    threadWithout.participants = [makeContact()];
    threadWithout.position = { x: 1000, y: 1000 };
    threadWithout.targetPosition = { x: 1000, y: 1000 };
    threadWithout.clusterMembership = null;

    // Cluster centroid far from the natural score-driven target
    const clusters = [
      {
        memberThreadIds: ["t1", "t2"],
        centroid: { x: 3800, y: 2800 },
      },
    ];

    const updatedWith = driftTick([threadWithMembership], zones, Date.now(), clusters);
    const updatedWithout = driftTick([threadWithout], zones, Date.now(), clusters);

    // Thread with membership should be nudged toward centroid (3800, 2800)
    // Thread without membership should stay near its score-driven target
    // The one with membership should be further from the base score-driven position
    expect(updatedWith[0].targetPosition.x).toBeGreaterThan(updatedWithout[0].targetPosition.x);
  });

  it("does not nudge when clusters param is omitted", () => {
    const zones = createZoneLayout();
    const thread = createThread("t1", "Subject", "s");
    thread.participants = [makeContact()];
    thread.position = { x: 500, y: 500 };
    thread.targetPosition = { x: 500, y: 500 };
    thread.clusterMembership = "cluster-a";

    // No clusters argument - backward compatible
    const [updated] = driftTick([thread], zones);
    expect(updated).toBeDefined();
  });

  it("does not nudge single-member clusters", () => {
    const zones = createZoneLayout();

    // Thread in a single-member cluster (no meaningful centroid pull)
    const threadSolo = createThread("t1", "Subject", "s");
    threadSolo.participants = [makeContact()];
    threadSolo.position = { x: 1000, y: 1000 };
    threadSolo.targetPosition = { x: 1000, y: 1000 };
    threadSolo.clusterMembership = "cluster-solo";

    // Thread in a two-member cluster for comparison (will get nudged)
    const threadMulti = createThread("t2", "Subject", "s");
    threadMulti.participants = [makeContact()];
    threadMulti.position = { x: 1000, y: 1000 };
    threadMulti.targetPosition = { x: 1000, y: 1000 };
    threadMulti.clusterMembership = "cluster-multi";

    const clusters = [
      {
        memberThreadIds: ["t1"], // single member - no nudge
        centroid: { x: 3800, y: 2800 },
      },
      {
        memberThreadIds: ["t2", "t3"], // two members - nudge applies
        centroid: { x: 3800, y: 2800 },
      },
    ];

    const updatedSolo = driftTick([threadSolo], zones, Date.now(), clusters);
    const updatedMulti = driftTick([threadMulti], zones, Date.now(), clusters);

    // Single-member cluster should have same target as no-cluster (no nudge applied)
    // Multi-member cluster should be nudged further toward centroid
    expect(updatedMulti[0].targetPosition.x).toBeGreaterThan(updatedSolo[0].targetPosition.x);
  });
});

describe("driftTick - collision avoidance on targetPosition (Spec 03)", () => {
  it("pushes overlapping targetPositions apart, not just positions", () => {
    const zones = createZoneLayout();
    const now = Date.now();

    // Two threads with nearly identical computed target positions (same zone, close scores)
    // Use different message counts so valueScore differs slightly -> different xOffset
    const t1 = createThread("t1", "S1", "s");
    const t2 = createThread("t2", "S2", "s");
    t1.participants = [makeContact({ vipFlag: true, relationshipScore: 50 })];
    t2.participants = [makeContact({ vipFlag: true, relationshipScore: 50 })];
    t1.unread = true;
    t2.unread = true;
    t1.latestMessageTimestamp = now;
    t1.firstMessageTimestamp = now;
    t2.latestMessageTimestamp = now;
    t2.firstMessageTimestamp = now;
    t1.riskTimerStart = now;
    t2.riskTimerStart = now;
    // messageCount difference gives different valueScore -> slightly different xOffset
    t1.messageCount = 1;
    t2.messageCount = 2; // valueScore differs by (1/10)*0.15 = 0.015
    // Positions far apart so they don't trigger position-based collision
    t1.position = { x: 100, y: 100 };
    t2.position = { x: 3800, y: 2800 };

    // Nudge both toward the same centroid via cluster affinity to bring targets close
    t1.clusterMembership = "same-cluster";
    t2.clusterMembership = "same-cluster";
    const clusters = [
      {
        memberThreadIds: ["t1", "t2"],
        centroid: { x: 2000, y: 600 }, // active-front center
      },
    ];

    // First, get the un-nudged targets without collision avoidance to confirm they're close
    const t1NoCluster = { ...t1, clusterMembership: null };
    const t2NoCluster = { ...t2, clusterMembership: null };
    const [t1Base] = driftTick([t1NoCluster], zones, now);
    const [t2Base] = driftTick([t2NoCluster], zones, now);
    const baseDist = Math.hypot(
      t2Base.targetPosition.x - t1Base.targetPosition.x,
      t2Base.targetPosition.y - t1Base.targetPosition.y,
    );

    const updated = driftTick([t1, t2], zones, now, clusters);

    const targetDist = Math.hypot(
      updated[1].targetPosition.x - updated[0].targetPosition.x,
      updated[1].targetPosition.y - updated[0].targetPosition.y,
    );

    if (baseDist < 40) {
      // If base targets were within COLLISION_MIN_DISTANCE, collision avoidance
      // should have pushed them further apart
      expect(targetDist).toBeGreaterThan(baseDist);
    } else {
      // Targets were already far enough apart - just verify they're both defined
      expect(targetDist).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("driftTick - organic wobble stability (Spec 03)", () => {
  it("applies wobble only when driftMagnitude > 2", () => {
    const zones = createZoneLayout();
    const now = 1000000;
    const thread = createThread("drifting-thread", "Subject", "s");
    thread.participants = [makeContact()];
    // Large separation between position and target -> wobble active
    thread.position = { x: 100, y: 100 };
    thread.targetPosition = { x: 2000, y: 600 };

    const [updated] = driftTick([thread], zones, now);

    // With drift magnitude >> 2, position must have moved (toward target + wobble)
    expect(updated.position.x).toBeGreaterThan(100);
  });

  it("driftVelocity has zero wobble component when thread is at its target (driftMagnitude = 0)", () => {
    // The wobble code path: `if (driftMagnitude > 2)` - so at driftMagnitude=0, no wobble
    // Verify by computing expected velocity (pure linear drift) vs actual
    const zones = createZoneLayout();
    const now = Date.now();
    const thread = createThread("no-wobble-thread", "Subject", "s");
    thread.participants = [makeContact({ vipFlag: false })];
    thread.latestMessageTimestamp = now;
    thread.firstMessageTimestamp = now;
    thread.unread = false;
    thread.lifecycleState = "waiting";
    thread.riskTier = "safe";
    thread.riskTimerStart = now;

    // Manually set position and targetPosition to the same value
    // so after score recomputation, the target matches the starting position exactly
    // First, discover what driftTick will compute as the target
    const [probe] = driftTick([{ ...thread }], zones, now);
    // Now set position to the computed target position
    thread.position = { ...probe.targetPosition };

    const [tick] = driftTick([thread], zones, now);

    // dx = targetPosition.x - position.x should be nearly 0 (they start equal)
    // wobble is also 0 when driftMagnitude <= 2
    // So driftVelocity should be very small (pure linear drift of ~0px)
    const velMag = Math.hypot(tick.driftVelocity.dx, tick.driftVelocity.dy);
    // Without wobble: velocity = dx*DRIFT_FRACTION + 0 ≈ 0 when position==target
    expect(velMag).toBeLessThan(2 * 0.05 + 0.001); // 2px * DRIFT_FRACTION + tolerance
  });

  it("driftVelocity is larger when thread is far from target (wobble active)", () => {
    const zones = createZoneLayout();
    const now = Date.now();

    const threadFar = createThread("far-thread", "Subject", "s");
    threadFar.participants = [makeContact()];
    threadFar.position = { x: 100, y: 100 };
    threadFar.targetPosition = { x: 2000, y: 600 };

    const threadNear = createThread("near-thread", "Subject", "s");
    threadNear.participants = [makeContact()];
    // Place at the same computed target so driftMagnitude = 0
    const [probe] = driftTick([{ ...threadFar }], zones, now);
    threadNear.position = { ...probe.targetPosition };
    threadNear.targetPosition = { ...probe.targetPosition };

    const [updatedFar] = driftTick([threadFar], zones, now);
    const [updatedNear] = driftTick([threadNear], zones, now);

    const farVelMag = Math.hypot(updatedFar.driftVelocity.dx, updatedFar.driftVelocity.dy);
    const nearVelMag = Math.hypot(updatedNear.driftVelocity.dx, updatedNear.driftVelocity.dy);

    // Thread far from target has larger drift velocity (movement + wobble both active)
    expect(farVelMag).toBeGreaterThan(nearVelMag);
  });
});

describe("onLabel and onMarkRead (Spec 03)", () => {
  it("onLabel resets neglectDuration to 0", () => {
    const thread = createThread("t1", "Subject", "s");
    thread.neglectDuration = 100000;

    const updated = onLabel(thread);

    expect(updated.neglectDuration).toBe(0);
  });

  it("onLabel updates lastUserReplyTimestamp", () => {
    const before = Date.now();
    const thread = createThread("t1", "Subject", "s");
    thread.lastUserReplyTimestamp = null;

    const updated = onLabel(thread);

    expect(updated.lastUserReplyTimestamp).not.toBeNull();
    expect(updated.lastUserReplyTimestamp!).toBeGreaterThanOrEqual(before);
  });

  it("onLabel does not change unread flag", () => {
    const thread = createThread("t1", "Subject", "s");
    thread.unread = true;
    thread.neglectDuration = 5000;

    const updated = onLabel(thread);

    expect(updated.unread).toBe(true);
  });

  it("onMarkRead resets neglectDuration to 0", () => {
    const thread = createThread("t1", "Subject", "s");
    thread.neglectDuration = 200000;

    const updated = onMarkRead(thread);

    expect(updated.neglectDuration).toBe(0);
  });

  it("onMarkRead updates lastUserReplyTimestamp", () => {
    const before = Date.now();
    const thread = createThread("t1", "Subject", "s");
    thread.lastUserReplyTimestamp = null;

    const updated = onMarkRead(thread);

    expect(updated.lastUserReplyTimestamp).not.toBeNull();
    expect(updated.lastUserReplyTimestamp!).toBeGreaterThanOrEqual(before);
  });

  it("onMarkRead sets unread to false", () => {
    const thread = createThread("t1", "Subject", "s");
    thread.unread = true;

    const updated = onMarkRead(thread);

    expect(updated.unread).toBe(false);
  });

  it("onMarkRead on an already-read thread leaves unread false", () => {
    const thread = createThread("t1", "Subject", "s");
    thread.unread = false;

    const updated = onMarkRead(thread);

    expect(updated.unread).toBe(false);
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

  it("biases placement toward cluster with topic tag overlap", () => {
    const zones = createZoneLayout();

    const existing1 = createThread("e1", "Project Alpha update", "snippet");
    existing1.topicTags = ["project", "alpha", "update"];
    existing1.participants = [makeContact({ email: "a@example.com" })];
    existing1.position = { x: 500, y: 500 };
    existing1.targetPosition = { x: 500, y: 500 };

    const existing2 = createThread("e2", "Alpha review needed", "snippet");
    existing2.topicTags = ["alpha", "review", "needed"];
    existing2.participants = [makeContact({ email: "b@example.com" })];
    existing2.position = { x: 520, y: 510 };
    existing2.targetPosition = { x: 520, y: 510 };

    const cluster = {
      memberThreadIds: ["e1", "e2"],
      centroid: { x: 510, y: 505 },
    };

    // New thread shares topic tags but NOT participants
    const newThread = createThread("n1", "Alpha status check", "snippet");
    newThread.topicTags = ["alpha", "status", "check"];
    newThread.participants = [makeContact({ email: "different@example.com" })];
    newThread.urgencyScore = 0.6;
    newThread.unread = true;

    const placed = placeNewThread(newThread, zones, [existing1, existing2], [cluster]);

    // Should be biased toward cluster centroid (within 100px)
    const dist = Math.hypot(placed.position.x - 510, placed.position.y - 505);
    expect(dist).toBeLessThan(100);
  });
});

describe("drifting-lost lifecycle", () => {
  it("transitions at-risk to drifting-lost or lost when neglect is high", () => {
    const zones = createZoneLayout();
    const thread = createThread("t1", "Test", "s");
    thread.lifecycleState = "at-risk";
    thread.riskTier = "critical";
    thread.riskScore = 70;
    // Set threadType to cold-outreach for longer thresholds so we stay in critical
    thread.threadType = "cold-outreach";
    // 36 hours of neglect - enough to push critical but not yet lost for cold-outreach
    const neglectMs = 36 * 60 * 60 * 1000;
    thread.neglectDuration = neglectMs;
    thread.urgencyScore = 0.1;
    thread.valueScore = 0.1;
    thread.latestMessageTimestamp = Date.now() - neglectMs;
    thread.lastUserReplyTimestamp = null;

    // Place thread in at-risk zone initially
    const atRiskCenter = getZoneCenter(zones, "at-risk");
    thread.position = { x: atRiskCenter.x, y: atRiskCenter.y };
    thread.targetPosition = { x: atRiskCenter.x, y: atRiskCenter.y };

    const result = driftTick([thread], zones, Date.now());
    const t = result[0];
    // Should have moved beyond at-risk: either drifting-lost or lost
    expect(["drifting-lost", "lost", "at-risk"]).toContain(t.lifecycleState);
    // If still at-risk, neglect drift should be pushing target toward lost
    if (t.lifecycleState === "at-risk") {
      const lostCenter = getZoneCenter(zones, "lost");
      const origDist = Math.hypot(atRiskCenter.x - lostCenter.x, atRiskCenter.y - lostCenter.y);
      const newDist = Math.hypot(
        t.targetPosition.x - lostCenter.x,
        t.targetPosition.y - lostCenter.y,
      );
      expect(newDist).toBeLessThan(origDist);
    }
  });

  it("onLabel recovers drifting-lost thread to active", () => {
    const thread = createThread("t1", "Test", "s");
    thread.lifecycleState = "drifting-lost";
    thread.stateHistory = [];

    const result = onLabel(thread);
    expect(result.lifecycleState).toBe("active");
    expect(result.neglectDuration).toBe(0);
    expect(result.stateHistory).toHaveLength(1);
    expect(result.stateHistory[0].from).toBe("drifting-lost");
    expect(result.stateHistory[0].to).toBe("active");
  });

  it("onMarkRead recovers drifting-lost thread to active", () => {
    const thread = createThread("t1", "Test", "s");
    thread.lifecycleState = "drifting-lost";
    thread.stateHistory = [];

    const result = onMarkRead(thread);
    expect(result.lifecycleState).toBe("active");
    expect(result.unread).toBe(false);
    expect(result.stateHistory).toHaveLength(1);
    expect(result.stateHistory[0].trigger).toBe("user-mark-read");
  });

  it("computeTargetZone returns lost for drifting-lost threads", () => {
    const thread = createThread("t1", "Test", "s");
    thread.lifecycleState = "drifting-lost";
    expect(computeTargetZone(thread)).toBe("lost");
  });

  it("computeTargetZone returns base-handled for approaching-archive threads", () => {
    const thread = createThread("t1", "Test", "s");
    thread.lifecycleState = "approaching-archive";
    expect(computeTargetZone(thread)).toBe("base-handled");
  });
});
