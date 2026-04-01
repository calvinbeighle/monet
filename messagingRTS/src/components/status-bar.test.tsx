// Status bar tests per Spec 07 / Spec 12

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar } from "./status-bar";
import { useAppStore } from "../lib/stores/app-store";

function resetStore() {
  useAppStore.setState({
    syncStatus: "connected",
    frontHealthScore: 100,
    streakInboxZero: 0,
    streakZeroLost: 0,
    unreadAlertCount: 0,
    sessionStats: {
      threadsHandled: 0,
      opportunitiesCaptured: 0,
      opportunitiesMissed: 0,
      risksMitigated: 0,
      agentsDeployed: 0,
      lostThreadCount: 0,
      netHealthChange: 0,
      sessionStart: Date.now(),
    },
  });
}

describe("StatusBar", () => {
  beforeEach(resetStore);

  it("renders the status bar", () => {
    render(<StatusBar />);
    expect(screen.getByTestId("status-bar")).toBeInTheDocument();
  });

  it("shows sync status indicator", () => {
    render(<StatusBar />);
    expect(screen.getByTestId("sync-indicator")).toBeInTheDocument();
  });

  it("shows front health score", () => {
    useAppStore.setState({ frontHealthScore: 72 });
    render(<StatusBar />);
    expect(screen.getByTestId("health-score")).toHaveTextContent("72");
  });

  describe("lost-thread tally (Spec 07)", () => {
    it("shows Lost indicator when lostThreadCount > 0", () => {
      useAppStore.setState({
        sessionStats: {
          threadsHandled: 0,
          opportunitiesCaptured: 0,
          opportunitiesMissed: 0,
          risksMitigated: 0,
          agentsDeployed: 0,
          lostThreadCount: 4,
          netHealthChange: 0,
          sessionStart: Date.now(),
        },
      });
      render(<StatusBar />);
      expect(screen.getByTestId("lost-tally")).toBeInTheDocument();
      expect(screen.getByTestId("lost-tally")).toHaveTextContent("Lost");
      expect(screen.getByTestId("lost-tally")).toHaveTextContent("4");
    });

    it("does not show Lost indicator when lostThreadCount is 0", () => {
      render(<StatusBar />);
      expect(screen.queryByTestId("lost-tally")).not.toBeInTheDocument();
    });

    it("updates Lost count when sessionStats.lostThreadCount changes", () => {
      useAppStore.setState({
        sessionStats: {
          threadsHandled: 0,
          opportunitiesCaptured: 0,
          opportunitiesMissed: 0,
          risksMitigated: 0,
          agentsDeployed: 0,
          lostThreadCount: 7,
          netHealthChange: 0,
          sessionStart: Date.now(),
        },
      });
      render(<StatusBar />);
      expect(screen.getByTestId("lost-tally")).toHaveTextContent("7");
    });
  });
});
