import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./app-store";
import type { TrustRecord } from "../types/game-mechanics";

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
      selectedThreadId: null,
      notifications: [],
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

describe("AppStore - selectedThread", () => {
  beforeEach(() => {
    useAppStore.setState({
      selectedThreadId: null,
      activePanel: "none",
      notifications: [],
    });
  });

  it("starts with no selected thread", () => {
    expect(useAppStore.getState().selectedThreadId).toBeNull();
  });

  it("selecting a thread opens detail panel", () => {
    useAppStore.getState().setSelectedThread("t1");
    expect(useAppStore.getState().selectedThreadId).toBe("t1");
    expect(useAppStore.getState().activePanel).toBe("detail");
  });

  it("deselecting thread closes detail panel", () => {
    useAppStore.getState().setSelectedThread("t1");
    useAppStore.getState().setSelectedThread(null);
    expect(useAppStore.getState().selectedThreadId).toBeNull();
    expect(useAppStore.getState().activePanel).toBe("none");
  });

  it("deselecting thread does not close non-detail panels", () => {
    useAppStore.getState().setActivePanel("deployment-history");
    useAppStore.getState().setSelectedThread("t1");
    // Now detail is open from selection
    expect(useAppStore.getState().activePanel).toBe("detail");

    // Switch to deployment-history manually
    useAppStore.getState().setActivePanel("deployment-history");

    // Deselecting should not close deployment-history
    useAppStore.getState().setSelectedThread(null);
    expect(useAppStore.getState().activePanel).toBe("deployment-history");
  });
});

describe("AppStore - notifications", () => {
  beforeEach(() => {
    useAppStore.setState({ notifications: [] });
  });

  it("starts with empty notifications", () => {
    expect(useAppStore.getState().notifications).toHaveLength(0);
  });

  it("adds a notification", () => {
    useAppStore.getState().addNotification({ message: "Test", severity: "info" });
    const notifs = useAppStore.getState().notifications;
    expect(notifs).toHaveLength(1);
    expect(notifs[0].message).toBe("Test");
    expect(notifs[0].severity).toBe("info");
    expect(notifs[0].dismissed).toBe(false);
    expect(notifs[0].id).toMatch(/^notif-/);
  });

  it("newest notification is first", () => {
    useAppStore.getState().addNotification({ message: "First", severity: "info" });
    useAppStore.getState().addNotification({ message: "Second", severity: "warning" });
    const notifs = useAppStore.getState().notifications;
    expect(notifs[0].message).toBe("Second");
    expect(notifs[1].message).toBe("First");
  });

  it("dismisses a notification by id", () => {
    useAppStore.getState().addNotification({ message: "Test", severity: "info" });
    const id = useAppStore.getState().notifications[0].id;
    useAppStore.getState().dismissNotification(id);
    expect(useAppStore.getState().notifications[0].dismissed).toBe(true);
  });

  it("clears all notifications", () => {
    useAppStore.getState().addNotification({ message: "A", severity: "info" });
    useAppStore.getState().addNotification({ message: "B", severity: "warning" });
    useAppStore.getState().clearAllNotifications();
    expect(useAppStore.getState().notifications).toHaveLength(0);
  });

  it("auto-dismisses oldest beyond max visible", () => {
    // Add 6 notifications (max is 5)
    for (let i = 0; i < 6; i++) {
      useAppStore.getState().addNotification({ message: `N${i}`, severity: "info" });
    }
    const notifs = useAppStore.getState().notifications;
    const visible = notifs.filter((n) => !n.dismissed);
    expect(visible.length).toBeLessThanOrEqual(5);
  });
});

