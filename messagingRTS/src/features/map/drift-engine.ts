// Thread positioning and drift engine per Spec 03
// Tick-based continuous drift: threads move toward target positions
// driven by urgency, value, neglect, and user actions.

import type { Thread, ZoneId } from "../../lib/types";
import type { Zone } from "../../lib/types";
import { computeUrgencyScore, computeValueScore } from "../../lib/utils/scoring";
import { getZoneCenter, getRandomPositionInZone, getZoneAtPosition } from "./zone-layout";

// Drift engine constants
const DRIFT_FRACTION = 0.05; // fraction of distance moved per tick toward target
const COLLISION_MIN_DISTANCE = 40; // minimum pixel separation between threads
const COLLISION_PUSH_STRENGTH = 0.3;
const NEGLECT_DRIFT_RATE = 0.02; // pixels per ms of neglect per tick

// Determine target zone based on scores and state
export function computeTargetZone(thread: Thread): ZoneId {
  // User override takes precedence
  if (thread.userOverrideZone) return thread.zone;

  // Handled threads go to base
  if (thread.lifecycleState === "handled") return "base-handled";

  // Lost threads
  if (thread.lifecycleState === "lost" || thread.riskTier === "lost") return "lost";

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

// Single tick of the drift engine per Spec 03
// Order: re-evaluate scores -> update neglect -> compute targets ->
//        apply neglect drift -> smooth movement -> collision avoidance
export function driftTick(
  threads: Thread[],
  zones: Map<ZoneId, Zone>,
  now: number = Date.now(),
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

    // 3. Compute target zone and position (soft boundary: zone follows position, not scores)
    // Thread's zone is determined by its actual position (line 129), not snapped here.
    // Target position pulls thread toward the score-driven zone gradually.
    const targetZone = computeTargetZone(t);
    t.targetPosition = computeTargetPosition(t, zones, targetZone);

    // 4. Apply neglect-driven drift toward Lost zone
    if (t.neglectDuration > 0 && t.lifecycleState !== "handled") {
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

    // 5. Smooth movement: actual position approaches target by fixed fraction
    const dx = t.targetPosition.x - t.position.x;
    const dy = t.targetPosition.y - t.position.y;
    t.position = {
      x: t.position.x + dx * DRIFT_FRACTION,
      y: t.position.y + dy * DRIFT_FRACTION,
    };

    // Update drift velocity for rendering
    t.driftVelocity = {
      dx: dx * DRIFT_FRACTION,
      dy: dy * DRIFT_FRACTION,
    };

    // Update zone based on actual position
    t.zone = getZoneAtPosition(zones, t.position.x, t.position.y);

    t.lastModified = now;
    updated.push(t);
  }

  // 6. Collision avoidance pass
  applyCollisionAvoidance(updated);

  return updated;
}

// Push overlapping threads apart (minimum separation distance)
function applyCollisionAvoidance(threads: Thread[]): void {
  for (let i = 0; i < threads.length; i++) {
    for (let j = i + 1; j < threads.length; j++) {
      const a = threads[i];
      const b = threads[j];
      const dx = b.position.x - a.position.x;
      const dy = b.position.y - a.position.y;
      const dist = Math.hypot(dx, dy);

      if (dist < COLLISION_MIN_DISTANCE && dist > 0) {
        const overlap = COLLISION_MIN_DISTANCE - dist;
        const pushX = (dx / dist) * overlap * COLLISION_PUSH_STRENGTH;
        const pushY = (dy / dist) * overlap * COLLISION_PUSH_STRENGTH;

        a.position = { x: a.position.x - pushX, y: a.position.y - pushY };
        b.position = { x: b.position.x + pushX, y: b.position.y + pushY };
      }
    }
  }
}

// Place a new thread on the map per Spec 03 initial placement rules
export function placeNewThread(thread: Thread, zones: Map<ZoneId, Zone>): Thread {
  const targetZone = computeTargetZone(thread);
  const position = getRandomPositionInZone(zones, targetZone);

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
    riskTier: "safe",
    riskTimerStart: Date.now(),
    userOverrideZone: false,
    lastModified: Date.now(),
  };
}

// Archive: drift toward base-handled boundary
export function onArchive(thread: Thread, zones: Map<ZoneId, Zone>): Thread {
  const position = getRandomPositionInZone(zones, "base-handled");
  return {
    ...thread,
    zone: "base-handled",
    targetPosition: position,
    lifecycleState: "handled",
    visualState: "archived",
    lastModified: Date.now(),
  };
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
