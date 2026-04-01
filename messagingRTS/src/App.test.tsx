import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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

// Mock auth store's checkConnection so init doesn't hit Nango API
vi.mock("./features/auth/auth-store", async () => {
  const { create } = await import("zustand");
  const store = create(() => ({
    authState: "authenticated" as const,
    connection: {
      id: 1,
      connectionId: "gmail",
      providerConfigKey: "google-mail",
      provider: "google-mail",
      createdAt: "",
      updatedAt: "",
    },
    error: null,
    checkConnection: vi.fn(async () => {}),
    startAuth: vi.fn(async () => {}),
    handleAuthComplete: vi.fn(async () => {}),
    handleConsentDenied: vi.fn(),
    signOut: vi.fn(),
    _checkConnectionStatus: vi.fn(async () => null),
    _createConnectSession: vi.fn(async () => ({ token: "", connectUrl: "", expiresAt: "" })),
    _redirect: vi.fn(),
  }));
  return { useAuthStore: store };
});

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

describe("Accessibility - Tab cycling between focus zones (Spec 12 Section 12)", () => {
  beforeEach(() => {
    resetStores();
    useAppStore.setState({ shellState: "active" });
  });

  it("Tab from status-bar moves focus to map viewport", () => {
    renderApp();
    act(() => {
      useAppStore.setState({ focusZone: "status-bar" });
    });
    fireEvent.keyDown(window, { key: "Tab" });
    expect(useAppStore.getState().focusZone).toBe("map");
  });

  it("Tab from map moves focus to agent-dock", () => {
    renderApp();
    act(() => {
      useAppStore.setState({ focusZone: "map" });
    });
    fireEvent.keyDown(window, { key: "Tab" });
    expect(useAppStore.getState().focusZone).toBe("agent-dock");
  });

  it("Tab from agent-dock wraps to status-bar when no right panel open", () => {
    renderApp();
    act(() => {
      useAppStore.setState({ focusZone: "agent-dock" });
    });
    fireEvent.keyDown(window, { key: "Tab" });
    expect(useAppStore.getState().focusZone).toBe("status-bar");
  });

  it("Tab from agent-dock moves to right-panel when detail panel is open", () => {
    const thread = createThread("t1", "Test", "Preview");
    useThreadStore.setState({ threads: new Map([["t1", thread]]) });
    useAppStore.setState({ selectedThreadId: "t1", activePanel: "detail" });
    renderApp();
    act(() => {
      useAppStore.setState({ focusZone: "agent-dock" });
    });
    fireEvent.keyDown(window, { key: "Tab" });
    expect(useAppStore.getState().focusZone).toBe("right-panel");
  });

  it("Shift+Tab from map moves focus back to status-bar", () => {
    renderApp();
    act(() => {
      useAppStore.setState({ focusZone: "map" });
    });
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(useAppStore.getState().focusZone).toBe("status-bar");
  });

  it("Shift+Tab from status-bar wraps to agent-dock when no right panel", () => {
    renderApp();
    act(() => {
      useAppStore.setState({ focusZone: "status-bar" });
    });
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(useAppStore.getState().focusZone).toBe("agent-dock");
  });
});

describe("Accessibility - ARIA attributes (Spec 12 Section 12)", () => {
  beforeEach(() => {
    resetStores();
    useAppStore.setState({ shellState: "active" });
  });

  it("focus zone containers have region role and aria-label", () => {
    renderApp();
    const statusBar = screen.getByTestId("status-bar-zone");
    expect(statusBar).toHaveAttribute("role", "region");
    expect(statusBar).toHaveAttribute("aria-label", "Status bar");

    const mapZone = screen.getByTestId("map-viewport-zone");
    expect(mapZone).toHaveAttribute("role", "region");
    expect(mapZone).toHaveAttribute("aria-label", "Map viewport");

    const dockZone = screen.getByTestId("agent-dock-zone");
    expect(dockZone).toHaveAttribute("role", "region");
    expect(dockZone).toHaveAttribute("aria-label", "Agent dock");
  });

  it("right panel zone has region role and aria-label when open", () => {
    const thread = createThread("t1", "Test", "Preview");
    useThreadStore.setState({ threads: new Map([["t1", thread]]) });
    useAppStore.setState({ selectedThreadId: "t1", activePanel: "detail" });
    renderApp();
    const rightPanel = screen.getByTestId("right-panel-zone");
    expect(rightPanel).toHaveAttribute("role", "region");
    expect(rightPanel).toHaveAttribute("aria-label", "Detail panel");
  });
});

describe("Accessibility - Escape behavior (Spec 12 Section 12)", () => {
  beforeEach(() => {
    resetStores();
    useAppStore.setState({ shellState: "active" });
  });

  it("Escape closes right panel when focus is in right-panel zone", () => {
    const thread = createThread("t1", "Test", "Preview");
    useThreadStore.setState({ threads: new Map([["t1", thread]]) });
    useAppStore.setState({ selectedThreadId: "t1", activePanel: "detail" });
    renderApp();
    act(() => {
      useAppStore.setState({ focusZone: "right-panel" });
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useAppStore.getState().activePanel).toBe("none");
    expect(useAppStore.getState().focusZone).toBe("map");
  });
});

describe("Responsive - Agent dock compact form (Spec 12 Section 11)", () => {
  beforeEach(() => {
    resetStores();
    useAppStore.setState({ shellState: "active" });
  });

  it("agent dock has compact height below responsive breakpoint", () => {
    renderApp();
    act(() => {
      useAppStore.setState({ viewportWidth: 600 });
    });
    const dock = screen.getByTestId("agent-dock");
    expect(dock.className).toContain("h-10");
  });

  it("agent dock has full height above responsive breakpoint", () => {
    renderApp();
    act(() => {
      useAppStore.setState({ viewportWidth: 1024 });
    });
    const dock = screen.getByTestId("agent-dock");
    expect(dock.className).toContain("h-16");
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
