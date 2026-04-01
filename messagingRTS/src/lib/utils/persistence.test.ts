// Persistence tests using fake-indexeddb for real IndexedDB operations
// Tests: CRUD, merge on reload, thread removal reconciliation, merge edge cases

import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  persistThread,
  persistThreads,
  loadThread,
  loadAllThreads,
  loadThreadsByZone,
  deleteThread,
  deleteAllThreads,
  getThreadCount,
  mergeThreadData,
  closeDB,
} from "./persistence";
import { createThread } from "../types";

// Reset IndexedDB between tests
beforeEach(async () => {
  await closeDB();
  indexedDB.deleteDatabase("messaging-rts");
});

afterEach(async () => {
  await closeDB();
});

describe("mergeThreadData", () => {
  it("overwrites core Gmail properties with fresh data", () => {
    const persisted = createThread("t1", "Old Subject", "old snippet");
    persisted.urgencyScore = 0.8;
    persisted.position = { x: 100, y: 200 };
    persisted.zone = "at-risk";
    persisted.lifecycleState = "active";

    const merged = mergeThreadData(persisted, {
      subject: "New Subject",
      snippet: "new snippet",
      messageCount: 5,
      unread: false,
      gmailLabels: ["INBOX", "IMPORTANT"],
    });

    // Fresh Gmail data overwrites
    expect(merged.subject).toBe("New Subject");
    expect(merged.snippet).toBe("new snippet");
    expect(merged.messageCount).toBe(5);
    expect(merged.unread).toBe(false);
    expect(merged.gmailLabels).toEqual(["INBOX", "IMPORTANT"]);

    // Computed properties preserved from persisted state
    expect(merged.urgencyScore).toBe(0.8);
    expect(merged.position).toEqual({ x: 100, y: 200 });
    expect(merged.zone).toBe("at-risk");
    expect(merged.lifecycleState).toBe("active");
  });

  it("preserves persisted values when fresh data is partial", () => {
    const persisted = createThread("t1", "Subject", "snippet");
    persisted.messageCount = 3;

    const merged = mergeThreadData(persisted, {
      unread: false,
    });

    expect(merged.subject).toBe("Subject");
    expect(merged.messageCount).toBe(3);
    expect(merged.unread).toBe(false);
  });

  it("updates lastModified timestamp", () => {
    const persisted = createThread("t1", "Subject", "snippet");
    const originalModified = persisted.lastModified;

    const merged = mergeThreadData(persisted, { subject: "Updated" });

    expect(merged.lastModified).toBeGreaterThanOrEqual(originalModified);
  });

  it("preserves all computed properties on merge", () => {
    const persisted = createThread("t1", "Subject", "snippet");
    persisted.urgencyScore = 0.9;
    persisted.valueScore = 0.7;
    persisted.position = { x: 500, y: 300 };
    persisted.targetPosition = { x: 600, y: 400 };
    persisted.zone = "opportunities";
    persisted.driftVelocity = { dx: 1, dy: -0.5 };
    persisted.clusterMembership = "cluster-1";
    persisted.lifecycleState = "waiting";
    persisted.riskTier = "elevated";
    persisted.stateHistory = [
      { from: "new", to: "active", timestamp: 1000, trigger: "user-opened" },
    ];

    const merged = mergeThreadData(persisted, {
      subject: "Fresh Subject",
      messageCount: 10,
    });

    expect(merged.urgencyScore).toBe(0.9);
    expect(merged.valueScore).toBe(0.7);
    expect(merged.position).toEqual({ x: 500, y: 300 });
    expect(merged.targetPosition).toEqual({ x: 600, y: 400 });
    expect(merged.zone).toBe("opportunities");
    expect(merged.driftVelocity).toEqual({ dx: 1, dy: -0.5 });
    expect(merged.clusterMembership).toBe("cluster-1");
    expect(merged.lifecycleState).toBe("waiting");
    expect(merged.riskTier).toBe("elevated");
    expect(merged.stateHistory).toHaveLength(1);
  });

  it("empty participants array from fresh data overwrites non-empty persisted", () => {
    const persisted = createThread("t1", "Subject", "snippet");
    persisted.participants = [
      {
        displayName: "Alice",
        email: "alice@example.com",
        organization: null,
        vipFlag: false,
        relationshipScore: 0.5,
        responseHistory: { avgResponseTimeMs: 1000, threadFrequency: 1 },
      },
    ];

    // Empty array is not null/undefined, so ?? passes it through
    const merged = mergeThreadData(persisted, { participants: [] });

    expect(merged.participants).toEqual([]);
  });

  it("unread: false from fresh data correctly overwrites true (falsy but not nullish)", () => {
    const persisted = createThread("t1", "Subject", "snippet");
    persisted.unread = true;

    // false is falsy but not nullish, so ?? passes it through
    const merged = mergeThreadData(persisted, { unread: false });

    expect(merged.unread).toBe(false);
  });
});

