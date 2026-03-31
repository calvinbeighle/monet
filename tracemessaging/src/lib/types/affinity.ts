// Affinity scoring for workstream detection - adapted from messagingRTS cluster.ts

export type AffinityScore = {
  participantOverlap: number; // 0-1, highest weight
  topicKeywordOverlap: number; // 0-1
  temporalProximity: number; // 0-1
  projectAssociation: number; // 0-1 (same git repo/Arc space/Claude project)
  crmAssociation: number; // 0-1 (same HubSpot deal/company)
  sharedLabelScore: number; // 0-1
  composite: number; // 0-1, weighted sum
};

// Membership state for activities within workstreams
export type ActivityMembershipState =
  | "unassigned"
  | "pending-evaluation"
  | "member"
  | "override-excluded"; // user manually removed

// Context linking confidence levels
export type LinkConfidence = {
  score: number; // 0-1
  method: "deterministic" | "ai"; // how the score was computed
  reasoning: string;
};
