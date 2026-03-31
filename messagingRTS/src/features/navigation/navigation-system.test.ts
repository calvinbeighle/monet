// Navigation system tests per Spec 08
// Tests search matching, keyboard navigation, zoom level logic, hit testing,
// coordinate transforms, and edge scrolling

import { describe, it, expect } from "vitest";
import {
  getZoomLevel,
  getCanonicalZoom,
  zoomToFitZone,
  searchThreads,
  findNextThreadInDirection,
  findNearestThread,
  computeEdgeScroll,
  hitTestThread,
  screenToMap,
  computeThreadCentroid,
  ZOOM_LEVEL_RANGES,
  ZONE_SHORTCUTS,
  ZONE_TAB_ORDER,
} from "./navigation-system";
import { createThread } from "../../lib/types";
import type { Thread, Zone } from "../../lib/types";

// Helper to create a thread at a specific position with searchable fields
function makeContact(email: string, displayName: string) {
  return {
    email,
    displayName,
    organization: null,
    vipFlag: false,
    relationshipScore: 50,
    responseHistory: { avgResponseTimeMs: 0, threadFrequency: 0 },
  };
}

function makeThread(id: string, x: number, y: number, overrides: Partial<Thread> = {}): Thread {
  const base = createThread(id, overrides.subject ?? `Subject ${id}`, overrides.snippet ?? "");
  return {
    ...base,
    participants: overrides.participants ?? [makeContact(`user-${id}@example.com`, `User ${id}`)],
    gmailLabels: overrides.gmailLabels ?? base.gmailLabels,
    ...overrides,
    // Position always from args - must be last to prevent override
    position: { x, y },
  };
}

describe("Zoom Level Logic", () => {
  it("maps zoom values to correct levels per Spec 08", () => {
    expect(getZoomLevel(0.1)).toBe("strategic");
    expect(getZoomLevel(0.2)).toBe("strategic");
    expect(getZoomLevel(0.24)).toBe("strategic");
    expect(getZoomLevel(0.25)).toBe("tactical");
    expect(getZoomLevel(0.5)).toBe("tactical");
    expect(getZoomLevel(0.59)).toBe("tactical");
    expect(getZoomLevel(0.6)).toBe("operational");
    expect(getZoomLevel(1.0)).toBe("operational");
    expect(getZoomLevel(1.19)).toBe("operational");
    expect(getZoomLevel(1.2)).toBe("detail");
    expect(getZoomLevel(2.0)).toBe("detail");
  });

  it("provides canonical zoom values for each level", () => {
    expect(getCanonicalZoom("strategic")).toBe(0.15);
    expect(getCanonicalZoom("tactical")).toBe(0.4);
    expect(getCanonicalZoom("operational")).toBe(0.85);
    expect(getCanonicalZoom("detail")).toBe(1.5);
  });

  it("defines ranges for all four zoom levels", () => {
    expect(Object.keys(ZOOM_LEVEL_RANGES)).toEqual([
      "strategic",
      "tactical",
      "operational",
      "detail",
    ]);
    // Each range's canonical falls within its bounds
    for (const [, range] of Object.entries(ZOOM_LEVEL_RANGES)) {
      expect(range.canonical).toBeGreaterThanOrEqual(range.min);
      expect(range.canonical).toBeLessThanOrEqual(range.max);
    }
  });
});

describe("Search", () => {
  const threads = [
    makeThread("t1", 100, 100, {
      subject: "Meeting tomorrow",
      participants: [makeContact("alice@example.com", "Alice")],
    }),
    makeThread("t2", 200, 100, {
      subject: "Project update",
      participants: [makeContact("bob@work.com", "Bob")],
    }),
    makeThread("t3", 100, 200, {
      subject: "Invoice #123",
      participants: [makeContact("billing@vendor.com", "Billing")],
      gmailLabels: ["IMPORTANT"],
    }),
    makeThread("t4", 300, 200, {
      subject: "Lunch plans",
      snippet: "Hey, want to grab lunch at the meeting spot?",
    }),
  ];

  it("returns empty for empty query", () => {
    expect(searchThreads(threads, "")).toEqual([]);
    expect(searchThreads(threads, "  ")).toEqual([]);
  });

  it("matches by subject keyword", () => {
    const results = searchThreads(threads, "meeting");
    expect(results).toContain("t1");
  });

  it("matches by sender name", () => {
    const results = searchThreads(threads, "alice");
    expect(results).toEqual(["t1"]);
  });

  it("matches by sender email", () => {
    const results = searchThreads(threads, "bob@work");
    expect(results).toEqual(["t2"]);
  });

  it("matches by label", () => {
    const results = searchThreads(threads, "important");
    expect(results).toEqual(["t3"]);
  });

  it("matches by snippet", () => {
    const results = searchThreads(threads, "lunch at the meeting");
    expect(results).toContain("t4");
  });

  it("is case insensitive", () => {
    expect(searchThreads(threads, "MEETING")).toContain("t1");
    expect(searchThreads(threads, "Alice")).toEqual(["t1"]);
  });

  it("returns results in map-coordinate order (left-to-right, top-to-bottom)", () => {
    // t1 at (100,100), t2 at (200,100), t3 at (100,200), t4 at (300,200)
    const results = searchThreads(threads, "e"); // matches all (email has 'e')
    // Top row first (y=100): t1(x=100), t2(x=200)
    // Bottom row (y=200): t3(x=100), t4(x=300)
    expect(results[0]).toBe("t1");
    expect(results[1]).toBe("t2");
    expect(results[2]).toBe("t3");
    expect(results[3]).toBe("t4");
  });
});

