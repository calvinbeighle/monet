import { describe, it, expect, vi, beforeEach } from "vitest";
import { useActivityStore } from "../stores/activity-store";
import { useWorkstreamStore } from "../stores/workstream-store";
import { useAppStore } from "../stores/app-store";
import { createActivity } from "../types/activity";
import { createWorkstream } from "../types/workstream";

// Mock the api-client module
vi.mock("./api-client", () => ({
  apiPost: vi.fn(),
}));

import { apiPost } from "./api-client";
import { detectWorkstreams } from "./ai-detection";

const mockApiPost = vi.mocked(apiPost);

describe("ai-detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset stores
    useActivityStore.setState({ activities: new Map() });
    useWorkstreamStore.setState({ workstreams: new Map() });
    useAppStore.getState().clearNotifications();
  });

  it("skips detection when fewer than 2 activities", async () => {
    const activity = createActivity("gmail", "msg1", {
      timestamp: Date.now(),
      title: "Test email",
    });
    useActivityStore.getState().addActivity(activity);

    await detectWorkstreams();

    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("calls AI detect endpoint with unassigned activities", async () => {
    const a1 = createActivity("gmail", "msg1", {
      timestamp: Date.now(),
      title: "Meeting with Acme Corp",
      participants: [
        {
          email: "john@acme.com",
          displayName: "John",
          source: "gmail",
          lastSeenTimestamp: Date.now(),
        },
      ],
    });
    const a2 = createActivity("google-calendar", "cal1", {
      timestamp: Date.now(),
      title: "Acme Corp Follow-up",
      participants: [
        {
          email: "john@acme.com",
          displayName: "John",
          source: "google-calendar",
          lastSeenTimestamp: Date.now(),
        },
      ],
    });

    useActivityStore.getState().addActivities([a1, a2]);

    mockApiPost.mockResolvedValueOnce({
      workstreams: [
        {
          name: "Acme Corp",
          description: "Interactions with Acme Corp",
          activityIds: [a1.activityId, a2.activityId],
          confidence: 0.85,
          rationale: "Shared participant john@acme.com",
          participants: ["john@acme.com"],
        },
      ],
    });

    await detectWorkstreams();

    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(mockApiPost).toHaveBeenCalledWith(
      "/ai/detect",
      expect.objectContaining({
        activities: expect.arrayContaining([
          expect.objectContaining({ activityId: a1.activityId }),
          expect.objectContaining({ activityId: a2.activityId }),
        ]),
      }),
    );

    // Verify workstream was created
    const wsStore = useWorkstreamStore.getState();
    expect(wsStore.getWorkstreamCount()).toBe(1);

    // Verify activities were assigned
    const actStore = useActivityStore.getState();
    const updated1 = actStore.getActivity(a1.activityId);
    expect(updated1?.workstreamId).toBeTruthy();
  });

  it("updates existing workstream on re-detection", async () => {
    // Set up an existing workstream
    const a1 = createActivity("gmail", "msg1", {
      timestamp: Date.now(),
      title: "Meeting with Acme",
    });
    useActivityStore.getState().addActivity(a1);

    const ws = createWorkstream("ws-1", "Acme Corp", {
      activityIds: [a1.activityId],
    });
    useWorkstreamStore.getState().setWorkstream(ws);
    useActivityStore
      .getState()
      .setActivityWorkstream(a1.activityId, "ws-1", false);

    // New activity arrives
    const a2 = createActivity("google-calendar", "cal1", {
      timestamp: Date.now(),
      title: "Acme Follow-up",
    });
    useActivityStore.getState().addActivity(a2);

    // AI says both belong to same cluster
    mockApiPost.mockResolvedValueOnce({
      workstreams: [
        {
          name: "Acme Corp",
          description: "Updated description",
          activityIds: [a1.activityId, a2.activityId],
          confidence: 0.9,
          rationale: "Strong match",
          participants: [],
        },
      ],
    });

    await detectWorkstreams();

    // Should update existing workstream, not create a new one
    const wsStore = useWorkstreamStore.getState();
    expect(wsStore.getWorkstreamCount()).toBe(1);

    const updated = wsStore.getWorkstream("ws-1");
    expect(updated?.confidence).toBe(0.9);
    expect(updated?.activityIds).toContain(a2.activityId);
  });

  it("handles API errors gracefully", async () => {
    const a1 = createActivity("gmail", "msg1", {
      timestamp: Date.now(),
      title: "Test 1",
    });
    const a2 = createActivity("git", "commit1", {
      timestamp: Date.now(),
      title: "Test 2",
    });
    useActivityStore.getState().addActivities([a1, a2]);

    mockApiPost.mockRejectedValueOnce(new Error("Network error"));

    await detectWorkstreams();

    // Should not throw - workstreams remain unchanged
    expect(useWorkstreamStore.getState().getWorkstreamCount()).toBe(0);
  });
});
