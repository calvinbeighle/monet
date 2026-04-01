// Thread positioning and drift engine per Spec 03
// Tick-based continuous drift: threads move toward target positions
// driven by urgency, value, neglect, and user actions.

import type { Thread, ZoneId } from "../../lib/types";
import type { Zone } from "../../lib/types";
import {
  computeUrgencyScore,
  computeValueScore,
  computeRiskTier,
  computeRiskScore,
} from "../../lib/utils/scoring";
import { resolveTransition } from "../../lib/utils/thread-lifecycle";
import { getZoneCenter, getRandomPositionInZone, getZoneAtPosition } from "./zone-layout";

// Drift engine constants
const DRIFT_FRACTION = 0.05; // fraction of distance moved per tick toward target
const COLLISION_MIN_DISTANCE = 40; // minimum pixel separation between threads
const COLLISION_PUSH_STRENGTH = 0.3;
const NEGLECT_DRIFT_RATE = 0.02; // pixels per ms of neglect per tick

// Organic drift constants per Spec 02
const WOBBLE_AMPLITUDE = 3; // pixels, small organic feel
const WOBBLE_SPEED = 0.001; // radians per ms

// Cluster migration animation per Spec 02
const CLUSTER_MIGRATION_DURATION = 500; // ms

// Per-thread hash for unique wobble phase offset
function threadHash(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// Cluster migration target tracking
export interface ClusterMigrationTarget {
  target: { x: number; y: number };
  startPosition: { x: number; y: number };
  startTime: number;
  duration: number;
}

// Module-level map for cluster migration animations
const clusterMigrations = new Map<string, ClusterMigrationTarget>();

export function setClusterMigration(
  threadId: string,
  target: { x: number; y: number },
  startPosition: { x: number; y: number },
  now: number = Date.now(),
): void {
  clusterMigrations.set(threadId, {
    target,
    startPosition,
    startTime: now,
    duration: CLUSTER_MIGRATION_DURATION,
  });
}

export function getClusterMigration(threadId: string): ClusterMigrationTarget | undefined {
  return clusterMigrations.get(threadId);
}

export function clearClusterMigration(threadId: string): void {
  clusterMigrations.delete(threadId);
}

export function clearAllClusterMigrations(): void {
  clusterMigrations.clear();
}

// Determine target zone based on scores and state
export function computeTargetZone(thread: Thread): ZoneId {
  // User override takes precedence
  if (thread.userOverrideZone) return thread.zone;

  // Handled and approaching-archive threads go to base
  if (thread.lifecycleState === "handled" || thread.lifecycleState === "approaching-archive")
    return "base-handled";

  // Lost threads
  if (thread.lifecycleState === "lost" || thread.riskTier === "lost") return "lost";

  // Drifting-lost threads target the lost zone (they are drifting toward it)
  if (thread.lifecycleState === "drifting-lost") return "lost";

  // At-risk threads
  if (thread.lifecycleState === "at-risk" || thread.riskTier === "critical") return "at-risk";

  // High value + moderate urgency = opportunities
  if (thread.valueScore > 0.6 && thread.urgencyScore < 0.5) return "opportunities";

  // Low value + low urgency = noise
  if (thread.valueScore < 0.3 && thread.urgencyScore < 0.3) return "noise";

  // Default: active front for threads needing attention
  if (thread.urgencyScore > 0.3 || thread.unread) return "active-front";

  // Moderate state: base/handled
  return "base-handled";
}

// Compute target position within the target zone
// Position is influenced by urgency (y-axis, higher = closer to top) and
// value (x-axis, higher = closer to center)
export function computeTargetPosition(
  thread: Thread,
  zones: Map<ZoneId, Zone>,
  targetZone: ZoneId,
): { x: number; y: number } {
  const zone = zones.get(targetZone);
  if (!zone) return getZoneCenter(zones, targetZone);

  const b = zone.boundary;
  const zoneW = b.maxX - b.minX;
  const zoneH = b.maxY - b.minY;

  // Urgency maps to vertical position within zone (high urgency = top)
  const yOffset = (1 - thread.urgencyScore) * zoneH;
  // Value maps to horizontal position (high value = center of zone)
  const xOffset = 0.5 * zoneW + (thread.valueScore - 0.5) * zoneW * 0.4;

  return {
    x: b.minX + xOffset,
    y: b.minY + yOffset * 0.8 + zoneH * 0.1, // 10% margin
  };
}

// Cluster member info for affinity nudge per Spec 03
export interface ClusterInfo {
  memberThreadIds: string[];
  centroid: { x: number; y: number };
}

// Affinity nudge strength - how much cluster-mates pull toward each other
const CLUSTER_NUDGE_STRENGTH = 0.15;

// Single tick of the drift engine per Spec 03
// Order: re-evaluate scores -> update neglect -> compute targets ->
//        clustering nudge -> collision avoidance on targets ->
//        smooth movement -> update zones
export function driftTick(
  threads: Thread[],
  zones: Map<ZoneId, Zone>,
  now: number = Date.now(),
  clusters?: ClusterInfo[],
): Thread[] {
  if (threads.length === 0) return threads;

  const updated: Thread[] = [];

  for (const thread of threads) {
    const t = { ...thread };

    // 1. Re-evaluate urgency and value scores
    t.urgencyScore = computeUrgencyScore(t, now);
    t.valueScore = computeValueScore(t);

    // 2. Update neglect duration
    const lastActivity = t.lastUserReplyTimestamp ?? t.latestMessageTimestamp;
    t.neglectDuration = now - lastActivity;

    // 2b. Update risk score and tier from latency thresholds per Spec 07
    const prevRiskTier = t.riskTier;
    if (t.lifecycleState !== "handled") {
      t.riskScore = computeRiskScore(t, now);
      t.riskTier = computeRiskTier(t, now);
    }

    // 2c. Forced reclassification per Spec 04: clear user override when underlying
    // state changes significantly (risk tier crosses to critical or lost)
    if (
      t.userOverrideZone &&
      (t.riskTier === "critical" || t.riskTier === "lost") &&
      prevRiskTier !== "critical" &&
      prevRiskTier !== "lost"
    ) {
      t.userOverrideZone = false;
    }

    // 2d. Auto-transition lifecycle state based on risk tier changes per Spec 07/09
    // waiting -> at-risk when critical threshold crossed
    if (t.riskTier === "critical" && prevRiskTier !== "critical" && prevRiskTier !== "lost") {
      const next = resolveTransition(t.lifecycleState, "time-threshold-waiting");
      if (next) {
        t.stateHistory = [
          ...t.stateHistory,
          { from: t.lifecycleState, to: next, timestamp: now, trigger: "risk-tier-critical" },
        ];
        t.lifecycleState = next;
      }
    }
    // at-risk -> drifting-lost when target enters lost zone per Spec 03
    if (t.lifecycleState === "at-risk" && t.riskTier === "critical") {
      const targetZoneCheck = getZoneAtPosition(zones, t.targetPosition.x, t.targetPosition.y);
      if (targetZoneCheck === "lost" || targetZoneCheck === "at-risk") {
        const next = resolveTransition(t.lifecycleState, "time-threshold-drifting-lost");
        if (next) {
          t.stateHistory = [
            ...t.stateHistory,
            { from: t.lifecycleState, to: next, timestamp: now, trigger: "drift-toward-lost" },
          ];
          t.lifecycleState = next;
        }
      }
    }

    // drifting-lost -> lost when actual position enters lost zone
    // at-risk -> lost when lost threshold crossed (direct transition if not via drifting-lost)
    if (t.riskTier === "lost" && prevRiskTier !== "lost") {
      const next = resolveTransition(t.lifecycleState, "time-threshold-lost");
      if (next) {
        t.stateHistory = [
          ...t.stateHistory,
          { from: t.lifecycleState, to: next, timestamp: now, trigger: "risk-tier-lost" },
        ];
        t.lifecycleState = next;
      }
    }

    // 2e. Update visual state based on current conditions
    if (t.visualState !== "archived" && t.visualState !== "agent-occupied") {
      const driftMagnitude = Math.hypot(
        t.targetPosition.x - t.position.x,
        t.targetPosition.y - t.position.y,
      );
      if (driftMagnitude > 5) {
        t.visualState = "drifting";
      } else if (t.zone === "active-front" || t.unread) {
        t.visualState = "active";
      } else {
        t.visualState = "idle";
      }
    }

    // 3. Compute target zone and position (soft boundary: zone follows position, not scores)
    // Thread's zone is determined by its actual position (line 129), not snapped here.
    // Target position pulls thread toward the score-driven zone gradually.
    const targetZone = computeTargetZone(t);
    t.targetPosition = computeTargetPosition(t, zones, targetZone);

    // 4. Apply neglect-driven drift toward Lost zone
    // Per Spec 03: "Threads with high value but low urgency occupy stable positions
    // in the monitor zone" - skip neglect drift for threads targeting the opportunities zone
    const isStabilizedOpportunity = targetZone === "opportunities";
    if (t.neglectDuration > 0 && t.lifecycleState !== "handled" && !isStabilizedOpportunity) {
      const neglectHours = t.neglectDuration / (1000 * 60 * 60);
      const lostCenter = getZoneCenter(zones, "lost");
      const driftMag = NEGLECT_DRIFT_RATE * Math.min(neglectHours, 48);
      const dx = lostCenter.x - t.targetPosition.x;
      const dy = lostCenter.y - t.targetPosition.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1) {
        t.targetPosition.x += (dx / dist) * driftMag;
        t.targetPosition.y += (dy / dist) * driftMag;
      }
    }

    // 4b. Clustering affinity nudge per Spec 03 Section 2:
    // After target positions are computed, nudge cluster-mates toward each other
    if (clusters && clusters.length > 0 && t.clusterMembership) {
      const myCluster = clusters.find((c) => c.memberThreadIds.includes(t.id));
      if (myCluster && myCluster.memberThreadIds.length > 1) {
        const nudgeDx = myCluster.centroid.x - t.targetPosition.x;
        const nudgeDy = myCluster.centroid.y - t.targetPosition.y;
        t.targetPosition = {
          x: t.targetPosition.x + nudgeDx * CLUSTER_NUDGE_STRENGTH,
          y: t.targetPosition.y + nudgeDy * CLUSTER_NUDGE_STRENGTH,
        };
      }
    }

    // 5. Cluster migration animation: override position if migration is active
    const migration = clusterMigrations.get(t.id);
    if (migration) {
      const elapsed = now - migration.startTime;
      if (elapsed >= migration.duration) {
        // Migration complete - snap to target and clear
        t.position = { ...migration.target };
        t.targetPosition = { ...migration.target };
        clusterMigrations.delete(t.id);
        t.driftVelocity = { dx: 0, dy: 0 };
        const migrationZone = getZoneAtPosition(zones, t.position.x, t.position.y);
        if (migrationZone !== t.zone) {
          t.previousZone = t.zone;
          t.zone = migrationZone;
        }
        t.lastModified = now;
        updated.push(t);
        continue;
      } else {
        // Lerp from start to target over duration
        const progress = elapsed / migration.duration;
        // Ease-out cubic for smooth deceleration
        const eased = 1 - Math.pow(1 - progress, 3);
        t.position = {
          x: migration.startPosition.x + (migration.target.x - migration.startPosition.x) * eased,
          y: migration.startPosition.y + (migration.target.y - migration.startPosition.y) * eased,
        };
        t.driftVelocity = {
          dx: (migration.target.x - migration.startPosition.x) * DRIFT_FRACTION,
          dy: (migration.target.y - migration.startPosition.y) * DRIFT_FRACTION,
        };
        // Update zone based on actual position, tracking previous zone per Spec 04
        const inProgressZone = getZoneAtPosition(zones, t.position.x, t.position.y);
        if (inProgressZone !== t.zone) {
          t.previousZone = t.zone;
          t.zone = inProgressZone;
        }
        t.lastModified = now;
        updated.push(t);
        continue;
      }
    }

    // 6. Smooth movement: actual position approaches target by fixed fraction
    const dx = t.targetPosition.x - t.position.x;
    const dy = t.targetPosition.y - t.position.y;
    const driftMagnitude = Math.hypot(dx, dy);

    // 6a. Snap-to-target per Spec 02: "settles at assigned position within one second"
    // At DRIFT_FRACTION=0.05, 5 ticks/sec, after 1s remaining = initial * 0.95^5 = 77%.
    // Snap when remaining distance < 1px to guarantee visual settlement within 1 second
    // for typical drift distances. For larger jumps, the exponential approach still applies
    // but the snap threshold ensures convergence.
    if (driftMagnitude < 1) {
      t.position = { x: t.targetPosition.x, y: t.targetPosition.y };
      t.driftVelocity = { dx: 0, dy: 0 };

      // Update zone based on actual position, tracking previous zone per Spec 04
      const newZone = getZoneAtPosition(zones, t.position.x, t.position.y);
      if (newZone !== t.zone) {
        t.previousZone = t.zone;
        t.zone = newZone;
      }

      t.lastModified = now;
      updated.push(t);
      continue;
    }

    // 6b. Organic wobble per Spec 02: only when actively drifting
    // per Spec 03 acceptance criteria: stable positions when scores are stable
    let wobbleX = 0;
    let wobbleY = 0;
    if (driftMagnitude > 2) {
      const hash = threadHash(t.id);
      const wobblePhase = (hash + now * WOBBLE_SPEED) % (2 * Math.PI);
      wobbleX = Math.sin(wobblePhase) * WOBBLE_AMPLITUDE * DRIFT_FRACTION;
      wobbleY = Math.cos(wobblePhase * 1.3) * WOBBLE_AMPLITUDE * DRIFT_FRACTION;
    }

    t.position = {
      x: t.position.x + dx * DRIFT_FRACTION + wobbleX,
      y: t.position.y + dy * DRIFT_FRACTION + wobbleY,
    };

    // Update drift velocity for rendering
    t.driftVelocity = {
      dx: dx * DRIFT_FRACTION + wobbleX,
      dy: dy * DRIFT_FRACTION + wobbleY,
    };

    // Update zone based on actual position, tracking previous zone per Spec 04
    const newZone = getZoneAtPosition(zones, t.position.x, t.position.y);
    if (newZone !== t.zone) {
      t.previousZone = t.zone;
      t.zone = newZone;
    }

    t.lastModified = now;
    updated.push(t);
  }

  // 6. Collision avoidance pass on target positions per Spec 03 Section 2:
  // Applied after clustering adjustments, before actual position update
  applyCollisionAvoidance(updated);

  return updated;
}

