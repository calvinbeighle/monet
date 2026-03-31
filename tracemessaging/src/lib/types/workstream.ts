import type { SourceType, Participant, ContactEnrichment } from "./activity";

export type WorkstreamStatus = "active" | "stale" | "archived";

export type RecommendedActionType =
  | "reply-email"
  | "schedule-meeting"
  | "review-document"
  | "follow-up"
  | "archive-workstream"
  | "no-action";

export type RecommendedAction = {
  type: RecommendedActionType;
  description: string;
  targetActivityId: string | null;
  confidence: number; // 0-1
};

export type UrgencyLevel = "low" | "medium" | "high";

export type WorkstreamSummary = {
  statusSummary: string; // 2-3 sentences
  keyDevelopments: string[]; // up to 3 bullets
  recommendedAction: RecommendedAction;
  urgency: UrgencyLevel;
  generatedAt: number; // UTC epoch ms
};

// Sparse timeline entry for rendering activity sparklines
export type TimelineEntry = {
  timestamp: number;
  activityId: string;
  source: SourceType;
};

// Source breakdown - count of activities per source
export type SourceBreakdown = Partial<Record<SourceType, number>>;

// Enriched participant with CRM data
export type EnrichedParticipant = Participant & {
  enrichment: ContactEnrichment | null;
};

// Status transition audit trail
export type StatusTransition = {
  from: WorkstreamStatus;
  to: WorkstreamStatus;
  timestamp: number;
  trigger: string;
};

// The central workstream entity
export type Workstream = {
  id: string; // stable UUID
  name: string; // AI-generated, user-editable
  description: string; // AI-generated one-liner

  // Membership
  activityIds: string[]; // ordered by timestamp
  activityTimeline: TimelineEntry[]; // sparse ordered list for rendering
  sourceBreakdown: SourceBreakdown;

  // Participants
  participants: EnrichedParticipant[];
  primaryParticipantEmail: string | null; // most frequent non-self

  // Temporal
  createdAt: number;
  lastActivityTimestamp: number;
  lastPersistedTimestamp: number;

  // Status
  status: WorkstreamStatus;
  statusHistory: StatusTransition[];
  unreadCount: number;
  pendingActionCount: number;

  // AI fields (cached)
  summary: WorkstreamSummary | null;
  confidence: number; // AI clustering confidence 0-1
  rationale: string; // AI explanation for why these activities are grouped
};

export function createWorkstream(
  id: string,
  name: string,
  fields?: Partial<Omit<Workstream, "id" | "name">>,
): Workstream {
  const now = Date.now();
  return {
    id,
    name,
    description: fields?.description ?? "",
    activityIds: fields?.activityIds ?? [],
    activityTimeline: fields?.activityTimeline ?? [],
    sourceBreakdown: fields?.sourceBreakdown ?? {},
    participants: fields?.participants ?? [],
    primaryParticipantEmail: fields?.primaryParticipantEmail ?? null,
    createdAt: fields?.createdAt ?? now,
    lastActivityTimestamp: fields?.lastActivityTimestamp ?? now,
    lastPersistedTimestamp: fields?.lastPersistedTimestamp ?? now,
    status: fields?.status ?? "active",
    statusHistory: fields?.statusHistory ?? [],
    unreadCount: fields?.unreadCount ?? 0,
    pendingActionCount: fields?.pendingActionCount ?? 0,
    summary: fields?.summary ?? null,
    confidence: fields?.confidence ?? 0,
    rationale: fields?.rationale ?? "",
  };
}
