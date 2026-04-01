// Thread clustering engine per Spec 11
// Affinity calculation, cluster formation/dissolution, membership management

import type { Thread, Position } from "../../lib/types";
import type { Cluster, AffinityScore } from "../../lib/types/cluster";

// Affinity component weights per Spec 11 (participant overlap is strongest)
const WEIGHT_PARTICIPANT = 0.5;
const WEIGHT_TOPIC = 0.2;
const WEIGHT_LABEL = 0.15;
const WEIGHT_TEMPORAL = 0.15;

// Clustering threshold - composite score must be at or above this to form/maintain cluster
const CLUSTERING_THRESHOLD = 0.3;

// Temporal proximity: recency window for proximity scoring
const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Per Spec 11: "No non-participant factor alone can produce a composite score
// that exceeds the clustering threshold"
// This is enforced by requiring participantOverlap > 0 for cluster membership.

let clusterIdCounter = 0;

function generateClusterId(): string {
  return `cluster-${++clusterIdCounter}`;
}

// Compute affinity between two threads
export function computeAffinity(a: Thread, b: Thread, _now: number = Date.now()): AffinityScore {
  const participantOverlap = computeParticipantOverlap(a, b);
  const topicKeywordOverlap = computeTopicOverlap(a, b);
  const sharedLabelScore = computeSharedLabels(a, b);
  const temporalProximity = computeTemporalProximity(a, b);

  const composite =
    participantOverlap * WEIGHT_PARTICIPANT +
    topicKeywordOverlap * WEIGHT_TOPIC +
    sharedLabelScore * WEIGHT_LABEL +
    temporalProximity * WEIGHT_TEMPORAL;

  return {
    participantOverlap,
    topicKeywordOverlap,
    sharedLabelScore,
    temporalProximity,
    composite,
  };
}

// Fraction of shared email addresses relative to combined unique set
function computeParticipantOverlap(a: Thread, b: Thread): number {
  const emailsA = new Set(a.participants.map((p) => p.email));
  const emailsB = new Set(b.participants.map((p) => p.email));
  if (emailsA.size === 0 && emailsB.size === 0) return 0;

  let shared = 0;
  for (const email of emailsA) {
    if (emailsB.has(email)) shared++;
  }

  const union = new Set([...emailsA, ...emailsB]).size;
  return union > 0 ? shared / union : 0;
}

// Topic keyword overlap from subjects (normalized)
function computeTopicOverlap(a: Thread, b: Thread): number {
  const wordsA = extractKeywords(a.subject);
  const wordsB = extractKeywords(b.subject);
  if (wordsA.size === 0 && wordsB.size === 0) return 0;

  let shared = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) shared++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? shared / union : 0;
}

const STOP_WORDS = new Set([
  "re",
  "fwd",
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "be",
  "to",
  "of",
  "and",
  "in",
  "for",
  "on",
  "at",
]);