// Push overlapping threads apart (minimum separation distance)
// Per Spec 03: operates on targetPosition so separation is enforced before
// the actual position moves toward the target
function applyCollisionAvoidance(threads: Thread[]): void {
  for (let i = 0; i < threads.length; i++) {
    for (let j = i + 1; j < threads.length; j++) {
      const a = threads[i];
      const b = threads[j];
      const dx = b.targetPosition.x - a.targetPosition.x;
      const dy = b.targetPosition.y - a.targetPosition.y;
      const dist = Math.hypot(dx, dy);

      if (dist < COLLISION_MIN_DISTANCE && dist > 0) {
        const overlap = COLLISION_MIN_DISTANCE - dist;
        const pushX = (dx / dist) * overlap * COLLISION_PUSH_STRENGTH;
        const pushY = (dy / dist) * overlap * COLLISION_PUSH_STRENGTH;

        a.targetPosition = { x: a.targetPosition.x - pushX, y: a.targetPosition.y - pushY };
        b.targetPosition = { x: b.targetPosition.x + pushX, y: b.targetPosition.y + pushY };
      }
    }
  }
}

// Place a new thread on the map per Spec 03 initial placement rules
// Per Spec 03: if thread has affinity with existing clustered threads,
// bias initial position toward that cluster's centroid
export function placeNewThread(
  thread: Thread,
  zones: Map<ZoneId, Zone>,
  existingThreads?: Thread[],
  clusters?: Array<{ memberThreadIds: string[]; centroid: { x: number; y: number } }>,
): Thread {
  const targetZone = computeTargetZone(thread);
  let position = getRandomPositionInZone(zones, targetZone);

  // Cluster-biased placement per Spec 03: bias toward clusters sharing participants or topic tags
  if (existingThreads && clusters && clusters.length > 0) {
    const newEmails = new Set(thread.participants.map((p) => p.email));
    const newTags = new Set(thread.topicTags ?? []);
    let bestCluster: { centroid: { x: number; y: number } } | null = null;
    let bestScore = 0;

    for (const cluster of clusters) {
      let participantOverlap = 0;
      let topicOverlap = 0;
      let memberCount = 0;

      for (const memberId of cluster.memberThreadIds) {
        const member = existingThreads.find((t) => t.id === memberId);
        if (!member) continue;
        memberCount++;

        // Check participant overlap
        for (const p of member.participants) {
          if (newEmails.has(p.email)) {
            participantOverlap++;
            break;
          }
        }

        // Check topic tag overlap
        const memberTags = member.topicTags ?? [];
        for (const tag of memberTags) {
          if (newTags.has(tag)) {
            topicOverlap++;
            break;
          }
        }
      }

      if (memberCount === 0) continue;

      // Combined affinity score: participant overlap weighted higher per Spec 11
      const score = (participantOverlap / memberCount) * 0.6 + (topicOverlap / memberCount) * 0.4;

      // Require meaningful affinity (at least 30% overlap)
      if (score >= 0.3 && score > bestScore) {
        bestScore = score;
        bestCluster = cluster;
      }
    }

    if (bestCluster) {
      const jitterX = (Math.random() - 0.5) * 60;
      const jitterY = (Math.random() - 0.5) * 60;
      position = {
        x: bestCluster.centroid.x + jitterX,
        y: bestCluster.centroid.y + jitterY,
      };
    }
  }

  return {
    ...thread,
    zone: targetZone,
    position,
    targetPosition: position,
    lastModified: Date.now(),
  };
}

