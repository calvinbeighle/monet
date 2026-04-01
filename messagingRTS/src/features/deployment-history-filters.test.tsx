// Tests for Feature 3: Deployment history filtering and outcome summaries (Spec 06)

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeploymentHistoryPanel } from "../components/deployment-history-panel";
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

function seedMultipleDeployments() {
  const agentStore = useAgentStore.getState();
  agentStore.deploy("closer", "c1", ["t1", "t2"]);
  agentStore.startWork("closer");
  agentStore.complete("closer", [{ threadId: "t1", outputType: "reply-draft", content: "Draft" }]);
  const closerAgent = agentStore.getAgent("closer");
  agentStore.resolve("closer", closerAgent.proposals[0].id, "approved");

  useDeploymentStore.setState({
    deployments: [
      {
        id: "d1",
        agentRole: "closer",
        clusterId: "c1",
        threadIds: ["t1", "t2"],
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
        threadIds: ["t3", "t4", "t5"],
        status: "in-progress",
        startedAt: Date.now(),
        completedAt: null,
        recalledAt: null,
        batchId: null,
        progress: 0,
        outcomeSummary: null,
      },
      {
        id: "d3",
        agentRole: "closer",
        clusterId: "c3",
        threadIds: ["t6"],
        status: "failed",
        startedAt: Date.now() - 30000,
        completedAt: Date.now() - 10000,
        recalledAt: null,
        batchId: null,
        progress: 0,
        outcomeSummary: null,
      },
    ],
  });
}

describe("Deployment history filters", () => {
  beforeEach(resetStores);

  it("renders filter controls", () => {
    seedMultipleDeployments();
    render(<DeploymentHistoryPanel />);
    expect(screen.getByTestId("deployment-filters")).toBeInTheDocument();
    expect(screen.getByTestId("filter-role")).toBeInTheDocument();
    expect(screen.getByTestId("filter-status")).toBeInTheDocument();
  });

  it("shows all deployments by default", () => {
    seedMultipleDeployments();
    render(<DeploymentHistoryPanel />);
    expect(screen.getByTestId("deployment-d1")).toBeInTheDocument();
    expect(screen.getByTestId("deployment-d2")).toBeInTheDocument();
    expect(screen.getByTestId("deployment-d3")).toBeInTheDocument();
  });

  it("filters by agent role", () => {
    seedMultipleDeployments();
    render(<DeploymentHistoryPanel />);
    fireEvent.change(screen.getByTestId("filter-role"), { target: { value: "researcher" } });
    expect(screen.getByTestId("deployment-d2")).toBeInTheDocument();
    expect(screen.queryByTestId("deployment-d1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("deployment-d3")).not.toBeInTheDocument();
  });

  it("filters by status", () => {
    seedMultipleDeployments();
    render(<DeploymentHistoryPanel />);
    fireEvent.change(screen.getByTestId("filter-status"), { target: { value: "failed" } });
    expect(screen.getByTestId("deployment-d3")).toBeInTheDocument();
    expect(screen.queryByTestId("deployment-d1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("deployment-d2")).not.toBeInTheDocument();
  });

  it("filters by both role and status", () => {
    seedMultipleDeployments();
    render(<DeploymentHistoryPanel />);
    fireEvent.change(screen.getByTestId("filter-role"), { target: { value: "closer" } });
    fireEvent.change(screen.getByTestId("filter-status"), { target: { value: "completed" } });
    expect(screen.getByTestId("deployment-d1")).toBeInTheDocument();
    expect(screen.queryByTestId("deployment-d2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("deployment-d3")).not.toBeInTheDocument();
  });

  it("shows no-match message when filters exclude all", () => {
    seedMultipleDeployments();
    render(<DeploymentHistoryPanel />);
    fireEvent.change(screen.getByTestId("filter-role"), { target: { value: "scheduler" } });
    expect(screen.getByText("No deployments match filters")).toBeInTheDocument();
  });

  it("resetting filter to all shows everything again", () => {
    seedMultipleDeployments();
    render(<DeploymentHistoryPanel />);
    fireEvent.change(screen.getByTestId("filter-role"), { target: { value: "researcher" } });
    expect(screen.queryByTestId("deployment-d1")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("filter-role"), { target: { value: "all" } });
    expect(screen.getByTestId("deployment-d1")).toBeInTheDocument();
    expect(screen.getByTestId("deployment-d2")).toBeInTheDocument();
    expect(screen.getByTestId("deployment-d3")).toBeInTheDocument();
  });
});

describe("Deployment history outcome summaries", () => {
  beforeEach(resetStores);

  it("shows deployment summary when deployments exist", () => {
    seedMultipleDeployments();
    render(<DeploymentHistoryPanel />);
    expect(screen.getByTestId("deployment-summary")).toBeInTheDocument();
    expect(screen.getByText(/3 deployments/)).toBeInTheDocument();
  });

  it("shows approved count in summary", () => {
    seedMultipleDeployments();
    render(<DeploymentHistoryPanel />);
    expect(screen.getByTestId("summary-approved")).toBeInTheDocument();
  });

  it("does not show summary when no deployments", () => {
    render(<DeploymentHistoryPanel />);
    expect(screen.queryByTestId("deployment-summary")).not.toBeInTheDocument();
  });

  it("summary updates when filter changes", () => {
    seedMultipleDeployments();
    render(<DeploymentHistoryPanel />);
    fireEvent.change(screen.getByTestId("filter-role"), { target: { value: "researcher" } });
    expect(screen.getByText(/1 deployment(?!s)/)).toBeInTheDocument();
  });
});
