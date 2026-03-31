import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NotificationArea } from "./notification-area";
import { useAppStore } from "../lib/stores/app-store";

function resetStores() {
  useAppStore.setState({ notifications: [] });
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
