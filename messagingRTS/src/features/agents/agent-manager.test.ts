import { describe, it, expect, beforeEach } from "vitest";
import {
  createAgentInstance,
  deployAgent,
  startWorking,
  completeAgent,
  failAgent,
  startCooldown,
  checkCooldown,
  recallAgent,
  resolveProposal,
  getCooldownRemaining,
  canDeploy,
  isValidAgentTransition,
  resetCounters,
} from "./agent-manager";
import { AGENT_DEFINITIONS } from "../../lib/types";

beforeEach(() => {
  resetCounters();
});

describe("Agent manager", () => {
  describe("createAgentInstance", () => {
    it("creates idle agent with correct defaults", () => {
      const agent = createAgentInstance("closer");
      expect(agent.role).toBe("closer");
      expect(agent.status).toBe("idle");
      expect(agent.clusterId).toBeNull();
      expect(agent.threadIds).toEqual([]);
      expect(agent.proposals).toEqual([]);
      expect(agent.approvedCount).toBe(0);
      expect(agent.rejectedCount).toBe(0);
    });
  });

  describe("state machine transitions", () => {
    it("follows valid path: idle -> deployed -> working -> completed -> cooldown -> idle", () => {
      expect(isValidAgentTransition("idle", "deployed")).toBe(true);
      expect(isValidAgentTransition("deployed", "working")).toBe(true);
      expect(isValidAgentTransition("working", "completed")).toBe(true);
      expect(isValidAgentTransition("completed", "cooldown")).toBe(true);
      expect(isValidAgentTransition("cooldown", "idle")).toBe(true);
    });

    it("follows valid failure path: working -> failed -> cooldown -> idle", () => {
      expect(isValidAgentTransition("working", "failed")).toBe(true);
      expect(isValidAgentTransition("failed", "cooldown")).toBe(true);
    });

    it("rejects invalid transitions", () => {
      expect(isValidAgentTransition("idle", "working")).toBe(false);
      expect(isValidAgentTransition("idle", "completed")).toBe(false);
      expect(isValidAgentTransition("deployed", "idle")).toBe(false);
      expect(isValidAgentTransition("cooldown", "deployed")).toBe(false);
    });
  });

  describe("deployment", () => {
    it("deploys idle agent to cluster", () => {
      const agent = createAgentInstance("closer");
      const deployed = deployAgent(agent, "cluster-1", ["t1", "t2", "t3"]);

      expect(deployed.status).toBe("deployed");
      expect(deployed.clusterId).toBe("cluster-1");
      expect(deployed.threadIds).toEqual(["t1", "t2", "t3"]);
      expect(deployed.deployedAt).toBeDefined();
    });

    it("enforces capacity limit", () => {
      const agent = createAgentInstance("closer"); // capacity 5
      const threads = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"];
      const deployed = deployAgent(agent, "cluster-1", threads);

      expect(deployed.threadIds.length).toBe(5); // capped at capacity
    });

    it("throws when deploying non-idle agent", () => {
      const agent = createAgentInstance("closer");
      const deployed = deployAgent(agent, "c1", ["t1"]);

      expect(() => deployAgent(deployed, "c2", ["t2"])).toThrow();
    });
  });

  describe("working", () => {
    it("transitions deployed to working", () => {
      let agent = createAgentInstance("closer");
      agent = deployAgent(agent, "c1", ["t1"]);
      agent = startWorking(agent);

      expect(agent.status).toBe("working");
      expect(agent.startedAt).toBeDefined();
    });

    it("throws when starting work from wrong status", () => {
      const agent = createAgentInstance("closer");
      expect(() => startWorking(agent)).toThrow();
    });
  });

  describe("completion", () => {
    it("creates proposals on completion", () => {
      let agent = createAgentInstance("drafter");
      agent = deployAgent(agent, "c1", ["t1"]);
      agent = startWorking(agent);
      agent = completeAgent(agent, [
        { threadId: "t1", outputType: "reply-draft", content: "Draft reply text" },
        { threadId: "t1", outputType: "tone-variant", content: "Casual version" },
      ]);

      expect(agent.status).toBe("completed");
      expect(agent.proposals.length).toBe(2);
      expect(agent.proposals[0].status).toBe("pending");
      expect(agent.proposals[0].content).toBe("Draft reply text");
      expect(agent.proposals[1].outputType).toBe("tone-variant");
    });
  });

  describe("failure", () => {
    it("marks agent as failed", () => {
      let agent = createAgentInstance("researcher");
      agent = deployAgent(agent, "c1", ["t1"]);
      agent = startWorking(agent);
      agent = failAgent(agent);

      expect(agent.status).toBe("failed");
      expect(agent.completedAt).toBeDefined();
    });
  });

  describe("cooldown", () => {
    it("starts cooldown with correct expiry", () => {
      const now = Date.now();
      let agent = createAgentInstance("closer"); // 10 min cooldown
      agent = deployAgent(agent, "c1", ["t1"], now);
      agent = startWorking(agent, now);
      agent = completeAgent(agent, [], [], now);
      agent = startCooldown(agent, now);

      expect(agent.status).toBe("cooldown");
      expect(agent.cooldownExpiry).toBe(now + AGENT_DEFINITIONS.closer.cooldownMs);
    });

    it("transitions to idle after cooldown expires", () => {
      const now = Date.now();
      let agent = createAgentInstance("closer");
      agent = deployAgent(agent, "c1", ["t1"], now);
      agent = startWorking(agent, now);
      agent = completeAgent(agent, [], [], now);
      agent = startCooldown(agent, now);

      // Still in cooldown
      agent = checkCooldown(agent, now + 1000);
      expect(agent.status).toBe("cooldown");

      // After cooldown expires
      agent = checkCooldown(agent, now + AGENT_DEFINITIONS.closer.cooldownMs + 1);
      expect(agent.status).toBe("idle");
      expect(agent.clusterId).toBeNull();
      expect(agent.threadIds).toEqual([]);
    });

    it("getCooldownRemaining returns correct value", () => {
      const now = Date.now();
      let agent = createAgentInstance("closer");
      agent = deployAgent(agent, "c1", ["t1"], now);
      agent = startWorking(agent, now);
      agent = completeAgent(agent, [], [], now);
      agent = startCooldown(agent, now);

      const remaining = getCooldownRemaining(agent, now + 5 * 60 * 1000);
      expect(remaining).toBe(5 * 60 * 1000); // 5 min left of 10 min cooldown
    });

    it("no bypass of cooldown", () => {
      const now = Date.now();
      let agent = createAgentInstance("closer");
      agent = deployAgent(agent, "c1", ["t1"], now);
      agent = startWorking(agent, now);
      agent = completeAgent(agent, [], [], now);
      agent = startCooldown(agent, now);

      // Cannot deploy during cooldown
      expect(canDeploy(agent)).toBe(false);
    });
  });

  describe("recall", () => {
    it("returns deployed agent to idle with no cooldown", () => {
      let agent = createAgentInstance("closer");
      agent = deployAgent(agent, "c1", ["t1"]);
      agent = recallAgent(agent);

      expect(agent.status).toBe("idle");
      expect(agent.cooldownExpiry).toBeNull();
      expect(agent.proposals).toEqual([]);
    });

    it("returns working agent to idle with no cooldown", () => {
      let agent = createAgentInstance("closer");
      agent = deployAgent(agent, "c1", ["t1"]);
      agent = startWorking(agent);
      agent = recallAgent(agent);

      expect(agent.status).toBe("idle");
    });

    it("throws when recalling idle agent", () => {
      const agent = createAgentInstance("closer");
      expect(() => recallAgent(agent)).toThrow();
    });
  });

  describe("proposal resolution", () => {
    it("approves a pending proposal", () => {
      let agent = createAgentInstance("drafter");
      agent = deployAgent(agent, "c1", ["t1"]);
      agent = startWorking(agent);
      agent = completeAgent(agent, [
        { threadId: "t1", outputType: "reply-draft", content: "Draft" },
      ]);

      const proposalId = agent.proposals[0].id;
      agent = resolveProposal(agent, proposalId, "approved");

      expect(agent.proposals[0].status).toBe("approved");
      expect(agent.approvedCount).toBe(1);
      expect(agent.rejectedCount).toBe(0);
    });

    it("rejects a pending proposal", () => {
      let agent = createAgentInstance("drafter");
      agent = deployAgent(agent, "c1", ["t1"]);
      agent = startWorking(agent);
      agent = completeAgent(agent, [
        { threadId: "t1", outputType: "reply-draft", content: "Draft" },
      ]);

      const proposalId = agent.proposals[0].id;
      agent = resolveProposal(agent, proposalId, "rejected");

      expect(agent.proposals[0].status).toBe("rejected");
      expect(agent.rejectedCount).toBe(1);
    });

    it("throws when resolving already resolved proposal", () => {
      let agent = createAgentInstance("drafter");
      agent = deployAgent(agent, "c1", ["t1"]);
      agent = startWorking(agent);
      agent = completeAgent(agent, [
        { threadId: "t1", outputType: "reply-draft", content: "Draft" },
      ]);

      const proposalId = agent.proposals[0].id;
      agent = resolveProposal(agent, proposalId, "approved");
      expect(() => resolveProposal(agent, proposalId, "rejected")).toThrow();
    });

    it("throws for non-existent proposal", () => {
      let agent = createAgentInstance("drafter");
      agent = deployAgent(agent, "c1", ["t1"]);
      agent = startWorking(agent);
      agent = completeAgent(agent, []);

      expect(() => resolveProposal(agent, "nonexistent", "approved")).toThrow();
    });
  });

  describe("canDeploy", () => {
    it("returns true for idle agents", () => {
      expect(canDeploy(createAgentInstance("closer"))).toBe(true);
    });

    it("returns false for deployed agents", () => {
      let agent = createAgentInstance("closer");
      agent = deployAgent(agent, "c1", ["t1"]);
      expect(canDeploy(agent)).toBe(false);
    });
  });
});
