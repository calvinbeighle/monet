import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeploymentHistoryPanel, type DeploymentRecord } from "./deployment-history-panel";
import { useAppStore } from "../lib/stores/app-store";

function resetStores() {
  useAppStore.setState({ activePanel: "deployment-history" });
}

const mockDeployments: DeploymentRecord[] = [
  {
    id: "d1",
    agentRole: "closer",
    agentName: "Closer",
    clusterId: "c1",
    threadCount: 3,
    status: "completed",
    startedAt: Date.now() - 60000,
    completedAt: Date.now(),
    approvedCount: 2,
    rejectedCount: 1,
  },
  {
    id: "d2",
    agentRole: "researcher",
    agentName: "Researcher",
    clusterId: null,
    threadCount: 5,
    status: "in-progress",
    startedAt: Date.now(),
    completedAt: null,
    approvedCount: 0,
    rejectedCount: 0,
  },
];

describe("DeploymentHistoryPanel", () => {
  beforeEach(resetStores);

  it("renders the panel", () => {
    render(<DeploymentHistoryPanel deployments={[]} />);
    expect(screen.getByTestId("deployment-history-panel")).toBeInTheDocument();
  });

  it("shows empty state when no deployments", () => {
    render(<DeploymentHistoryPanel deployments={[]} />);
    expect(screen.getByTestId("deployment-history-empty")).toBeInTheDocument();
    expect(screen.getByText("No deployments yet")).toBeInTheDocument();
  });

  it("renders deployment records", () => {
    render(<DeploymentHistoryPanel deployments={mockDeployments} />);
    expect(screen.getByTestId("deployment-history-list")).toBeInTheDocument();
    expect(screen.getByTestId("deployment-d1")).toBeInTheDocument();
    expect(screen.getByTestId("deployment-d2")).toBeInTheDocument();
  });

  it("shows agent name and status", () => {
    render(<DeploymentHistoryPanel deployments={mockDeployments} />);
    expect(screen.getByText("Closer")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("Researcher")).toBeInTheDocument();
    expect(screen.getByText("in-progress")).toBeInTheDocument();
  });

  it("shows thread count and approval stats", () => {
    render(<DeploymentHistoryPanel deployments={mockDeployments} />);
    expect(screen.getByText(/3 threads/)).toBeInTheDocument();
    expect(screen.getByText(/2 approved/)).toBeInTheDocument();
    expect(screen.getByText(/1 rejected/)).toBeInTheDocument();
  });

  it("close button sets activePanel to none", () => {
    render(<DeploymentHistoryPanel deployments={[]} />);
    fireEvent.click(screen.getByTestId("deployment-history-close"));
    expect(useAppStore.getState().activePanel).toBe("none");
  });
});