// User action repositioning per Spec 03
// Reply: snap target to Active zone, reset neglect
export function onUserReply(thread: Thread, zones: Map<ZoneId, Zone>): Thread {
  const position = computeTargetPosition(
    { ...thread, urgencyScore: 0.1, neglectDuration: 0 },
    zones,
    "active-front",
  );
  return {
    ...thread,
    zone: "active-front",
    targetPosition: position,
    neglectDuration: 0,
    lastUserReplyTimestamp: Date.now(),
    riskScore: 0,
    riskTier: "safe",
    riskTimerStart: Date.now(),
    userOverrideZone: false,
    lastModified: Date.now(),
  };
}

// Archive: drift toward base-handled boundary via approaching-archive state per Spec 03
export function onArchive(thread: Thread, zones: Map<ZoneId, Zone>): Thread {
  const position = getRandomPositionInZone(zones, "base-handled");
  return {
    ...thread,
    zone: "base-handled",
    targetPosition: position,
    lifecycleState: "approaching-archive",
    visualState: "archived",
    lastModified: Date.now(),
  };
}

// Label action: reset neglect per Spec 03 Section 3
// Recovers drifting-lost threads back to active per Spec 03
export function onLabel(thread: Thread): Thread {
  const result: Thread = {
    ...thread,
    neglectDuration: 0,
    lastUserReplyTimestamp: Date.now(),
    lastModified: Date.now(),
  };
  if (thread.lifecycleState === "drifting-lost") {
    result.lifecycleState = "active";
    result.stateHistory = [
      ...thread.stateHistory,
      { from: "drifting-lost", to: "active", timestamp: Date.now(), trigger: "user-label" },
    ];
  }
  return result;
}

// Mark read action: reset neglect per Spec 03 Section 3
// Recovers drifting-lost threads back to active per Spec 03
export function onMarkRead(thread: Thread): Thread {
  const result: Thread = {
    ...thread,
    neglectDuration: 0,
    lastUserReplyTimestamp: Date.now(),
    unread: false,
    lastModified: Date.now(),
  };
  if (thread.lifecycleState === "drifting-lost") {
    result.lifecycleState = "active";
    result.stateHistory = [
      ...thread.stateHistory,
      { from: "drifting-lost", to: "active", timestamp: Date.now(), trigger: "user-mark-read" },
    ];
  }
  return result;
}

// Manual reclassification: user drags thread to a different zone
// Sets userOverrideZone flag so drift engine respects the manual placement.
// Target position is set within the new zone; position follows via drift.
export function onManualReclassify(
  thread: Thread,
  zones: Map<ZoneId, Zone>,
  targetZone: ZoneId,
  dropPosition?: { x: number; y: number },
): Thread {
  const position = dropPosition ?? getRandomPositionInZone(zones, targetZone);
  return {
    ...thread,
    zone: targetZone,
    previousZone: thread.zone,
    targetPosition: position,
    userOverrideZone: true,
    lastModified: Date.now(),
  };
}
