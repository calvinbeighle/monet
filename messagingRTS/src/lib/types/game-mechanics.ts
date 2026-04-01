// Game mechanics types per Spec 07
// Trust scores, opportunity windows, streaks, front health, session stats

export interface TrustRecord {
  contactEmail: string;
  score: number; // 0-100
  tier: TrustTier;
  consecutiveStreak: number;
  tierEntryDate: number; // timestamp when entered current tier
  lastReplyTimestamp: number | null;
  lastDecayCheck: number;
  decayActive: boolean; // per Spec 07: true when trust decay is currently active
}

export type TrustTier = "new" | "building" | "established" | "high-trust";

export interface SessionStats {
  threadsHandled: number;
  opportunitiesCaptured: number;
  opportunitiesMissed: number;
  risksMitigated: number;
  agentsDeployed: number;
  lostThreadCount: number; // permanent per session, even after re-engagement
  netHealthChange: number;
  sessionStart: number;
}

export interface StreakState {
  inboxZeroDays: number;
  zeroLostDays: number;
  lastEvaluationDate: string; // YYYY-MM-DD
}

export interface MapAlert {
  id: string;
  type: MapAlertType;
  threadId: string | null;
  message: string;
  createdAt: number;
  acknowledged: boolean;
  autoResolved: boolean;
}

export type MapAlertType =
  | "new-high-value"
  | "about-to-be-lost"
  | "agent-completed"
  | "streak-at-risk"
  | "thread-resurfaced";
