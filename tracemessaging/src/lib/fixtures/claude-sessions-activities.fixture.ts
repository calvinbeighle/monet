import type { ActivityRecord, Participant } from "@/lib/types";
import { createActivity } from "@/lib/types";

const now = Date.now();
const DAY = 86400000;
const HOUR = 3600000;

const CALVIN: Participant = {
  email: "calvin@example.com",
  displayName: "Calvin Beighle",
  source: "claude-code",
  lastSeenTimestamp: now,
};

export const claudeSessionFixtures: ActivityRecord[] = [
  // --- Workstream: Trace Messaging Development ---
  createActivity("claude-code", "session_trace_fixtures", {
    timestamp: now - 2 * HOUR,
    title: "Create dev seed data fixture files for tracemessaging",
    participants: [{ ...CALVIN, lastSeenTimestamp: now - 2 * HOUR }],
    preview:
      'First message: "Create dev seed data fixture files in src/lib/fixtures/..."',
    body: null,
    labels: [],
    metadata: {
      projectPath: "~/Monet/tracemessaging",
      sessionId: "session_trace_fixtures",
      turnCount: 18,
      modelId: "claude-sonnet-4-6",
      tokensUsed: 42800,
      firstMessage:
        "Create dev seed data fixture files in src/lib/fixtures/. First read these to understand the ActivityRecord type...",
      durationMs: 7200000,
      status: "active",
    },
    workstreamId: null,
    viewed: false,
  }),

  createActivity("claude-code", "session_affinity_engine", {
    timestamp: now - 1 * DAY - 1 * HOUR,
    title: "Implement affinity scoring engine for workstream detection",
    participants: [{ ...CALVIN, lastSeenTimestamp: now - 1 * DAY }],
    preview:
      'First message: "Implement the affinity scoring engine in src/lib/services/affinity-engine.ts..."',
    body: null,
    labels: [],
    metadata: {
      projectPath: "~/Monet/tracemessaging",
      sessionId: "session_affinity_engine",
      turnCount: 34,
      modelId: "claude-sonnet-4-6",
      tokensUsed: 78200,
      firstMessage:
        "Implement the affinity scoring engine in src/lib/services/affinity-engine.ts. The engine should group ActivityRecords into workstreams by participant overlap and temporal proximity.",
      durationMs: 9800000,
      status: "completed",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("claude-code", "session_foundation_layer", {
    timestamp: now - 2 * DAY - 3 * HOUR,
    title:
      "Implement Trace Messaging foundation layer - types, stores, adapters",
    participants: [{ ...CALVIN, lastSeenTimestamp: now - 2 * DAY }],
    preview:
      'First message: "Implement the Trace Messaging foundation layer (Priority 1)..."',
    body: null,
    labels: [],
    metadata: {
      projectPath: "~/Monet/tracemessaging",
      sessionId: "session_foundation_layer",
      turnCount: 50,
      modelId: "claude-sonnet-4-6",
      tokensUsed: 118500,
      firstMessage:
        "Implement the Trace Messaging foundation layer (Priority 1). This includes: ActivityRecord type system, WorkstreamStore with Zustand, ActivityStore, and source adapter skeletons for gmail, arc-browser, google-calendar, git, and claude-code.",
      durationMs: 14400000,
      status: "completed",
    },
    workstreamId: null,
    viewed: true,
  }),

  // --- Workstream: Infrastructure / DevOps ---
  createActivity("claude-code", "session_otel_bridge", {
    timestamp: now - 4 * DAY - 2 * HOUR,
    title: "Integrate OTEL exporter and bridge for agent trace observability",
    participants: [{ ...CALVIN, lastSeenTimestamp: now - 4 * DAY }],
    preview:
      'First message: "Set up OpenTelemetry exporter in the agent and wire it through the otel-bridge.py..."',
    body: null,
    labels: [],
    metadata: {
      projectPath: "~/Monet/agent",
      sessionId: "session_otel_bridge",
      turnCount: 27,
      modelId: "claude-sonnet-4-6",
      tokensUsed: 61400,
      firstMessage:
        "Set up OpenTelemetry exporter in the agent and wire it through the otel-bridge.py. The bridge should forward spans to the tracemessaging frontend via a local HTTP endpoint.",
      durationMs: 8100000,
      status: "completed",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("claude-code", "session_haiku_router", {
    timestamp: now - 5 * DAY - 4 * HOUR,
    title: "Add Haiku router fallback for cost optimization in agent/main.py",
    participants: [{ ...CALVIN, lastSeenTimestamp: now - 5 * DAY }],
    preview:
      'First message: "Add a Haiku router fallback to agent/main.py. When the task is simple (short context, no tool calls), route to claude-haiku-3-5 instead of sonnet..."',
    body: null,
    labels: [],
    metadata: {
      projectPath: "~/Monet/agent",
      sessionId: "session_haiku_router",
      turnCount: 19,
      modelId: "claude-sonnet-4-6",
      tokensUsed: 38900,
      firstMessage:
        "Add a Haiku router fallback to agent/main.py. When the task is simple (short context, no tool calls), route to claude-haiku-3-5 instead of sonnet to reduce cost.",
      durationMs: 5400000,
      status: "completed",
    },
    workstreamId: null,
    viewed: true,
  }),

  // --- Workstream: Client Project - Acme Corp ---
  createActivity("claude-code", "session_acme_kpi_charts", {
    timestamp: now - 6 * DAY - 1 * HOUR,
    title: "Build KPI chart components for Acme Corp dashboard",
    participants: [{ ...CALVIN, lastSeenTimestamp: now - 6 * DAY }],
    preview:
      'First message: "Build KPI chart components using Recharts for the Acme dashboard..."',
    body: null,
    labels: [],
    metadata: {
      projectPath: "~/Monet/acme-dashboard",
      sessionId: "session_acme_kpi_charts",
      turnCount: 41,
      modelId: "claude-sonnet-4-6",
      tokensUsed: 94700,
      firstMessage:
        "Build KPI chart components using Recharts for the Acme dashboard. Need: RevenueChart (line), ConversionFunnel (bar), KpiCard (stat), and a filter sidebar. Connect to the existing React Query data layer.",
      durationMs: 12600000,
      status: "completed",
    },
    workstreamId: null,
    viewed: true,
  }),

  // --- Workstream: Hiring / Recruiting ---
  createActivity("claude-code", "session_hiring_process", {
    timestamp: now - 8 * DAY - 3 * HOUR,
    title:
      "Draft technical interview process and rubric for Senior Engineer role",
    participants: [{ ...CALVIN, lastSeenTimestamp: now - 8 * DAY }],
    preview:
      'First message: "Help me design the technical interview process for the Senior Engineer role at Monet..."',
    body: null,
    labels: [],
    metadata: {
      projectPath: "~/Monet",
      sessionId: "session_hiring_process",
      turnCount: 12,
      modelId: "claude-sonnet-4-6",
      tokensUsed: 24300,
      firstMessage:
        "Help me design the technical interview process for the Senior Engineer role at Monet. Should be 3 rounds max: intro screen, technical deep dive, culture/values. Need a scoring rubric for TypeScript, system design, async patterns.",
      durationMs: 3200000,
      status: "completed",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("claude-code", "session_shell_agents_dash", {
    timestamp: now - 13 * DAY - 6 * HOUR,
    title: "Implement agent deployment UI in Flutter shell - drag to deploy",
    participants: [{ ...CALVIN, lastSeenTimestamp: now - 13 * DAY }],
    preview:
      'First message: "Implement the agent deployment UI in shell/lib/ui/agents_dashboard.dart..."',
    body: null,
    labels: [],
    metadata: {
      projectPath: "~/Monet/shell",
      sessionId: "session_shell_agents_dash",
      turnCount: 5,
      modelId: "claude-sonnet-4-6",
      tokensUsed: 11200,
      firstMessage:
        "Implement the agent deployment UI in shell/lib/ui/agents_dashboard.dart. Support: drag-to-deploy gesture, confirmation dialog, recall action, quick-deploy button. Wire to the existing approval_overlay.",
      durationMs: 1800000,
      status: "completed",
    },
    workstreamId: null,
    viewed: true,
  }),
];
