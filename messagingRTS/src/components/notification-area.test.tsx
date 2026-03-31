import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NotificationArea } from "./notification-area";
import { useAppStore } from "../lib/stores/app-store";

function resetStores() {
  useAppStore.setState({ notifications: [], mapAlerts: [] });
}

describe("NotificationArea", () => {
  beforeEach(resetStores);

  it("renders nothing when no notifications", () => {
    const { container } = render(<NotificationArea />);
    expect(container.innerHTML).toBe("");
  });

  it("renders visible notifications", () => {
    useAppStore.setState({
      notifications: [
        {
          id: "n1",
          message: "Thread at risk",
          severity: "warning",
          dismissed: false,
          createdAt: Date.now(),
        },
        {
          id: "n2",
          message: "Agent completed",
          severity: "success",
          dismissed: false,
          createdAt: Date.now(),
        },
      ],
    });

    render(<NotificationArea />);
    expect(screen.getByTestId("notification-area")).toBeInTheDocument();
    expect(screen.getByTestId("notification-n1")).toBeInTheDocument();
    expect(screen.getByTestId("notification-n2")).toBeInTheDocument();
    expect(screen.getByText("Thread at risk")).toBeInTheDocument();
    expect(screen.getByText("Agent completed")).toBeInTheDocument();
  });

  it("does not render dismissed notifications", () => {
    useAppStore.setState({
      notifications: [
        { id: "n1", message: "Visible", severity: "info", dismissed: false, createdAt: Date.now() },
        { id: "n2", message: "Hidden", severity: "info", dismissed: true, createdAt: Date.now() },
      ],
    });

    render(<NotificationArea />);
    expect(screen.getByText("Visible")).toBeInTheDocument();
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  });

  it("dismiss button marks notification as dismissed", () => {
    useAppStore.setState({
      notifications: [
        { id: "n1", message: "Test", severity: "info", dismissed: false, createdAt: Date.now() },
      ],
    });

    render(<NotificationArea />);
    fireEvent.click(screen.getByTestId("notification-dismiss-n1"));

    const state = useAppStore.getState();
    expect(state.notifications[0].dismissed).toBe(true);
  });

  it("renders nothing when all notifications are dismissed", () => {
    useAppStore.setState({
      notifications: [
        {
          id: "n1",
          message: "Dismissed",
          severity: "info",
          dismissed: true,
          createdAt: Date.now(),
        },
      ],
    });

    const { container } = render(<NotificationArea />);
    expect(container.innerHTML).toBe("");
  });
});

describe("NotificationArea - map alerts", () => {
  beforeEach(resetStores);

  it("renders active map alerts", () => {
    useAppStore.setState({
      mapAlerts: [
        {
          id: "alert-1",
          type: "about-to-be-lost",
          threadId: "t1",
          message: "Thread about to be lost",
          createdAt: Date.now(),
          acknowledged: false,
          autoResolved: false,
        },
      ],
    });

    render(<NotificationArea />);
    expect(screen.getByTestId("map-alert-alert-1")).toBeInTheDocument();
    expect(screen.getByText("Thread about to be lost")).toBeInTheDocument();
  });

  it("does not render acknowledged map alerts", () => {
    useAppStore.setState({
      mapAlerts: [
        {
          id: "alert-1",
          type: "about-to-be-lost",
          threadId: "t1",
          message: "Acknowledged alert",
          createdAt: Date.now(),
          acknowledged: true,
          autoResolved: false,
        },
      ],
    });

    const { container } = render(<NotificationArea />);
    expect(container.innerHTML).toBe("");
  });

  it("does not render auto-resolved map alerts", () => {
    useAppStore.setState({
      mapAlerts: [
        {
          id: "alert-1",
          type: "about-to-be-lost",
          threadId: "t1",
          message: "Auto-resolved alert",
          createdAt: Date.now(),
          acknowledged: false,
          autoResolved: true,
        },
      ],
    });

    const { container } = render(<NotificationArea />);
    expect(container.innerHTML).toBe("");
  });

  it("acknowledge button marks map alert as acknowledged", () => {
    useAppStore.setState({
      mapAlerts: [
        {
          id: "alert-1",
          type: "streak-at-risk",
          threadId: null,
          message: "Streak at risk",
          createdAt: Date.now(),
          acknowledged: false,
          autoResolved: false,
        },
      ],
    });

    render(<NotificationArea />);
    fireEvent.click(screen.getByTestId("map-alert-ack-alert-1"));

    const state = useAppStore.getState();
    expect(state.mapAlerts[0].acknowledged).toBe(true);
    expect(state.unreadAlertCount).toBe(0);
  });

  it("shows both notifications and map alerts together", () => {
    useAppStore.setState({
      notifications: [
        {
          id: "n1",
          message: "Shell notification",
          severity: "info",
          dismissed: false,
          createdAt: Date.now(),
        },
      ],
      mapAlerts: [
        {
          id: "alert-1",
          type: "new-high-value",
          threadId: "t1",
          message: "High value alert",
          createdAt: Date.now(),
          acknowledged: false,
          autoResolved: false,
        },
      ],
    });

    render(<NotificationArea />);
    expect(screen.getByTestId("notification-n1")).toBeInTheDocument();
    expect(screen.getByTestId("map-alert-alert-1")).toBeInTheDocument();
  });
});
