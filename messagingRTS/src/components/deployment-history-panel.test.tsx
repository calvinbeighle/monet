import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeploymentHistoryPanel } from "./deployment-history-panel";
import { useAppStore } from "../lib/stores/app-store";
import { useDeploymentStore } from "../lib/stores/deployment-store";
import { useAgentStore } from "../lib/stores/agent-store";
import { createAgentInstance, resetCounters } from "../features/agents/agent-manager";
import type { AgentRole } from "../lib/types";

const ALL_ROLES: AgentRole[] = [
  "closer",
  "researcher",
  "scheduler",
  "cleaner",
  "drafter",
  "escalation-bot",
];

function resetStores() {
  useAppStore.setState({ activePanel: "deployment-history" });
  useDeploymentStore.setState({ deployments: [], activeDeploymentId: null });
  resetCounters();
  const freshAgents = new Map<AgentRole, ReturnType<typeof createAgentInstance>>();
  for (const role of ALL_ROLES) {
    freshAgents.set(role, createAgentInstance(role));
  }
  useAgentStore.setState({ agents: freshAgents });
}

function seedDeployments() {
  // Deploy and complete the closer agent to get approve/reject counts
  const agentStore = useAgentStore.getState();
  agentStore.deploy("closer", "c1", ["t1", "t2", "t3"]);
  agentStore.startWork("closer");
  agentStore.complete("closer", [
    { threadId: "t1", outputType: "reply-draft", content: "Draft 1" },
    { threadId: "t2", outputType: "reply-draft", content: "Draft 2" },
    { threadId: "t3", outputType: "close-action-proposal", content: "Close" },
  ]);
  // Resolve some proposals
  const agent = agentStore.getAgent("closer");
  agentStore.resolve("closer", agent.proposals[0].id, "approved");
  agentStore.resolve("closer", agent.proposals[1].id, "approved");
  agentStore.resolve("closer", agent.proposals[2].id, "rejected");

  // Deploy researcher (in-progress)
  agentStore.deploy("researcher", "c2", ["t4", "t5", "t6", "t7", "t8"]);
  agentStore.startWork("researcher");

  useDeploymentStore.setState({
    deployments: [
      {
        id: "d1",
        agentRole: "closer",
        clusterId: "c1",
        threadIds: ["t1", "t2", "t3"],
        status: "completed",
        startedAt: Date.now() - 60000,
        completedAt: Date.now(),
        recalledAt: null,
        batchId: null,
        progress: 0,
        outcomeSummary: null,
      },
      {
        id: "d2",
        agentRole: "researcher",
        clusterId: "c2",
        threadIds: ["t4", "t5", "t6", "t7", "t8"],
        status: "in-progress",
        startedAt: Date.now(),
        completedAt: null,
        recalledAt: null,
        batchId: null,
        progress: 0,
        outcomeSummary: null,
      },
    ],
  });
}

describe("DeploymentHistoryPanel", () => {
  beforeEach(resetStores);

  it("renders the panel", () => {
    render(<DeploymentHistoryPanel />);
    expect(screen.getByTestId("deployment-history-panel")).toBeInTheDocument();
  });

  it("shows empty state when no deployments", () => {
    render(<DeploymentHistoryPanel />);
    expect(screen.getByTestId("deployment-history-empty")).toBeInTheDocument();
    expect(screen.getByText("No deployments yet")).toBeInTheDocument();
  });

  it("renders deployment records", () => {
    seedDeployments();
    render(<DeploymentHistoryPanel />);
    expect(screen.getByTestId("deployment-history-list")).toBeInTheDocument();
    expect(screen.getByTestId("deployment-d1")).toBeInTheDocument();
    expect(screen.getByTestId("deployment-d2")).toBeInTheDocument();
  });

  it("shows agent name and status", () => {
    seedDeployments();
    render(<DeploymentHistoryPanel />);
    // Agent names appear in both filter dropdown and deployment cards
    expect(screen.getAllByText("Closer").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("completed").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Researcher").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("in-progress").length).toBeGreaterThanOrEqual(1);
  });

  it("shows thread count and approval stats", () => {
    seedDeployments();
    render(<DeploymentHistoryPanel />);
    expect(screen.getByText(/3 threads/)).toBeInTheDocument();
    // Approved/rejected appear in both summary and per-deployment cards
    expect(screen.getAllByText(/2 approved/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/1 rejected/).length).toBeGreaterThanOrEqual(1);
  });

  it("close button sets activePanel to none", () => {
    render(<DeploymentHistoryPanel />);
    fireEvent.click(screen.getByTestId("deployment-history-close"));
    expect(useAppStore.getState().activePanel).toBe("none");
  });
});

describe("Deployment history recall button per Spec 06", () => {
  beforeEach(resetStores);

  it("shows recall button for in-progress deployments", () => {
    seedDeployments();
    render(<DeploymentHistoryPanel />);
    // d2 is in-progress, should have recall button
    expect(screen.getByTestId("recall-d2")).toBeTruthy();
  });

  it("does not show recall button for completed deployments", () => {
    seedDeployments();
    render(<DeploymentHistoryPanel />);
    // d1 is completed, should NOT have recall button
    expect(screen.queryByTestId("recall-d1")).toBeNull();
  });

  it("recall button calls recallDeployment and recall agent", () => {
    seedDeployments();
    render(<DeploymentHistoryPanel />);
    const recallBtn = screen.getByTestId("recall-d2");
    fireEvent.click(recallBtn);
    // After recall, deployment status should be "recalled"
    const deployment = useDeploymentStore.getState().deployments.find((d) => d.id === "d2");
    expect(deployment?.status).toBe("recalled");
  });
});
