// Source types for all ingestion sources
export type SourceType =
  | "gmail"
  | "arc-browser"
  | "google-calendar"
  | "git"
  | "local-project"
  | "claude-code"
  | "hubspot";

// Participant in an activity
export type Participant = {
  email: string;
  displayName: string;
  source: SourceType;
  lastSeenTimestamp: number;
};

// CRM enrichment data for a participant (adapted from messagingRTS ContactEnrichment)
export type ContactEnrichment = {
  displayName: string;
  email: string;
  organization: string;
  dealNames: string[];
  lifecycleStage: string;
  vipFlag: boolean;
  relationshipScore: number; // 0-1
};

// Source-specific metadata (varies by source)
export type ActivityMetadata = Record<string, unknown>;

// The normalized activity record - the atomic unit from any source
// Activity ID format: {source}:{sourceId} for cross-source uniqueness
export type ActivityRecord = {
  activityId: string; // format: "{source}:{sourceId}"
  source: SourceType;
  sourceId: string;
  timestamp: number; // UTC epoch ms
  title: string;
  participants: Participant[];
  preview: string; // short text preview
  body: string | null; // full content, null for privacy/size (e.g. Claude sessions)
  labels: string[];
  metadata: ActivityMetadata;

  // App-computed fields (preserved across source refreshes)
  workstreamId: string | null;
  userOverride: boolean; // true if user manually assigned/unassigned
  viewed: boolean;
  lastModified: number; // UTC epoch ms
};

// Factory function
export function createActivity(
  source: SourceType,
  sourceId: string,
  fields: Partial<
    Omit<ActivityRecord, "activityId" | "source" | "sourceId">
  > & {
    timestamp: number;
    title: string;
  },
): ActivityRecord {
  return {
    activityId: `${source}:${sourceId}`,
    source,
    sourceId,
    timestamp: fields.timestamp,
    title: fields.title,
    participants: fields.participants ?? [],
    preview: fields.preview ?? "",
    body: fields.body ?? null,
    labels: fields.labels ?? [],
    metadata: fields.metadata ?? {},
    workstreamId: fields.workstreamId ?? null,
    userOverride: fields.userOverride ?? false,
    viewed: fields.viewed ?? false,
    lastModified: fields.lastModified ?? Date.now(),
  };
}
