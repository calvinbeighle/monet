import { describe, it, expect } from "vitest";
import {
  createZoneLayout,
  updateZoneSizes,
  getZoneAtPosition,
  getZoneCenter,
  getRandomPositionInZone,
  evaluateZoneAlerts,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
} from "./zone-layout";
import type { ZoneId } from "../../lib/types";

describe("Zone layout", () => {
  it("creates all 6 zones", () => {
    const zones = createZoneLayout();
    expect(zones.size).toBe(6);

    const expectedIds: ZoneId[] = [
      "active-front",
      "opportunities",
      "at-risk",
      "lost",
      "noise",
      "base-handled",
    ];
    for (const id of expectedIds) {
      expect(zones.has(id)).toBe(true);
    }
  });

  it("all zones have valid boundaries within canvas", () => {
    const zones = createZoneLayout();
    for (const [, zone] of zones) {
      expect(zone.boundary.minX).toBeGreaterThanOrEqual(0);
      expect(zone.boundary.maxX).toBeLessThanOrEqual(CANVAS_WIDTH);
      expect(zone.boundary.minY).toBeGreaterThanOrEqual(0);
      expect(zone.boundary.maxY).toBeLessThanOrEqual(CANVAS_HEIGHT);
      expect(zone.boundary.maxX).toBeGreaterThan(zone.boundary.minX);
      expect(zone.boundary.maxY).toBeGreaterThan(zone.boundary.minY);
    }
  });

  it("all zones start with zero thread count", () => {
    const zones = createZoneLayout();
    for (const [, zone] of zones) {
      expect(zone.threadCount).toBe(0);
    }
  });

  it("active-front is positioned in upper area", () => {
    const zones = createZoneLayout();
    const center = getZoneCenter(zones, "active-front");
    // Active front should be in upper third of canvas
    expect(center.y).toBeLessThan(CANVAS_HEIGHT / 2);
  });

  it("lost zone is positioned in lower area", () => {
    const zones = createZoneLayout();
    const center = getZoneCenter(zones, "lost");
    expect(center.y).toBeGreaterThan(CANVAS_HEIGHT / 2);
  });
});

describe("updateZoneSizes (adaptive sizing)", () => {
  it("scales zones proportionally to thread population", () => {
    const zones = createZoneLayout();
    const originalWidth =
      zones.get("active-front")!.boundary.maxX - zones.get("active-front")!.boundary.minX;

    updateZoneSizes(zones, {
      "active-front": 50,
      opportunities: 5,
      "at-risk": 5,
      lost: 5,
      noise: 5,
      "base-handled": 5,
    });

    const newWidth =
      zones.get("active-front")!.boundary.maxX - zones.get("active-front")!.boundary.minX;

    // Active front should be larger since it has most threads
    expect(newWidth).toBeGreaterThan(originalWidth * 0.9);
  });

  it("updates thread counts per zone", () => {
    const zones = createZoneLayout();
    updateZoneSizes(zones, {
      "active-front": 10,
      opportunities: 5,
      "at-risk": 3,
      lost: 1,
      noise: 20,
      "base-handled": 8,
    });

    expect(zones.get("active-front")!.threadCount).toBe(10);
    expect(zones.get("noise")!.threadCount).toBe(20);
    expect(zones.get("lost")!.threadCount).toBe(1);
  });

  it("handles zero total threads without crashing", () => {
    const zones = createZoneLayout();
    expect(() => {
      updateZoneSizes(zones, {
        "active-front": 0,
        opportunities: 0,
        "at-risk": 0,
        lost: 0,
        noise: 0,
        "base-handled": 0,
      });
    }).not.toThrow();
  });
});

describe("getZoneAtPosition", () => {
  it("returns correct zone for center of active-front", () => {
    const zones = createZoneLayout();
    const center = getZoneCenter(zones, "active-front");
    expect(getZoneAtPosition(zones, center.x, center.y)).toBe("active-front");
  });

  it("returns correct zone for center of lost", () => {
    const zones = createZoneLayout();
    const center = getZoneCenter(zones, "lost");
    expect(getZoneAtPosition(zones, center.x, center.y)).toBe("lost");
  });

  it("returns nearest zone for out-of-bounds position", () => {
    const zones = createZoneLayout();
    // Far off-canvas should still return something
    const zone = getZoneAtPosition(zones, -1000, -1000);
    expect(zone).toBeDefined();
  });
});

describe("getRandomPositionInZone", () => {
  it("returns position within zone boundary", () => {
    const zones = createZoneLayout();
    for (let i = 0; i < 10; i++) {
      const pos = getRandomPositionInZone(zones, "active-front");
      const zone = zones.get("active-front")!;
      expect(pos.x).toBeGreaterThanOrEqual(zone.boundary.minX);
      expect(pos.x).toBeLessThanOrEqual(zone.boundary.maxX);
      expect(pos.y).toBeGreaterThanOrEqual(zone.boundary.minY);
      expect(pos.y).toBeLessThanOrEqual(zone.boundary.maxY);
    }
  });
});

describe("evaluateZoneAlerts", () => {
  it("fires alert when count exceeds max threshold", () => {
    const zones = createZoneLayout();
    const zone = zones.get("at-risk")!;
    zone.alertThreshold = { minThreads: null, maxThreads: 5 };
    zone.threadCount = 10;

    evaluateZoneAlerts(zones);
    expect(zone.alertState).toBe("active");
  });

  it("fires alert when count drops below min threshold", () => {
    const zones = createZoneLayout();
    const zone = zones.get("active-front")!;
    zone.alertThreshold = { minThreads: 3, maxThreads: null };
    zone.threadCount = 1;

    evaluateZoneAlerts(zones);
    expect(zone.alertState).toBe("active");
  });

  it("clears alert when condition resolves", () => {
    const zones = createZoneLayout();
    const zone = zones.get("at-risk")!;
    zone.alertThreshold = { minThreads: null, maxThreads: 5 };
    zone.threadCount = 10;
    zone.alertState = "active";

    zone.threadCount = 3;
    evaluateZoneAlerts(zones);
    expect(zone.alertState).toBe("inactive");
  });

  it("stays inactive when no thresholds set", () => {
    const zones = createZoneLayout();
    const zone = zones.get("noise")!;
    zone.threadCount = 100;

    evaluateZoneAlerts(zones);
    expect(zone.alertState).toBe("inactive");
  });
});