describe("Keyboard Navigation", () => {
  const threads = [
    makeThread("center", 500, 500),
    makeThread("right", 700, 500),
    makeThread("left", 300, 500),
    makeThread("up", 500, 300),
    makeThread("down", 500, 700),
  ];

  it("returns null at strategic zoom (not active per Spec 08)", () => {
    expect(findNextThreadInDirection(threads, "center", "ArrowRight", "strategic")).toBeNull();
  });

  it("returns null at tactical zoom (not active per Spec 08)", () => {
    expect(findNextThreadInDirection(threads, "center", "ArrowRight", "tactical")).toBeNull();
  });

  it("finds thread to the right at operational zoom", () => {
    const next = findNextThreadInDirection(threads, "center", "ArrowRight", "operational");
    expect(next).toBe("right");
  });

  it("finds thread to the left", () => {
    const next = findNextThreadInDirection(threads, "center", "ArrowLeft", "operational");
    expect(next).toBe("left");
  });

  it("finds thread above", () => {
    const next = findNextThreadInDirection(threads, "center", "ArrowUp", "operational");
    expect(next).toBe("up");
  });

  it("finds thread below", () => {
    const next = findNextThreadInDirection(threads, "center", "ArrowDown", "operational");
    expect(next).toBe("down");
  });

  it("returns null for invalid direction key", () => {
    expect(findNextThreadInDirection(threads, "center", "ArrowDiagonal", "operational")).toBeNull();
  });

  it("works at detail zoom level", () => {
    expect(findNextThreadInDirection(threads, "center", "ArrowRight", "detail")).toBe("right");
  });

  it("returns first thread when no current selection", () => {
    const next = findNextThreadInDirection(threads, null, "ArrowRight", "operational");
    expect(next).toBe("center"); // first in array
  });
});

describe("findNearestThread", () => {
  const threads = [
    makeThread("t1", 100, 100),
    makeThread("t2", 500, 500),
    makeThread("t3", 900, 900),
  ];

  it("finds the nearest thread to a position", () => {
    expect(findNearestThread(threads, 90, 90)).toBe("t1");
    expect(findNearestThread(threads, 600, 600)).toBe("t2");
    expect(findNearestThread(threads, 1000, 1000)).toBe("t3");
  });

  it("returns null for empty array", () => {
    expect(findNearestThread([], 100, 100)).toBeNull();
  });
});

describe("Edge Scrolling", () => {
  const vw = 800;
  const vh = 600;

  it("returns null when cursor is in center", () => {
    expect(computeEdgeScroll(400, 300, vw, vh)).toBeNull();
  });

  it("scrolls left when cursor is near left edge", () => {
    const dir = computeEdgeScroll(10, 300, vw, vh);
    expect(dir).not.toBeNull();
    expect(dir!.x).toBeLessThan(0);
    expect(dir!.y).toBe(0);
  });

  it("scrolls right when cursor is near right edge", () => {
    const dir = computeEdgeScroll(790, 300, vw, vh);
    expect(dir).not.toBeNull();
    expect(dir!.x).toBeGreaterThan(0);
  });

  it("scrolls up when cursor is near top edge", () => {
    const dir = computeEdgeScroll(400, 5, vw, vh);
    expect(dir).not.toBeNull();
    expect(dir!.y).toBeLessThan(0);
  });

  it("scrolls down when cursor is near bottom edge", () => {
    const dir = computeEdgeScroll(400, 595, vw, vh);
    expect(dir).not.toBeNull();
    expect(dir!.y).toBeGreaterThan(0);
  });

  it("scroll speed increases with proximity to edge", () => {
    const far = computeEdgeScroll(35, 300, vw, vh);
    const close = computeEdgeScroll(5, 300, vw, vh);
    expect(Math.abs(close!.x)).toBeGreaterThan(Math.abs(far!.x));
  });

  it("handles diagonal edge (corner)", () => {
    const dir = computeEdgeScroll(5, 5, vw, vh);
    expect(dir).not.toBeNull();
    expect(dir!.x).toBeLessThan(0);
    expect(dir!.y).toBeLessThan(0);
  });
});