export function extractKeywords(subject: string): Set<string> {
  return new Set(
    subject
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

// Shared label score (user-applied labels, not system labels)
function computeSharedLabels(a: Thread, b: Thread): number {
  const systemLabels = new Set([
    "INBOX",
    "SENT",
    "DRAFT",
    "TRASH",
    "SPAM",
    "UNREAD",
    "STARRED",
    "IMPORTANT",
  ]);
  const labelsA = new Set(a.gmailLabels.filter((l) => !systemLabels.has(l)));
  const labelsB = new Set(b.gmailLabels.filter((l) => !systemLabels.has(l)));
  if (labelsA.size === 0 && labelsB.size === 0) return 0;

  let shared = 0;
  for (const label of labelsA) {
    if (labelsB.has(label)) shared++;
  }

  return shared > 0 ? 1.0 : 0;
}

// Temporal proximity based on most recent activity
function computeTemporalProximity(a: Thread, b: Thread): number {
  const timeDiff = Math.abs(a.latestMessageTimestamp - b.latestMessageTimestamp);
  if (timeDiff >= RECENCY_WINDOW_MS) return 0;
  return 1.0 - timeDiff / RECENCY_WINDOW_MS;
}

// Compute centroid from member positions
function computeCentroid(threads: Thread[]): Position {
  if (threads.length === 0) return { x: 0, y: 0 };
  const sum = threads.reduce((acc, t) => ({ x: acc.x + t.position.x, y: acc.y + t.position.y }), {
    x: 0,
    y: 0,
  });
  return { x: sum.x / threads.length, y: sum.y / threads.length };
}

// Derive cluster label from common subject terms or participant names
function deriveLabel(threads: Thread[]): string {
  // Try common participants first
  const participantCounts = new Map<string, number>();
  for (const t of threads) {
    for (const p of t.participants) {
      const name = p.displayName || p.email;
      participantCounts.set(name, (participantCounts.get(name) || 0) + 1);
    }
  }

  // Find participant appearing in most threads
  let bestParticipant = "";
  let bestCount = 0;
  for (const [name, count] of participantCounts) {
    if (count > bestCount) {
      bestCount = count;
      bestParticipant = name;
    }
  }

  if (bestCount >= 2 && bestParticipant) {
    return bestParticipant;
  }

  // Fall back to common subject terms
  const wordCounts = new Map<string, number>();
  for (const t of threads) {
    const words = extractKeywords(t.subject);
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }
  }

  let bestWord = "";
  let bestWordCount = 0;
  for (const [word, count] of wordCounts) {
    if (count > bestWordCount) {
      bestWordCount = count;
      bestWord = word;
    }
  }

  return bestWord || "cluster";
}

// Set of thread IDs excluded from rejoining specific clusters (manual override)
const overrideExclusions = new Map<string, Set<string>>(); // threadId -> Set<clusterId>

// Main clustering evaluation function
// Called on: new thread arrival, thread data change, tick cycle completion
export function evaluateClusters(
  threads: Thread[],
  existingClusters: Cluster[],
  now: number = Date.now(),
): { clusters: Cluster[]; threadUpdates: Map<string, string | null> } {
  const threadMap = new Map(threads.map((t) => [t.id, t]));
  const threadUpdates = new Map<string, string | null>();

  // Build current cluster membership and index for ID reuse
  const memberOf = new Map<string, string>(); // threadId -> clusterId
  const existingClusterMembers = new Map<string, Set<string>>(); // clusterId -> Set<threadId>
  for (const cluster of existingClusters) {
    existingClusterMembers.set(cluster.id, new Set(cluster.memberThreadIds));
    for (const threadId of cluster.memberThreadIds) {
      memberOf.set(threadId, cluster.id);
    }
  }

  // Evaluate all pairs for affinity
  const affinityPairs: Array<{ a: string; b: string; score: AffinityScore }> = [];
  const threadList = threads.filter((t) => t.lifecycleState !== "handled");

  for (let i = 0; i < threadList.length; i++) {
    for (let j = i + 1; j < threadList.length; j++) {
      const score = computeAffinity(threadList[i], threadList[j], now);
      if (score.composite >= CLUSTERING_THRESHOLD && score.participantOverlap > 0) {
        affinityPairs.push({ a: threadList[i].id, b: threadList[j].id, score });
      }
    }
  }

  // Sort by composite score descending - strongest affinities first
  affinityPairs.sort((x, y) => y.score.composite - x.score.composite);

  // Build new clusters using greedy assignment
  // Track which existing cluster IDs have been reused to avoid double-assignment
  // Per Spec 11: only active (2+ member) cluster IDs can be reused; dissolved IDs are retired
  const activeClusterIds = new Set(
    existingClusters.filter((c) => c.memberThreadIds.length >= 2).map((c) => c.id),
  );
  const usedExistingIds = new Set<string>();
  const newClusters: Cluster[] = [];
  const assigned = new Set<string>();

  for (const pair of affinityPairs) {
    const clusterA = assigned.has(pair.a) ? findCluster(newClusters, pair.a) : null;
    const clusterB = assigned.has(pair.b) ? findCluster(newClusters, pair.b) : null;

    // Check override exclusions
    if (clusterA && isExcluded(pair.b, clusterA.id)) continue;
    if (clusterB && isExcluded(pair.a, clusterB.id)) continue;

    if (!clusterA && !clusterB) {
      // Neither assigned - create new cluster
      // Try to reuse an existing cluster ID if these threads were previously clustered together
      const reuseId = findExistingClusterId(
        existingClusterMembers,
        usedExistingIds,
        activeClusterIds,
        pair.a,
        pair.b,
      );
      if (reuseId && (isExcluded(pair.a, reuseId) || isExcluded(pair.b, reuseId))) continue;
      if (!reuseId && (isExcluded(pair.a, "") || isExcluded(pair.b, ""))) continue;

      const clusterId = reuseId ?? generateClusterId();
      if (reuseId) usedExistingIds.add(reuseId);

      const membersData = [threadMap.get(pair.a)!, threadMap.get(pair.b)!];
      const existingForTimestamp = reuseId
        ? existingClusters.find((c) => c.id === reuseId)
        : undefined;
      const cluster: Cluster = {
        id: clusterId,
        memberThreadIds: [pair.a, pair.b],
        centroid: computeCentroid(membersData),
        label: deriveLabel(membersData),
        visualExtent: 2,
        formationTimestamp: existingForTimestamp?.formationTimestamp ?? now,
        lastMembershipChange: now,
      };
      newClusters.push(cluster);
      assigned.add(pair.a);
      assigned.add(pair.b);
    } else if (clusterA && !clusterB) {
      // Add B to A's cluster (one cluster per thread max)
      clusterA.memberThreadIds.push(pair.b);
      assigned.add(pair.b);
      const membersData = clusterA.memberThreadIds.map((id) => threadMap.get(id)!).filter(Boolean);
      clusterA.centroid = computeCentroid(membersData);
      clusterA.label = deriveLabel(membersData);
      // Per Spec 11: extent does not decrease unless member count decreases (high-water mark)
      clusterA.visualExtent = Math.max(clusterA.visualExtent, clusterA.memberThreadIds.length);
      clusterA.lastMembershipChange = now;
    } else if (!clusterA && clusterB) {
      // Add A to B's cluster
      clusterB.memberThreadIds.push(pair.a);
      assigned.add(pair.a);
      const membersData = clusterB.memberThreadIds.map((id) => threadMap.get(id)!).filter(Boolean);
      clusterB.centroid = computeCentroid(membersData);
      clusterB.label = deriveLabel(membersData);
      // Per Spec 11: extent does not decrease unless member count decreases (high-water mark)
      clusterB.visualExtent = Math.max(clusterB.visualExtent, clusterB.memberThreadIds.length);
      clusterB.lastMembershipChange = now;
    }
    // Both assigned to different clusters - don't merge (one cluster per thread)
  }

  // Remove clusters with fewer than 2 members per Spec 11
  const validClusters = newClusters.filter((c) => c.memberThreadIds.length >= 2);

  // Update thread cluster membership
  for (const thread of threads) {
    const cluster = findCluster(validClusters, thread.id);
    const newClusterId = cluster?.id ?? null;
    const oldClusterId = thread.clusterMembership;

    if (newClusterId !== oldClusterId) {
      threadUpdates.set(thread.id, newClusterId);
    }
  }

  return { clusters: validClusters, threadUpdates };
}

// Find an existing cluster ID that contains both threads (for ID stability across evaluations)
// Per Spec 11: dissolved cluster identifiers are not reused; only reuse IDs for clusters
// that are still active (2+ members) in the current evaluation
function findExistingClusterId(
  existingClusterMembers: Map<string, Set<string>>,
  usedIds: Set<string>,
  activeClusterIds: Set<string>,
  threadA: string,
  threadB: string,
): string | null {
  for (const [clusterId, members] of existingClusterMembers) {
    if (usedIds.has(clusterId)) continue;
    // Only reuse IDs of clusters that are still active (not dissolved)
    if (!activeClusterIds.has(clusterId)) continue;
    if (members.has(threadA) && members.has(threadB)) {
      return clusterId;
    }
  }
  // Also check if either thread was in an active existing cluster (partial overlap)
  for (const [clusterId, members] of existingClusterMembers) {
    if (usedIds.has(clusterId)) continue;
    if (!activeClusterIds.has(clusterId)) continue;
    if (members.has(threadA) || members.has(threadB)) {
      return clusterId;
    }
  }
  return null;
}

function findCluster(clusters: Cluster[], threadId: string): Cluster | undefined {
  return clusters.find((c) => c.memberThreadIds.includes(threadId));
}

function isExcluded(threadId: string, clusterId: string): boolean {
  const exclusions = overrideExclusions.get(threadId);
  if (!exclusions) return false;
  return exclusions.has(clusterId);
}

// Manual override: drag thread out of cluster per Spec 11
// Thread cannot rejoin same cluster for rest of session
export function excludeFromCluster(threadId: string, clusterId: string): void {
  if (!overrideExclusions.has(threadId)) {
    overrideExclusions.set(threadId, new Set());
  }
  overrideExclusions.get(threadId)!.add(clusterId);
}

// Reset exclusions (new session)
export function resetExclusions(): void {
  overrideExclusions.clear();
}

export { CLUSTERING_THRESHOLD };
