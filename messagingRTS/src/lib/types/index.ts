export type {
  Position,
  Velocity,
  ContactEnrichment,
  ThreadMessage,
  AttachmentDescriptor,
} from "./thread";
export type { ThreadLifecycleState, ThreadType, RiskTier, OpportunityState } from "./thread";
export type { ThreadVisualState, StateTransition, Thread } from "./thread";
export { createThread } from "./thread";

export type { ZoneBoundary, ZoneAlertThreshold, ZoneAlertState, Zone } from "./zone";
export { ZONE_DEFINITIONS } from "./zone";
export type { ZoneId } from "./zone";

export type { AgentRole, AgentStatus, ProposalStatus, AgentDefinition } from "./agent";
export type { AgentProposal, AgentInstance } from "./agent";
export { AGENT_DEFINITIONS } from "./agent";

export type { SyncMode, ConnectivityStatus, ActionQueueEntryStatus } from "./sync";
export type { ActionQueueEntry, SyncState, ThreadChangeType, ThreadChangeEvent } from "./sync";
