// Agent store tests per Spec 05 and Spec 06
// Verifies: store initialization, deploy/work/complete/fail/cooldown lifecycle,
// recall, proposal resolution, cooldown ticking, and queries

import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "./agent-store";

describe("AgentStore", () => {
  beforeEach(() => {
    // Reset to fresh state with new idle instances
    const agents = new Map();
    const roles = [
      "closer",
      "researcher",
      "scheduler",
      "cleaner",
      "drafter",
      "escalation-bot",
    ] as const;
    for (const role of roles) {
      agents.set(role, {
        id: `agent-${role}`,
        role,
        clusterId: null,
        threadIds: [],
        status: "idle",
        createdAt: Date.now(),
        deployedAt: null,
        startedAt: null,
        completedAt: null,
        cooldownExpiry: null,
        proposals: [],
        approvedCount: 0,
        rejectedCount: 0,
      });
    }
    useAgentStore.setState({ agents });
  });

  it("initializes with 6 idle agents", () => {
    const agents = useAgentStore.getState().agents;
    expect(agents.size).toBe(6);
    for (const [, agent] of agents) {
      expect(agent.status).toBe("idle");
    }
  });

  it("deploys an agent to a cluster", () => {
    useAgentStore.getState().deploy("closer", "cluster-1", ["t1", "t2", "t3"]);
    const agent = useAgentStore.getState().getAgent("closer");
    expect(agent.status).toBe("deployed");
    expect(agent.clusterId).toBe("cluster-1");
    expect(agent.threadIds).toEqual(["t1", "t2", "t3"]);
  });

  it("enforces capacity on deploy", () => {
    // Closer capacity is 5
    const threadIds = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"];
    useAgentStore.getState().deploy("closer", "c1", threadIds);
    const agent = useAgentStore.getState().getAgent("closer");
    expect(agent.threadIds.length).toBe(5);
  });

  it("starts work after deploy", () => {
    useAgentStore.getState().deploy("researcher", "c1", ["t1"]);
    useAgentStore.getState().startWork("researcher");
    expect(useAgentStore.getState().getAgent("researcher").status).toBe("working");
  });

  it("completes with proposals", () => {
    useAgentStore.getState().deploy("drafter", "c1", ["t1"]);
    useAgentStore.getState().startWork("drafter");
    useAgentStore
      .getState()
      .complete("drafter", [{ threadId: "t1", outputType: "reply-draft", content: "Draft reply" }]);
    const agent = useAgentStore.getState().getAgent("drafter");
    expect(agent.status).toBe("completed");
    expect(agent.proposals.length).toBe(1);
    expect(agent.proposals[0].status).toBe("pending");
  });

  it("fails agent", () => {
    useAgentStore.getState().deploy("scheduler", "c1", ["t1"]);
    useAgentStore.getState().startWork("scheduler");
    useAgentStore.getState().fail("scheduler");
    expect(useAgentStore.getState().getAgent("scheduler").status).toBe("failed");
  });

  it("begins cooldown after completion", () => {
    useAgentStore.getState().deploy("cleaner", "c1", ["t1"]);
    useAgentStore.getState().startWork("cleaner");
    useAgentStore.getState().complete("cleaner", []);
    useAgentStore.getState().beginCooldown("cleaner");
    const agent = useAgentStore.getState().getAgent("cleaner");
    expect(agent.status).toBe("cooldown");
    expect(agent.cooldownExpiry).not.toBeNull();
  });

  it("ticks cooldown to idle when expired", () => {
    useAgentStore.getState().deploy("escalation-bot", "c1", ["t1"]);
    useAgentStore.getState().startWork("escalation-bot");
    useAgentStore.getState().complete("escalation-bot", []);
    useAgentStore.getState().beginCooldown("escalation-bot");

    // Cooldown for escalation-bot is 2 min
    const agent = useAgentStore.getState().getAgent("escalation-bot");
    const afterCooldown = agent.cooldownExpiry! + 1;
    useAgentStore.getState().tickCooldowns(afterCooldown);

    expect(useAgentStore.getState().getAgent("escalation-bot").status).toBe("idle");
  });

  it("does not transition cooldown when not yet expired", () => {
    useAgentStore.getState().deploy("closer", "c1", ["t1"]);
    useAgentStore.getState().startWork("closer");
    useAgentStore.getState().complete("closer", []);
    useAgentStore.getState().beginCooldown("closer");

    const agent = useAgentStore.getState().getAgent("closer");
    const beforeExpiry = agent.cooldownExpiry! - 1000;
    useAgentStore.getState().tickCooldowns(beforeExpiry);

    expect(useAgentStore.getState().getAgent("closer").status).toBe("cooldown");
  });

  it("recalls deployed agent to idle without cooldown", () => {
    useAgentStore.getState().deploy("researcher", "c1", ["t1"]);
    useAgentStore.getState().recall("researcher");
    const agent = useAgentStore.getState().getAgent("researcher");
    expect(agent.status).toBe("idle");
    expect(agent.clusterId).toBeNull();
    expect(agent.threadIds).toEqual([]);
  });

  it("resolves proposal", () => {
    useAgentStore.getState().deploy("drafter", "c1", ["t1"]);
    useAgentStore.getState().startWork("drafter");
    useAgentStore
      .getState()
      .complete("drafter", [{ threadId: "t1", outputType: "reply-draft", content: "Hi" }]);

    const proposalId = useAgentStore.getState().getAgent("drafter").proposals[0].id;
    useAgentStore.getState().resolve("drafter", proposalId, "approved");

    const agent = useAgentStore.getState().getAgent("drafter");
    expect(agent.proposals[0].status).toBe("approved");
    expect(agent.approvedCount).toBe(1);
  });

  describe("queries", () => {
    it("canDeployRole returns true for idle agents", () => {
      expect(useAgentStore.getState().canDeployRole("closer")).toBe(true);
    });

    it("canDeployRole returns false for non-idle agents", () => {
      useAgentStore.getState().deploy("closer", "c1", ["t1"]);
      expect(useAgentStore.getState().canDeployRole("closer")).toBe(false);
    });

    it("getDeployedCount counts deployed and working agents", () => {
      useAgentStore.getState().deploy("closer", "c1", ["t1"]);
      useAgentStore.getState().deploy("researcher", "c2", ["t2"]);
      useAgentStore.getState().startWork("researcher");
      expect(useAgentStore.getState().getDeployedCount()).toBe(2);
    });

    it("getCooldownMs returns 0 for non-cooldown agents", () => {
      expect(useAgentStore.getState().getCooldownMs("closer")).toBe(0);
    });
  });
});
