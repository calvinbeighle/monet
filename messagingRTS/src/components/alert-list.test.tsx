import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AlertList } from "./alert-list";
import { useAppStore } from "../lib/stores/app-store";
import type { MapAlert } from "../lib/types/game-mechanics";

function makeAlert(overrides: Partial<MapAlert> = {}): MapAlert {
  return {
    id: `alert-${Math.random().toString(36).slice(2)}`,
    type: "about-to-be-lost",
    threadId: "t1",
    message: "Thread is about to be lost",
    acknowledged: false,
    autoResolved: false,
    createdAt: Date.now(),
    ...overrides,
  };
}

function resetStore() {
  useAppStore.setState({ mapAlerts: [] });
}

describe("AlertList", () => {
  beforeEach(resetStore);

  it("shows 'No active alerts' when no alerts exist", () => {
    render(<AlertList onClose={() => {}} />);

    expect(screen.getByTestId("no-alerts")).toBeInTheDocument();
    expect(screen.getByText("No active alerts")).toBeInTheDocument();
  });

  it("shows 'No active alerts' when all alerts are auto-resolved", () => {
    useAppStore.setState({
      mapAlerts: [makeAlert({ autoResolved: true }), makeAlert({ autoResolved: true })],
    });

    render(<AlertList onClose={() => {}} />);

    expect(screen.getByTestId("no-alerts")).toBeInTheDocument();
  });

  it("renders unacknowledged alerts in the unacknowledged section", () => {
    useAppStore.setState({
      mapAlerts: [
        makeAlert({ id: "a1", acknowledged: false }),
        makeAlert({ id: "a2", acknowledged: false }),
      ],
    });

    render(<AlertList onClose={() => {}} />);

    expect(screen.getByTestId("unacknowledged-alerts")).toBeInTheDocument();
    expect(screen.getByTestId("alert-item-a1")).toBeInTheDocument();
    expect(screen.getByTestId("alert-item-a2")).toBeInTheDocument();
  });

  it("renders dismiss buttons for each unacknowledged alert", () => {
    useAppStore.setState({
      mapAlerts: [
        makeAlert({ id: "a1", acknowledged: false }),
        makeAlert({ id: "a2", acknowledged: false }),
      ],
    });

    render(<AlertList onClose={() => {}} />);

    expect(screen.getByTestId("acknowledge-alert-a1")).toBeInTheDocument();
    expect(screen.getByTestId("acknowledge-alert-a2")).toBeInTheDocument();
  });

  it("clicking dismiss calls acknowledgeMapAlert with the alert id", () => {
    useAppStore.setState({
      mapAlerts: [makeAlert({ id: "a1", acknowledged: false })],
    });

    render(<AlertList onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("acknowledge-alert-a1"));

    const state = useAppStore.getState();
    const alert = state.mapAlerts.find((a) => a.id === "a1");
    expect(alert?.acknowledged).toBe(true);
  });

  it("shows acknowledged alerts in the dismissed section", () => {
    useAppStore.setState({
      mapAlerts: [
        makeAlert({ id: "a1", acknowledged: true }),
        makeAlert({ id: "a2", acknowledged: true }),
      ],
    });

    render(<AlertList onClose={() => {}} />);

    expect(screen.getByTestId("acknowledged-alerts")).toBeInTheDocument();
    expect(screen.getByTestId("alert-item-a1")).toBeInTheDocument();
    expect(screen.getByTestId("alert-item-a2")).toBeInTheDocument();
  });

  it("acknowledged alerts do not have dismiss buttons", () => {
    useAppStore.setState({
      mapAlerts: [makeAlert({ id: "a1", acknowledged: true })],
    });

    render(<AlertList onClose={() => {}} />);

    expect(screen.queryByTestId("acknowledge-alert-a1")).not.toBeInTheDocument();
  });

  it("does not render dismissed section when no acknowledged alerts exist", () => {
    useAppStore.setState({
      mapAlerts: [makeAlert({ id: "a1", acknowledged: false })],
    });

    render(<AlertList onClose={() => {}} />);

    expect(screen.queryByTestId("acknowledged-alerts")).not.toBeInTheDocument();
  });

  it("does not render unacknowledged section when no unacknowledged alerts exist", () => {
    useAppStore.setState({
      mapAlerts: [makeAlert({ id: "a1", acknowledged: true })],
    });

    render(<AlertList onClose={() => {}} />);

    expect(screen.queryByTestId("unacknowledged-alerts")).not.toBeInTheDocument();
  });

  it("auto-resolved alerts are excluded from both sections", () => {
    useAppStore.setState({
      mapAlerts: [
        makeAlert({ id: "a1", autoResolved: true, acknowledged: false }),
        makeAlert({ id: "a2", autoResolved: true, acknowledged: true }),
      ],
    });

    render(<AlertList onClose={() => {}} />);

    expect(screen.queryByTestId("alert-item-a1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("alert-item-a2")).not.toBeInTheDocument();
    expect(screen.getByTestId("no-alerts")).toBeInTheDocument();
  });

  it("close button calls onClose callback", () => {
    const onClose = vi.fn();
    render(<AlertList onClose={onClose} />);

    fireEvent.click(screen.getByTestId("close-alert-list"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("alert count is shown in heading when unacknowledged alerts are present", () => {
    useAppStore.setState({
      mapAlerts: [
        makeAlert({ id: "a1", acknowledged: false }),
        makeAlert({ id: "a2", acknowledged: false }),
      ],
    });

    render(<AlertList onClose={() => {}} />);

    expect(screen.getByText("Alerts (2)")).toBeInTheDocument();
  });

  it("renders with dialog role and correct aria-label", () => {
    render(<AlertList onClose={() => {}} />);

    const panel = screen.getByTestId("alert-list");
    expect(panel).toHaveAttribute("role", "dialog");
    expect(panel).toHaveAttribute("aria-label", "Map alerts");
  });

  it("thread-level alerts display the threadId", () => {
    useAppStore.setState({
      mapAlerts: [makeAlert({ id: "a1", threadId: "thread-42", acknowledged: false })],
    });

    render(<AlertList onClose={() => {}} />);

    expect(screen.getByText("thread-42")).toBeInTheDocument();
  });

  it("system alerts with null threadId display 'System alert'", () => {
    useAppStore.setState({
      mapAlerts: [makeAlert({ id: "a1", threadId: null, acknowledged: false })],
    });

    render(<AlertList onClose={() => {}} />);

    expect(screen.getByText("System alert")).toBeInTheDocument();
  });
});
