// Deployment store tests per Spec 06
// Verifies: drag state, confirmation flow, deployment lifecycle, recall, queries

import { describe, it, expect, beforeEach } from "vitest";
import { useDeploymentStore } from "./deployment-store";

describe("DeploymentStore", () => {
  beforeEach(() => {
    useDeploymentStore.setState({
      dragState: null,
      confirmation: null,
      deployments: [],
      activeDeploymentId: null,
    });
  });

  describe("drag state", () => {
    it("starts drag with role and position", () => {
      useDeploymentStore.getState().startDrag("closer", 100, 200);
      const drag = useDeploymentStore.getState().dragState;
      expect(drag).not.toBeNull();
      expect(drag!.draggingRole).toBe("closer");
      expect(drag!.screenX).toBe(100);
      expect(drag!.screenY).toBe(200);
      expect(drag!.dropValid).toBe(false);
    });

    it("updates drag position", () => {
      useDeploymentStore.getState().startDrag("closer", 100, 200);
      useDeploymentStore.getState().updateDrag(300, 400);
      const drag = useDeploymentStore.getState().dragState;
      expect(drag!.screenX).toBe(300);
      expect(drag!.screenY).toBe(400);
    });

    it("sets drop target", () => {
      useDeploymentStore.getState().startDrag("researcher", 0, 0);
      useDeploymentStore.getState().setDragTarget("cluster-1", "active-front", true);
      const drag = useDeploymentStore.getState().dragState;
      expect(drag!.hoverClusterId).toBe("cluster-1");
      expect(drag!.hoverZoneId).toBe("active-front");
      expect(drag!.dropValid).toBe(true);
    });

    it("cancels drag", () => {
      useDeploymentStore.getState().startDrag("closer", 0, 0);
      useDeploymentStore.getState().cancelDrag();
      expect(useDeploymentStore.getState().dragState).toBeNull();
    });

    it("updateDrag does nothing when not dragging", () => {
      useDeploymentStore.getState().updateDrag(100, 200);
      expect(useDeploymentStore.getState().dragState).toBeNull();
    });
  });

  describe("confirmation", () => {
    it("shows confirmation and clears drag state", () => {
      useDeploymentStore.getState().startDrag("drafter", 0, 0);
      useDeploymentStore.getState().showConfirmation({
        agentRole: "drafter",
        clusterId: "c1",
        threadIds: ["t1", "t2"],
        description: "Draft replies to 2 threads",
      });
      expect(useDeploymentStore.getState().dragState).toBeNull();
      expect(useDeploymentStore.getState().confirmation).not.toBeNull();
      expect(useDeploymentStore.getState().confirmation!.agentRole).toBe("drafter");
    });

    it("cancels confirmation", () => {
      useDeploymentStore.getState().showConfirmation({
        agentRole: "closer",
        clusterId: "c1",
        threadIds: ["t1"],
        description: "Close 1 thread",
      });
      useDeploymentStore.getState().cancelConfirmation();
      expect(useDeploymentStore.getState().confirmation).toBeNull();
    });

    it("confirms deployment and creates record", () => {
      useDeploymentStore.getState().showConfirmation({
        agentRole: "scheduler",
        clusterId: "c1",
        threadIds: ["t1", "t2", "t3"],
        description: "Schedule meetings for 3 threads",
      });

      const record = useDeploymentStore.getState().confirmDeployment();
      expect(record).not.toBeNull();
      expect(record!.agentRole).toBe("scheduler");
      expect(record!.clusterId).toBe("c1");
      expect(record!.threadIds).toEqual(["t1", "t2", "t3"]);
      expect(record!.status).toBe("confirming");

      // Confirmation cleared
      expect(useDeploymentStore.getState().confirmation).toBeNull();
      // Record added to deployments
      expect(useDeploymentStore.getState().deployments.length).toBe(1);
      // Active deployment set
      expect(useDeploymentStore.getState().activeDeploymentId).toBe(record!.id);
    });

    it("confirmDeployment returns null when no confirmation", () => {
      expect(useDeploymentStore.getState().confirmDeployment()).toBeNull();
    });
  });

  describe("deployment lifecycle", () => {
    function createDeployment() {
      useDeploymentStore.getState().showConfirmation({
        agentRole: "closer",
        clusterId: "c1",
        threadIds: ["t1"],
        description: "Test",
      });
      return useDeploymentStore.getState().confirmDeployment()!;
    }

    it("transitions through full lifecycle: confirming -> traveling -> in-progress -> completed", () => {
      const record = createDeployment();

      useDeploymentStore.getState().startTravel(record.id);
      expect(useDeploymentStore.getState().deployments[0].status).toBe("traveling");

      useDeploymentStore.getState().startWork(record.id);
      expect(useDeploymentStore.getState().deployments[0].status).toBe("in-progress");

      useDeploymentStore.getState().completeDeployment(record.id);
      expect(useDeploymentStore.getState().deployments[0].status).toBe("completed");
      expect(useDeploymentStore.getState().deployments[0].completedAt).not.toBeNull();
      expect(useDeploymentStore.getState().activeDeploymentId).toBeNull();
    });

    it("recall sets status and clears active", () => {
      const record = createDeployment();
      useDeploymentStore.getState().startTravel(record.id);
      useDeploymentStore.getState().recallDeployment(record.id);

      const deployment = useDeploymentStore.getState().deployments[0];
      expect(deployment.status).toBe("recalled");
      expect(deployment.recalledAt).not.toBeNull();
      expect(useDeploymentStore.getState().activeDeploymentId).toBeNull();
    });

    it("fail sets status and clears active", () => {
      const record = createDeployment();
      useDeploymentStore.getState().startTravel(record.id);
      useDeploymentStore.getState().startWork(record.id);
      useDeploymentStore.getState().failDeployment(record.id);

      expect(useDeploymentStore.getState().deployments[0].status).toBe("failed");
      expect(useDeploymentStore.getState().activeDeploymentId).toBeNull();
    });
  });

  describe("queries", () => {
    it("getActiveDeploymentForRole finds active deployment", () => {
      useDeploymentStore.getState().showConfirmation({
        agentRole: "drafter",
        clusterId: "c1",
        threadIds: ["t1"],
        description: "Test",
      });
      useDeploymentStore.getState().confirmDeployment();

      const active = useDeploymentStore.getState().getActiveDeploymentForRole("drafter");
      expect(active).toBeDefined();
      expect(active!.agentRole).toBe("drafter");
    });

    it("getActiveDeploymentForRole returns undefined for idle role", () => {
      expect(useDeploymentStore.getState().getActiveDeploymentForRole("closer")).toBeUndefined();
    });

    it("getDeploymentHistory returns all deployments", () => {
      useDeploymentStore.getState().showConfirmation({
        agentRole: "closer",
        clusterId: "c1",
        threadIds: ["t1"],
        description: "Test 1",
      });
      useDeploymentStore.getState().confirmDeployment();

      useDeploymentStore.getState().showConfirmation({
        agentRole: "researcher",
        clusterId: "c2",
        threadIds: ["t2"],
        description: "Test 2",
      });
      useDeploymentStore.getState().confirmDeployment();

      expect(useDeploymentStore.getState().getDeploymentHistory().length).toBe(2);
    });
  });
});
