// Context menu agent deployment tests per Spec 06
// Tests the logic used by MapViewport's right-click context menu handler.

import { describe, it, expect, beforeEach } from "vitest";
import { hitTestThread } from "../navigation/navigation-system";
import { createThread, AGENT_DEFINITIONS } from "../../lib/types";
import type { AgentRole } from "../../lib/types";
import { useAgentStore } from "../../lib/stores/agent-store";
import { useDeploymentStore } from "../../lib/stores/deployment-store";
import { createAgentInstance, resetCounters } from "../agents/agent-manager";

const ALL_ROLES: AgentRole[] = [
  "closer",
  "researcher",
  "scheduler",
  "cleaner",
  "drafter",
  "escalation-bot",
];

function resetStores() {
  resetCounters();
  const freshAgents = new Map<AgentRole, ReturnType<typeof createAgentInstance>>();
  for (const role of ALL_ROLES) {
    freshAgents.set(role, createAgentInstance(role));
  }
  useAgentStore.setState({ agents: freshAgents });
  useDeploymentStore.setState({
    deployments: [],
    activeDeploymentId: null,
    dragState: null,
    confirmation: null,
  });
}

describe("Right-click context menu for Deploy Agent (Spec 06)", () => {
  beforeEach(resetStores);

  it("hit-tests a thread to determine context menu target", () => {
    const thread = createThread("t1", "Subject", "snippet");
    thread.position = { x: 100, y: 200 };

    const hitId = hitTestThread([thread], 105, 205);
    expect(hitId).toBe("t1");
  });

  it("returns null when right-clicking empty space", () => {
    const thread = createThread("t1", "Subject", "snippet");
    thread.position = { x: 100, y: 200 };

    const hitId = hitTestThread([thread], 500, 500);
    expect(hitId).toBeNull();
  });

  it("all 6 agent types are defined with correct properties for context menu", () => {
    const roles: AgentRole[] = [
      "closer",
      "researcher",
      "scheduler",
      "cleaner",
      "drafter",
      "escalation-bot",
    ];

    for (const role of roles) {
      const def = AGENT_DEFINITIONS[role];
      expect(def).toBeDefined();
      expect(def.name).toBeTruthy();
      expect(def.color).toBeGreaterThan(0);
      expect(def.capacity).toBeGreaterThan(0);
      expect(def.description).toBeTruthy();
    }
  });

  it("canDeployRole returns true for idle agents", () => {
    const agentStore = useAgentStore.getState();
    expect(agentStore.canDeployRole("closer")).toBe(true);
    expect(agentStore.canDeployRole("drafter")).toBe(true);
  });

  it("canDeployRole returns false for deployed/working agents", () => {
    const agentStore = useAgentStore.getState();
    agentStore.deploy("closer", "c1", ["t1"]);
    expect(agentStore.canDeployRole("closer")).toBe(false);
  });

  it("canDeployRole returns false for agents in cooldown", () => {
    const agentStore = useAgentStore.getState();
    agentStore.deploy("closer", "c1", ["t1"]);
    agentStore.startWork("closer");
    agentStore.complete("closer", [{ threadId: "t1", outputType: "reply-draft", content: "test" }]);
    agentStore.beginCooldown("closer");
    expect(agentStore.canDeployRole("closer")).toBe(false);
  });

  it("showConfirmation triggers the deployment confirmation flow", () => {
    const def = AGENT_DEFINITIONS["closer"];
    useDeploymentStore.getState().showConfirmation({
      agentRole: "closer",
      clusterId: "zone-active-front",
      threadIds: ["t1", "t2"],
      description: `${def.name}: deploy to 2 threads`,
    });

    const confirmation = useDeploymentStore.getState().confirmation;
    expect(confirmation).not.toBeNull();
    expect(confirmation!.agentRole).toBe("closer");
    expect(confirmation!.threadIds).toEqual(["t1", "t2"]);
  });

  it("respects agent capacity limit when selecting threads", () => {
    const def = AGENT_DEFINITIONS["scheduler"]; // capacity: 4
    const threadIds = ["t1", "t2", "t3", "t4", "t5", "t6"];
    const limited = threadIds.slice(0, def.capacity);
    expect(limited).toHaveLength(4);
  });

  it("context menu lists only valid agent types per Spec 06 Section 13", () => {
    // Deploy closer so it becomes unavailable
    const agentStore = useAgentStore.getState();
    agentStore.deploy("closer", "c1", ["t1"]);

    // Check which roles pass the validity filter
    const validRoles = ALL_ROLES.filter((role) => {
      const canDeploy = useAgentStore.getState().canDeployRole(role);
      const clusterAlreadyDeployed = useDeploymentStore
        .getState()
        .deployments.some(
          (d) =>
            d.agentRole === role &&
            d.clusterId === "c1" &&
            (d.status === "confirming" || d.status === "traveling" || d.status === "in-progress"),
        );
      return canDeploy && !clusterAlreadyDeployed;
    });

    // closer is deployed (not idle), so should not appear
    expect(validRoles).not.toContain("closer");
    // Other 5 roles should still be valid
    expect(validRoles).toHaveLength(5);
    expect(validRoles).toContain("researcher");
    expect(validRoles).toContain("scheduler");
    expect(validRoles).toContain("cleaner");
    expect(validRoles).toContain("drafter");
    expect(validRoles).toContain("escalation-bot");
  });

  it("no valid agents when all are deployed shows empty state", () => {
    // Deploy all agents
    const agentStore = useAgentStore.getState();
    for (const role of ALL_ROLES) {
      agentStore.deploy(role, "c1", ["t1"]);
    }

    const validRoles = ALL_ROLES.filter((role) => {
      return useAgentStore.getState().canDeployRole(role);
    });

    expect(validRoles).toHaveLength(0);
  });

  it("cluster filter blocks agents already deployed to same cluster", () => {
    // Deploy closer to cluster-1
    const deployStore = useDeploymentStore.getState();
    deployStore.showConfirmation({
      agentRole: "closer",
      clusterId: "cluster-1",
      threadIds: ["t1"],
      description: "test",
    });
    deployStore.confirmDeployment();

    // Check: closer should have active deployment on cluster-1
    const deployments = useDeploymentStore.getState().deployments;
    const clusterAlreadyDeployed = deployments.some(
      (d) =>
        d.agentRole === "closer" &&
        d.clusterId === "cluster-1" &&
        (d.status === "confirming" || d.status === "traveling" || d.status === "in-progress"),
    );
    expect(clusterAlreadyDeployed).toBe(true);

    // Researcher is not deployed to cluster-1
    const researcherDeployed = deployments.some(
      (d) =>
        d.agentRole === "researcher" &&
        d.clusterId === "cluster-1" &&
        (d.status === "confirming" || d.status === "traveling" || d.status === "in-progress"),
    );
    expect(researcherDeployed).toBe(false);
  });
});
