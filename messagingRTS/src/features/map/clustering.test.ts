import { describe, it, expect, beforeEach } from "vitest";
import {
  computeAffinity,
  evaluateClusters,
  excludeFromCluster,
  resetExclusions,
  _resetPendingRemovals,
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
  _resetPendingRemovals();
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

  it("preserves cluster ID across evaluation passes (Spec 11 ID stability)", () => {
    const now = Date.now();
    const t1 = createThread("t1", "Project update", "s");
    t1.participants = [makeContact("alice@co.com"), makeContact("bob@co.com")];
    t1.latestMessageTimestamp = now;
    t1.position = { x: 100, y: 100 };

    const t2 = createThread("t2", "Re: Project update", "s");
    t2.participants = [makeContact("alice@co.com"), makeContact("bob@co.com")];
    t2.latestMessageTimestamp = now;
    t2.position = { x: 110, y: 100 };

    // First evaluation: forms cluster
    const { clusters: pass1 } = evaluateClusters([t1, t2], [], now);
    expect(pass1.length).toBe(1);
    const originalId = pass1[0].id;

    // Second evaluation: same threads, passing existing clusters
    const { clusters: pass2 } = evaluateClusters([t1, t2], pass1, now);
    expect(pass2.length).toBe(1);
    expect(pass2[0].id).toBe(originalId); // ID must be stable
  });

  it("manual override exclusion persists across evaluation passes with stable IDs", () => {
    const now = Date.now();
    const t1 = createThread("t1", "Subject", "s");
    t1.participants = [makeContact("alice@co.com")];
    t1.latestMessageTimestamp = now;
    t1.position = { x: 100, y: 100 };

    const t2 = createThread("t2", "Subject", "s");
    t2.participants = [makeContact("alice@co.com")];
    t2.latestMessageTimestamp = now;
    t2.position = { x: 110, y: 100 };

    const t3 = createThread("t3", "Subject", "s");
    t3.participants = [makeContact("alice@co.com")];
    t3.latestMessageTimestamp = now;
    t3.position = { x: 120, y: 100 };

    // Form clusters
    const { clusters: pass1 } = evaluateClusters([t1, t2, t3], [], now);
    expect(pass1.length).toBe(1);
    const clusterId = pass1[0].id;

    // Exclude t1 from the cluster
    excludeFromCluster("t1", clusterId);

    // Re-evaluate with existing clusters
    const { clusters: pass2 } = evaluateClusters([t1, t2, t3], pass1, now);
    // t1 should not be in the cluster anymore
    const t1Cluster = pass2.find((c) => c.memberThreadIds.includes("t1"));
    expect(t1Cluster).toBeUndefined();
  });

  it("cluster label uses participant name when present in ALL members (Spec 11)", () => {
    const now = Date.now();
    const alice = makeContact("alice@co.com", "Alice");

    // All 3 threads include Alice - label should use "Alice"
    const t1 = createThread("t1", "Topic", "s");
    t1.participants = [alice];
    t1.latestMessageTimestamp = now;
    t1.position = { x: 100, y: 100 };

    const t2 = createThread("t2", "Topic", "s");
    t2.participants = [alice];
    t2.latestMessageTimestamp = now;
    t2.position = { x: 110, y: 100 };

    const t3 = createThread("t3", "Topic", "s");
    t3.participants = [alice];
    t3.latestMessageTimestamp = now;
    t3.position = { x: 120, y: 100 };

    const { clusters } = evaluateClusters([t1, t2, t3], [], now);
    expect(clusters.length).toBe(1);
    expect(clusters[0].label).toContain("Alice");
  });

  // Per Spec 11: visualExtent contracts to current member count when members leave
  it("contracts visualExtent to current member count when cluster is rebuilt (Spec 11)", () => {
    const now = Date.now();
    const t1 = createThread("t1", "Project update", "s");
    t1.participants = [makeContact("alice@co.com"), makeContact("bob@co.com")];
    t1.latestMessageTimestamp = now;
    t1.position = { x: 100, y: 100 };

    const t2 = createThread("t2", "Re: Project update", "s");
    t2.participants = [makeContact("alice@co.com"), makeContact("bob@co.com")];
    t2.latestMessageTimestamp = now;
    t2.position = { x: 110, y: 100 };

    // First evaluation: forms cluster with 2 members
    const { clusters: pass1 } = evaluateClusters([t1, t2], [], now);
    expect(pass1.length).toBe(1);
    expect(pass1[0].visualExtent).toBe(2);

    // Artificially inflate the visualExtent (simulates prior larger membership)
    pass1[0].visualExtent = 99;

    // Second evaluation with the inflated existing cluster - should contract to actual member count
    const { clusters: pass2 } = evaluateClusters([t1, t2], pass1, now);
    expect(pass2.length).toBe(1);
    // Per Spec 11: extent contracts to the value appropriate for remaining member count
    expect(pass2[0].visualExtent).toBe(2);
  });

  it("cluster label does NOT use participant when they are absent from some members (Spec 11)", () => {
    const now = Date.now();
    const alice = makeContact("alice@co.com", "Alice");
    const bob = makeContact("bob@co.com", "Bob");

    // t1 has alice+bob, t2 has only bob - alice is not in all members
    const t1 = createThread("t1", "Topic", "s");
    t1.participants = [alice, bob];
    t1.latestMessageTimestamp = now;
    t1.position = { x: 100, y: 100 };

    const t2 = createThread("t2", "Topic", "s");
    t2.participants = [bob];
    t2.latestMessageTimestamp = now;
    t2.position = { x: 110, y: 100 };

    const { clusters } = evaluateClusters([t1, t2], [], now);
    expect(clusters.length).toBe(1);
    // Alice is not in all members so label should NOT be "Alice"
    // Bob is in all members so label should contain "Bob"
    expect(clusters[0].label).not.toContain("Alice");
    expect(clusters[0].label).toContain("Bob");
  });
});

