export { apiGet, apiPost } from "./api-client";

export {
  fetchGmailActivities,
  startGmailPolling,
  stopGmailPolling,
} from "./gmail-ingestion";

export { fetchArcActivities } from "./arc-ingestion";

export { fetchCalendarActivities } from "./calendar-ingestion";

export { fetchGitActivities } from "./git-ingestion";

export { fetchClaudeSessionActivities } from "./claude-sessions-ingestion";

export { startIngestion, stopIngestion } from "./ingestion-orchestrator";
export { default as ingestionOrchestrator } from "./ingestion-orchestrator";

export {
  detectWorkstreams,
  startDetection,
  stopDetection,
} from "./ai-detection";

export { evaluateActivity, relinkUncertainActivities } from "./ai-linking";

export {
  requestSummary,
  needsRefresh,
  refreshStaleSummaries,
  stopSummaryService,
} from "./ai-summary";

export {
  requestImage,
  needsImageRefresh,
  refreshStaleImages,
  stopImagineService,
} from "./imagine-service";
