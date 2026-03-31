import { describe, it, expect, beforeEach } from "vitest";
import { useThreadStore } from "./thread-store";
import { createThread } from "../types";

describe("ThreadStore", () => {
  beforeEach(() => {
    // Reset store between tests
    useThreadStore.setState({
      threads: new Map(),
      selectedThreadId: null,
      selectedThreadIds: new Set(),
    });
  });

  it("starts with empty state", () => {
    const state = useThreadStore.getState();
    expect(state.threads.size).toBe(0);
    expect(state.selectedThreadId).toBeNull();
  });

  it("adds and retrieves a thread", () => {
    const thread = createThread("t1", "Subject", "snippet");
    useThreadStore.getState().setThread(thread);

    const retrieved = useThreadStore.getState().getThread("t1");
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe("t1");
    expect(retrieved!.subject).toBe("Subject");
  });

  it("adds multiple threads at once", () => {
    const threads = [
      createThread("t1", "S1", "s1"),
      createThread("t2", "S2", "s2"),
      createThread("t3", "S3", "s3"),
    ];
    useThreadStore.getState().setThreads(threads);
    expect(useThreadStore.getState().getThreadCount()).toBe(3);
  });

  it("removes a thread", () => {
    const thread = createThread("t1", "Subject", "snippet");
    useThreadStore.getState().setThread(thread);
    useThreadStore.getState().removeThread("t1");

    expect(useThreadStore.getState().getThread("t1")).toBeUndefined();
    expect(useThreadStore.getState().getThreadCount()).toBe(0);
  });

  it("updates a thread partially", () => {
    const thread = createThread("t1", "Subject", "snippet");
    useThreadStore.getState().setThread(thread);
    useThreadStore.getState().updateThread("t1", { urgencyScore: 0.9, unread: false });

    const updated = useThreadStore.getState().getThread("t1")!;
    expect(updated.urgencyScore).toBe(0.9);
    expect(updated.unread).toBe(false);
    expect(updated.subject).toBe("Subject"); // unchanged
  });

  it("transitions lifecycle state with history", () => {
    const thread = createThread("t1", "Subject", "snippet");
    useThreadStore.getState().setThread(thread);
    useThreadStore.getState().transitionState("t1", "active", "user-opened");

    const updated = useThreadStore.getState().getThread("t1")!;
    expect(updated.lifecycleState).toBe("active");
    expect(updated.stateHistory).toHaveLength(1);
    expect(updated.stateHistory[0].from).toBe("new");
    expect(updated.stateHistory[0].to).toBe("active");
    expect(updated.stateHistory[0].trigger).toBe("user-opened");
  });

  it("selects and deselects a thread", () => {
    useThreadStore.getState().selectThread("t1");
    expect(useThreadStore.getState().selectedThreadId).toBe("t1");

    useThreadStore.getState().selectThread(null);
    expect(useThreadStore.getState().selectedThreadId).toBeNull();
  });

  it("toggles batch selection", () => {
    useThreadStore.getState().toggleBatchSelect("t1");
    useThreadStore.getState().toggleBatchSelect("t2");
    expect(useThreadStore.getState().selectedThreadIds.size).toBe(2);

    useThreadStore.getState().toggleBatchSelect("t1"); // deselect
    expect(useThreadStore.getState().selectedThreadIds.size).toBe(1);
    expect(useThreadStore.getState().selectedThreadIds.has("t2")).toBe(true);
  });

  it("clears batch selection", () => {
    useThreadStore.getState().toggleBatchSelect("t1");
    useThreadStore.getState().toggleBatchSelect("t2");
    useThreadStore.getState().clearBatchSelection();
    expect(useThreadStore.getState().selectedThreadIds.size).toBe(0);
  });

  it("filters threads by zone", () => {
    const t1 = createThread("t1", "S1", "s1");
    const t2 = { ...createThread("t2", "S2", "s2"), zone: "lost" as const };
    const t3 = createThread("t3", "S3", "s3");

    useThreadStore.getState().setThreads([t1, t2, t3]);

    const activeFront = useThreadStore.getState().getThreadsByZone("active-front");
    expect(activeFront).toHaveLength(2);

    const lost = useThreadStore.getState().getThreadsByZone("lost");
    expect(lost).toHaveLength(1);
    expect(lost[0].id).toBe("t2");
  });
});
