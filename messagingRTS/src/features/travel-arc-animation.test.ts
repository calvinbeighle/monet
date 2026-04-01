// Tests for Feature 2: Agent travel arc animation (Spec 06)
// Validates travel animation state in deployment store and bezier math in map renderer.

import { describe, it, expect, beforeEach } from "vitest";
import { useDeploymentStore } from "../lib/stores/deployment-store";
import type { TravelAnimation } from "../lib/stores/deployment-store";
import { MapRenderer } from "./map/map-renderer";

function resetStore() {
  useDeploymentStore.setState({
    deployments: [],
    travelAnimations: [],
    confirmation: null,
    dragState: null,
    activeDeploymentId: null,
    selectedClusterIds: [],
  });
}

describe("Travel animation - Deployment Store", () => {
  beforeEach(resetStore);

  it("travelAnimations starts empty", () => {
    expect(useDeploymentStore.getState().travelAnimations).toEqual([]);
  });

  it("addTravelAnimation adds an animation", () => {
    const anim: TravelAnimation = {
      agentRole: "closer",
      deploymentId: "d1",
      startX: 0,
      startY: 100,
      endX: 500,
      endY: 300,
      startTime: Date.now(),
      duration: 800,
    };
    useDeploymentStore.getState().addTravelAnimation(anim);
    const anims = useDeploymentStore.getState().travelAnimations;
    expect(anims).toHaveLength(1);
    expect(anims[0].deploymentId).toBe("d1");
    expect(anims[0].agentRole).toBe("closer");
  });

  it("addTravelAnimation can add multiple animations", () => {
    const anim1: TravelAnimation = {
      agentRole: "closer",
      deploymentId: "d1",
      startX: 0,
      startY: 0,
      endX: 100,
      endY: 100,
      startTime: Date.now(),
      duration: 800,
    };
    const anim2: TravelAnimation = {
      agentRole: "researcher",
      deploymentId: "d2",
      startX: 50,
      startY: 50,
      endX: 200,
      endY: 200,
      startTime: Date.now(),
      duration: 800,
    };
    useDeploymentStore.getState().addTravelAnimation(anim1);
    useDeploymentStore.getState().addTravelAnimation(anim2);
    expect(useDeploymentStore.getState().travelAnimations).toHaveLength(2);
  });

  it("removeTravelAnimation removes by deployment ID", () => {
    const anim: TravelAnimation = {
      agentRole: "closer",
      deploymentId: "d1",
      startX: 0,
      startY: 0,
      endX: 100,
      endY: 100,
      startTime: Date.now(),
      duration: 800,
    };
    useDeploymentStore.getState().addTravelAnimation(anim);
    useDeploymentStore.getState().removeTravelAnimation("d1");
    expect(useDeploymentStore.getState().travelAnimations).toHaveLength(0);
  });

  it("removeTravelAnimation leaves other animations intact", () => {
    useDeploymentStore.getState().addTravelAnimation({
      agentRole: "closer",
      deploymentId: "d1",
      startX: 0,
      startY: 0,
      endX: 100,
      endY: 100,
      startTime: Date.now(),
      duration: 800,
    });
    useDeploymentStore.getState().addTravelAnimation({
      agentRole: "researcher",
      deploymentId: "d2",
      startX: 50,
      startY: 50,
      endX: 200,
      endY: 200,
      startTime: Date.now(),
      duration: 800,
    });
    useDeploymentStore.getState().removeTravelAnimation("d1");
    const anims = useDeploymentStore.getState().travelAnimations;
    expect(anims).toHaveLength(1);
    expect(anims[0].deploymentId).toBe("d2");
  });

  it("getActiveTravelAnimations returns current animations", () => {
    const anim: TravelAnimation = {
      agentRole: "closer",
      deploymentId: "d1",
      startX: 0,
      startY: 0,
      endX: 100,
      endY: 100,
      startTime: Date.now(),
      duration: 800,
    };
    useDeploymentStore.getState().addTravelAnimation(anim);
    const active = useDeploymentStore.getState().getActiveTravelAnimations();
    expect(active).toHaveLength(1);
  });
});

describe("Travel animation - Bezier curve math", () => {
  it("bezierPoint returns start position at t=0", () => {
    const p = MapRenderer.bezierPoint(0, 0, 100, 100, 0);
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it("bezierPoint returns end position at t=1", () => {
    const p = MapRenderer.bezierPoint(0, 0, 100, 100, 1);
    expect(p.x).toBeCloseTo(100, 5);
    expect(p.y).toBeCloseTo(100, 5);
  });

  it("bezierPoint returns midpoint-ish at t=0.5 (offset by arc)", () => {
    const p = MapRenderer.bezierPoint(0, 0, 200, 0, 0.5);
    // At t=0.5 on a horizontal line, x should be near 100
    expect(p.x).toBeCloseTo(100, 0);
    // y should be non-zero due to the arc (control point offset)
    expect(p.y).not.toBe(0);
  });

  it("bezierPoint creates an arc (not straight line)", () => {
    const start = MapRenderer.bezierPoint(0, 0, 100, 0, 0);
    const mid = MapRenderer.bezierPoint(0, 0, 100, 0, 0.5);
    const end = MapRenderer.bezierPoint(0, 0, 100, 0, 1);
    // Mid point y should deviate from the straight line (y=0)
    expect(Math.abs(mid.y)).toBeGreaterThan(1);
    // Start and end should be on the line
    expect(start.y).toBeCloseTo(0, 5);
    expect(end.y).toBeCloseTo(0, 5);
  });

  it("bezierPoint handles vertical lines", () => {
    const start = MapRenderer.bezierPoint(0, 0, 0, 200, 0);
    const mid = MapRenderer.bezierPoint(0, 0, 0, 200, 0.5);
    const end = MapRenderer.bezierPoint(0, 0, 0, 200, 1);
    expect(start.y).toBeCloseTo(0, 5);
    expect(end.y).toBeCloseTo(200, 5);
    // X should deviate for the arc
    expect(Math.abs(mid.x)).toBeGreaterThan(1);
  });
});

describe("Travel animation - MapRenderer integration", () => {
  it("setTravelAnimations stores animations", () => {
    const renderer = new MapRenderer();
    renderer.setTravelAnimations([
      {
        agentColor: 0xffbf00,
        startX: 0,
        startY: 0,
        endX: 100,
        endY: 100,
        startTime: Date.now(),
        duration: 800,
      },
    ]);
    expect(renderer.getTravelAnimations()).toHaveLength(1);
  });

  it("setTravelAnimations can clear animations", () => {
    const renderer = new MapRenderer();
    renderer.setTravelAnimations([
      {
        agentColor: 0xffbf00,
        startX: 0,
        startY: 0,
        endX: 100,
        endY: 100,
        startTime: Date.now(),
        duration: 800,
      },
    ]);
    renderer.setTravelAnimations([]);
    expect(renderer.getTravelAnimations()).toHaveLength(0);
  });

  it("renderTravelArcs does not throw without init", () => {
    const renderer = new MapRenderer();
    renderer.setTravelAnimations([
      {
        agentColor: 0xffbf00,
        startX: 0,
        startY: 0,
        endX: 100,
        endY: 100,
        startTime: Date.now() - 400,
        duration: 800,
      },
    ]);
    expect(() => renderer.renderTravelArcs()).not.toThrow();
  });
});
