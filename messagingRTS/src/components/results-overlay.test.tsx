import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResultsOverlay } from "./results-overlay";
import { useAgentStore } from "../lib/stores/agent-store";
import { useDeploymentStore } from "../lib/stores/deployment-store";
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
  resetCounters();
  // Fully reset agent store with fresh instances
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

function setupCompletedAgent() {
  const store = useAgentStore.getState();
  store.deploy("closer", "c1", ["t1", "t2"]);
  store.startWork("closer");
  store.complete("closer", [
    { threadId: "t1", outputType: "reply-draft", content: "Hi, following up on our conversation." },
    { threadId: "t2", outputType: "close-action-proposal", content: "Mark as resolved." },
  ]);

  // Set up matching deployment record
  useDeploymentStore.setState({
    deployments: [
      {
        id: "deploy-test",
        agentRole: "closer",
        clusterId: "c1",
        threadIds: ["t1", "t2"],
        status: "completed",
        startedAt: Date.now() - 5000,
        completedAt: Date.now(),
        recalledAt: null,
        batchId: null,
      },
    ],
  });
}

describe("ResultsOverlay", () => {
  beforeEach(resetStores);

  it("renders nothing when agent is idle", () => {
    const { container } = render(<ResultsOverlay agentRole="closer" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when agent has no proposals", () => {
    const store = useAgentStore.getState();
    store.deploy("closer", "c1", ["t1"]);
    store.startWork("closer");
    store.complete("closer", []);
    const { container } = render(<ResultsOverlay agentRole="closer" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders overlay with proposals when agent is completed", () => {
    setupCompletedAgent();
    render(<ResultsOverlay agentRole="closer" />);
    expect(screen.getByTestId("results-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("results-overlay-panel")).toBeInTheDocument();
    expect(screen.getByText("Closer Results")).toBeInTheDocument();
  });

  it("shows all proposals with approve/reject buttons", () => {
    setupCompletedAgent();
    render(<ResultsOverlay agentRole="closer" />);
    const proposals = screen.getByTestId("results-proposals-list");
    expect(proposals.children.length).toBe(2);

    // Check content
    expect(screen.getByText("Hi, following up on our conversation.")).toBeInTheDocument();
    expect(screen.getByText("Mark as resolved.")).toBeInTheDocument();

    // Check output type labels
    expect(screen.getByText("reply-draft")).toBeInTheDocument();
    expect(screen.getByText("close-action-proposal")).toBeInTheDocument();
  });

  it("shows pending count", () => {
    setupCompletedAgent();
    render(<ResultsOverlay agentRole="closer" />);
    expect(screen.getByText("2 of 2 pending")).toBeInTheDocument();
  });

  it("done button is disabled when proposals are pending", () => {
    setupCompletedAgent();
    render(<ResultsOverlay agentRole="closer" />);
    const doneButton = screen.getByTestId("results-done-button");
    expect(doneButton).toBeDisabled();
  });

  it("approving a proposal updates its status", () => {
    setupCompletedAgent();
    render(<ResultsOverlay agentRole="closer" />);

    const agent = useAgentStore.getState().getAgent("closer");
    const approveBtn = screen.getByTestId(`approve-${agent.proposals[0].id}`);
    fireEvent.click(approveBtn);

    // After approval, status should show
    expect(screen.getByTestId(`proposal-${agent.proposals[0].id}-status`)).toHaveTextContent(
      "approved",
    );
    expect(screen.getByText("1 of 2 pending")).toBeInTheDocument();
  });

  it("rejecting a proposal updates its status", () => {
    setupCompletedAgent();
    render(<ResultsOverlay agentRole="closer" />);

    const agent = useAgentStore.getState().getAgent("closer");
    const rejectBtn = screen.getByTestId(`reject-${agent.proposals[1].id}`);
    fireEvent.click(rejectBtn);

    expect(screen.getByTestId(`proposal-${agent.proposals[1].id}-status`)).toHaveTextContent(
      "rejected",
    );
  });

  it("done button enables when all proposals resolved", () => {
    setupCompletedAgent();
    render(<ResultsOverlay agentRole="closer" />);

    const agent = useAgentStore.getState().getAgent("closer");
    fireEvent.click(screen.getByTestId(`approve-${agent.proposals[0].id}`));

    // Get updated proposals after first resolve
    const updatedAgent = useAgentStore.getState().getAgent("closer");
    fireEvent.click(screen.getByTestId(`reject-${updatedAgent.proposals[1].id}`));

    const doneButton = screen.getByTestId("results-done-button");
    expect(doneButton).not.toBeDisabled();
    expect(screen.getByText("2 resolved")).toBeInTheDocument();
  });

  it("clicking done transitions agent to cooldown and deployment to resolved", () => {
    setupCompletedAgent();
    render(<ResultsOverlay agentRole="closer" />);

    // Resolve all proposals
    const agent = useAgentStore.getState().getAgent("closer");
    fireEvent.click(screen.getByTestId(`approve-${agent.proposals[0].id}`));
    const updated = useAgentStore.getState().getAgent("closer");
    fireEvent.click(screen.getByTestId(`approve-${updated.proposals[1].id}`));

    // Click done
    fireEvent.click(screen.getByTestId("results-done-button"));

    // Agent should be in cooldown
    expect(useAgentStore.getState().getAgent("closer").status).toBe("cooldown");

    // Deployment should be resolved
    const deployment = useDeploymentStore.getState().deployments[0];
    expect(deployment.status).toBe("resolved");
  });

  it("shows approve/reject counts in footer", () => {
    setupCompletedAgent();
    render(<ResultsOverlay agentRole="closer" />);

    const agent = useAgentStore.getState().getAgent("closer");
    fireEvent.click(screen.getByTestId(`approve-${agent.proposals[0].id}`));

    expect(screen.getByText("1 approved, 0 rejected")).toBeInTheDocument();
  });
});
