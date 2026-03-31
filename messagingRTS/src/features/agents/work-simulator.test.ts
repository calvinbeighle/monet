import { describe, it, expect } from "vitest";
import { generateSimulatedProposals, SIMULATED_WORK_DURATION_MS } from "./work-simulator";
import { AGENT_DEFINITIONS } from "../../lib/types";
import type { AgentRole } from "../../lib/types";

describe("work-simulator", () => {
  it("generates proposals for each assigned thread", () => {
    const proposals = generateSimulatedProposals("closer", ["t1", "t2", "t3"]);
    // Closer generates 1 proposal per thread
    expect(proposals.length).toBe(3);
    expect(proposals[0].threadId).toBe("t1");
    expect(proposals[1].threadId).toBe("t2");
    expect(proposals[2].threadId).toBe("t3");
  });

  it("respects agent capacity", () => {
    // Scheduler has capacity 4
    const threadIds = ["t1", "t2", "t3", "t4", "t5", "t6"];
    const proposals = generateSimulatedProposals("scheduler", threadIds);
    const uniqueThreads = new Set(proposals.map((p) => p.threadId));
    expect(uniqueThreads.size).toBeLessThanOrEqual(AGENT_DEFINITIONS.scheduler.capacity);
  });

  it("closer produces reply-draft output type", () => {
    const proposals = generateSimulatedProposals("closer", ["t1"]);
    expect(proposals[0].outputType).toBe("reply-draft");
  });

  it("researcher produces thread-summary output type", () => {
    const proposals = generateSimulatedProposals("researcher", ["t1"]);
    expect(proposals[0].outputType).toBe("thread-summary");
  });

  it("scheduler produces meeting-time-proposal output type", () => {
    const proposals = generateSimulatedProposals("scheduler", ["t1"]);
    expect(proposals[0].outputType).toBe("meeting-time-proposal");
  });

  it("cleaner produces archive-proposal output type", () => {
    const proposals = generateSimulatedProposals("cleaner", ["t1"]);
    expect(proposals[0].outputType).toBe("archive-proposal");
  });

  it("drafter produces reply-draft plus tone variants for first threads", () => {
    const proposals = generateSimulatedProposals("drafter", ["t1", "t2", "t3"]);
    // First 2 threads get primary + tone variant, 3rd gets only primary
    const t1Proposals = proposals.filter((p) => p.threadId === "t1");
    expect(t1Proposals.length).toBe(2);
    expect(t1Proposals[0].outputType).toBe("reply-draft");
    expect(t1Proposals[1].outputType).toBe("tone-variant");

    const t3Proposals = proposals.filter((p) => p.threadId === "t3");
    expect(t3Proposals.length).toBe(1);
    expect(t3Proposals[0].outputType).toBe("reply-draft");
  });

  it("escalation-bot produces escalation-flag output type", () => {
    const proposals = generateSimulatedProposals("escalation-bot", ["t1"]);
    expect(proposals[0].outputType).toBe("escalation-flag");
  });

  it("all proposals have non-empty content", () => {
    const allRoles: AgentRole[] = [
      "closer",
      "researcher",
      "scheduler",
      "cleaner",
      "drafter",
      "escalation-bot",
    ];
    for (const role of allRoles) {
      const proposals = generateSimulatedProposals(role, ["t1"]);
      for (const p of proposals) {
        expect(p.content.length).toBeGreaterThan(0);
      }
    }
  });

  it("returns empty array for empty thread list", () => {
    const proposals = generateSimulatedProposals("closer", []);
    expect(proposals).toEqual([]);
  });

  it("SIMULATED_WORK_DURATION_MS is a positive number", () => {
    expect(SIMULATED_WORK_DURATION_MS).toBeGreaterThan(0);
  });
});
