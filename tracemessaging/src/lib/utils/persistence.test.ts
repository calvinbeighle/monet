import { mergeActivityData } from "./persistence";
import { createActivity } from "../types";

describe("mergeActivityData", () => {
  it("preserves app-owned fields from persisted copy", () => {
    const persisted = createActivity("gmail", "a1", {
      timestamp: 1000,
      title: "Old Title",
      workstreamId: "ws-1",
      userOverride: true,
      viewed: true,
    });

    const fresh = createActivity("gmail", "a1", {
      timestamp: 2000,
      title: "New Title",
      preview: "Updated preview",
    });

    const merged = mergeActivityData(persisted, fresh);

    // Source-owned fields updated
    expect(merged.title).toBe("New Title");
    expect(merged.timestamp).toBe(2000);
    expect(merged.preview).toBe("Updated preview");

    // App-owned fields preserved
    expect(merged.workstreamId).toBe("ws-1");
    expect(merged.userOverride).toBe(true);
    expect(merged.viewed).toBe(true);
  });

  it("updates lastModified on merge", () => {
    const persisted = createActivity("gmail", "a1", {
      timestamp: 1000,
      title: "Old",
      lastModified: 500,
    });

    const fresh = createActivity("gmail", "a1", {
      timestamp: 2000,
      title: "New",
    });

    const merged = mergeActivityData(persisted, fresh);
    expect(merged.lastModified).toBeGreaterThan(500);
  });
});
