// Tests for Feature 4: In-progress cluster indicator on map (Spec 06)

import { describe, it, expect } from "vitest";
import { MapRenderer } from "./map/map-renderer";

describe("In-progress cluster indicator - MapRenderer", () => {
  it("inProgressClusterIds starts empty", () => {
    const renderer = new MapRenderer();
    expect(renderer.getInProgressClusterIds().size).toBe(0);
  });

  it("setInProgressClusterIds stores the IDs", () => {
    const renderer = new MapRenderer();
    renderer.setInProgressClusterIds(new Set(["c1", "c2"]));
    expect(renderer.getInProgressClusterIds().has("c1")).toBe(true);
    expect(renderer.getInProgressClusterIds().has("c2")).toBe(true);
    expect(renderer.getInProgressClusterIds().size).toBe(2);
  });

  it("setInProgressClusterIds can be cleared", () => {
    const renderer = new MapRenderer();
    renderer.setInProgressClusterIds(new Set(["c1"]));
    expect(renderer.getInProgressClusterIds().size).toBe(1);
    renderer.setInProgressClusterIds(new Set());
    expect(renderer.getInProgressClusterIds().size).toBe(0);
  });

  it("setInProgressClusterIds replaces previous set", () => {
    const renderer = new MapRenderer();
    renderer.setInProgressClusterIds(new Set(["c1", "c2"]));
    renderer.setInProgressClusterIds(new Set(["c3"]));
    expect(renderer.getInProgressClusterIds().has("c1")).toBe(false);
    expect(renderer.getInProgressClusterIds().has("c3")).toBe(true);
    expect(renderer.getInProgressClusterIds().size).toBe(1);
  });

  it("renderClusters does not crash with in-progress clusters set (no init)", () => {
    const renderer = new MapRenderer();
    renderer.setInProgressClusterIds(new Set(["cluster-0"]));
    // Without PixiJS init, renderClusters returns early - no crash
    expect(() => renderer.renderClusters([], [])).not.toThrow();
  });

  it("renderClusters does not crash with in-progress IDs matching actual clusters (no init)", () => {
    const renderer = new MapRenderer();
    renderer.setInProgressClusterIds(new Set(["c1"]));
    const cluster = {
      id: "c1",
      memberThreadIds: ["t1", "t2"],
      centroid: { x: 100, y: 100 },
      label: "Test",
      visualExtent: 50,
      formationTimestamp: Date.now(),
      lastMembershipChange: Date.now(),
    };
    // No layers, so returns early safely
    expect(() => renderer.renderClusters([cluster], [])).not.toThrow();
  });
});
