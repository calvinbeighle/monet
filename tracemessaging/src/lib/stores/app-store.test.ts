import { useAppStore } from "./app-store";

beforeEach(() => {
  useAppStore.setState({
    authState: "unauthenticated",
    dataState: "loading",
    currentRoute: { view: "timeline" },
    syncStatus: "connected",
    sourceSyncStates: new Map(),
    notifications: [],
    searchQuery: "",
    searchOpen: false,
  });
});

describe("useAppStore", () => {
  it("starts with default state", () => {
    const state = useAppStore.getState();
    expect(state.authState).toBe("unauthenticated");
    expect(state.dataState).toBe("loading");
    expect(state.currentRoute).toEqual({ view: "timeline" });
    expect(state.syncStatus).toBe("connected");
  });

  it("transitions auth state", () => {
    useAppStore.getState().setAuthState("authenticated");
    expect(useAppStore.getState().authState).toBe("authenticated");
  });

  it("adds and dismisses notifications", () => {
    useAppStore.getState().addNotification("Test message", "info");

    const notifications = useAppStore.getState().notifications;
    expect(notifications).toHaveLength(1);
    expect(notifications[0].message).toBe("Test message");
    expect(notifications[0].type).toBe("info");

    useAppStore.getState().dismissNotification(notifications[0].id);
    expect(useAppStore.getState().notifications).toHaveLength(0);
  });

  it("sets error auto-dismiss to null", () => {
    useAppStore.getState().addNotification("Error!", "error");
    const n = useAppStore.getState().notifications[0];
    expect(n.autoDismissMs).toBeNull();
  });

  it("sets info auto-dismiss to 5000", () => {
    useAppStore.getState().addNotification("Info!", "info");
    const n = useAppStore.getState().notifications[0];
    expect(n.autoDismissMs).toBe(5000);
  });

  it("updates source sync state", () => {
    useAppStore
      .getState()
      .updateSourceSync("gmail", { status: "syncing", itemCount: 50 });

    const state = useAppStore.getState().sourceSyncStates.get("gmail");
    expect(state?.status).toBe("syncing");
    expect(state?.itemCount).toBe(50);
  });

  it("manages search state", () => {
    useAppStore.getState().setSearchQuery("test");
    expect(useAppStore.getState().searchQuery).toBe("test");

    useAppStore.getState().setSearchOpen(true);
    expect(useAppStore.getState().searchOpen).toBe(true);
  });
});
