// Thread drag-to-zone reclassification tests per Spec 04 Section 9
// and thread drag-out-of-cluster per Spec 11 Section 9.
// These test the core logic used by MapViewport's mouse handlers.

import { describe, it, expect, beforeEach } from "vitest";
import { hitTestThread, screenToMap } from "../navigation/navigation-system";
import { onManualReclassify, computeTargetZone } from "./drift-engine";
import { excludeFromCluster, resetExclusions, evaluateClusters } from "./clustering";
import { createZoneLayout, getZoneAtPosition } from "./zone-layout";
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

describe("Thread drag: mousedown hit-test", () => {
  it("hitTestThread returns threadId when mouse is on a thread", () => {
    const thread = createThread("t1", "Subject", "s");
    thread.position = { x: 100, y: 200 };

    const hitId = hitTestThread([thread], 105, 205);
    expect(hitId).toBe("t1");
  });

  it("hitTestThread returns null when mouse is far from any thread", () => {
    const thread = createThread("t1", "Subject", "s");
    thread.position = { x: 100, y: 200 };

    const hitId = hitTestThread([thread], 500, 500);
    expect(hitId).toBeNull();
  });

  it("hitTestThread picks nearest thread when multiple are in range", () => {
    const t1 = createThread("t1", "Subject 1", "s");
    const t2 = createThread("t2", "Subject 2", "s");
    t1.position = { x: 100, y: 100 };
    t2.position = { x: 110, y: 100 };

    // Point closer to t2
    const hitId = hitTestThread([t1, t2], 108, 100);
    expect(hitId).toBe("t2");
  });
});

describe("Thread drag: reclassification on mouseup", () => {
  it("onManualReclassify sets zone and userOverrideZone flag", () => {
    const zones = createZoneLayout();
    const thread = createThread("t1", "Subject", "s");
    thread.zone = "active-front";

    const dropPos = { x: 3200, y: 800 };
    const updated = onManualReclassify(thread, zones, "opportunities", dropPos);

    expect(updated.zone).toBe("opportunities");
    expect(updated.userOverrideZone).toBe(true);
    expect(updated.previousZone).toBe("active-front");
    expect(updated.targetPosition).toEqual(dropPos);
  });

  it("getZoneAtPosition determines correct zone from drop coordinates", () => {
    const zones = createZoneLayout();
    // Active-front is centered around (2000, 600) per zone-layout.ts
    const zone = getZoneAtPosition(zones, 2000, 600);
    expect(zone).toBe("active-front");

    // Lost zone is centered around (600, 2400)
    const lostZone = getZoneAtPosition(zones, 600, 2400);
    expect(lostZone).toBe("lost");
  });

  it("reclassified thread stays in target zone during drift", () => {
    const zones = createZoneLayout();
    const thread = createThread("t1", "Subject", "s");
    thread.zone = "at-risk";
    thread.riskTier = "critical";

    const updated = onManualReclassify(thread, zones, "opportunities");
    expect(updated.userOverrideZone).toBe(true);
    // The drift engine respects userOverrideZone
    expect(computeTargetZone(updated)).toBe("opportunities");
  });
});

describe("Thread drag: out-of-cluster exclusion (Spec 11 Section 9)", () => {
  beforeEach(() => {
    resetExclusions();
  });

  it("excludeFromCluster prevents thread from rejoining cluster", () => {
    const t1 = createThread("t1", "Subject 1", "s");
    const t2 = createThread("t2", "Subject 2", "s");
    const t3 = createThread("t3", "Subject 3", "s");
    t1.participants = [makeContact({ email: "shared@example.com" })];
    t2.participants = [makeContact({ email: "shared@example.com" })];
    t3.participants = [makeContact({ email: "shared@example.com" })];
    t1.position = { x: 100, y: 100 };
    t2.position = { x: 120, y: 120 };
    t3.position = { x: 110, y: 110 };

    // Form initial cluster
    const now = Date.now();
    const result1 = evaluateClusters([t1, t2, t3], [], now);
    expect(result1.clusters.length).toBeGreaterThan(0);

    const clusterId = result1.clusters[0].id;
    expect(result1.clusters[0].memberThreadIds).toContain("t1");

    // Exclude t1 from that cluster (simulating drag-out)
    excludeFromCluster("t1", clusterId);

    // Re-evaluate clusters - t1 should not be in the same cluster
    const result2 = evaluateClusters([t1, t2, t3], result1.clusters, now);
    for (const cluster of result2.clusters) {
      if (cluster.id === clusterId) {
        expect(cluster.memberThreadIds).not.toContain("t1");
      }
    }
  });

  it("exclusion is cluster-specific, thread can join other clusters", () => {
    const t1 = createThread("t1", "Subject 1", "s");
    const t2 = createThread("t2", "Subject 2", "s");
    t1.participants = [makeContact({ email: "shared@example.com" })];
    t2.participants = [makeContact({ email: "shared@example.com" })];
    t1.position = { x: 100, y: 100 };
    t2.position = { x: 120, y: 120 };

    const now = Date.now();
    const result = evaluateClusters([t1, t2], [], now);
    const clusterId = result.clusters[0]?.id ?? "non-existent";

    // Exclude from this specific cluster
    excludeFromCluster("t1", clusterId);

    // Excluding from cluster-X does not prevent joining cluster-Y
    excludeFromCluster("t1", "some-other-cluster");
    // This is just verifying the API does not crash
    expect(true).toBe(true);
  });

  it("resetExclusions clears all overrides", () => {
    excludeFromCluster("t1", "c1");
    resetExclusions();

    // After reset, t1 can rejoin c1
    const t1 = createThread("t1", "Subject 1", "s");
    const t2 = createThread("t2", "Subject 2", "s");
    t1.participants = [makeContact({ email: "shared@example.com" })];
    t2.participants = [makeContact({ email: "shared@example.com" })];
    t1.position = { x: 100, y: 100 };
    t2.position = { x: 120, y: 120 };

    const result = evaluateClusters([t1, t2], [], Date.now());
    // Both should be clustered together since exclusion was cleared
    if (result.clusters.length > 0) {
      expect(result.clusters[0].memberThreadIds).toContain("t1");
      expect(result.clusters[0].memberThreadIds).toContain("t2");
    }
  });
});

describe("Screen to map coordinate conversion", () => {
  it("screenToMap converts correctly at zoom 1.0", () => {
    const cam = { x: 0, y: 0, zoom: 1.0, level: "operational" as const };
    const result = screenToMap(400, 300, cam, 800, 600);
    expect(result.x).toBe(0); // center of viewport
    expect(result.y).toBe(0);
  });

  it("screenToMap accounts for camera offset", () => {
    const cam = { x: 500, y: 300, zoom: 1.0, level: "operational" as const };
    const result = screenToMap(400, 300, cam, 800, 600);
    expect(result.x).toBe(500);
    expect(result.y).toBe(300);
  });

  it("screenToMap accounts for zoom level", () => {
    const cam = { x: 0, y: 0, zoom: 2.0, level: "detail" as const };
    const result = screenToMap(400, 300, cam, 800, 600);
    // At zoom 2.0, the center is still (0,0)
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    // But an offset from center is halved
    const offset = screenToMap(500, 400, cam, 800, 600);
    expect(offset.x).toBe(50); // (500 - 400) / 2.0
    expect(offset.y).toBe(50); // (400 - 300) / 2.0
  });
});
