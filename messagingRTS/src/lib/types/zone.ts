// Zone system per Spec 04
// Six canonical zones with spatial regions, visual identity, and alert thresholds

import type { Position } from "./thread";

export type ZoneId =
  | "active-front"
  | "opportunities"
  | "at-risk"
  | "lost"
  | "noise"
  | "base-handled";

export interface ZoneBoundary {
  // Bounding polygon defined by corner points
  points: Position[];
  // Simplified bounding box for fast checks
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ZoneAlertThreshold {
  minThreads: number | null; // alert if count drops below
  maxThreads: number | null; // alert if count exceeds
}

export type ZoneAlertState = "inactive" | "active";

export interface Zone {
  id: ZoneId;
  name: string;
  boundary: ZoneBoundary;
  colorTint: number; // hex color for PixiJS
  borderColor: number;
  threadCount: number;
  alertThreshold: ZoneAlertThreshold;
  alertState: ZoneAlertState;
  dynamicSizeWeight: number; // proportional to thread population
}

// Canonical zone definitions with default layout positions
// Map coordinate system: origin at center, x right, y down
// Total canvas: 4000x3000
export const ZONE_DEFINITIONS: Record<
  ZoneId,
  { name: string; colorTint: number; borderColor: number }
> = {
  "active-front": {
    name: "Active Front",
    colorTint: 0x1a3a5c,
    borderColor: 0x2a6aac,
  },
  opportunities: {
    name: "Opportunities",
    colorTint: 0x1a4a2a,
    borderColor: 0x2a8a4a,
  },
  "at-risk": {
    name: "At Risk",
    colorTint: 0x5a3a1a,
    borderColor: 0xaa6a2a,
  },
  lost: {
    name: "Lost",
    colorTint: 0x3a1a1a,
    borderColor: 0x8a2a2a,
  },
  noise: {
    name: "Noise",
    colorTint: 0x2a2a2a,
    borderColor: 0x4a4a4a,
  },
  "base-handled": {
    name: "Base / Handled",
    colorTint: 0x1a2a3a,
    borderColor: 0x3a5a7a,
  },
};
