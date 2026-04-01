import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionSummaryModal, type SessionSummaryData } from "./session-summary-modal";
import { useAppStore } from "../lib/stores/app-store";

const mockData: SessionSummaryData = {
  threadsHandled: 12,
  opportunitiesCaptured: 5,
  opportunitiesMissed: 2,
  risksMitigated: 8,
  agentsDeployed: 3,
  netHealthChange: 15,
  sessionDurationMs: 45 * 60000,
};

function resetStores() {
  useAppStore.setState({ activePanel: "session-summary" });
}

describe("SessionSummaryModal", () => {
  beforeEach(resetStores);

  it("renders the modal", () => {
    render(<SessionSummaryModal data={mockData} triggeredFrom={null} />);
    expect(screen.getByTestId("session-summary-modal")).toBeInTheDocument();
  });

  it("shows all summary fields", () => {
    render(<SessionSummaryModal data={mockData} triggeredFrom={null} />);
    expect(screen.getByText("45m")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows positive health change with + sign", () => {
    render(<SessionSummaryModal data={mockData} triggeredFrom={null} />);
    expect(screen.getByText("+15")).toBeInTheDocument();
  });

  it("shows negative health change without + sign", () => {
    const negData = { ...mockData, netHealthChange: -10 };
    render(<SessionSummaryModal data={negData} triggeredFrom={null} />);
    expect(screen.getByText("-10")).toBeInTheDocument();
  });

  it("close button sets activePanel to none", () => {
    render(<SessionSummaryModal data={mockData} triggeredFrom={null} />);
    fireEvent.click(screen.getByTestId("session-summary-close"));
    expect(useAppStore.getState().activePanel).toBe("none");
  });

  it("clicking backdrop closes modal", () => {
    render(<SessionSummaryModal data={mockData} triggeredFrom={null} />);
    fireEvent.click(screen.getByTestId("session-summary-backdrop"));
    expect(useAppStore.getState().activePanel).toBe("none");
  });

  it("Escape key closes modal", () => {
    render(<SessionSummaryModal data={mockData} triggeredFrom={null} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useAppStore.getState().activePanel).toBe("none");
  });

  it("has role=dialog and aria-modal=true", () => {
    render(<SessionSummaryModal data={mockData} triggeredFrom={null} />);
    const modal = screen.getByTestId("session-summary-modal");
    expect(modal).toHaveAttribute("role", "dialog");
    expect(modal).toHaveAttribute("aria-modal", "true");
  });

  it("has aria-label on the modal", () => {
    render(<SessionSummaryModal data={mockData} triggeredFrom={null} />);
    const modal = screen.getByTestId("session-summary-modal");
    expect(modal).toHaveAttribute("aria-label", "Session summary");
  });
});
