// Navigation system per Spec 08
// Pure functions for search matching, keyboard navigation, zoom level logic,
// and coordinate transforms. No side effects - used by map-viewport to drive behavior.

import type { Thread, ZoneId, Zone } from "../../lib/types";
import type { CameraState, ZoomLevel } from "./navigation-store";

// Zoom level boundaries per Spec 08
export const ZOOM_LEVEL_RANGES: Record<ZoomLevel, { min: number; max: number; canonical: number }> =
  {
    strategic: { min: 0.1, max: 0.25, canonical: 0.15 },
    tactical: { min: 0.25, max: 0.6, canonical: 0.4 },
    operational: { min: 0.6, max: 1.2, canonical: 0.85 },
    detail: { min: 1.2, max: 2.0, canonical: 1.5 },
  };

// Edge scrolling constants
const EDGE_MARGIN = 40; // pixels from viewport edge
const EDGE_SCROLL_SPEED = 8; // pixels per frame at maximum proximity

// Keyboard nav angular range for direction matching
const DIRECTION_ANGLE_RANGE = Math.PI / 3; // 60 degrees

// -- Zoom level logic --

export function getZoomLevel(zoom: number): ZoomLevel {
  if (zoom < 0.25) return "strategic";
  if (zoom < 0.6) return "tactical";
  if (zoom < 1.2) return "operational";
  return "detail";
}

export function getCanonicalZoom(level: ZoomLevel): number {
  return ZOOM_LEVEL_RANGES[level].canonical;
}

/** Compute zoom that fits a zone boundary within the viewport */
export function zoomToFitZone(
  zone: Zone,
  viewportWidth: number,
  viewportHeight: number,
): { zoom: number; level: ZoomLevel; centerX: number; centerY: number } {
  const b = zone.boundary;
  const zoneWidth = b.maxX - b.minX;
  const zoneHeight = b.maxY - b.minY;
  const centerX = (b.minX + b.maxX) / 2;
  const centerY = (b.minY + b.maxY) / 2;

  // Fit zone within viewport with padding
  const padding = 1.2; // 20% padding
  const zoomX = viewportWidth / (zoneWidth * padding);
  const zoomY = viewportHeight / (zoneHeight * padding);
  const zoom = Math.max(0.1, Math.min(2.0, Math.min(zoomX, zoomY)));
  const level = getZoomLevel(zoom);

  return { zoom, level, centerX, centerY };
}

// -- Search --

/** Match threads by keyword (subject/snippet), sender address/name, or label */
export function searchThreads(threads: Thread[], query: string): string[] {
  if (!query.trim()) return [];

  const lower = query.toLowerCase();
  const matches: Array<{ id: string; x: number; y: number }> = [];

  for (const thread of threads) {
    let matched = false;

    // Subject match
    if (thread.subject.toLowerCase().includes(lower)) {
      matched = true;
    }

    // Snippet match
    if (!matched && thread.snippet?.toLowerCase().includes(lower)) {
      matched = true;
    }

    // Sender/participant match (name or email)
    if (!matched) {
      for (const p of thread.participants) {
        if (
          p.email.toLowerCase().includes(lower) ||
          (p.displayName && p.displayName.toLowerCase().includes(lower))
        ) {
          matched = true;
          break;
        }
      }
    }

    // Label match
    if (!matched) {
      for (const label of thread.gmailLabels) {
        if (label.toLowerCase().includes(lower)) {
          matched = true;
          break;
        }
      }
    }

    if (matched) {
      matches.push({ id: thread.id, x: thread.position.x, y: thread.position.y });
    }
  }

  // Sort in map-coordinate order: left-to-right, top-to-bottom
  matches.sort((a, b) => {
    const yDiff = a.y - b.y;
    if (Math.abs(yDiff) > 50) return yDiff; // different rows
    return a.x - b.x; // same row, sort by x
  });

  return matches.map((m) => m.id);
}

// -- Keyboard Navigation --

interface DirectionVector {
  x: number;
  y: number;
}

const ARROW_DIRECTIONS: Record<string, DirectionVector> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

/**
 * Find the nearest thread in the given arrow key direction from the current selection.
 * Per Spec 08: only active at Operational or Detail zoom levels.
 */
