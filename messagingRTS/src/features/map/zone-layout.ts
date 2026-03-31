// Zone layout engine per Spec 04
// Defines the canonical positions and boundaries of the six zones on a 4000x3000 canvas.
// Zones have fixed anchor positions but adaptive sizing based on thread population.

import type { ZoneId, Zone, ZoneBoundary } from "../../lib/types";
import { ZONE_DEFINITIONS } from "../../lib/types";

// Canvas dimensions
export const CANVAS_WIDTH = 4000;
export const CANVAS_HEIGHT = 3000;

// Canonical zone layout - positions are anchors, boundaries expand around them
// Layout rationale (per Spec 04):
//   Active Front: central-forward (top-center) - most prominent
//   Opportunities: right of active, slightly lower - warm, ready threads
//   At Risk: below active - visually signals approaching danger
//   Lost: far bottom-left - subdued, peripheral
//   Noise: far bottom-right - automated, low priority
//   Base/Handled: bottom-center - resolved, stable

interface ZoneAnchor {
  cx: number;
  cy: number;
  baseWidth: number;
  baseHeight: number;
}

const ZONE_ANCHORS: Record<ZoneId, ZoneAnchor> = {
  "active-front": { cx: 2000, cy: 600, baseWidth: 1600, baseHeight: 800 },
  opportunities: { cx: 3200, cy: 800, baseWidth: 1000, baseHeight: 700 },
  "at-risk": { cx: 2000, cy: 1600, baseWidth: 1400, baseHeight: 600 },
  lost: { cx: 600, cy: 2400, baseWidth: 1000, baseHeight: 600 },
  noise: { cx: 3400, cy: 2400, baseWidth: 800, baseHeight: 500 },
  "base-handled": { cx: 2000, cy: 2500, baseWidth: 1200, baseHeight: 500 },
};

function makeBoundary(anchor: ZoneAnchor, scale: number = 1.0): ZoneBoundary {
  const w = (anchor.baseWidth * scale) / 2;
  const h = (anchor.baseHeight * scale) / 2;
  return {
    points: [
      { x: anchor.cx - w, y: anchor.cy - h },
      { x: anchor.cx + w, y: anchor.cy - h },
      { x: anchor.cx + w, y: anchor.cy + h },
      { x: anchor.cx - w, y: anchor.cy + h },
    ],
    minX: anchor.cx - w,
    maxX: anchor.cx + w,
    minY: anchor.cy - h,
    maxY: anchor.cy + h,
  };
}

// Create initial zone layout with equal sizing
export function createZoneLayout(): Map<ZoneId, Zone> {
  const zones = new Map<ZoneId, Zone>();
  const zoneIds: ZoneId[] = [
    "active-front",
    "opportunities",
    "at-risk",
    "lost",
    "noise",
    "base-handled",
  ];

  for (const id of zoneIds) {
    const def = ZONE_DEFINITIONS[id];
    const anchor = ZONE_ANCHORS[id];
    zones.set(id, {
      id,
      name: def.name,
      boundary: makeBoundary(anchor),
      colorTint: def.colorTint,
      borderColor: def.borderColor,
      threadCount: 0,
      alertThreshold: { minThreads: null, maxThreads: null },
      alertState: "inactive",
      dynamicSizeWeight: 1.0,
    });
  }

  return zones;
}

// Update zone sizes based on thread populations (per Spec 04: adaptive sizing)
// Area scales proportional to thread population; total canvas area stays constant.
export function updateZoneSizes(
  zones: Map<ZoneId, Zone>,
  threadCounts: Record<ZoneId, number>,
): void {
  const total = Object.values(threadCounts).reduce((sum, c) => sum + c, 0);
  if (total === 0) return; // no threads, keep default sizes

  for (const [id, zone] of zones) {
    const count = threadCounts[id] || 0;
    // Scale factor: min 0.6 (never disappear), max 1.5 (never dominate)
    // Linear interpolation based on proportion of total threads
    const proportion = count / total;
    const scale = 0.6 + proportion * 5.4; // maps 0->0.6, ~0.17->1.5
    zone.dynamicSizeWeight = Math.min(Math.max(scale, 0.6), 1.5);
    zone.threadCount = count;
    zone.boundary = makeBoundary(ZONE_ANCHORS[id], zone.dynamicSizeWeight);
  }
}

// Determine which zone a position belongs to
// Uses bounding box check - returns the zone whose center is nearest if in overlap
export function getZoneAtPosition(zones: Map<ZoneId, Zone>, x: number, y: number): ZoneId {
  let bestZone: ZoneId = "active-front";
  let bestDist = Infinity;

  for (const [id, zone] of zones) {
    const b = zone.boundary;
    // Check if within bounds
    if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) {
      // Distance to zone center
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist < bestDist) {
        bestDist = dist;
        bestZone = id;
      }
    }
  }

  // If not inside any zone, find nearest zone center
  if (bestDist === Infinity) {
    for (const [id, zone] of zones) {
      const b = zone.boundary;
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist < bestDist) {
        bestDist = dist;
        bestZone = id;
      }
    }
  }

  return bestZone;
}

// Get the center of a zone for target position calculations
export function getZoneCenter(zones: Map<ZoneId, Zone>, zoneId: ZoneId): { x: number; y: number } {
  const zone = zones.get(zoneId);
  if (!zone) return { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
  const b = zone.boundary;
  return {
    x: (b.minX + b.maxX) / 2,
    y: (b.minY + b.maxY) / 2,
  };
}

// Get a random position within a zone boundary (for initial placement)
export function getRandomPositionInZone(
  zones: Map<ZoneId, Zone>,
  zoneId: ZoneId,
): { x: number; y: number } {
  const zone = zones.get(zoneId);
  if (!zone) return { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
  const b = zone.boundary;
  // Random position within the inner 80% of the zone to avoid edges
  const margin = 0.1;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  return {
    x: b.minX + w * margin + Math.random() * w * (1 - 2 * margin),
    y: b.minY + h * margin + Math.random() * h * (1 - 2 * margin),
  };
}

// Evaluate zone alerts per Spec 04
// Fires when count crosses threshold; remains active until condition resolves
export function evaluateZoneAlerts(zones: Map<ZoneId, Zone>): void {
  for (const [, zone] of zones) {
    const { minThreads, maxThreads } = zone.alertThreshold;
    let shouldAlert = false;

    if (minThreads !== null && zone.threadCount < minThreads) {
      shouldAlert = true;
    }
    if (maxThreads !== null && zone.threadCount > maxThreads) {
      shouldAlert = true;
    }

    zone.alertState = shouldAlert ? "active" : "inactive";
  }
}
