import { createWorkstream } from "./workstream";

describe("createWorkstream", () => {
  it("creates a workstream with defaults", () => {
    const ws = createWorkstream("ws-1", "Test Workstream");

    expect(ws.id).toBe("ws-1");
    expect(ws.name).toBe("Test Workstream");
    expect(ws.description).toBe("");
    expect(ws.activityIds).toEqual([]);
    expect(ws.activityTimeline).toEqual([]);
    expect(ws.sourceBreakdown).toEqual({});
    expect(ws.participants).toEqual([]);
    expect(ws.primaryParticipantEmail).toBeNull();
    expect(ws.status).toBe("active");
    expect(ws.statusHistory).toEqual([]);
    expect(ws.unreadCount).toBe(0);
    expect(ws.pendingActionCount).toBe(0);
    expect(ws.summary).toBeNull();
    expect(ws.confidence).toBe(0);
    expect(ws.rationale).toBe("");
    expect(ws.createdAt).toBeGreaterThan(0);
    expect(ws.lastActivityTimestamp).toBeGreaterThan(0);
  });

  it("preserves provided fields", () => {
    const ws = createWorkstream("ws-2", "Custom", {
      description: "A custom workstream",
      status: "stale",
      unreadCount: 5,
      activityIds: ["gmail:a", "git:b"],
    });

    expect(ws.description).toBe("A custom workstream");
    expect(ws.status).toBe("stale");
    expect(ws.unreadCount).toBe(5);
    expect(ws.activityIds).toEqual(["gmail:a", "git:b"]);
  });
});
