// Thread clustering types per Spec 11
// Affinity-based grouping with participant overlap as primary signal

import type { Position } from "./thread";

export interface Cluster {
  id: string;
  memberThreadIds: string[];
  centroid: Position;
  label: string;
  visualExtent: number; // grows with member count
  formationTimestamp: number;
  lastMembershipChange: number;
}

export type ClusterLifecycleState = "forming" | "active" | "dissolving" | "dissolved";

export type ThreadMembershipState =
  | "unassigned"
  | "pending-evaluation"
  | "member"
  | "override-excluded";

// Affinity components per Spec 11 (in descending weight order)
export interface AffinityScore {
  participantOverlap: number; // highest weight
  topicKeywordOverlap: number;
  sharedLabelScore: number;
  temporalProximity: number;
  composite: number;
}
