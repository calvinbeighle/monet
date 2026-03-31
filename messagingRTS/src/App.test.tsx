import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { useAppStore } from "./lib/stores/app-store";
import { useThreadStore } from "./lib/stores/thread-store";
import { createThread } from "./lib/types";

// Mock persistence manager so App init doesn't hit IndexedDB
vi.mock("./features/sync/persistence-manager", () => ({
  loadPersistedThreads: vi.fn(async () => []),
  startPeriodicPersist: vi.fn(),
  stopPeriodicPersist: vi.fn(),
  flushPersist: vi.fn(async () => {}),
  saveThreadState: vi.fn(async () => {}),
}));

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

function resetStores() {
  useAppStore.setState({
    shellState: "initializing",
    activePanel: "none",
    focusZone: "map",
    selectedThreadId: null,
    viewportWidth: 1024,
    viewportHeight: 768,
    notifications: [],
  });
  useThreadStore.setState({
    threads: new Map(),
  });
}

describe("App shell", () => {
  beforeEach(() => {
    resetStores();
    useAppStore.setState({ shellState: "active" });
  });

  it("renders the application shell with all layout regions", () => {
    renderApp();
    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getByTestId("status-bar")).toBeInTheDocument();
    expect(screen.getByTestId("map-viewport")).toBeInTheDocument();
    expect(screen.getByTestId("agent-dock")).toBeInTheDocument();
  });

  it("renders all 6 agent types in the dock", () => {
    renderApp();
    expect(screen.getByTestId("agent-closer")).toBeInTheDocument();
    expect(screen.getByTestId("agent-researcher")).toBeInTheDocument();
    expect(screen.getByTestId("agent-scheduler")).toBeInTheDocument();
    expect(screen.getByTestId("agent-cleaner")).toBeInTheDocument();
    expect(screen.getByTestId("agent-drafter")).toBeInTheDocument();
    expect(screen.getByTestId("agent-escalation-bot")).toBeInTheDocument();
  });

  it("shows sync status indicator", () => {
    renderApp();
    expect(screen.getByTestId("sync-indicator")).toBeInTheDocument();
  });

  it("shows front health score", () => {
    renderApp();
    expect(screen.getByTestId("health-score")).toBeInTheDocument();
  });
});

describe("Shell lifecycle states", () => {
  beforeEach(resetStores);

  it("shows initializing state before persistence loads", () => {
    renderApp();
    // Async init hasn't resolved yet, so initializing UI is shown
    expect(screen.getByTestId("shell-initializing")).toBeInTheDocument();
  });

  it("shows unauthenticated state with auth prompt", () => {
    useAppStore.setState({ shellState: "unauthenticated" });
    renderApp();
    expect(screen.getByTestId("auth-prompt")).toBeInTheDocument();
    expect(screen.getByText("Connect Gmail")).toBeInTheDocument();
  });

  it("shows loading state with loading indicator", () => {
    useAppStore.setState({ shellState: "loading" });
    renderApp();
    expect(screen.getByTestId("loading-indicator")).toBeInTheDocument();
    expect(screen.getByText("Syncing your inbox...")).toBeInTheDocument();
  });

  it("shows empty state when no threads after sync", () => {
    useAppStore.setState({ shellState: "empty" });
    renderApp();
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByText("Your inbox is empty")).toBeInTheDocument();
  });

  it("shows degraded banner when Gmail is unreachable", () => {
    useAppStore.setState({ shellState: "degraded" });
    renderApp();
    expect(screen.getByTestId("degraded-banner")).toBeInTheDocument();
  });

  it("does not show degraded banner in active state", () => {
    useAppStore.setState({ shellState: "active" });
    renderApp();
    expect(screen.queryByTestId("degraded-banner")).not.toBeInTheDocument();
  });
});

describe("Panel management", () => {
  beforeEach(() => {
    resetStores();
    useAppStore.setState({ shellState: "active" });
  });

  it("shows detail panel when a thread is selected", () => {
    const thread = createThread("t1", "Test Subject", "Preview");
    useThreadStore.setState({ threads: new Map([["t1", thread]]) });
    useAppStore.setState({ selectedThreadId: "t1", activePanel: "detail" });

    renderApp();
    expect(screen.getByTestId("detail-panel")).toBeInTheDocument();
    expect(screen.getByTestId("right-panel-zone")).toBeInTheDocument();
  });

  it("does not show right panel when activePanel is none", () => {
    renderApp();
    expect(screen.queryByTestId("right-panel-zone")).not.toBeInTheDocument();
  });

  it("shows deployment history panel", () => {
    useAppStore.setState({ activePanel: "deployment-history" });
    renderApp();
    expect(screen.getByTestId("deployment-history-panel")).toBeInTheDocument();
  });

  it("shows session summary modal", () => {
    useAppStore.setState({ activePanel: "session-summary" });
    renderApp();
    expect(screen.getByTestId("session-summary-modal")).toBeInTheDocument();
  });
});

describe("Focus zones", () => {
  beforeEach(() => {
    resetStores();
    useAppStore.setState({ shellState: "active" });
  });

  it("has status-bar, map-viewport, and agent-dock focus zones", () => {
    renderApp();
    expect(screen.getByTestId("status-bar-zone")).toBeInTheDocument();
    expect(screen.getByTestId("map-viewport-zone")).toBeInTheDocument();
    expect(screen.getByTestId("agent-dock-zone")).toBeInTheDocument();
  });

  it("sets focus zone to status-bar on focus", () => {
    renderApp();
    fireEvent.focus(screen.getByTestId("status-bar-zone"));
    expect(useAppStore.getState().focusZone).toBe("status-bar");
  });

  it("sets focus zone to map on focus", () => {
    renderApp();
    fireEvent.focus(screen.getByTestId("map-viewport-zone"));
    expect(useAppStore.getState().focusZone).toBe("map");
  });

  it("sets focus zone to agent-dock on focus", () => {
    renderApp();
    fireEvent.focus(screen.getByTestId("agent-dock-zone"));
    expect(useAppStore.getState().focusZone).toBe("agent-dock");
  });
});

describe("StatusBar triggers", () => {
  beforeEach(() => {
    resetStores();
    useAppStore.setState({ shellState: "active" });
  });

  it("has summary trigger button", () => {
    renderApp();
    expect(screen.getByTestId("summary-trigger")).toBeInTheDocument();
  });

  it("has deployment history trigger button", () => {
    renderApp();
    expect(screen.getByTestId("history-trigger")).toBeInTheDocument();
  });

  it("clicking summary trigger opens session summary modal", () => {
    renderApp();
    fireEvent.click(screen.getByTestId("summary-trigger"));
    expect(useAppStore.getState().activePanel).toBe("session-summary");
  });

  it("clicking history trigger opens deployment history panel", () => {
    renderApp();
    fireEvent.click(screen.getByTestId("history-trigger"));
    expect(useAppStore.getState().activePanel).toBe("deployment-history");
  });
});
