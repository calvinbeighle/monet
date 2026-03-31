import { useActivityStore } from "./activity-store";
import { createActivity } from "../types";

// Reset store between tests
beforeEach(() => {
  useActivityStore.setState({ activities: new Map() });
});

describe("useActivityStore", () => {
  it("starts with empty activities", () => {
    expect(useActivityStore.getState().getActivityCount()).toBe(0);
  });

  it("adds a single activity", () => {
    const activity = createActivity("gmail", "a1", {
      timestamp: 1000,
      title: "Email 1",
    });

    useActivityStore.getState().addActivity(activity);

    expect(useActivityStore.getState().getActivityCount()).toBe(1);
    expect(useActivityStore.getState().getActivity("gmail:a1")).toBeDefined();
  });

  it("adds multiple activities in batch", () => {
    const activities = [
      createActivity("gmail", "a1", { timestamp: 1000, title: "Email 1" }),
      createActivity("git", "c1", { timestamp: 2000, title: "Commit 1" }),
      createActivity("arc-browser", "t1", { timestamp: 3000, title: "Tab 1" }),
    ];

    useActivityStore.getState().addActivities(activities);

    expect(useActivityStore.getState().getActivityCount()).toBe(3);
  });

  it("updates an activity and stamps lastModified", () => {
    const activity = createActivity("gmail", "a1", {
      timestamp: 1000,
      title: "Original",
    });
    useActivityStore.getState().addActivity(activity);

    const before = activity.lastModified;
    useActivityStore
      .getState()
      .updateActivity("gmail:a1", { title: "Updated" });

    const updated = useActivityStore.getState().getActivity("gmail:a1");
    expect(updated?.title).toBe("Updated");
    expect(updated?.lastModified).toBeGreaterThanOrEqual(before);
  });

  it("removes an activity", () => {
    const activity = createActivity("gmail", "a1", {
      timestamp: 1000,
      title: "Email 1",
    });
    useActivityStore.getState().addActivity(activity);
    useActivityStore.getState().removeActivity("gmail:a1");

    expect(useActivityStore.getState().getActivityCount()).toBe(0);
  });

  it("sets workstream assignment", () => {
    const activity = createActivity("gmail", "a1", {
      timestamp: 1000,
      title: "Email 1",
    });
    useActivityStore.getState().addActivity(activity);
    useActivityStore
      .getState()
      .setActivityWorkstream("gmail:a1", "ws-1", false);

    const updated = useActivityStore.getState().getActivity("gmail:a1");
    expect(updated?.workstreamId).toBe("ws-1");
    expect(updated?.userOverride).toBe(false);
  });

  it("marks activity as viewed", () => {
    const activity = createActivity("gmail", "a1", {
      timestamp: 1000,
      title: "Email 1",
    });
    useActivityStore.getState().addActivity(activity);
    useActivityStore.getState().markViewed("gmail:a1");

    const updated = useActivityStore.getState().getActivity("gmail:a1");
    expect(updated?.viewed).toBe(true);
  });

  it("queries by source", () => {
    useActivityStore
      .getState()
      .addActivities([
        createActivity("gmail", "a1", { timestamp: 1000, title: "Email 1" }),
        createActivity("gmail", "a2", { timestamp: 2000, title: "Email 2" }),
        createActivity("git", "c1", { timestamp: 3000, title: "Commit 1" }),
      ]);

    const gmailActivities = useActivityStore
      .getState()
      .getActivitiesBySource("gmail");
    expect(gmailActivities).toHaveLength(2);
  });

  it("queries unassigned activities", () => {
    useActivityStore.getState().addActivities([
      createActivity("gmail", "a1", {
        timestamp: 1000,
        title: "Email 1",
        workstreamId: "ws-1",
      }),
      createActivity("gmail", "a2", { timestamp: 2000, title: "Email 2" }),
    ]);

    const unassigned = useActivityStore.getState().getUnassignedActivities();
    expect(unassigned).toHaveLength(1);
    expect(unassigned[0].activityId).toBe("gmail:a2");
  });
});
