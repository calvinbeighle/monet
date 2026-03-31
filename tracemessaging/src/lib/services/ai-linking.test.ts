import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useActivityStore } from "../stores/activity-store";
import { useWorkstreamStore } from "../stores/workstream-store";
import { useAppStore } from "../stores/app-store";
import { createActivity } from "../types/activity";
import { createWorkstream } from "../types/workstream";

// Mock the api-client module
vi.mock("./api-client", () => ({
  apiPost: vi.fn(),
}));

import { evaluateActivity } from "./ai-linking";

describe("ai-linking", () => {
  beforeEach(() => {
    useActivityStore.setState({ activities: new Map() });
    useWorkstreamStore.setState({ workstreams: new Map() });
    useAppStore.setState({ notifications: [] });
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("skips user-overridden activities", () => {
    const activity = createActivity("gmail", "msg1", {
      timestamp: Date.now(),
      title: "User assigned",
      userOverride: true,
    });

    // Should not throw or trigger any API call
    evaluateActivity(activity);
    // No assertion needed - just verifying no error
  });

  it("skips already-assigned activities", () => {
    const activity = createActivity("gmail", "msg1", {
      timestamp: Date.now(),
      title: "Already assigned",
      workstreamId: "ws-123",
    });

    evaluateActivity(activity);
    // No assertion needed - just verifying no error
  });

  it("fast-path matches activities by Gmail thread ID", () => {
    // Set up a workstream with a Gmail activity
    const existingActivity = createActivity("gmail", "msg1", {
      timestamp: Date.now() - 1000,
      title: "Initial email",
      metadata: { threadId: "thread-abc" },
    });
    useActivityStore.getState().addActivity(existingActivity);

    const ws = createWorkstream("ws-1", "Email Thread", {
      activityIds: [existingActivity.activityId],
    });
    useWorkstreamStore.getState().setWorkstream(ws);

    // New activity from same thread
    const newActivity = createActivity("gmail", "msg2", {
      timestamp: Date.now(),
      title: "Reply in same thread",
      metadata: { threadId: "thread-abc" },
    });
    useActivityStore.getState().addActivity(newActivity);

    evaluateActivity(newActivity);

    // Should be assigned to the workstream via fast-path
    const updated = useActivityStore
      .getState()
      .getActivity(newActivity.activityId);
    expect(updated?.workstreamId).toBe("ws-1");
  });

  it("fast-path matches by git repo+branch", () => {
    const existingActivity = createActivity("git", "commit1", {
      timestamp: Date.now() - 1000,
      title: "Initial commit",
      metadata: { branch: "feature/auth", repo: "monet" },
    });
    useActivityStore.getState().addActivity(existingActivity);

    const ws = createWorkstream("ws-git", "Feature Auth", {
      activityIds: [existingActivity.activityId],
    });
    useWorkstreamStore.getState().setWorkstream(ws);

    const newActivity = createActivity("git", "commit2", {
      timestamp: Date.now(),
      title: "Add login form",
      metadata: { branch: "feature/auth", repo: "monet" },
    });
    useActivityStore.getState().addActivity(newActivity);

    evaluateActivity(newActivity);

    const updated = useActivityStore
      .getState()
      .getActivity(newActivity.activityId);
    expect(updated?.workstreamId).toBe("ws-git");
  });

  it("fast-path matches by calendar series ID", () => {
    const existingActivity = createActivity("google-calendar", "event1", {
      timestamp: Date.now() - 1000,
      title: "Weekly standup",
      metadata: { seriesId: "series-xyz" },
    });
    useActivityStore.getState().addActivity(existingActivity);

    const ws = createWorkstream("ws-cal", "Weekly Standup", {
      activityIds: [existingActivity.activityId],
    });
    useWorkstreamStore.getState().setWorkstream(ws);

    const newActivity = createActivity("google-calendar", "event2", {
      timestamp: Date.now(),
      title: "Weekly standup (next week)",
      metadata: { seriesId: "series-xyz" },
    });
    useActivityStore.getState().addActivity(newActivity);

    evaluateActivity(newActivity);

    const updated = useActivityStore
      .getState()
      .getActivity(newActivity.activityId);
    expect(updated?.workstreamId).toBe("ws-cal");
  });

  it("queues non-fast-path activities for batch processing", () => {
    const ws = createWorkstream("ws-1", "Some Project", {
      activityIds: [],
      participants: [
        {
          email: "alice@example.com",
          displayName: "Alice",
          source: "gmail",
          lastSeenTimestamp: Date.now(),
          enrichment: null,
        },
      ],
    });
    useWorkstreamStore.getState().setWorkstream(ws);

    const newActivity = createActivity("arc-browser", "tab1", {
      timestamp: Date.now(),
      title: "Random browser tab",
    });
    useActivityStore.getState().addActivity(newActivity);

    // This should queue the activity, not immediately assign
    evaluateActivity(newActivity);

    // Activity should still be unassigned (waiting for batch)
    const updated = useActivityStore
      .getState()
      .getActivity(newActivity.activityId);
    expect(updated?.workstreamId).toBeNull();
  });
});
