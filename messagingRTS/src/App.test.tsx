import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";

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

describe("App shell", () => {
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