describe("Real IndexedDB persistence", () => {
  it("persistThread + loadThread round-trip preserves all fields", async () => {
    const thread = createThread("t1", "Round Trip", "snippet here");
    thread.urgencyScore = 0.85;
    thread.valueScore = 0.6;
    thread.position = { x: 150, y: 250 };
    thread.targetPosition = { x: 200, y: 300 };
    thread.zone = "opportunities";
    thread.previousZone = "active-front";
    thread.driftVelocity = { dx: 0.5, dy: -1.2 };
    thread.clusterMembership = "cluster-a";
    thread.lifecycleState = "active";
    thread.stateHistory = [{ from: "new", to: "active", timestamp: 1000, trigger: "user-opened" }];
    thread.threadType = "warm-intro";
    thread.riskTier = "elevated";
    thread.opportunityState = "ripe";
    thread.opportunityWindowEnd = 99999;
    thread.visualState = "drifting";
    thread.userOverrideZone = true;
    thread.lastUserReplyTimestamp = 5000;
    thread.neglectDuration = 60000;
    thread.unread = false;
    thread.gmailLabels = ["INBOX", "STARRED"];
    thread.participants = [
      {
        displayName: "Bob",
        email: "bob@test.com",
        organization: "Acme",
        vipFlag: true,
        relationshipScore: 0.9,
        responseHistory: { avgResponseTimeMs: 500, threadFrequency: 3 },
      },
    ];

    await persistThread(thread);
    const loaded = await loadThread("t1");

    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe("t1");
    expect(loaded!.subject).toBe("Round Trip");
    expect(loaded!.snippet).toBe("snippet here");
    expect(loaded!.urgencyScore).toBe(0.85);
    expect(loaded!.valueScore).toBe(0.6);
    expect(loaded!.position).toEqual({ x: 150, y: 250 });
    expect(loaded!.targetPosition).toEqual({ x: 200, y: 300 });
    expect(loaded!.zone).toBe("opportunities");
    expect(loaded!.previousZone).toBe("active-front");
    expect(loaded!.driftVelocity).toEqual({ dx: 0.5, dy: -1.2 });
    expect(loaded!.clusterMembership).toBe("cluster-a");
    expect(loaded!.lifecycleState).toBe("active");
    expect(loaded!.stateHistory).toHaveLength(1);
    expect(loaded!.stateHistory[0]).toEqual({
      from: "new",
      to: "active",
      timestamp: 1000,
      trigger: "user-opened",
    });
    expect(loaded!.threadType).toBe("warm-intro");
    expect(loaded!.riskTier).toBe("elevated");
    expect(loaded!.opportunityState).toBe("ripe");
    expect(loaded!.opportunityWindowEnd).toBe(99999);
    expect(loaded!.visualState).toBe("drifting");
    expect(loaded!.userOverrideZone).toBe(true);
    expect(loaded!.lastUserReplyTimestamp).toBe(5000);
    expect(loaded!.neglectDuration).toBe(60000);
    expect(loaded!.unread).toBe(false);
    expect(loaded!.gmailLabels).toEqual(["INBOX", "STARRED"]);
    expect(loaded!.participants).toHaveLength(1);
    expect(loaded!.participants[0].displayName).toBe("Bob");
  });

  it("persistThreads bulk + loadAllThreads", async () => {
    const threads = [
      createThread("t1", "S1", "s1"),
      createThread("t2", "S2", "s2"),
      createThread("t3", "S3", "s3"),
    ];

    await persistThreads(threads);
    const all = await loadAllThreads();

    expect(all).toHaveLength(3);
    const ids = all.map((t) => t.id).sort();
    expect(ids).toEqual(["t1", "t2", "t3"]);
  });

  it("loadThreadsByZone index query", async () => {
    const t1 = createThread("t1", "S1", "s1");
    t1.zone = "active-front";
    const t2 = createThread("t2", "S2", "s2");
    t2.zone = "lost";
    const t3 = createThread("t3", "S3", "s3");
    t3.zone = "active-front";
    const t4 = createThread("t4", "S4", "s4");
    t4.zone = "opportunities";

    await persistThreads([t1, t2, t3, t4]);

    const activeFront = await loadThreadsByZone("active-front");
    expect(activeFront).toHaveLength(2);
    expect(activeFront.map((t) => t.id).sort()).toEqual(["t1", "t3"]);

    const lost = await loadThreadsByZone("lost");
    expect(lost).toHaveLength(1);
    expect(lost[0].id).toBe("t2");

    const opportunities = await loadThreadsByZone("opportunities");
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].id).toBe("t4");
  });

  it("deleteThread removes and subsequent loadThread returns undefined", async () => {
    const thread = createThread("t1", "Subject", "snippet");
    await persistThread(thread);

    await deleteThread("t1");
    const loaded = await loadThread("t1");

    expect(loaded).toBeUndefined();
  });

  it("getThreadCount accuracy", async () => {
    expect(await getThreadCount()).toBe(0);

    await persistThread(createThread("t1", "S1", "s1"));
    expect(await getThreadCount()).toBe(1);

    await persistThreads([createThread("t2", "S2", "s2"), createThread("t3", "S3", "s3")]);
    expect(await getThreadCount()).toBe(3);

    await deleteThread("t2");
    expect(await getThreadCount()).toBe(2);
  });

  it("deleteAllThreads clears everything", async () => {
    await persistThreads([
      createThread("t1", "S1", "s1"),
      createThread("t2", "S2", "s2"),
      createThread("t3", "S3", "s3"),
    ]);
    expect(await getThreadCount()).toBe(3);

    await deleteAllThreads();
    expect(await getThreadCount()).toBe(0);

    const all = await loadAllThreads();
    expect(all).toEqual([]);
  });

  it("loadThread returns undefined for non-existent thread", async () => {
    const loaded = await loadThread("nonexistent");
    expect(loaded).toBeUndefined();
  });
});

describe("Thread removal reconciliation", () => {
  it("removes threads deleted from Gmail during reconciliation", async () => {
    // Persist 5 threads
    const threads = [
      createThread("t1", "S1", "s1"),
      createThread("t2", "S2", "s2"),
      createThread("t3", "S3", "s3"),
      createThread("t4", "S4", "s4"),
      createThread("t5", "S5", "s5"),
    ];
    await persistThreads(threads);
    expect(await getThreadCount()).toBe(5);

    // Gmail returns only 3 thread IDs
    const gmailThreadIds = new Set(["t1", "t3", "t5"]);

    // Find and delete threads missing from Gmail
    const allPersisted = await loadAllThreads();
    const toDelete = allPersisted.filter((t) => !gmailThreadIds.has(t.id));
    for (const t of toDelete) {
      await deleteThread(t.id);
    }

    // Verify only 3 remain
    expect(await getThreadCount()).toBe(3);
    const remaining = await loadAllThreads();
    const remainingIds = remaining.map((t) => t.id).sort();
    expect(remainingIds).toEqual(["t1", "t3", "t5"]);

    // Verify the deleted ones are gone
    expect(await loadThread("t2")).toBeUndefined();
    expect(await loadThread("t4")).toBeUndefined();
  });
});
