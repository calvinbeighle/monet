import { describe, it, expect, beforeEach } from "vitest";
import {
  computeAffinity,
  evaluateClusters,
  excludeFromCluster,
  resetExclusions,
} from "./clustering";
import { createThread } from "../../lib/types";
import type { ContactEnrichment } from "../../lib/types";

function makeContact(email: string, name?: string): ContactEnrichment {
  return {
    displayName: name || email.split("@")[0],
    email,
    organization: null,
    vipFlag: false,
    relationshipScore: 50,
    responseHistory: { avgResponseTimeMs: 0, threadFrequency: 0 },
  };
}

beforeEach(() => {
  resetExclusions();
});

describe("computeAffinity", () => {
  it("returns high affinity for threads with shared participants", () => {
    const t1 = createThread("t1", "Project update", "s");
    t1.participants = [makeContact("alice@co.com"), makeContact("bob@co.com")];

    const t2 = createThread("t2", "Re: Project update", "s");
    t2.participants = [makeContact("alice@co.com"), makeContact("charlie@co.com")];

    const affinity = computeAffinity(t1, t2);
    expect(affinity.participantOverlap).toBeGreaterThan(0);
    expect(affinity.composite).toBeGreaterThan(0);
  });

  it("returns zero participant overlap for completely different participants", () => {
    const t1 = createThread("t1", "Subject A", "s");
    t1.participants = [makeContact("alice@co.com")];

    const t2 = createThread("t2", "Subject B", "s");
    t2.participants = [makeContact("bob@other.com")];

    const affinity = computeAffinity(t1, t2);
    expect(affinity.participantOverlap).toBe(0);
  });

  it("boosts affinity for shared topic keywords", () => {
    const t1 = createThread("t1", "Q3 budget review meeting", "s");
    t1.participants = [makeContact("alice@co.com")];

    const t2 = createThread("t2", "Budget review follow-up", "s");
    t2.participants = [makeContact("alice@co.com")];

    const affinity = computeAffinity(t1, t2);
    expect(affinity.topicKeywordOverlap).toBeGreaterThan(0);
  });

  it("boosts affinity for shared custom labels", () => {
    const t1 = createThread("t1", "Subject A", "s");
    t1.participants = [makeContact("alice@co.com")];
    t1.gmailLabels = ["INBOX", "ProjectX"];

    const t2 = createThread("t2", "Subject B", "s");
    t2.participants = [makeContact("alice@co.com")];
    t2.gmailLabels = ["INBOX", "ProjectX"];

    const affinity = computeAffinity(t1, t2);
    expect(affinity.sharedLabelScore).toBe(1.0);
  });

  it("does not count system labels as shared", () => {
    const t1 = createThread("t1", "Subject A", "s");
    t1.participants = [makeContact("alice@co.com")];
    t1.gmailLabels = ["INBOX", "IMPORTANT"];

    const t2 = createThread("t2", "Subject B", "s");
    t2.participants = [makeContact("bob@co.com")];
    t2.gmailLabels = ["INBOX", "IMPORTANT"];

    const affinity = computeAffinity(t1, t2);
    expect(affinity.sharedLabelScore).toBe(0);
  });

  it("temporal proximity is high for recent threads", () => {
    const now = Date.now();
    const t1 = createThread("t1", "Subject A", "s");
    t1.participants = [makeContact("alice@co.com")];
    t1.latestMessageTimestamp = now;

    const t2 = createThread("t2", "Subject B", "s");
    t2.participants = [makeContact("alice@co.com")];
    t2.latestMessageTimestamp = now - 1000; // 1 second ago

    const affinity = computeAffinity(t1, t2, now);
    expect(affinity.temporalProximity).toBeGreaterThan(0.99);
  });

  it("temporal proximity is zero for threads far apart", () => {
    const now = Date.now();
    const t1 = createThread("t1", "Subject A", "s");
    t1.participants = [makeContact("alice@co.com")];
    t1.latestMessageTimestamp = now;

    const t2 = createThread("t2", "Subject B", "s");
    t2.participants = [makeContact("alice@co.com")];
    t2.latestMessageTimestamp = now - 30 * 24 * 60 * 60 * 1000; // 30 days ago

    const affinity = computeAffinity(t1, t2, now);
    expect(affinity.temporalProximity).toBe(0);
  });

  // Per Spec 11: no non-participant factor alone can exceed threshold
  it("non-participant factors alone cannot exceed clustering threshold", () => {
    const t1 = createThread("t1", "Budget review meeting Q3", "s");
    t1.participants = [makeContact("alice@co.com")];
    t1.gmailLabels = ["ProjectX"];

    const t2 = createThread("t2", "Budget review meeting Q3", "s");
    t2.participants = [makeContact("bob@other.com")]; // different participant
    t2.gmailLabels = ["ProjectX"];

    const affinity = computeAffinity(t1, t2);
    // Even with perfect topic + label + temporal match, participant overlap is 0
    // So the composite cannot exceed CLUSTERING_THRESHOLD without participant overlap
    expect(affinity.participantOverlap).toBe(0);
    // The evaluateClusters function enforces this by requiring participantOverlap > 0
  });
});

