import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DetailPanel } from "./detail-panel";
import { useAppStore } from "../lib/stores/app-store";
import { useThreadStore } from "../lib/stores/thread-store";
import { createThread } from "../lib/types";

function resetStores() {
  useAppStore.setState({
    selectedThreadId: null,
    activePanel: "none",
  });
  useThreadStore.setState({
    threads: new Map(),
  });
}

describe("DetailPanel", () => {
  beforeEach(resetStores);

  it("renders nothing when no thread is selected", () => {
    const { container } = render(<DetailPanel />);
    expect(container.innerHTML).toBe("");
  });

  it("renders panel when a thread is selected", () => {
    const thread = createThread("t1", "Test Subject", "Preview text");
    useThreadStore.setState({ threads: new Map([["t1", thread]]) });
    useAppStore.setState({ selectedThreadId: "t1" });

    render(<DetailPanel />);
    expect(screen.getByTestId("detail-panel")).toBeInTheDocument();
    expect(screen.getByTestId("detail-subject")).toHaveTextContent("Test Subject");
  });

  it("shows thread not found when thread ID does not match store", () => {
    useAppStore.setState({ selectedThreadId: "nonexistent" });

    render(<DetailPanel />);
    expect(screen.getByText("Thread not found")).toBeInTheDocument();
  });

  it("close button clears selection", () => {
    const thread = createThread("t1", "Subject", "Snippet");
    useThreadStore.setState({ threads: new Map([["t1", thread]]) });
    useAppStore.setState({ selectedThreadId: "t1", activePanel: "detail" });

    render(<DetailPanel />);
    fireEvent.click(screen.getByTestId("detail-panel-close"));

    expect(useAppStore.getState().selectedThreadId).toBeNull();
  });

  it("shows message count", () => {
    const thread = { ...createThread("t1", "Subject", "Snippet"), messageCount: 5 };
    useThreadStore.setState({ threads: new Map([["t1", thread]]) });
    useAppStore.setState({ selectedThreadId: "t1" });

    render(<DetailPanel />);
    expect(screen.getByText("5 messages")).toBeInTheDocument();
  });

  it("shows singular message for count of 1", () => {
    const thread = { ...createThread("t1", "Subject", "Snippet"), messageCount: 1 };
    useThreadStore.setState({ threads: new Map([["t1", thread]]) });
    useAppStore.setState({ selectedThreadId: "t1" });

    render(<DetailPanel />);
    expect(screen.getByText("1 message")).toBeInTheDocument();
  });

  it("renders reply composer", () => {
    const thread = createThread("t1", "Subject", "Snippet");
    useThreadStore.setState({ threads: new Map([["t1", thread]]) });
    useAppStore.setState({ selectedThreadId: "t1" });

    render(<DetailPanel />);
    expect(screen.getByTestId("reply-composer")).toBeInTheDocument();
  });

  it("renders messages when thread has messages", () => {
    const thread = {
      ...createThread("t1", "Subject", "Snippet"),
      messages: [
        {
          id: "m1",
          sender: "alice@example.com",
          recipients: [],
          cc: [],
          bcc: [],
          timestamp: Date.now(),
          bodyPlain: "Hello there",
          bodyHtml: "",
          labelIds: [],
          attachments: [],
        },
      ],
    };
    useThreadStore.setState({ threads: new Map([["t1", thread]]) });
    useAppStore.setState({ selectedThreadId: "t1" });

    render(<DetailPanel />);
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("Hello there")).toBeInTheDocument();
  });

  it("shows thread metadata - zone, state, risk, opportunity, urgency, value", () => {
    const thread = {
      ...createThread("t1", "Subject", "Snippet"),
      zone: "at-risk" as const,
      lifecycleState: "active" as const,
      riskTier: "elevated" as const,
      opportunityState: "ripe" as const,
      urgencyScore: 0.75,
      valueScore: 0.6,
    };
    useThreadStore.setState({ threads: new Map([["t1", thread]]) });
    useAppStore.setState({ selectedThreadId: "t1" });

    render(<DetailPanel />);
    const metadata = screen.getByTestId("thread-metadata");
    expect(metadata).toBeInTheDocument();
    expect(metadata.textContent).toContain("at-risk");
    expect(metadata.textContent).toContain("active");
    expect(metadata.textContent).toContain("elevated");
    expect(metadata.textContent).toContain("ripe");
    expect(metadata.textContent).toContain("75%"); // urgency
    expect(metadata.textContent).toContain("60%"); // value
  });

  it("shows (no subject) when subject is empty", () => {
    const thread = createThread("t1", "", "Snippet");
    useThreadStore.setState({ threads: new Map([["t1", thread]]) });
    useAppStore.setState({ selectedThreadId: "t1" });

    render(<DetailPanel />);
    expect(screen.getByTestId("detail-subject")).toHaveTextContent("(no subject)");
  });

  it("has proper accessibility attributes", () => {
    const thread = createThread("t1", "Subject", "Snippet");
    useThreadStore.setState({ threads: new Map([["t1", thread]]) });
    useAppStore.setState({ selectedThreadId: "t1" });

    render(<DetailPanel />);
    const panel = screen.getByTestId("detail-panel");
    expect(panel).toHaveAttribute("role", "complementary");
    expect(panel).toHaveAttribute("aria-label", "Thread detail");
    expect(screen.getByTestId("detail-panel-close")).toHaveAttribute(
      "aria-label",
      "Close detail panel",
    );
  });
});
