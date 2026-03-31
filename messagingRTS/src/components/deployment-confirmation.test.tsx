// Deployment confirmation dialog tests per Spec 06

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeploymentConfirmation } from "./deployment-confirmation";
import { useDeploymentStore } from "../lib/stores/deployment-store";
import { useAgentStore } from "../lib/stores/agent-store";

function resetStores() {
  useDeploymentStore.setState({
    dragState: null,
    confirmation: null,
    deployments: [],
    activeDeploymentId: null,
  });
  // Reset agent store with idle agents
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
}

describe("DeploymentConfirmation", () => {
  beforeEach(resetStores);

  it("renders nothing when no confirmation is active", () => {
    const { container } = render(<DeploymentConfirmation />);
    expect(container.innerHTML).toBe("");
  });

  it("renders confirmation dialog with agent details", () => {
    useDeploymentStore.getState().showConfirmation({
      agentRole: "closer",
      clusterId: "c1",
      threadIds: ["t1", "t2", "t3"],
      description: "Close 3 conversations",
    });

    render(<DeploymentConfirmation />);
    expect(screen.getByTestId("deployment-confirmation")).toBeInTheDocument();
    expect(screen.getByText("Deploy Closer")).toBeInTheDocument();
    expect(screen.getByText("Close 3 conversations")).toBeInTheDocument();
    expect(screen.getByText("3 threads")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-deploy")).toBeInTheDocument();
    expect(screen.getByTestId("cancel-deploy")).toBeInTheDocument();
  });

  it("cancel clears confirmation", () => {
    useDeploymentStore.getState().showConfirmation({
      agentRole: "drafter",
      clusterId: "c1",
      threadIds: ["t1"],
      description: "Draft reply",
    });

    render(<DeploymentConfirmation />);
    fireEvent.click(screen.getByTestId("cancel-deploy"));
    expect(useDeploymentStore.getState().confirmation).toBeNull();
  });

  it("confirm creates deployment record and deploys agent", () => {
    useDeploymentStore.getState().showConfirmation({
      agentRole: "researcher",
      clusterId: "c1",
      threadIds: ["t1", "t2"],
      description: "Research 2 threads",
    });

    render(<DeploymentConfirmation />);
    fireEvent.click(screen.getByTestId("confirm-deploy"));

    // Confirmation cleared
    expect(useDeploymentStore.getState().confirmation).toBeNull();
    // Deployment record created
    expect(useDeploymentStore.getState().deployments.length).toBe(1);
    // Agent deployed
    const agent = useAgentStore.getState().getAgent("researcher");
    expect(agent.status).toBe("deployed");
    expect(agent.threadIds).toEqual(["t1", "t2"]);
  });

  it("shows singular thread text for 1 thread", () => {
    useDeploymentStore.getState().showConfirmation({
      agentRole: "scheduler",
      clusterId: "c1",
      threadIds: ["t1"],
      description: "Schedule 1 meeting",
    });

    render(<DeploymentConfirmation />);
    expect(screen.getByText("1 thread")).toBeInTheDocument();
  });
});
