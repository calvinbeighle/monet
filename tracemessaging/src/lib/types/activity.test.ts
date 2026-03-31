import { createActivity } from "./activity";
import type { SourceType } from "./activity";

describe("createActivity", () => {
  it("creates an activity with required fields and defaults", () => {
    const activity = createActivity("gmail", "abc123", {
      timestamp: 1000,
      title: "Test Email",
    });

    expect(activity.activityId).toBe("gmail:abc123");
    expect(activity.source).toBe("gmail");
    expect(activity.sourceId).toBe("abc123");
    expect(activity.timestamp).toBe(1000);
    expect(activity.title).toBe("Test Email");
    expect(activity.participants).toEqual([]);
    expect(activity.preview).toBe("");
    expect(activity.body).toBeNull();
    expect(activity.labels).toEqual([]);
    expect(activity.metadata).toEqual({});
    expect(activity.workstreamId).toBeNull();
    expect(activity.userOverride).toBe(false);
    expect(activity.viewed).toBe(false);
    expect(activity.lastModified).toBeGreaterThan(0);
  });

  it("creates activity ID in {source}:{sourceId} format", () => {
    const sources: SourceType[] = [
      "gmail",
      "arc-browser",
      "google-calendar",
      "git",
      "claude-code",
      "hubspot",
    ];
    for (const source of sources) {
      const activity = createActivity(source, "id1", {
        timestamp: 1000,
        title: "Test",
      });
      expect(activity.activityId).toBe(`${source}:id1`);
    }
  });

  it("preserves provided optional fields", () => {
    const activity = createActivity("git", "commit1", {
      timestamp: 2000,
      title: "fix: resolve bug",
      preview: "Fixed null pointer",
      body: "Full diff here",
      labels: ["bugfix"],
      metadata: { branch: "main" },
      workstreamId: "ws-1",
      userOverride: true,
      viewed: true,
    });

    expect(activity.preview).toBe("Fixed null pointer");
    expect(activity.body).toBe("Full diff here");
    expect(activity.labels).toEqual(["bugfix"]);
    expect(activity.metadata).toEqual({ branch: "main" });
    expect(activity.workstreamId).toBe("ws-1");
    expect(activity.userOverride).toBe(true);
    expect(activity.viewed).toBe(true);
  });
});
