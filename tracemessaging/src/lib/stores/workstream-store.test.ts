import { useWorkstreamStore } from "./workstream-store";
import { createWorkstream } from "../types";
import { createActivity } from "../types";

beforeEach(() => {
  useWorkstreamStore.setState({ workstreams: new Map() });
});

describe("useWorkstreamStore", () => {
  it("starts with empty workstreams", () => {
    expect(useWorkstreamStore.getState().getWorkstreamCount()).toBe(0);
  });

  it("sets a workstream", () => {
    const ws = createWorkstream("ws-1", "Test");
    useWorkstreamStore.getState().setWorkstream(ws);

    expect(useWorkstreamStore.getState().getWorkstreamCount()).toBe(1);
    expect(useWorkstreamStore.getState().getWorkstream("ws-1")?.name).toBe(
      "Test",
    );
  });

  it("adds activity to workstream", () => {
    const ws = createWorkstream("ws-1", "Test");
    useWorkstreamStore.getState().setWorkstream(ws);

    const activity = createActivity("gmail", "a1", {
      timestamp: 1000,
      title: "Email 1",
    });
    useWorkstreamStore.getState().addActivityToWorkstream("ws-1", activity);

    const updated = useWorkstreamStore.getState().getWorkstream("ws-1");
    expect(updated?.activityIds).toContain("gmail:a1");
    expect(updated?.activityTimeline).toHaveLength(1);
  });

  it("does not duplicate activity in workstream", () => {
    const ws = createWorkstream("ws-1", "Test");
    useWorkstreamStore.getState().setWorkstream(ws);

    const activity = createActivity("gmail", "a1", {
      timestamp: 1000,
      title: "Email 1",
    });
    useWorkstreamStore.getState().addActivityToWorkstream("ws-1", activity);
    useWorkstreamStore.getState().addActivityToWorkstream("ws-1", activity);

    const updated = useWorkstreamStore.getState().getWorkstream("ws-1");
    expect(updated?.activityIds).toHaveLength(1);
  });

  it("removes activity from workstream", () => {
    const ws = createWorkstream("ws-1", "Test", {
      activityIds: ["gmail:a1"],
    });
    useWorkstreamStore.getState().setWorkstream(ws);
    useWorkstreamStore
      .getState()
      .removeActivityFromWorkstream("ws-1", "gmail:a1");

    const updated = useWorkstreamStore.getState().getWorkstream("ws-1");
    expect(updated?.activityIds).toHaveLength(0);
  });

  it("transitions status with audit trail", () => {
    const ws = createWorkstream("ws-1", "Test");
    useWorkstreamStore.getState().setWorkstream(ws);
    useWorkstreamStore.getState().transitionStatus("ws-1", "stale", "manual");

    const updated = useWorkstreamStore.getState().getWorkstream("ws-1");
    expect(updated?.status).toBe("stale");
    expect(updated?.statusHistory).toHaveLength(1);
    expect(updated?.statusHistory[0].from).toBe("active");
    expect(updated?.statusHistory[0].to).toBe("stale");
    expect(updated?.statusHistory[0].trigger).toBe("manual");
  });

  it("checks lifecycle transitions", () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const ws = createWorkstream("ws-1", "Test", {
      lastActivityTimestamp: eightDaysAgo,
    });
    useWorkstreamStore.getState().setWorkstream(ws);
    useWorkstreamStore.getState().checkLifecycles();

    const updated = useWorkstreamStore.getState().getWorkstream("ws-1");
    expect(updated?.status).toBe("stale");
  });

  it("resets to active when activity added to stale workstream", () => {
    const ws = createWorkstream("ws-1", "Test", { status: "stale" });
    useWorkstreamStore.getState().setWorkstream(ws);

    const activity = createActivity("gmail", "a1", {
      timestamp: Date.now(),
      title: "New Email",
    });
    useWorkstreamStore.getState().addActivityToWorkstream("ws-1", activity);

    const updated = useWorkstreamStore.getState().getWorkstream("ws-1");
    expect(updated?.status).toBe("active");
  });

  it("returns sorted workstreams", () => {
    const now = Date.now();
    useWorkstreamStore.getState().setWorkstreams([
      createWorkstream("ws-1", "Older", {
        lastActivityTimestamp: now - 10000,
      }),
      createWorkstream("ws-2", "Newer", {
        lastActivityTimestamp: now,
      }),
      createWorkstream("ws-3", "Stale", {
        status: "stale",
        lastActivityTimestamp: now - 5000,
      }),
    ]);

    const sorted = useWorkstreamStore.getState().getSortedWorkstreams();
    expect(sorted[0].name).toBe("Newer");
    expect(sorted[1].name).toBe("Older");
    expect(sorted[2].name).toBe("Stale");
  });
});
