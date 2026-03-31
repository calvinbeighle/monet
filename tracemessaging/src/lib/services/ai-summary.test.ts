import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useActivityStore } from "../stores/activity-store";
import { useWorkstreamStore } from "../stores/workstream-store";
import { createActivity } from "../types/activity";
import { createWorkstream } from "../types/workstream";

// Mock the api-client module
vi.mock("./api-client", () => ({
  apiPost: vi.fn(),
}));

import { apiPost } from "./api-client";
import { requestSummary, needsRefresh, stopSummaryService } from "./ai-summary";

const mockedApiPost = vi.mocked(apiPost);

describe("ai-summary", () => {
  beforeEach(() => {
    useActivityStore.setState({ activities: new Map() });
    useWorkstreamStore.setState({ workstreams: new Map() });
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopSummaryService();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("needsRefresh returns true when no summary exists", () => {
    const ws = createWorkstream("ws-1", "Test WS");
    useWorkstreamStore.getState().setWorkstream(ws);

    expect(needsRefresh("ws-1")).toBe(true);
  });

  it("needsRefresh returns false when summary is fresh", () => {
    const ws = createWorkstream("ws-1", "Test WS", {
      summary: {
        statusSummary: "All good",
        keyDevelopments: [],
        recommendedAction: {
          type: "no-action",
          description: "Nothing to do",
          targetActivityId: null,
          confidence: 1.0,
        },
        urgency: "low",
        generatedAt: Date.now(), // Fresh
      },
    });
    useWorkstreamStore.getState().setWorkstream(ws);

    expect(needsRefresh("ws-1")).toBe(false);
  });

  it("needsRefresh returns true when summary is >30min old", () => {
    const thirtyOneMinutesAgo = Date.now() - 31 * 60 * 1000;
    const ws = createWorkstream("ws-1", "Test WS", {
      summary: {
        statusSummary: "Stale summary",
        keyDevelopments: [],
        recommendedAction: {
          type: "no-action",
          description: "Nothing",
          targetActivityId: null,
          confidence: 1.0,
        },
        urgency: "low",
        generatedAt: thirtyOneMinutesAgo,
      },
    });
    useWorkstreamStore.getState().setWorkstream(ws);

    expect(needsRefresh("ws-1")).toBe(true);
  });

  it("generates summary via AI endpoint on immediate request", async () => {
    const a1 = createActivity("gmail", "msg1", {
      timestamp: Date.now(),
      title: "Important email from client",
      participants: [
        {
          email: "client@acme.com",
          displayName: "Client",
          source: "gmail",
          lastSeenTimestamp: Date.now(),
        },
      ],
      preview: "We need to discuss the proposal timeline...",
    });
    useActivityStore.getState().addActivity(a1);

    const ws = createWorkstream("ws-1", "Acme Proposal", {
      activityIds: [a1.activityId],
    });
    useWorkstreamStore.getState().setWorkstream(ws);

    mockedApiPost.mockResolvedValueOnce({
      statusSummary:
        "Active proposal discussion with Acme Corp. Client requesting timeline update.",
      keyDevelopments: ["Client sent email requesting timeline update"],
      recommendedAction: {
        type: "reply-email",
        description: "Reply to client about proposal timeline",
        targetActivityId: a1.activityId,
        confidence: 0.9,
      },
      urgency: "medium",
      generatedAt: Date.now(),
    });

    requestSummary("ws-1", true);

    // Need to flush microtasks since the function is async
    await vi.runAllTimersAsync();

    expect(mockedApiPost).toHaveBeenCalledWith(
      "/ai/summarize",
      expect.objectContaining({
        workstream: expect.objectContaining({ name: "Acme Proposal" }),
        activities: expect.arrayContaining([
          expect.objectContaining({ activityId: a1.activityId }),
        ]),
      }),
    );

    // Check that workstream got the summary
    const updatedWs = useWorkstreamStore.getState().getWorkstream("ws-1");
    expect(updatedWs?.summary).toBeDefined();
    expect(updatedWs?.summary?.statusSummary).toContain("Acme Corp");
    expect(updatedWs?.summary?.urgency).toBe("medium");
    expect(updatedWs?.summary?.recommendedAction.type).toBe("reply-email");
  });

  it("debounces multiple summary requests for the same workstream", () => {
    const a1 = createActivity("gmail", "msg1", {
      timestamp: Date.now(),
      title: "Email 1",
    });
    useActivityStore.getState().addActivity(a1);
    const ws = createWorkstream("ws-1", "Test", {
      activityIds: [a1.activityId],
    });
    useWorkstreamStore.getState().setWorkstream(ws);

    // Request summary 3 times without immediate flag
    requestSummary("ws-1");
    requestSummary("ws-1");
    requestSummary("ws-1");

    // Should not have called API yet (debouncing)
    expect(mockedApiPost).not.toHaveBeenCalled();
  });

  it("normalizes invalid urgency values to 'low'", async () => {
    const a1 = createActivity("gmail", "msg1", {
      timestamp: Date.now(),
      title: "Test email",
    });
    useActivityStore.getState().addActivity(a1);
    const ws = createWorkstream("ws-1", "Test", {
      activityIds: [a1.activityId],
    });
    useWorkstreamStore.getState().setWorkstream(ws);

    mockedApiPost.mockResolvedValueOnce({
      statusSummary: "Test summary",
      keyDevelopments: [],
      recommendedAction: {
        type: "invalid-type",
        description: "Something",
        targetActivityId: null,
        confidence: 0.5,
      },
      urgency: "critical", // Invalid - should normalize to 'low'
      generatedAt: Date.now(),
    });

    requestSummary("ws-1", true);
    await vi.runAllTimersAsync();

    const updatedWs = useWorkstreamStore.getState().getWorkstream("ws-1");
    expect(updatedWs?.summary?.urgency).toBe("low");
    expect(updatedWs?.summary?.recommendedAction.type).toBe("no-action"); // invalid type normalized
  });
});