export function findNextThreadInDirection(
  threads: Thread[],
  currentId: string | null,
  direction: string,
  zoomLevel: ZoomLevel,
  viewportCenter?: { x: number; y: number },
): string | null {
  // Only at operational or detail per Spec 08
  if (zoomLevel !== "operational" && zoomLevel !== "detail") return null;

  const dir = ARROW_DIRECTIONS[direction];
  if (!dir) return null;

  // Per Spec 08: first arrow key press selects thread nearest to viewport center
  if (!currentId) {
    if (viewportCenter) {
      return findNearestThread(threads, viewportCenter.x, viewportCenter.y);
    }
    return threads.length > 0 ? threads[0].id : null;
  }

  const current = threads.find((t) => t.id === currentId);
  if (!current) return threads.length > 0 ? threads[0].id : null;

  const dirAngle = Math.atan2(dir.y, dir.x);
  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const thread of threads) {
    if (thread.id === currentId) continue;

    const dx = thread.position.x - current.position.x;
    const dy = thread.position.y - current.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) continue; // same position

    const angle = Math.atan2(dy, dx);
    const angleDiff = Math.abs(normalizeAngle(angle - dirAngle));

    if (angleDiff <= DIRECTION_ANGLE_RANGE && dist < bestDist) {
      bestDist = dist;
      bestId = thread.id;
    }
  }

  return bestId;
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Find the thread nearest to a given map position.
 * Used for initial arrow key selection (nearest to viewport center).
 */
export function findNearestThread(threads: Thread[], x: number, y: number): string | null {
  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const thread of threads) {
    const dx = thread.position.x - x;
    const dy = thread.position.y - y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestId = thread.id;
    }
  }

  return bestId;
}

// -- Edge Scrolling --

/**
 * Compute edge scroll direction based on cursor position within viewport.
 * Returns null if cursor is not in the edge margin.
 * Per Spec 08: speed proportional to proximity to edge, only during drag.
 */
export function computeEdgeScroll(
  cursorX: number,
  cursorY: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } | null {
  let dx = 0;
  let dy = 0;

  if (cursorX < EDGE_MARGIN) {
    dx = -EDGE_SCROLL_SPEED * (1 - cursorX / EDGE_MARGIN);
  } else if (cursorX > viewportWidth - EDGE_MARGIN) {
    dx = EDGE_SCROLL_SPEED * (1 - (viewportWidth - cursorX) / EDGE_MARGIN);
  }

  if (cursorY < EDGE_MARGIN) {
    dy = -EDGE_SCROLL_SPEED * (1 - cursorY / EDGE_MARGIN);
  } else if (cursorY > viewportHeight - EDGE_MARGIN) {
    dy = EDGE_SCROLL_SPEED * (1 - (viewportHeight - cursorY) / EDGE_MARGIN);
  }

  if (dx === 0 && dy === 0) return null;
  return { x: dx, y: dy };
}

// -- Hit testing --

/** Find thread entity at a given map coordinate (for click selection) */
export function hitTestThread(
  threads: Thread[],
  mapX: number,
  mapY: number,
  hitRadius: number = 20,
): string | null {
  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const thread of threads) {
    const dx = thread.position.x - mapX;
    const dy = thread.position.y - mapY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= hitRadius && dist < bestDist) {
      bestDist = dist;
      bestId = thread.id;
    }
  }

  return bestId;
}

/** Convert screen coordinates to map coordinates given camera state */
export function screenToMap(
  screenX: number,
  screenY: number,
  camera: CameraState,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  const mapX = camera.x + (screenX - viewportWidth / 2) / camera.zoom;
  const mapY = camera.y + (screenY - viewportHeight / 2) / camera.zoom;
  return { x: mapX, y: mapY };
}

/** Compute the centroid of all thread positions (for initial camera placement) */
export function computeThreadCentroid(threads: Thread[]): { x: number; y: number } {
  if (threads.length === 0) return { x: 2000, y: 1500 }; // map center (4000x3000)

  let sumX = 0;
  let sumY = 0;
  for (const t of threads) {
    sumX += t.position.x;
    sumY += t.position.y;
  }
  return { x: sumX / threads.length, y: sumY / threads.length };
}

// -- Zone quick-nav --

/** Zone keyboard shortcuts per Spec 08 */
export const ZONE_SHORTCUTS: Record<string, ZoneId> = {
  "1": "active-front",
  "2": "opportunities",
  "3": "at-risk",
  "4": "lost",
  "5": "noise",
  "6": "base-handled",
};

/** Get the ordered list of zone IDs for tab cycling */
export const ZONE_TAB_ORDER: ZoneId[] = [
  "active-front",
  "opportunities",
  "at-risk",
  "lost",
  "noise",
  "base-handled",
];