describe("Hit Testing", () => {
  const threads = [
    makeThread("t1", 100, 100),
    makeThread("t2", 200, 200),
    makeThread("t3", 500, 500),
  ];

  it("detects thread within hit radius", () => {
    expect(hitTestThread(threads, 105, 105)).toBe("t1");
    expect(hitTestThread(threads, 195, 195)).toBe("t2");
  });

  it("returns null when no thread is near", () => {
    expect(hitTestThread(threads, 350, 350)).toBeNull();
  });

  it("returns closest thread when multiple are in range", () => {
    // Create threads close together
    const close = [makeThread("a", 100, 100), makeThread("b", 110, 110)];
    expect(hitTestThread(close, 105, 105, 20)).toBe("a");
  });

  it("respects custom hit radius", () => {
    expect(hitTestThread(threads, 130, 130, 10)).toBeNull(); // too far for 10px radius
    expect(hitTestThread(threads, 130, 130, 50)).toBe("t1"); // within 50px radius
  });
});

describe("Coordinate Transforms", () => {
  it("converts screen coordinates to map coordinates", () => {
    const cam = { x: 1000, y: 1000, zoom: 1.0, level: "operational" as const };
    const map = screenToMap(400, 300, cam, 800, 600);
    // Center of screen maps to camera position
    expect(map.x).toBe(1000);
    expect(map.y).toBe(1000);
  });

  it("accounts for zoom in screen-to-map conversion", () => {
    const cam = { x: 1000, y: 1000, zoom: 2.0, level: "detail" as const };
    // At 2x zoom, screen offset of 100px = 50 map units
    const map = screenToMap(500, 400, cam, 800, 600);
    expect(map.x).toBe(1050); // 1000 + (500-400)/2
    expect(map.y).toBe(1050); // 1000 + (400-300)/2
  });

  it("computes centroid of thread positions", () => {
    const threads = [makeThread("t1", 100, 200), makeThread("t2", 300, 400)];
    const centroid = computeThreadCentroid(threads);
    expect(centroid.x).toBe(200);
    expect(centroid.y).toBe(300);
  });

  it("returns map center for empty thread list", () => {
    const centroid = computeThreadCentroid([]);
    expect(centroid.x).toBe(2000);
    expect(centroid.y).toBe(1500);
  });
});

describe("Zone Quick-Nav", () => {
  it("maps number keys to zone IDs", () => {
    expect(ZONE_SHORTCUTS["1"]).toBe("active-front");
    expect(ZONE_SHORTCUTS["2"]).toBe("opportunities");
    expect(ZONE_SHORTCUTS["3"]).toBe("at-risk");
    expect(ZONE_SHORTCUTS["4"]).toBe("lost");
    expect(ZONE_SHORTCUTS["5"]).toBe("noise");
    expect(ZONE_SHORTCUTS["6"]).toBe("base-handled");
  });

  it("tab order covers all 6 zones", () => {
    expect(ZONE_TAB_ORDER).toHaveLength(6);
    expect(ZONE_TAB_ORDER).toContain("active-front");
    expect(ZONE_TAB_ORDER).toContain("base-handled");
  });
});

describe("zoomToFitZone", () => {
  const testZone: Zone = {
    id: "active-front",
    name: "Active Front",
    boundary: {
      points: [],
      minX: 1000,
      minY: 500,
      maxX: 2000,
      maxY: 1000,
    },
    colorTint: 0x44cc44,
    borderColor: 0x66ee66,
    threadCount: 10,
    alertThreshold: { maxThreads: 20, minThreads: 0 },
    alertState: "inactive",
    dynamicSizeWeight: 1.0,
  };

  it("computes zoom to fit zone in viewport", () => {
    const fit = zoomToFitZone(testZone, 800, 600);
    expect(fit.centerX).toBe(1500); // midpoint of 1000-2000
    expect(fit.centerY).toBe(750); // midpoint of 500-1000
    expect(fit.zoom).toBeGreaterThan(0);
    expect(fit.zoom).toBeLessThanOrEqual(2.0);
  });

  it("zoom is clamped within valid range", () => {
    const fit = zoomToFitZone(testZone, 80000, 60000);
    expect(fit.zoom).toBeLessThanOrEqual(2.0);
  });
});