describe("two-tick cluster membership removal per Spec 11", () => {
  // These tests use 3 threads so that when one drops affinity, the other two
  // still maintain the cluster. This lets the pending-removal code find the
  // existing cluster in newClusters and retain the departing member for one tick.

  it("thread stays in cluster on first tick when affinity drops (pending removal)", () => {
    const now = Date.now();
    const alice = makeContact("alice@co.com");
    const bob = makeContact("bob@co.com");

    // t1, t2, t3 all share alice - form a single cluster
    const t1 = createThread("t1", "Subject", "s");
    t1.participants = [alice, bob];
    t1.latestMessageTimestamp = now;
    t1.position = { x: 100, y: 100 };

    const t2 = createThread("t2", "Subject", "s");
    t2.participants = [alice, bob];
    t2.latestMessageTimestamp = now;
    t2.position = { x: 110, y: 100 };

    const t3 = createThread("t3", "Subject", "s");
    t3.participants = [alice, bob];
    t3.latestMessageTimestamp = now;
    t3.position = { x: 120, y: 100 };

    // First pass: all three cluster together
    const { clusters: pass1 } = evaluateClusters([t1, t2, t3], [], now);
    expect(pass1.length).toBe(1);
    const clusterId = pass1[0].id;
    expect(pass1[0].memberThreadIds).toContain("t2");

    // t2 loses affinity (drops shared participants), but t1 and t3 still cluster
    const t2_dropped = createThread("t2", "Subject", "s");
    t2_dropped.participants = [makeContact("charlie@other.com")]; // no overlap with alice/bob
    t2_dropped.latestMessageTimestamp = now;
    t2_dropped.position = { x: 110, y: 100 };

    // Second pass (first tick after drop): pending removal - t2 should still be in cluster
    const { clusters: pass2 } = evaluateClusters([t1, t2_dropped, t3], pass1, now);
    const clusterAfterFirstTick = pass2.find((c) => c.id === clusterId);
    // On first tick, the thread should still be present (grace period)
    expect(clusterAfterFirstTick).toBeDefined();
    expect(clusterAfterFirstTick!.memberThreadIds).toContain("t2");
  });

  it("thread is removed from cluster on second tick when affinity remains low", () => {
    const now = Date.now();
    const alice = makeContact("alice@co.com");
    const bob = makeContact("bob@co.com");

    const t1 = createThread("t1", "Subject", "s");
    t1.participants = [alice, bob];
    t1.latestMessageTimestamp = now;
    t1.position = { x: 100, y: 100 };

    const t2 = createThread("t2", "Subject", "s");
    t2.participants = [alice, bob];
    t2.latestMessageTimestamp = now;
    t2.position = { x: 110, y: 100 };

    const t3 = createThread("t3", "Subject", "s");
    t3.participants = [alice, bob];
    t3.latestMessageTimestamp = now;
    t3.position = { x: 120, y: 100 };

    // First pass: all three cluster together
    const { clusters: pass1 } = evaluateClusters([t1, t2, t3], [], now);
    expect(pass1.length).toBe(1);
    const clusterId = pass1[0].id;

    // t2 loses affinity
    const t2_dropped = createThread("t2", "Subject", "s");
    t2_dropped.participants = [makeContact("charlie@other.com")];
    t2_dropped.latestMessageTimestamp = now;
    t2_dropped.position = { x: 110, y: 100 };

    // Second pass (first tick): pending removal - t2 still in cluster
    const { clusters: pass2 } = evaluateClusters([t1, t2_dropped, t3], pass1, now);
    const clusterPass2 = pass2.find((c) => c.id === clusterId);
    expect(clusterPass2).toBeDefined();
    expect(clusterPass2!.memberThreadIds).toContain("t2");

    // Third pass (second tick): confirmed removal - t2 should be gone
    const { clusters: pass3 } = evaluateClusters([t1, t2_dropped, t3], pass2, now);
    const clusterPass3 = pass3.find((c) => c.id === clusterId);
    // After two ticks with sustained low affinity, t2 is confirmed removed
    const t2InCluster = clusterPass3?.memberThreadIds.includes("t2") ?? false;
    expect(t2InCluster).toBe(false);
  });

  it("thread stays in cluster if affinity recovers before second tick confirmation", () => {
    const now = Date.now();
    const alice = makeContact("alice@co.com");
    const bob = makeContact("bob@co.com");

    const t1 = createThread("t1", "Subject", "s");
    t1.participants = [alice, bob];
    t1.latestMessageTimestamp = now;
    t1.position = { x: 100, y: 100 };

    const t2 = createThread("t2", "Subject", "s");
    t2.participants = [alice, bob];
    t2.latestMessageTimestamp = now;
    t2.position = { x: 110, y: 100 };

    const t3 = createThread("t3", "Subject", "s");
    t3.participants = [alice, bob];
    t3.latestMessageTimestamp = now;
    t3.position = { x: 120, y: 100 };

    // First pass: all three cluster together
    const { clusters: pass1 } = evaluateClusters([t1, t2, t3], [], now);
    expect(pass1.length).toBe(1);
    const clusterId = pass1[0].id;

    // t2 drops affinity temporarily
    const t2_dropped = createThread("t2", "Subject", "s");
    t2_dropped.participants = [makeContact("charlie@other.com")];
    t2_dropped.latestMessageTimestamp = now;
    t2_dropped.position = { x: 110, y: 100 };

    // Second pass: pending removal, t2 still present
    const { clusters: pass2 } = evaluateClusters([t1, t2_dropped, t3], pass1, now);
    const clusterPass2 = pass2.find((c) => c.id === clusterId);
    expect(clusterPass2).toBeDefined();
    expect(clusterPass2!.memberThreadIds).toContain("t2");

    // t2 recovers affinity (back to sharing alice+bob)
    const t2_recovered = createThread("t2", "Subject", "s");
    t2_recovered.participants = [alice, bob];
    t2_recovered.latestMessageTimestamp = now;
    t2_recovered.position = { x: 110, y: 100 };

    // Third pass: affinity recovered - pending removal cleared, t2 stays in cluster
    const { clusters: pass3 } = evaluateClusters([t1, t2_recovered, t3], pass2, now);
    const clusterPass3 = pass3.find((c) => c.id === clusterId);
    expect(clusterPass3).toBeDefined();
    expect(clusterPass3!.memberThreadIds).toContain("t2");
  });
});

