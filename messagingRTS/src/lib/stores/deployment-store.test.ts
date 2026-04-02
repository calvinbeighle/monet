// Deployment store tests per Spec 06
// Verifies: drag state, confirmation flow, deployment lifecycle, recall, queries,
// batch deployment (Spec 06 Section 11), cluster selection

import { describe, it, expect, beforeEach } from "vitest";
import { useDeploymentStore } from "./deployment-store";

describe("DeploymentStore", () => {
  beforeEach(() => {
    useDeploymentStore.setState({
      dragState: null,
      confirmation: null,
      deployments: [],
      activeDeploymentId: null,
      selectedClusterIds: [],
      escalatedClusterIds: new Set(),
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

    it("confirms deployment and creates record with null batchId", () => {
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
      expect(record!.batchId).toBeNull();

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

  describe("resolution", () => {
    function createCompletedDeployment() {
      useDeploymentStore.getState().showConfirmation({
        agentRole: "closer",
        clusterId: "c1",
        threadIds: ["t1"],
        description: "Test",
      });
      const record = useDeploymentStore.getState().confirmDeployment()!;
      useDeploymentStore.getState().startTravel(record.id);
      useDeploymentStore.getState().startWork(record.id);
      useDeploymentStore.getState().completeDeployment(record.id);
      return record;
    }

    it("resolveDeployment transitions completed to resolved", () => {
      const record = createCompletedDeployment();
      useDeploymentStore.getState().resolveDeployment(record.id);
      expect(useDeploymentStore.getState().deployments[0].status).toBe("resolved");
    });

    it("getCompletedDeploymentForRole finds completed deployment", () => {
      createCompletedDeployment();
      const found = useDeploymentStore.getState().getCompletedDeploymentForRole("closer");
      expect(found).toBeDefined();
      expect(found!.status).toBe("completed");
    });

    it("getCompletedDeploymentForRole returns undefined for non-completed", () => {
      expect(useDeploymentStore.getState().getCompletedDeploymentForRole("closer")).toBeUndefined();
    });

    it("getCompletedDeploymentForRole returns undefined after resolution", () => {
      const record = createCompletedDeployment();
      useDeploymentStore.getState().resolveDeployment(record.id);
      expect(useDeploymentStore.getState().getCompletedDeploymentForRole("closer")).toBeUndefined();
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

  // Batch deployment tests per Spec 06 Section 11
  describe("cluster selection", () => {
    it("toggles cluster selection on and off", () => {
      useDeploymentStore.getState().toggleClusterSelection("c1");
      expect(useDeploymentStore.getState().selectedClusterIds).toEqual(["c1"]);

      useDeploymentStore.getState().toggleClusterSelection("c2");
      expect(useDeploymentStore.getState().selectedClusterIds).toEqual(["c1", "c2"]);

      // Toggle c1 off
      useDeploymentStore.getState().toggleClusterSelection("c1");
      expect(useDeploymentStore.getState().selectedClusterIds).toEqual(["c2"]);
    });

    it("clears all cluster selections", () => {
      useDeploymentStore.getState().toggleClusterSelection("c1");
      useDeploymentStore.getState().toggleClusterSelection("c2");
      useDeploymentStore.getState().toggleClusterSelection("c3");
      expect(useDeploymentStore.getState().selectedClusterIds.length).toBe(3);

      useDeploymentStore.getState().clearClusterSelection();
      expect(useDeploymentStore.getState().selectedClusterIds).toEqual([]);
    });
  });

  describe("batch deployment", () => {
    it("creates one independent record per cluster with shared batchId", () => {
      useDeploymentStore.getState().showConfirmation({
        agentRole: "cleaner",
        clusterId: "batch",
        threadIds: ["t1", "t2", "t3", "t4"],
        description: "Clean across 2 clusters",
        batchTargets: [
          { clusterId: "c1", threadIds: ["t1", "t2"], label: "Cluster A" },
          { clusterId: "c2", threadIds: ["t3", "t4"], label: "Cluster B" },
        ],
      });

      const records = useDeploymentStore.getState().confirmBatchDeployment();
      expect(records.length).toBe(2);

      // Each record has independent identity and cluster
      expect(records[0].clusterId).toBe("c1");
      expect(records[0].threadIds).toEqual(["t1", "t2"]);
      expect(records[1].clusterId).toBe("c2");
      expect(records[1].threadIds).toEqual(["t3", "t4"]);

      // Both share the same batchId
      expect(records[0].batchId).not.toBeNull();
      expect(records[0].batchId).toBe(records[1].batchId);

      // Both are in confirming status
      expect(records[0].status).toBe("confirming");
      expect(records[1].status).toBe("confirming");

      // All records added to deployments
      expect(useDeploymentStore.getState().deployments.length).toBe(2);

      // Confirmation cleared
      expect(useDeploymentStore.getState().confirmation).toBeNull();

      // Cluster selection cleared after batch confirm
      expect(useDeploymentStore.getState().selectedClusterIds).toEqual([]);
    });

    it("returns empty array when no batch targets", () => {
      useDeploymentStore.getState().showConfirmation({
        agentRole: "closer",
        clusterId: "c1",
        threadIds: ["t1"],
        description: "Test",
      });
      // No batchTargets - confirmBatchDeployment returns empty
      const records = useDeploymentStore.getState().confirmBatchDeployment();
      expect(records).toEqual([]);
    });

    it("returns empty array when no confirmation", () => {
      const records = useDeploymentStore.getState().confirmBatchDeployment();
      expect(records).toEqual([]);
    });

    it("batch records have independent lifecycles", () => {
      useDeploymentStore.getState().showConfirmation({
        agentRole: "researcher",
        clusterId: "batch",
        threadIds: ["t1", "t2", "t3"],
        description: "Research across 3 clusters",
        batchTargets: [
          { clusterId: "c1", threadIds: ["t1"], label: "Cluster 1" },
          { clusterId: "c2", threadIds: ["t2"], label: "Cluster 2" },
          { clusterId: "c3", threadIds: ["t3"], label: "Cluster 3" },
        ],
      });

      const records = useDeploymentStore.getState().confirmBatchDeployment();
      expect(records.length).toBe(3);

      // Start travel for first two, recall the third
      useDeploymentStore.getState().startTravel(records[0].id);
      useDeploymentStore.getState().startTravel(records[1].id);
      useDeploymentStore.getState().recallDeployment(records[2].id);

      const deployments = useDeploymentStore.getState().deployments;
      const d0 = deployments.find((d) => d.id === records[0].id)!;
      const d1 = deployments.find((d) => d.id === records[1].id)!;
      const d2 = deployments.find((d) => d.id === records[2].id)!;

      expect(d0.status).toBe("traveling");
      expect(d1.status).toBe("traveling");
      expect(d2.status).toBe("recalled");

      // Complete first, fail second
      useDeploymentStore.getState().startWork(records[0].id);
      useDeploymentStore.getState().completeDeployment(records[0].id);
      useDeploymentStore.getState().startWork(records[1].id);
      useDeploymentStore.getState().failDeployment(records[1].id);

      const final = useDeploymentStore.getState().deployments;
      expect(final.find((d) => d.id === records[0].id)!.status).toBe("completed");
      expect(final.find((d) => d.id === records[1].id)!.status).toBe("failed");
      expect(final.find((d) => d.id === records[2].id)!.status).toBe("recalled");
    });

    it("getBatchDeployments returns all records for a batch", () => {
      useDeploymentStore.getState().showConfirmation({
        agentRole: "drafter",
        clusterId: "batch",
        threadIds: ["t1", "t2"],
        description: "Draft across clusters",
        batchTargets: [
          { clusterId: "c1", threadIds: ["t1"], label: "A" },
          { clusterId: "c2", threadIds: ["t2"], label: "B" },
        ],
      });

      const records = useDeploymentStore.getState().confirmBatchDeployment();
      const batchId = records[0].batchId!;

      const batchRecords = useDeploymentStore.getState().getBatchDeployments(batchId);
      expect(batchRecords.length).toBe(2);
      expect(batchRecords.every((r) => r.batchId === batchId)).toBe(true);
    });

    it("getActiveDeploymentsForRole returns all active batch records", () => {
      useDeploymentStore.getState().showConfirmation({
        agentRole: "closer",
        clusterId: "batch",
        threadIds: ["t1", "t2", "t3"],
        description: "Close across clusters",
        batchTargets: [
          { clusterId: "c1", threadIds: ["t1"], label: "A" },
          { clusterId: "c2", threadIds: ["t2"], label: "B" },
          { clusterId: "c3", threadIds: ["t3"], label: "C" },
        ],
      });

      const records = useDeploymentStore.getState().confirmBatchDeployment();

      // All 3 are active (confirming)
      let active = useDeploymentStore.getState().getActiveDeploymentsForRole("closer");
      expect(active.length).toBe(3);

      // Recall one - only 2 remain active
      useDeploymentStore.getState().recallDeployment(records[0].id);
      active = useDeploymentStore.getState().getActiveDeploymentsForRole("closer");
      expect(active.length).toBe(2);
    });

    it("getCompletedDeploymentsForRole returns all completed batch records", () => {
      useDeploymentStore.getState().showConfirmation({
        agentRole: "scheduler",
        clusterId: "batch",
        threadIds: ["t1", "t2"],
        description: "Schedule",
        batchTargets: [
          { clusterId: "c1", threadIds: ["t1"], label: "A" },
          { clusterId: "c2", threadIds: ["t2"], label: "B" },
        ],
      });

      const records = useDeploymentStore.getState().confirmBatchDeployment();

      // Complete both
      for (const r of records) {
        useDeploymentStore.getState().startTravel(r.id);
        useDeploymentStore.getState().startWork(r.id);
        useDeploymentStore.getState().completeDeployment(r.id);
      }

      const completed = useDeploymentStore.getState().getCompletedDeploymentsForRole("scheduler");
      expect(completed.length).toBe(2);
    });

    it("shows correct total thread count in batch confirmation", () => {
      // This verifies the confirmation state carries the right data for the dialog
      useDeploymentStore.getState().showConfirmation({
        agentRole: "cleaner",
        clusterId: "batch",
        threadIds: ["t1", "t2", "t3", "t4", "t5"],
        description: "Clean 5 threads across 3 clusters",
        batchTargets: [
          { clusterId: "c1", threadIds: ["t1", "t2"], label: "Cluster A" },
          { clusterId: "c2", threadIds: ["t3"], label: "Cluster B" },
          { clusterId: "c3", threadIds: ["t4", "t5"], label: "Cluster C" },
        ],
      });

      const conf = useDeploymentStore.getState().confirmation!;
      expect(conf.threadIds.length).toBe(5); // total thread count
      expect(conf.batchTargets!.length).toBe(3); // cluster count
      expect(conf.batchTargets![0].threadIds.length).toBe(2);
      expect(conf.batchTargets![1].threadIds.length).toBe(1);
      expect(conf.batchTargets![2].threadIds.length).toBe(2);
    });
  });

  describe("Progress and outcome per Spec 06", () => {
    it("initializes progress to 0 and outcomeSummary to null on confirm", () => {
      const store = useDeploymentStore.getState();
      store.showConfirmation({
        agentRole: "closer",
        clusterId: "c1",
        threadIds: ["t1"],
        description: "Test",
      });
      const record = store.confirmDeployment()!;
      expect(record.progress).toBe(0);
      expect(record.outcomeSummary).toBeNull();
    });

    it("updateProgress clamps between 0 and 1", () => {
      useDeploymentStore.getState().showConfirmation({
        agentRole: "closer",
        clusterId: "c1",
        threadIds: ["t1"],
        description: "Test",
      });
      const record = useDeploymentStore.getState().confirmDeployment()!;

      useDeploymentStore.getState().updateProgress(record.id, 0.5);
      expect(useDeploymentStore.getState().deployments[0].progress).toBe(0.5);

      useDeploymentStore.getState().updateProgress(record.id, 1.5);
      expect(useDeploymentStore.getState().deployments[0].progress).toBe(1);

      useDeploymentStore.getState().updateProgress(record.id, -0.1);
      expect(useDeploymentStore.getState().deployments[0].progress).toBe(0);
    });

    it("completeDeployment sets progress to 1 and stores outcome summary", () => {
      useDeploymentStore.getState().showConfirmation({
        agentRole: "closer",
        clusterId: "c1",
        threadIds: ["t1"],
        description: "Test",
      });
      const record = useDeploymentStore.getState().confirmDeployment()!;
      useDeploymentStore.getState().startTravel(record.id);
      useDeploymentStore.getState().startWork(record.id);
      useDeploymentStore.getState().completeDeployment(record.id, "Drafted 3 replies, 1 follow-up");

      const updated = useDeploymentStore.getState().deployments[0];
      expect(updated.progress).toBe(1);
      expect(updated.outcomeSummary).toBe("Drafted 3 replies, 1 follow-up");
    });

    it("failDeployment stores outcome summary", () => {
      useDeploymentStore.getState().showConfirmation({
        agentRole: "closer",
        clusterId: "c1",
        threadIds: ["t1"],
        description: "Test",
      });
      const record = useDeploymentStore.getState().confirmDeployment()!;
      useDeploymentStore.getState().startTravel(record.id);
      useDeploymentStore.getState().startWork(record.id);
      useDeploymentStore.getState().failDeployment(record.id, "API rate limit exceeded");

      const updated = useDeploymentStore.getState().deployments[0];
      expect(updated.outcomeSummary).toBe("API rate limit exceeded");
    });
  });

  describe("escalated cluster tracking per Spec 05", () => {
    it("addEscalatedCluster tracks escalated cluster IDs", () => {
      useDeploymentStore.getState().addEscalatedCluster("cluster-escalated-1");
      expect(useDeploymentStore.getState().escalatedClusterIds.has("cluster-escalated-1")).toBe(
        true,
      );
    });

    it("clearEscalatedCluster removes the cluster ID", () => {
      useDeploymentStore.getState().addEscalatedCluster("cluster-escalated-2");
      expect(useDeploymentStore.getState().escalatedClusterIds.has("cluster-escalated-2")).toBe(
        true,
      );

      useDeploymentStore.getState().clearEscalatedCluster("cluster-escalated-2");
      expect(useDeploymentStore.getState().escalatedClusterIds.has("cluster-escalated-2")).toBe(
        false,
      );
    });
  });

  describe("Snap-back animation per Spec 06", () => {
    it("cancelDrag creates snap-back animation from current drag position", () => {
      useDeploymentStore.getState().startDrag("closer", 300, 200);
      useDeploymentStore.getState().cancelDrag();

      const snap = useDeploymentStore.getState().snapBackAnimation;
      expect(snap).not.toBeNull();
      expect(snap!.agentRole).toBe("closer");
      expect(snap!.fromX).toBe(300);
      expect(snap!.fromY).toBe(200);
      expect(snap!.duration).toBe(400);
    });

    it("clearSnapBack removes snap-back animation", () => {
      useDeploymentStore.getState().startDrag("closer", 100, 100);
      useDeploymentStore.getState().cancelDrag();
      expect(useDeploymentStore.getState().snapBackAnimation).not.toBeNull();

      useDeploymentStore.getState().clearSnapBack();
      expect(useDeploymentStore.getState().snapBackAnimation).toBeNull();
    });

    it("cancelDrag without active drag produces null snap-back", () => {
      useDeploymentStore.getState().cancelDrag();
      expect(useDeploymentStore.getState().snapBackAnimation).toBeNull();
    });
  });
});