describe("AppStore - map alerts", () => {
  beforeEach(() => {
    useAppStore.setState({ mapAlerts: [], unreadAlertCount: 0 });
  });

  it("starts with empty map alerts", () => {
    expect(useAppStore.getState().mapAlerts).toHaveLength(0);
    expect(useAppStore.getState().unreadAlertCount).toBe(0);
  });

  it("sets map alerts and updates unread count", () => {
    useAppStore.getState().setMapAlerts([
      {
        id: "a1",
        type: "about-to-be-lost",
        threadId: "t1",
        message: "Thread at risk",
        createdAt: Date.now(),
        acknowledged: false,
        autoResolved: false,
      },
      {
        id: "a2",
        type: "streak-at-risk",
        threadId: null,
        message: "Streak at risk",
        createdAt: Date.now(),
        acknowledged: false,
        autoResolved: false,
      },
    ]);
    expect(useAppStore.getState().mapAlerts).toHaveLength(2);
    expect(useAppStore.getState().unreadAlertCount).toBe(2);
  });

  it("excludes acknowledged and auto-resolved from unread count", () => {
    useAppStore.getState().setMapAlerts([
      {
        id: "a1",
        type: "about-to-be-lost",
        threadId: "t1",
        message: "Active",
        createdAt: Date.now(),
        acknowledged: false,
        autoResolved: false,
      },
      {
        id: "a2",
        type: "agent-completed",
        threadId: null,
        message: "Acked",
        createdAt: Date.now(),
        acknowledged: true,
        autoResolved: false,
      },
      {
        id: "a3",
        type: "new-high-value",
        threadId: "t2",
        message: "Resolved",
        createdAt: Date.now(),
        acknowledged: false,
        autoResolved: true,
      },
    ]);
    expect(useAppStore.getState().unreadAlertCount).toBe(1);
  });

  it("acknowledges a map alert and updates count", () => {
    useAppStore.getState().setMapAlerts([
      {
        id: "a1",
        type: "about-to-be-lost",
        threadId: "t1",
        message: "Alert",
        createdAt: Date.now(),
        acknowledged: false,
        autoResolved: false,
      },
    ]);
    expect(useAppStore.getState().unreadAlertCount).toBe(1);

    useAppStore.getState().acknowledgeMapAlert("a1");
    expect(useAppStore.getState().mapAlerts[0].acknowledged).toBe(true);
    expect(useAppStore.getState().unreadAlertCount).toBe(0);
  });
});

describe("AppStore - trust records, session stats, streaks", () => {
  beforeEach(() => {
    useAppStore.setState({
      trustRecords: {},
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
      streakState: {
        inboxZeroDays: 0,
        zeroLostDays: 0,
        lastEvaluationDate: "",
      },
      streakInboxZero: 0,
      streakZeroLost: 0,
    });
  });

  it("setTrustRecords sets and retrieves trust records", () => {
    const record: TrustRecord = {
      contactEmail: "alice@example.com",
      score: 75,
      tier: "established",
      consecutiveStreak: 3,
      tierEntryDate: 1000000,
      establishedSinceDate: 1000000,
      lastReplyTimestamp: 2000000,
      lastDecayCheck: 3000000,
      decayActive: false,
    };
    useAppStore.getState().setTrustRecords({ "alice@example.com": record });
    const stored = useAppStore.getState().trustRecords;
    expect(stored["alice@example.com"]).toEqual(record);
  });

  it("updateSessionStats merges partial updates", () => {
    useAppStore.getState().updateSessionStats({ threadsHandled: 5 });
    expect(useAppStore.getState().sessionStats.threadsHandled).toBe(5);
  });

  it("updateSessionStats preserves other fields during partial update", () => {
    useAppStore.getState().updateSessionStats({ opportunitiesCaptured: 2 });
    useAppStore.getState().updateSessionStats({ threadsHandled: 7 });
    const stats = useAppStore.getState().sessionStats;
    expect(stats.threadsHandled).toBe(7);
    expect(stats.opportunitiesCaptured).toBe(2);
    expect(stats.risksMitigated).toBe(0);
    expect(stats.agentsDeployed).toBe(0);
  });

  it("setStreaks updates streakState and syncs streakInboxZero and streakZeroLost", () => {
    useAppStore.getState().setStreaks({
      inboxZeroDays: 4,
      zeroLostDays: 2,
      lastEvaluationDate: "2026-03-31",
    });
    const state = useAppStore.getState();
    expect(state.streakState.inboxZeroDays).toBe(4);
    expect(state.streakState.zeroLostDays).toBe(2);
    expect(state.streakState.lastEvaluationDate).toBe("2026-03-31");
    expect(state.streakInboxZero).toBe(4);
    expect(state.streakZeroLost).toBe(2);
  });
});
