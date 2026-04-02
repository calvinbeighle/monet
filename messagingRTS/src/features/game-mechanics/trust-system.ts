// Trust system per Spec 07
// Trust score per contact (0-100) with tiers: new, building, established, high-trust
// Trust increases on on-time replies, decays on neglect

import type { TrustRecord, TrustTier } from "../../lib/types/game-mechanics";
import { getLatencyThresholds } from "../../lib/utils/scoring";
import type { ThreadType } from "../../lib/types";

// Trust tier boundaries per Spec 07
const TIER_BOUNDARIES: Record<TrustTier, { min: number; max: number }> = {
  new: { min: 0, max: 19 },
  building: { min: 20, max: 49 },
  established: { min: 50, max: 79 },
  "high-trust": { min: 80, max: 100 },
};

// Trust increment per on-time reply per Spec 07: "The trust increase is larger for
// high-latency-tolerance thread types (existing-relationship) than for low-latency-tolerance
// types (internal), reflecting that timely personal replies carry more weight."
// Values spread proportionally to reflect tolerance ratios:
// existing-relationship (24h) vs internal (4h) = 6x tolerance, now 8:3 increment (2.7x).
const TRUST_INCREMENT: Record<ThreadType, number> = {
  "cold-outreach": 2,
  "warm-intro": 5,
  "existing-relationship": 8,
  internal: 3,
  transactional: 1,
};

// Trust decay amount per evaluation period
const TRUST_DECAY_AMOUNT = 3;

// Established tier floor protection duration (30 days)
const ESTABLISHED_FLOOR_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export function getTrustTier(score: number): TrustTier {
  if (score >= 80) return "high-trust";
  if (score >= 50) return "established";
  if (score >= 20) return "building";
  return "new";
}

export function createTrustRecord(contactEmail: string): TrustRecord {
  const now = Date.now();
  return {
    contactEmail,
    score: 0,
    tier: "new",
    consecutiveStreak: 0,
    tierEntryDate: now,
    establishedSinceDate: null,
    lastReplyTimestamp: null,
    lastDecayCheck: now,
    decayActive: false,
  };
}

// Update trust on user reply within the elevated threshold (on-time)
export function onTimeReply(
  record: TrustRecord,
  threadType: ThreadType,
  now: number = Date.now(),
): TrustRecord {
  const increment = TRUST_INCREMENT[threadType];
  const newScore = Math.min(100, record.score + increment);
  const newStreak = record.consecutiveStreak + 1;
  const newTier = getTrustTier(newScore);

  // Per Spec 07: establishedSinceDate tracks when contact first reached established tier.
  // Set on first crossing into established/high-trust, never reset on upward transitions.
  const isAtOrAboveEstablished = newTier === "established" || newTier === "high-trust";
  const wasAtOrAboveEstablished = record.tier === "established" || record.tier === "high-trust";
  let establishedSinceDate = record.establishedSinceDate;
  if (isAtOrAboveEstablished && !wasAtOrAboveEstablished) {
    // First time reaching established tier - set the date
    establishedSinceDate = now;
  }
  // If upward transition (established -> high-trust), preserve existing date

  return {
    ...record,
    score: newScore,
    tier: newTier,
    consecutiveStreak: newStreak,
    lastReplyTimestamp: now,
    tierEntryDate: newTier !== record.tier ? now : record.tierEntryDate,
    establishedSinceDate,
    decayActive: false, // on-time reply clears decay
  };
}

// Check and apply trust decay per Spec 07:
// Decay activates when no reply to contact for >2x critical threshold
export function evaluateDecay(
  record: TrustRecord,
  threadType: ThreadType,
  now: number = Date.now(),
): TrustRecord {
  if (!record.lastReplyTimestamp) return record; // no interaction yet, no decay

  const thresholds = getLatencyThresholds(threadType);
  const decayThreshold = thresholds.critical * 2;
  const timeSinceReply = now - record.lastReplyTimestamp;

  if (timeSinceReply <= decayThreshold) {
    // Not decaying - ensure flag is cleared
    if (record.decayActive) {
      return { ...record, decayActive: false };
    }
    return record;
  }

  // Check established tier floor protection per Spec 07:
  // "Decay does not drop a contact below their established trust tier if they have held
  // that tier for more than 30 days of continuous history." Uses establishedSinceDate
  // which tracks continuous time at or above established, surviving upward transitions.
  const hasFloorProtection =
    record.establishedSinceDate !== null &&
    (record.tier === "established" || record.tier === "high-trust") &&
    now - record.establishedSinceDate >= ESTABLISHED_FLOOR_DURATION_MS;

  let newScore = Math.max(0, record.score - TRUST_DECAY_AMOUNT);

  // Floor protection: don't drop below established minimum
  if (hasFloorProtection) {
    newScore = Math.max(TIER_BOUNDARIES.established.min, newScore);
  }

  const newTier = getTrustTier(newScore);

  // Clear establishedSinceDate if score drops below established tier
  const newEstablishedSinceDate =
    newTier === "established" || newTier === "high-trust" ? record.establishedSinceDate : null;

  return {
    ...record,
    score: newScore,
    tier: newTier,
    consecutiveStreak: 0, // decay resets streak
    lastDecayCheck: now,
    tierEntryDate: newTier !== record.tier ? now : record.tierEntryDate,
    establishedSinceDate: newEstablishedSinceDate,
    decayActive: true, // per Spec 07: flag that decay is active on this contact
  };
}