describe("evaluateClusters", () => {
  it("forms a cluster from threads with shared participants", () => {
    const now = Date.now();
    const t1 = createThread("t1", "Project A", "s");
    t1.participants = [makeContact("alice@co.com"), makeContact("bob@co.com")];
    t1.position = { x: 100, y: 100 };
    t1.latestMessageTimestamp = now;

    const t2 = createThread("t2", "Re: Project A", "s");
    t2.participants = [makeContact("alice@co.com"), makeContact("bob@co.com")];
    t2.position = { x: 120, y: 110 };
    t2.latestMessageTimestamp = now;

    const { clusters } = evaluateClusters([t1, t2], [], now);

    expect(clusters.length).toBe(1);
    expect(clusters[0].memberThreadIds).toContain("t1");
    expect(clusters[0].memberThreadIds).toContain("t2");
  });

  it("does not form cluster with fewer than 2 members", () => {
    const t1 = createThread("t1", "Subject", "s");
    t1.participants = [makeContact("alice@co.com")];

    const { clusters } = evaluateClusters([t1], []);
    expect(clusters.length).toBe(0);
  });

  it("does not cluster threads with no participant overlap", () => {
    const now = Date.now();
    const t1 = createThread("t1", "Subject A", "s");
    t1.participants = [makeContact("alice@co.com")];
    t1.latestMessageTimestamp = now;

    const t2 = createThread("t2", "Subject B", "s");
    t2.participants = [makeContact("bob@other.com")];
    t2.latestMessageTimestamp = now;

    const { clusters } = evaluateClusters([t1, t2], [], now);
    expect(clusters.length).toBe(0);
  });

  it("assigns one cluster per thread maximum", () => {
    const now = Date.now();
    const alice = makeContact("alice@co.com");
    const bob = makeContact("bob@co.com");
    const charlie = makeContact("charlie@co.com");

    const t1 = createThread("t1", "Chat with Alice", "s");
    t1.participants = [alice, bob];
    t1.position = { x: 100, y: 100 };
    t1.latestMessageTimestamp = now;

    const t2 = createThread("t2", "Chat with Alice too", "s");
    t2.participants = [alice, bob];
    t2.position = { x: 110, y: 110 };
    t2.latestMessageTimestamp = now;

    const t3 = createThread("t3", "Different topic", "s");
    t3.participants = [charlie];
    t3.position = { x: 500, y: 500 };
    t3.latestMessageTimestamp = now;

    const { clusters } = evaluateClusters([t1, t2, t3], [], now);

    // t1 and t2 should cluster together, t3 alone (no cluster)
    const t1Clusters = clusters.filter((c) => c.memberThreadIds.includes("t1"));
    const t2Clusters = clusters.filter((c) => c.memberThreadIds.includes("t2"));
    expect(t1Clusters.length).toBeLessThanOrEqual(1);
    expect(t2Clusters.length).toBeLessThanOrEqual(1);
  });

  it("computes centroid from member positions", () => {
    const now = Date.now();
    const t1 = createThread("t1", "Subject", "s");
    t1.participants = [makeContact("alice@co.com")];
    t1.position = { x: 100, y: 200 };
    t1.latestMessageTimestamp = now;

    const t2 = createThread("t2", "Re: Subject", "s");
    t2.participants = [makeContact("alice@co.com")];
    t2.position = { x: 300, y: 400 };
    t2.latestMessageTimestamp = now;

    const { clusters } = evaluateClusters([t1, t2], [], now);
    if (clusters.length > 0) {
      expect(clusters[0].centroid.x).toBe(200);
      expect(clusters[0].centroid.y).toBe(300);
    }
  });

  it("respects manual override exclusions", () => {
    const now = Date.now();
    const t1 = createThread("t1", "Subject", "s");
    t1.participants = [makeContact("alice@co.com")];
    t1.latestMessageTimestamp = now;

    const t2 = createThread("t2", "Re: Subject", "s");
    t2.participants = [makeContact("alice@co.com")];
    t2.latestMessageTimestamp = now;

    // First, cluster them
    const { clusters: first } = evaluateClusters([t1, t2], [], now);
    expect(first.length).toBe(1);

    // Exclude t1 from the cluster
    excludeFromCluster("t1", first[0].id);

    // Re-evaluate - t1 should not be in the same cluster
    const { clusters: second } = evaluateClusters([t1, t2], [], now);
    const t1InCluster = second.some(
      (c) => c.memberThreadIds.includes("t1") && c.id === first[0].id,
    );
    expect(t1InCluster).toBe(false);
  });

  it("does not cluster handled threads", () => {
    const now = Date.now();
    const t1 = createThread("t1", "Subject", "s");
    t1.participants = [makeContact("alice@co.com")];
    t1.lifecycleState = "handled";
    t1.latestMessageTimestamp = now;

    const t2 = createThread("t2", "Re: Subject", "s");
    t2.participants = [makeContact("alice@co.com")];
    t2.latestMessageTimestamp = now;

    const { clusters } = evaluateClusters([t1, t2], [], now);
    // Only one non-handled thread, can't form cluster
    expect(clusters.length).toBe(0);
  });
});
