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

describe("ResultsOverlay - Drafter tone variants (Spec 07)", () => {
  beforeEach(resetStores);

  function setupDrafterWithToneVariants() {
    const store = useAgentStore.getState();
    store.deploy("drafter", "c1", ["t1", "t2"]);
    store.startWork("drafter");
    store.complete("drafter", [
      {
        threadId: "t1",
        outputType: "reply-draft",
        content: "[Professional] Dear team, please review.",
      },
      { threadId: "t1", outputType: "tone-variant", content: "[Casual] Hey team, take a look!" },
      {
        threadId: "t1",
        outputType: "tone-variant",
        content: "[Friendly] Hi everyone, would love your thoughts.",
      },
      { threadId: "t2", outputType: "reply-draft", content: "Thanks for your message." },
    ]);

    useDeploymentStore.setState({
      deployments: [
        {
          id: "deploy-drafter",
          agentRole: "drafter",
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

  it("groups proposals by thread and shows tone variant tabs for drafter", () => {
    setupDrafterWithToneVariants();
    render(<ResultsOverlay agentRole="drafter" />);

    // Should render a tone variant group for thread t1
    expect(screen.getByTestId("tone-variant-group-t1")).toBeInTheDocument();
    expect(screen.getByTestId("tone-variant-tabs")).toBeInTheDocument();
  });

  it("shows tone labels as tab buttons", () => {
    setupDrafterWithToneVariants();
    render(<ResultsOverlay agentRole="drafter" />);

    // Three variants for t1: Professional, Casual, Friendly
    const agent = useAgentStore.getState().getAgent("drafter");
    const t1Proposals = agent.proposals.filter((p) => p.threadId === "t1");
    expect(t1Proposals).toHaveLength(3);

    // Tone tabs should show the tone labels
    for (const p of t1Proposals) {
      expect(screen.getByTestId(`tone-tab-${p.id}`)).toBeInTheDocument();
    }
  });

  it("clicking tone tab switches the active variant", () => {
    setupDrafterWithToneVariants();
    render(<ResultsOverlay agentRole="drafter" />);

    const agent = useAgentStore.getState().getAgent("drafter");
    const t1Proposals = agent.proposals.filter((p) => p.threadId === "t1");

    // Initially shows the first variant (Professional)
    expect(screen.getByText("[Professional] Dear team, please review.")).toBeInTheDocument();

    // Click second tone tab (Casual)
    fireEvent.click(screen.getByTestId(`tone-tab-${t1Proposals[1].id}`));
    expect(screen.getByText("[Casual] Hey team, take a look!")).toBeInTheDocument();
  });

  it("single-proposal threads render without tone variant tabs for drafter", () => {
    setupDrafterWithToneVariants();
    render(<ResultsOverlay agentRole="drafter" />);

    // t2 has only one proposal, so no tone variant group/tabs
    expect(screen.queryByTestId("tone-variant-group-t2")).not.toBeInTheDocument();
    // But the proposal content should still be visible
    expect(screen.getByText("Thanks for your message.")).toBeInTheDocument();
  });

  it("non-drafter agents render proposals without tone variant grouping", () => {
    setupCompletedAgent();
    render(<ResultsOverlay agentRole="closer" />);

    // Closer should never show tone variant tabs
    expect(screen.queryByTestId("tone-variant-tabs")).not.toBeInTheDocument();
  });
});

describe("ResultsOverlay - Failed thread identification (Spec 05)", () => {
  beforeEach(resetStores);

  it("shows failed thread markers when failedThreadIds is provided", () => {
    setupCompletedAgent();
    render(<ResultsOverlay agentRole="closer" failedThreadIds={["t3", "t4"]} />);

    expect(screen.getByTestId("failed-threads-section")).toBeInTheDocument();
    expect(screen.getByTestId("failed-thread-t3")).toBeInTheDocument();
    expect(screen.getByTestId("failed-thread-t4")).toBeInTheDocument();
  });

  it("shows 'Failed to process' text on failed thread markers", () => {
    setupCompletedAgent();
    render(<ResultsOverlay agentRole="closer" failedThreadIds={["t3"]} />);

    expect(screen.getByTestId("failed-thread-t3")).toHaveTextContent("Failed to process");
  });

  it("shows 'Failed' badge on failed thread markers", () => {
    setupCompletedAgent();
    render(<ResultsOverlay agentRole="closer" failedThreadIds={["t3"]} />);

    const failedMarker = screen.getByTestId("failed-thread-t3");
    expect(failedMarker).toHaveTextContent("Failed");
  });

  it("does not show failed section when failedThreadIds is empty", () => {
    setupCompletedAgent();
    render(<ResultsOverlay agentRole="closer" failedThreadIds={[]} />);

    expect(screen.queryByTestId("failed-threads-section")).not.toBeInTheDocument();
  });

  it("does not show failed section when failedThreadIds is not provided", () => {
    setupCompletedAgent();
    render(<ResultsOverlay agentRole="closer" />);

    expect(screen.queryByTestId("failed-threads-section")).not.toBeInTheDocument();
  });

  it("shows both failed markers and successful proposals", () => {
    setupCompletedAgent();
    render(<ResultsOverlay agentRole="closer" failedThreadIds={["t3"]} />);

    // Failed section present
    expect(screen.getByTestId("failed-thread-t3")).toBeInTheDocument();
    // Successful proposals still shown
    expect(screen.getByText("Hi, following up on our conversation.")).toBeInTheDocument();
    expect(screen.getByText("Mark as resolved.")).toBeInTheDocument();
  });
});
