// Thread data model per Spec 09
// Core thread properties from Gmail + computed properties owned by the application

export interface Position {
  x: number;
  y: number;
}

export interface Velocity {
  dx: number;
  dy: number;
}

export interface ContactEnrichment {
  displayName: string;
  email: string;
  organization: string | null;
  vipFlag: boolean;
  relationshipScore: number;
  responseHistory: {
    avgResponseTimeMs: number;
    threadFrequency: number;
  };
}

export interface ThreadMessage {
  id: string;
  sender: string;
  recipients: string[];
  cc: string[];
  bcc: string[];
  timestamp: number;
  bodyPlain: string;
  bodyHtml: string;
  labelIds: string[];
  attachments: AttachmentDescriptor[];
}

export interface AttachmentDescriptor {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

// Lifecycle states per Spec 09 and Spec 03:
// New -> Active <-> Waiting <-> At-Risk -> Drifting-Lost -> Lost; Any -> Handled
// Approaching-Archive is the transitional state when a thread is dismissed/archived
export type ThreadLifecycleState =
  | "new"
  | "active"
  | "waiting"
  | "at-risk"
  | "drifting-lost"
  | "lost"
  | "handled"
  | "approaching-archive";

// Thread types for game mechanics latency tolerance (Spec 07)
export type ThreadType =
  | "cold-outreach"
  | "warm-intro"
  | "existing-relationship"
  | "internal"
  | "transactional";

// Risk tiers per Spec 07
export type RiskTier = "safe" | "elevated" | "critical" | "lost";

// Opportunity states per Spec 07
export type OpportunityState = "none" | "ripe" | "fading" | "expired" | "captured";

// Zone IDs per Spec 04
export type ZoneId =
  | "active-front"
  | "opportunities"
  | "at-risk"
  | "lost"
  | "noise"
  | "base-handled";

// Thread entity visual state for map rendering (Spec 02)
export type ThreadVisualState = "idle" | "active" | "drifting" | "archived" | "agent-occupied";

export interface StateTransition {
  from: ThreadLifecycleState;
  to: ThreadLifecycleState;
  timestamp: number;
  trigger: string;
}

export interface Thread {
  // Core properties from Gmail
  id: string;
  subject: string;
  participants: ContactEnrichment[];
  messages: ThreadMessage[];
  messageCount: number;
  latestMessageTimestamp: number;
  firstMessageTimestamp: number;
  gmailLabels: string[];
  unread: boolean;
  snippet: string;

  // Computed properties (application-owned)
  urgencyScore: number; // 0.0 - 1.0
  valueScore: number; // 0.0 - 1.0
  position: Position;
  targetPosition: Position;
  zone: ZoneId;
  previousZone: ZoneId | null;
  driftVelocity: Velocity;
  clusterMembership: string | null;

  // Lifecycle
  lifecycleState: ThreadLifecycleState;
  stateHistory: StateTransition[];

  // Game mechanics
  threadType: ThreadType;
  riskScore: number; // continuous 0-100 risk score per Spec 07
  riskTier: RiskTier;
  riskTimerStart: number; // timestamp when risk clock started
  opportunityState: OpportunityState;
  opportunityWindowEnd: number | null;

  // Topic tags derived from subject and body per Spec 03
  topicTags: string[];

  // Visual state for rendering
  visualState: ThreadVisualState;

  // User overrides
  userOverrideZone: boolean;
  lastUserReplyTimestamp: number | null;
  neglectDuration: number; // milliseconds

  // Persistence
  lastModified: number;
}

// Factory for creating a new thread with defaults
export function createThread(id: string, subject: string, snippet: string): Thread {
  const now = Date.now();
  return {
    id,
    subject,
    participants: [],
    messages: [],
    messageCount: 0,
    latestMessageTimestamp: now,
    firstMessageTimestamp: now,
    gmailLabels: [],
    unread: true,
    snippet,

    urgencyScore: 0.5,
    valueScore: 0.5,
    position: { x: 0, y: 0 },
    targetPosition: { x: 0, y: 0 },
    zone: "active-front",
    previousZone: null,
    driftVelocity: { dx: 0, dy: 0 },
    clusterMembership: null,

    lifecycleState: "new",
    stateHistory: [],

    threadType: "existing-relationship",
    riskScore: 0,
    riskTier: "safe",
    riskTimerStart: now,
    opportunityState: "none",
    opportunityWindowEnd: null,

    topicTags: [],

    visualState: "idle",

    userOverrideZone: false,
    lastUserReplyTimestamp: null,
    neglectDuration: 0,

    lastModified: now,
  };
}
