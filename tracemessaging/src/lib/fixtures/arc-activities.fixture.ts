import type { ActivityRecord } from "@/lib/types";
import { createActivity } from "@/lib/types";

const now = Date.now();
const DAY = 86400000;
const HOUR = 3600000;

function domainFrom(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export const arcFixtures: ActivityRecord[] = [
  // --- Workstream: Trace Messaging Development ---
  createActivity("arc-browser", "arc_tab_vite_docs", {
    timestamp: now - 1 * HOUR,
    title: "Vite | Next Generation Frontend Tooling",
    participants: [],
    preview: "Vite docs - Getting Started, Configuration, Plugins",
    body: null,
    labels: ["Work", "active"],
    metadata: {
      url: "https://vitejs.dev/guide/",
      domain: domainFrom("https://vitejs.dev/guide/"),
      spaceName: "Work",
      tabState: "active",
      faviconUrl: "https://vitejs.dev/logo.svg",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("arc-browser", "arc_tab_react_query", {
    timestamp: now - 2 * HOUR,
    title: "TanStack Query v5 - Queries | TanStack",
    participants: [],
    preview: "TanStack Query v5 docs - useQuery, QueryClient, prefetching",
    body: null,
    labels: ["Work", "active"],
    metadata: {
      url: "https://tanstack.com/query/latest/docs/framework/react/guides/queries",
      domain: domainFrom(
        "https://tanstack.com/query/latest/docs/framework/react/guides/queries",
      ),
      spaceName: "Work",
      tabState: "active",
      faviconUrl: "https://tanstack.com/favicon.ico",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("arc-browser", "arc_tab_zustand_docs", {
    timestamp: now - 3 * HOUR,
    title: "Zustand - Bear necessities for state management",
    participants: [],
    preview: "Zustand docs - getting started, slices, middleware",
    body: null,
    labels: ["Work", "active"],
    metadata: {
      url: "https://docs.pmnd.rs/zustand/getting-started/introduction",
      domain: domainFrom(
        "https://docs.pmnd.rs/zustand/getting-started/introduction",
      ),
      spaceName: "Work",
      tabState: "active",
      faviconUrl: "https://zustand-demo.pmnd.rs/favicon.ico",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("arc-browser", "arc_tab_gh_tracemessaging", {
    timestamp: now - 4 * HOUR,
    title: "GitHub - Monet/tracemessaging: Trace Messaging source",
    participants: [],
    preview: "GitHub repository - Monet/tracemessaging, ralph-build branch",
    body: null,
    labels: ["Work", "active"],
    metadata: {
      url: "https://github.com/calvinbeighle/Monet/tree/ralph-build/tracemessaging",
      domain: "github.com",
      spaceName: "Work",
      tabState: "active",
      faviconUrl: "https://github.githubassets.com/favicons/favicon.svg",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("arc-browser", "arc_tab_linear_trace", {
    timestamp: now - 5 * HOUR,
    title: "Linear - Trace Messaging - Sprint 4",
    participants: [],
    preview: "Linear sprint board - Trace Messaging workstream detection tasks",
    body: null,
    labels: ["Work", "active"],
    metadata: {
      url: "https://linear.app/monet/project/trace-messaging-sprint-4",
      domain: "linear.app",
      spaceName: "Work",
      tabState: "active",
      faviconUrl: "https://linear.app/favicon.ico",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("arc-browser", "arc_tab_typescript_handbook", {
    timestamp: now - 1 * DAY - 2 * HOUR,
    title: "TypeScript: Handbook - Utility Types",
    participants: [],
    preview: "TypeScript docs - Partial, Required, Record, Omit utility types",
    body: null,
    labels: ["Work", "archive"],
    metadata: {
      url: "https://www.typescriptlang.org/docs/handbook/utility-types.html",
      domain: domainFrom(
        "https://www.typescriptlang.org/docs/handbook/utility-types.html",
      ),
      spaceName: "Work",
      tabState: "archived",
      faviconUrl: "https://www.typescriptlang.org/favicon.ico",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("arc-browser", "arc_tab_so_workstream_algo", {
    timestamp: now - 1 * DAY - 6 * HOUR,
    title: "Stack Overflow - Graph clustering algorithm for email threading",
    participants: [],
    preview:
      "SO: algorithm for clustering emails by participants and time proximity",
    body: null,
    labels: ["Research", "archive"],
    metadata: {
      url: "https://stackoverflow.com/questions/74829301/graph-clustering-email-threading",
      domain: "stackoverflow.com",
      spaceName: "Research",
      tabState: "archived",
      faviconUrl: "https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico",
    },
    workstreamId: null,
    viewed: true,
  }),

  // --- Workstream: Client Project - Acme Corp ---
  createActivity("arc-browser", "arc_tab_acme_figma", {
    timestamp: now - 2 * DAY - 1 * HOUR,
    title: "Figma - Acme Corp Dashboard v2 - Design System",
    participants: [],
    preview: "Figma file: Acme Corp Q2 dashboard redesign, component library",
    body: null,
    labels: ["Work", "active"],
    metadata: {
      url: "https://www.figma.com/file/xK9mNvPqRt3wLd/Acme-Dashboard-v2",
      domain: "figma.com",
      spaceName: "Work",
      tabState: "active",
      faviconUrl: "https://static.figma.com/app/icon/1/favicon.ico",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("arc-browser", "arc_tab_acme_staging", {
    timestamp: now - 2 * DAY - 3 * HOUR,
    title: "Acme Corp - Analytics Dashboard (Staging)",
    participants: [],
    preview: "Acme staging environment - dashboard build preview",
    body: null,
    labels: ["Work", "active"],
    metadata: {
      url: "https://staging.acmecorp-dashboard.internal/analytics",
      domain: "staging.acmecorp-dashboard.internal",
      spaceName: "Work",
      tabState: "active",
      faviconUrl: null,
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("arc-browser", "arc_tab_recharts_docs", {
    timestamp: now - 3 * DAY - 2 * HOUR,
    title: "Recharts - A composable charting library for React",
    participants: [],
    preview: "Recharts docs - LineChart, BarChart, ResponsiveContainer API",
    body: null,
    labels: ["Work", "archive"],
    metadata: {
      url: "https://recharts.org/en-US/api",
      domain: "recharts.org",
      spaceName: "Work",
      tabState: "archived",
      faviconUrl: "https://recharts.org/favicon.ico",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("arc-browser", "arc_tab_acme_gh", {
    timestamp: now - 4 * DAY,
    title: "GitHub - Monet/acme-dashboard: feature/dashboard branch",
    participants: [],
    preview: "GitHub: Monet/acme-dashboard, PR #12 - KPI chart components",
    body: null,
    labels: ["Work", "archive"],
    metadata: {
      url: "https://github.com/calvinbeighle/Monet/tree/feature/dashboard/acme-dashboard",
      domain: "github.com",
      spaceName: "Work",
      tabState: "archived",
      faviconUrl: "https://github.githubassets.com/favicons/favicon.svg",
    },
    workstreamId: null,
    viewed: true,
  }),

  // --- Workstream: Hiring / Recruiting ---
  createActivity("arc-browser", "arc_tab_linkedin_jobs", {
    timestamp: now - 1 * DAY - 1 * HOUR,
    title: "LinkedIn - Senior Engineer applicants - Monet",
    participants: [],
    preview: "LinkedIn job post: Senior Engineer at Monet - applicant tracker",
    body: null,
    labels: ["Work", "active"],
    metadata: {
      url: "https://www.linkedin.com/jobs/view/3847291034/applicants",
      domain: "linkedin.com",
      spaceName: "Work",
      tabState: "active",
      faviconUrl: "https://static.licdn.com/sc/h/al2o9zrvru7aqj8e1x2rzsrca",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("arc-browser", "arc_tab_marcus_linkedin", {
    timestamp: now - 2 * DAY,
    title: "Marcus Webb - Software Engineer - LinkedIn",
    participants: [],
    preview: "Marcus Webb LinkedIn profile - Senior engineer, 8yr exp React/TS",
    body: null,
    labels: ["Work", "archive"],
    metadata: {
      url: "https://www.linkedin.com/in/marcus-webb-swe/",
      domain: "linkedin.com",
      spaceName: "Work",
      tabState: "archived",
      faviconUrl: "https://static.licdn.com/sc/h/al2o9zrvru7aqj8e1x2rzsrca",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("arc-browser", "arc_tab_priya_linkedin", {
    timestamp: now - 3 * DAY - 4 * HOUR,
    title: "Priya Nair - Full Stack Engineer - LinkedIn",
    participants: [],
    preview:
      "Priya Nair LinkedIn profile - 6yr TypeScript/React, fintech background",
    body: null,
    labels: ["Work", "archive"],
    metadata: {
      url: "https://www.linkedin.com/in/priya-nair-eng/",
      domain: "linkedin.com",
      spaceName: "Work",
      tabState: "archived",
      faviconUrl: "https://static.licdn.com/sc/h/al2o9zrvru7aqj8e1x2rzsrca",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("arc-browser", "arc_tab_levels_fyi", {
    timestamp: now - 4 * DAY - 2 * HOUR,
    title: "levels.fyi - Software Engineer salaries 2026",
    participants: [],
    preview: "levels.fyi: Senior SWE compensation data by company and location",
    body: null,
    labels: ["Research", "archive"],
    metadata: {
      url: "https://www.levels.fyi/t/software-engineer/level/senior",
      domain: "levels.fyi",
      spaceName: "Research",
      tabState: "archived",
      faviconUrl: "https://www.levels.fyi/favicon.ico",
    },
    workstreamId: null,
    viewed: true,
  }),

  // --- Workstream: Infrastructure / DevOps ---
  createActivity("arc-browser", "arc_tab_digitalocean_monitor", {
    timestamp: now - 30 * 60 * 1000,
    title: "DigitalOcean - Droplet agent-worker-01 - Graphs",
    participants: [],
    preview: "DO control panel: agent-worker-01 memory/CPU graphs - NYC3",
    body: null,
    labels: ["Work", "active"],
    metadata: {
      url: "https://cloud.digitalocean.com/droplets/383920471/graphs",
      domain: "cloud.digitalocean.com",
      spaceName: "Work",
      tabState: "active",
      faviconUrl: "https://cloud.digitalocean.com/favicon.ico",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("arc-browser", "arc_tab_otel_docs", {
    timestamp: now - 4 * DAY - 5 * HOUR,
    title: "OpenTelemetry - Python SDK - Tracing",
    participants: [],
    preview:
      "OTel Python SDK docs - TracerProvider, BatchSpanProcessor, exporters",
    body: null,
    labels: ["Research", "archive"],
    metadata: {
      url: "https://opentelemetry.io/docs/instrumentation/python/",
      domain: "opentelemetry.io",
      spaceName: "Research",
      tabState: "archived",
      faviconUrl: "https://opentelemetry.io/favicons/favicon-32x32.png",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("arc-browser", "arc_tab_nango_docs", {
    timestamp: now - 5 * DAY - 3 * HOUR,
    title: "Nango - OAuth integration platform docs",
    participants: [],
    preview: "Nango docs: webhook verification, token refresh, Gmail scopes",
    body: null,
    labels: ["Work", "archive"],
    metadata: {
      url: "https://docs.nango.dev/integrate/guides/receive-webhooks-from-nango",
      domain: "docs.nango.dev",
      spaceName: "Work",
      tabState: "archived",
      faviconUrl: "https://docs.nango.dev/favicon.ico",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("arc-browser", "arc_tab_uptime_kuma", {
    timestamp: now - 5 * DAY - 6 * HOUR,
    title: "Uptime Kuma - Monet Agent Status Dashboard",
    participants: [],
    preview: "Uptime Kuma self-hosted: Monet agent worker uptime and latency",
    body: null,
    labels: ["Work", "active"],
    metadata: {
      url: "https://status.monet.dev/dashboard",
      domain: "status.monet.dev",
      spaceName: "Work",
      tabState: "active",
      faviconUrl: "https://status.monet.dev/favicon.ico",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("arc-browser", "arc_tab_do_managed_db", {
    timestamp: now - 6 * DAY,
    title: "DigitalOcean - Managed PostgreSQL - Connection Details",
    participants: [],
    preview:
      "DO managed Postgres: Monet prod DB connection string and SSL config",
    body: null,
    labels: ["Work", "archive"],
    metadata: {
      url: "https://cloud.digitalocean.com/databases/db-postgresql-nyc3-29041",
      domain: "cloud.digitalocean.com",
      spaceName: "Work",
      tabState: "archived",
      faviconUrl: "https://cloud.digitalocean.com/favicon.ico",
    },
    workstreamId: null,
    viewed: true,
  }),

  // Personal / other
  createActivity("arc-browser", "arc_tab_hn_ai", {
    timestamp: now - 2 * DAY - 7 * HOUR,
    title: "Hacker News - Show HN: Agent-native OS prototype",
    participants: [],
    preview: "HN discussion: agent-native OS, intent-driven UIs, workstream AI",
    body: null,
    labels: ["Personal", "archive"],
    metadata: {
      url: "https://news.ycombinator.com/item?id=43872910",
      domain: "news.ycombinator.com",
      spaceName: "Personal",
      tabState: "archived",
      faviconUrl: "https://news.ycombinator.com/favicon.ico",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("arc-browser", "arc_tab_anthropic_docs", {
    timestamp: now - 3 * DAY - 8 * HOUR,
    title: "Anthropic - Claude API Reference - Messages",
    participants: [],
    preview: "Claude API docs: messages endpoint, streaming, tool use, vision",
    body: null,
    labels: ["Research", "active"],
    metadata: {
      url: "https://docs.anthropic.com/en/api/messages",
      domain: "docs.anthropic.com",
      spaceName: "Research",
      tabState: "active",
      faviconUrl: "https://docs.anthropic.com/favicon.ico",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("arc-browser", "arc_tab_slack_monet", {
    timestamp: now - 4 * DAY - 1 * HOUR,
    title: "Slack - Monet - #engineering",
    participants: [],
    preview: "Slack: Monet workspace, #engineering channel",
    body: null,
    labels: ["Work", "active"],
    metadata: {
      url: "https://app.slack.com/client/T04AB12CDEF/C06GH78IJKL",
      domain: "app.slack.com",
      spaceName: "Work",
      tabState: "active",
      faviconUrl:
        "https://a.slack-edge.com/80588/marketing/img/meta/favicon-32.png",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("arc-browser", "arc_tab_design_tokens", {
    timestamp: now - 7 * DAY - 3 * HOUR,
    title: "Figma - Monet Design System - Tokens",
    participants: [],
    preview: "Figma: Monet design system, color tokens, spacing scale",
    body: null,
    labels: ["Design", "archive"],
    metadata: {
      url: "https://www.figma.com/file/yR7pNxQzKt2mBh/Monet-Design-System",
      domain: "figma.com",
      spaceName: "Design",
      tabState: "archived",
      faviconUrl: "https://static.figma.com/app/icon/1/favicon.ico",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("arc-browser", "arc_tab_vercel_dash", {
    timestamp: now - 8 * DAY - 2 * HOUR,
    title: "Vercel - Deployments - tracemessaging",
    participants: [],
    preview: "Vercel dashboard: tracemessaging deployments, preview URLs, logs",
    body: null,
    labels: ["Work", "archive"],
    metadata: {
      url: "https://vercel.com/calvinbeighle/tracemessaging/deployments",
      domain: "vercel.com",
      spaceName: "Work",
      tabState: "archived",
      faviconUrl: "https://vercel.com/favicon.ico",
    },
    workstreamId: null,
    viewed: true,
  }),
];