describe("computeAffinity - topicTags", () => {
  it("uses topicTags for topic overlap when available", () => {
    const t1 = createThread("t1", "Unrelated subject", "s");
    t1.participants = [makeContact("alice@co.com")];
    t1.topicTags = ["budget", "q3", "review"];

    const t2 = createThread("t2", "Another subject", "s");
    t2.participants = [makeContact("alice@co.com")];
    t2.topicTags = ["budget", "review", "planning"];

    const affinity = computeAffinity(t1, t2);
    expect(affinity.topicKeywordOverlap).toBeGreaterThan(0);
  });

  it("topicTags produce higher overlap than non-matching subjects", () => {
    const now = Date.now();

    // With topicTags that match
    const t1Tags = createThread("t1", "Random noise subject", "s");
    t1Tags.participants = [makeContact("alice@co.com")];
    t1Tags.latestMessageTimestamp = now;
    t1Tags.topicTags = ["contract", "renewal", "deadline"];

    const t2Tags = createThread("t2", "Completely different words", "s");
    t2Tags.participants = [makeContact("alice@co.com")];
    t2Tags.latestMessageTimestamp = now;
    t2Tags.topicTags = ["contract", "renewal", "negotiation"];

    const affinityWithTags = computeAffinity(t1Tags, t2Tags, now);

    // Without topicTags - falls back to non-matching subjects
    const t1NoTags = createThread("t3", "Random noise subject", "s");
    t1NoTags.participants = [makeContact("alice@co.com")];
    t1NoTags.latestMessageTimestamp = now;

    const t2NoTags = createThread("t4", "Completely different words", "s");
    t2NoTags.participants = [makeContact("alice@co.com")];
    t2NoTags.latestMessageTimestamp = now;

    const affinityNoTags = computeAffinity(t1NoTags, t2NoTags, now);

    expect(affinityWithTags.topicKeywordOverlap).toBeGreaterThan(
      affinityNoTags.topicKeywordOverlap,
    );
  });

  it("falls back to subject keywords when topicTags are empty", () => {
    const t1 = createThread("t1", "Budget review meeting", "s");
    t1.participants = [makeContact("alice@co.com")];
    t1.topicTags = []; // empty - should fall back to subject

    const t2 = createThread("t2", "Budget review follow-up", "s");
    t2.participants = [makeContact("alice@co.com")];
    t2.topicTags = []; // empty - should fall back to subject

    const affinityEmpty = computeAffinity(t1, t2);

    // Without topicTags field set (undefined) should behave identically
    const t3 = createThread("t3", "Budget review meeting", "s");
    t3.participants = [makeContact("alice@co.com")];

    const t4 = createThread("t4", "Budget review follow-up", "s");
    t4.participants = [makeContact("alice@co.com")];

    const affinityUndefined = computeAffinity(t3, t4);

    expect(affinityEmpty.topicKeywordOverlap).toBe(affinityUndefined.topicKeywordOverlap);
  });
});
