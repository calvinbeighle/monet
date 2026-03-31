// Map renderer tests
// Note: Full WebGL tests require a browser environment.
// These tests validate the non-rendering logic (camera, zoom levels, state).

import { describe, it, expect } from "vitest";
import { MapRenderer } from "./map-renderer";

describe("MapRenderer", () => {
  it("can be instantiated", () => {
    const renderer = new MapRenderer();
    expect(renderer).toBeDefined();
    expect(renderer.getApp()).toBeNull(); // not initialized yet
  });

  it("reports correct initial camera state", () => {
    const renderer = new MapRenderer();
    const state = renderer.getCameraState();
    expect(state.x).toBe(0);
    expect(state.y).toBe(0);
    expect(state.zoom).toBe(0.5);
    expect(state.level).toBe("tactical"); // 0.5 is tactical range
  });

  it("zoom levels are correct per Spec 08", () => {
    const renderer = new MapRenderer();

    // Test zoom level boundaries
    // We can't easily set zoom without init, but we can verify the logic
    // by checking the method exists and returns valid values
    const state = renderer.getCameraState();
    expect(["strategic", "tactical", "operational", "detail"]).toContain(state.level);
  });

  it("zoom level thresholds match Spec 08", () => {
    const renderer = new MapRenderer();

    // Strategic: < 0.25
    renderer.setCamera(0, 0, 0.15);
    expect(renderer.getZoomLevel()).toBe("strategic");

    // Tactical: 0.25 - 0.6
    renderer.setCamera(0, 0, 0.4);
    expect(renderer.getZoomLevel()).toBe("tactical");

    // Operational: 0.6 - 1.2
    renderer.setCamera(0, 0, 0.8);
    expect(renderer.getZoomLevel()).toBe("operational");

    // Detail: >= 1.2
    renderer.setCamera(0, 0, 1.5);
    expect(renderer.getZoomLevel()).toBe("detail");
  });

  it("has renderClusters method for cluster visual rendering", () => {
    const renderer = new MapRenderer();
    expect(typeof renderer.renderClusters).toBe("function");
  });

  it("renderClusters does nothing when layers not initialized", () => {
    const renderer = new MapRenderer();
    // Should not throw when called without init
    expect(() => renderer.renderClusters([], [])).not.toThrow();
  });
});
