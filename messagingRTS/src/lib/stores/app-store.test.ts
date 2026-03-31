import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./app-store";

describe("AppStore", () => {
  beforeEach(() => {
    useAppStore.setState({
      shellState: "initializing",
      activePanel: "none",
      focusZone: "map",
      syncStatus: "connected",
      frontHealthScore: 100,
      streakInboxZero: 0,
      streakZeroLost: 0,
      unreadAlertCount: 0,
      viewportWidth: 0,
      viewportHeight: 0,
    });
  });

  it("starts in initializing state", () => {
    expect(useAppStore.getState().shellState).toBe("initializing");
  });

  it("transitions shell state", () => {
    useAppStore.getState().setShellState("active");
    expect(useAppStore.getState().shellState).toBe("active");
  });

  it("manages active panel - only one at a time", () => {
    useAppStore.getState().setActivePanel("detail");
    expect(useAppStore.getState().activePanel).toBe("detail");

    useAppStore.getState().setActivePanel("deployment-history");
    expect(useAppStore.getState().activePanel).toBe("deployment-history");

    useAppStore.getState().setActivePanel("none");
    expect(useAppStore.getState().activePanel).toBe("none");
  });

  it("tracks sync status", () => {
    useAppStore.getState().setSyncStatus("syncing");
    expect(useAppStore.getState().syncStatus).toBe("syncing");

    useAppStore.getState().setSyncStatus("error");
    expect(useAppStore.getState().syncStatus).toBe("error");
  });

  it("tracks front health score", () => {
    useAppStore.getState().setFrontHealth(42);
    expect(useAppStore.getState().frontHealthScore).toBe(42);
  });

  it("tracks viewport dimensions", () => {
    useAppStore.getState().setViewportDimensions(1920, 1080);
    expect(useAppStore.getState().viewportWidth).toBe(1920);
    expect(useAppStore.getState().viewportHeight).toBe(1080);
  });

  it("manages focus zones per Spec 12 tab order", () => {
    useAppStore.getState().setFocusZone("status-bar");
    expect(useAppStore.getState().focusZone).toBe("status-bar");

    useAppStore.getState().setFocusZone("agent-dock");
    expect(useAppStore.getState().focusZone).toBe("agent-dock");
  });
});
