import type { ActivityRecord } from "@/lib/types";
import { createActivity } from "@/lib/types";

const now = Date.now();
const DAY = 86400000;
const HOUR = 3600000;

// Thread IDs for clustering
const THREAD_TRACE_DEV = "thread_gmail_trace_001";
const THREAD_ACME = "thread_gmail_acme_001";
const THREAD_HIRING = "thread_gmail_hiring_001";
const THREAD_INFRA = "thread_gmail_infra_001";

export const gmailFixtures: ActivityRecord[] = [
  // --- Workstream: Trace Messaging Development ---
  createActivity("gmail", "msg_trace_001", {
    timestamp: now - 1 * DAY - 2 * HOUR,
    title: "Re: Trace Messaging - workstream detection design",
    participants: [
      {
        email: "sarah.chen@monet.dev",
        displayName: "Sarah Chen",
        source: "gmail",
        lastSeenTimestamp: now - 1 * DAY,
      },
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "gmail",
        lastSeenTimestamp: now - 1 * DAY,
      },
    ],
    preview:
      "Looks good. The affinity scoring approach makes sense - let's ship the fixture layer first so we have data to test against.",
    body: "Looks good. The affinity scoring approach makes sense - let's ship the fixture layer first so we have data to test against. I can review the PR this afternoon.",
    labels: ["INBOX", "UNREAD", "IMPORTANT"],
    metadata: {
      threadId: THREAD_TRACE_DEV,
      messageId: "msg_trace_001@mail.gmail.com",
      isUnread: true,
      from: "sarah.chen@monet.dev",
      to: ["calvin@example.com"],
    },
    workstreamId: null,
    viewed: false,
  }),

  createActivity("gmail", "msg_trace_002", {
    timestamp: now - 2 * DAY - 4 * HOUR,
    title: "Trace Messaging - workstream detection design",
    participants: [
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "gmail",
        lastSeenTimestamp: now - 2 * DAY,
      },
      {
        email: "sarah.chen@monet.dev",
        displayName: "Sarah Chen",
        source: "gmail",
        lastSeenTimestamp: now - 2 * DAY,
      },
    ],
    preview:
      "Hey Sarah - I drafted the affinity scoring spec. Main idea: each source adapter emits ActivityRecords, the workstream engine groups them by participant overlap and temporal proximity.",
    body: "Hey Sarah - I drafted the affinity scoring spec. Main idea: each source adapter emits ActivityRecords, the workstream engine groups them by participant overlap and temporal proximity. Let me know what you think before I start the implementation.",
    labels: ["INBOX", "IMPORTANT"],
    metadata: {
      threadId: THREAD_TRACE_DEV,
      messageId: "msg_trace_002@mail.gmail.com",
      isUnread: false,
      from: "calvin@example.com",
      to: ["sarah.chen@monet.dev"],
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("gmail", "msg_trace_003", {
    timestamp: now - 3 * DAY - 1 * HOUR,
    title: "Re: Trace Messaging - workstream detection design",
    participants: [
      {
        email: "sarah.chen@monet.dev",
        displayName: "Sarah Chen",
        source: "gmail",
        lastSeenTimestamp: now - 3 * DAY,
      },
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "gmail",
        lastSeenTimestamp: now - 3 * DAY,
      },
    ],
    preview:
      "One question: how do we handle the case where two workstreams share a participant? The graph approach might need edge weights.",
    body: "One question: how do we handle the case where two workstreams share a participant? The graph approach might need edge weights. Also, should we track decay on participant activity (i.e. a contact you haven't emailed in 30 days should have lower weight)?",
    labels: ["INBOX"],
    metadata: {
      threadId: THREAD_TRACE_DEV,
      messageId: "msg_trace_003@mail.gmail.com",
      isUnread: false,
      from: "sarah.chen@monet.dev",
      to: ["calvin@example.com"],
    },
    workstreamId: null,
    viewed: true,
  }),

  // --- Workstream: Client Project - Acme Corp ---
  createActivity("gmail", "msg_acme_001", {
    timestamp: now - 4 * HOUR,
    title: "Acme Corp - Q2 dashboard delivery timeline",
    participants: [
      {
        email: "jessica.park@acmecorp.com",
        displayName: "Jessica Park",
        source: "gmail",
        lastSeenTimestamp: now - 4 * HOUR,
      },
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "gmail",
        lastSeenTimestamp: now - 4 * HOUR,
      },
      {
        email: "tom.riley@acmecorp.com",
        displayName: "Tom Riley",
        source: "gmail",
        lastSeenTimestamp: now - 4 * HOUR,
      },
    ],
    preview:
      "Hi Calvin - following up on the dashboard. Tom and I aligned on the new KPI requirements. Can we schedule a call this week to walk through the updated spec?",
    body: "Hi Calvin - following up on the dashboard. Tom and I aligned on the new KPI requirements. Can we schedule a call this week to walk through the updated spec? We want to make sure the Q2 delivery is on track before the board meeting on April 15.",
    labels: ["INBOX", "UNREAD", "IMPORTANT", "STARRED"],
    metadata: {
      threadId: THREAD_ACME,
      messageId: "msg_acme_001@mail.gmail.com",
      isUnread: true,
      from: "jessica.park@acmecorp.com",
      to: ["calvin@example.com"],
      cc: ["tom.riley@acmecorp.com"],
    },
    workstreamId: null,
    viewed: false,
  }),

  createActivity("gmail", "msg_acme_002", {
    timestamp: now - 2 * DAY - 6 * HOUR,
    title: "Re: Acme Corp - Q2 dashboard delivery timeline",
    participants: [
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "gmail",
        lastSeenTimestamp: now - 2 * DAY,
      },
      {
        email: "jessica.park@acmecorp.com",
        displayName: "Jessica Park",
        source: "gmail",
        lastSeenTimestamp: now - 2 * DAY,
      },
    ],
    preview:
      "Jessica - thanks for the update. I have Friday 2pm or Monday morning free. Will send over the current build link so you can preview ahead of the call.",
    body: "Jessica - thanks for the update. I have Friday 2pm or Monday morning free. Will send over the current build link so you can preview ahead of the call. The core charts are done, we're still working on the filter sidebar.",
    labels: ["INBOX"],
    metadata: {
      threadId: THREAD_ACME,
      messageId: "msg_acme_002@mail.gmail.com",
      isUnread: false,
      from: "calvin@example.com",
      to: ["jessica.park@acmecorp.com"],
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("gmail", "msg_acme_003", {
    timestamp: now - 5 * DAY - 3 * HOUR,
    title: "Acme Corp - Q2 dashboard delivery timeline",
    participants: [
      {
        email: "jessica.park@acmecorp.com",
        displayName: "Jessica Park",
        source: "gmail",
        lastSeenTimestamp: now - 5 * DAY,
      },
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "gmail",
        lastSeenTimestamp: now - 5 * DAY,
      },
    ],
    preview:
      "Hi Calvin - checking in on the Acme dashboard. Our VP wants a preview during the all-hands next week. Is that feasible?",
    body: "Hi Calvin - checking in on the Acme dashboard. Our VP wants a preview during the all-hands next week. Is that feasible? We are flexible on which features are shown but need the core analytics working.",
    labels: ["INBOX"],
    metadata: {
      threadId: THREAD_ACME,
      messageId: "msg_acme_003@mail.gmail.com",
      isUnread: false,
      from: "jessica.park@acmecorp.com",
      to: ["calvin@example.com"],
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("gmail", "msg_acme_004", {
    timestamp: now - 7 * DAY,
    title: "Acme Corp - access to staging environment",
    participants: [
      {
        email: "tom.riley@acmecorp.com",
        displayName: "Tom Riley",
        source: "gmail",
        lastSeenTimestamp: now - 7 * DAY,
      },
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "gmail",
        lastSeenTimestamp: now - 7 * DAY,
      },
    ],
    preview:
      "Calvin - I set up your SSO access to the Acme staging environment. Let me know if you hit any issues connecting.",
    body: "Calvin - I set up your SSO access to the Acme staging environment. Let me know if you hit any issues connecting. The API keys for the data warehouse are in 1Password under 'Acme Prod'.",
    labels: ["INBOX"],
    metadata: {
      threadId: THREAD_ACME,
      messageId: "msg_acme_004@mail.gmail.com",
      isUnread: false,
      from: "tom.riley@acmecorp.com",
      to: ["calvin@example.com"],
    },
    workstreamId: null,
    viewed: true,
  }),

  // --- Workstream: Hiring / Recruiting ---
  createActivity("gmail", "msg_hire_001", {
    timestamp: now - 6 * HOUR,
    title: "Re: Senior Engineer role - Marcus interview feedback",
    participants: [
      {
        email: "marcus.webb@gmail.com",
        displayName: "Marcus Webb",
        source: "gmail",
        lastSeenTimestamp: now - 6 * HOUR,
      },
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "gmail",
        lastSeenTimestamp: now - 6 * HOUR,
      },
    ],
    preview:
      "Hi Calvin - thanks so much for taking the time today. Really excited about the role and the Monet vision. Looking forward to next steps.",
    body: "Hi Calvin - thanks so much for taking the time today. Really excited about the role and the Monet vision. Looking forward to next steps. Please let me know if there is anything else you need from me.",
    labels: ["INBOX", "UNREAD"],
    metadata: {
      threadId: THREAD_HIRING,
      messageId: "msg_hire_001@mail.gmail.com",
      isUnread: true,
      from: "marcus.webb@gmail.com",
      to: ["calvin@example.com"],
    },
    workstreamId: null,
    viewed: false,
  }),

  createActivity("gmail", "msg_hire_002", {
    timestamp: now - 1 * DAY - 5 * HOUR,
    title: "Senior Engineer role - Marcus interview feedback",
    participants: [
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "gmail",
        lastSeenTimestamp: now - 1 * DAY,
      },
      {
        email: "marcus.webb@gmail.com",
        displayName: "Marcus Webb",
        source: "gmail",
        lastSeenTimestamp: now - 1 * DAY,
      },
    ],
    preview:
      "Marcus - great chat yesterday. I wanted to invite you for a deeper technical conversation this week. Are you free Thursday afternoon?",
    body: "Marcus - great chat yesterday. I wanted to invite you for a deeper technical conversation this week. Are you free Thursday afternoon? We'll do a 90-minute session: 30 min product discussion, 60 min live coding (your choice of language).",
    labels: ["INBOX", "IMPORTANT"],
    metadata: {
      threadId: THREAD_HIRING,
      messageId: "msg_hire_002@mail.gmail.com",
      isUnread: false,
      from: "calvin@example.com",
      to: ["marcus.webb@gmail.com"],
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("gmail", "msg_hire_003", {
    timestamp: now - 3 * DAY - 2 * HOUR,
    title: "Application: Senior Engineer - Priya Nair",
    participants: [
      {
        email: "priya.nair@protonmail.com",
        displayName: "Priya Nair",
        source: "gmail",
        lastSeenTimestamp: now - 3 * DAY,
      },
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "gmail",
        lastSeenTimestamp: now - 3 * DAY,
      },
    ],
    preview:
      "Hi Calvin - I saw the Senior Engineer posting on LinkedIn. I have 6 years of TypeScript and React experience, most recently at a Series B fintech.",
    body: "Hi Calvin - I saw the Senior Engineer posting on LinkedIn. I have 6 years of TypeScript and React experience, most recently at a Series B fintech. Would love to chat about the Monet agent OS vision. Attaching resume.",
    labels: ["INBOX", "UNREAD"],
    metadata: {
      threadId: "thread_gmail_hiring_002",
      messageId: "msg_hire_003@mail.gmail.com",
      isUnread: true,
      from: "priya.nair@protonmail.com",
      to: ["calvin@example.com"],
    },
    workstreamId: null,
    viewed: false,
  }),

  // --- Workstream: Infrastructure / DevOps ---
  createActivity("gmail", "msg_infra_001", {
    timestamp: now - 30 * 60 * 1000,
    title: "[Alert] DigitalOcean - agent worker memory high",
    participants: [
      {
        email: "alerts@digitalocean.com",
        displayName: "DigitalOcean Alerts",
        source: "gmail",
        lastSeenTimestamp: now - 30 * 60 * 1000,
      },
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "gmail",
        lastSeenTimestamp: now,
      },
    ],
    preview:
      "Your droplet agent-worker-01 (NYC3) has exceeded 85% memory usage for more than 10 minutes. Current: 87%.",
    body: "Your droplet agent-worker-01 (NYC3) has exceeded 85% memory usage for more than 10 minutes. Current: 87%. Consider upgrading the droplet or investigating memory leaks in your application.",
    labels: ["INBOX", "UNREAD"],
    metadata: {
      threadId: THREAD_INFRA,
      messageId: "msg_infra_001@mail.gmail.com",
      isUnread: true,
      from: "alerts@digitalocean.com",
      to: ["calvin@example.com"],
      isAutomated: true,
    },
    workstreamId: null,
    viewed: false,
  }),

  createActivity("gmail", "msg_infra_002", {
    timestamp: now - 4 * DAY - 1 * HOUR,
    title: "Re: Deploy agent v0.4 to production - checklist",
    participants: [
      {
        email: "sarah.chen@monet.dev",
        displayName: "Sarah Chen",
        source: "gmail",
        lastSeenTimestamp: now - 4 * DAY,
      },
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "gmail",
        lastSeenTimestamp: now - 4 * DAY,
      },
    ],
    preview:
      "Checklist looks good to me. One note: make sure the OTEL bridge is running before you deploy, otherwise traces will be dropped during the rollout window.",
    body: "Checklist looks good to me. One note: make sure the OTEL bridge is running before you deploy, otherwise traces will be dropped during the rollout window. Also confirm the Nango webhook secret is rotated in 1Password.",
    labels: ["INBOX"],
    metadata: {
      threadId: THREAD_INFRA,
      messageId: "msg_infra_002@mail.gmail.com",
      isUnread: false,
      from: "sarah.chen@monet.dev",
      to: ["calvin@example.com"],
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("gmail", "msg_infra_003", {
    timestamp: now - 4 * DAY - 3 * HOUR,
    title: "Deploy agent v0.4 to production - checklist",
    participants: [
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "gmail",
        lastSeenTimestamp: now - 4 * DAY,
      },
      {
        email: "sarah.chen@monet.dev",
        displayName: "Sarah Chen",
        source: "gmail",
        lastSeenTimestamp: now - 4 * DAY,
      },
    ],
    preview:
      "Sarah - sharing the deploy checklist for v0.4. Main changes: new Haiku router fallback, updated OTEL exporter, and the Nango webhook handler.",
    body: "Sarah - sharing the deploy checklist for v0.4. Main changes: new Haiku router fallback, updated OTEL exporter, and the Nango webhook handler. Planning to deploy Friday 5pm after the team clears out.",
    labels: ["INBOX", "IMPORTANT"],
    metadata: {
      threadId: THREAD_INFRA,
      messageId: "msg_infra_003@mail.gmail.com",
      isUnread: false,
      from: "calvin@example.com",
      to: ["sarah.chen@monet.dev"],
    },
    workstreamId: null,
    viewed: true,
  }),

  // Automated notifications (no workstream clustering)
  createActivity("gmail", "msg_notify_001", {
    timestamp: now - 8 * DAY,
    title: "GitHub: PR #47 merged - feat: implement results overlay",
    participants: [
      {
        email: "notifications@github.com",
        displayName: "GitHub",
        source: "gmail",
        lastSeenTimestamp: now - 8 * DAY,
      },
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "gmail",
        lastSeenTimestamp: now - 8 * DAY,
      },
    ],
    preview:
      "PR #47 feat: implement results overlay - approve/reject proposals per agent deployment was merged into main by calvin.",
    body: null,
    labels: ["INBOX"],
    metadata: {
      threadId: "thread_gmail_gh_001",
      messageId: "msg_notify_001@mail.gmail.com",
      isUnread: false,
      isAutomated: true,
      from: "notifications@github.com",
      to: ["calvin@example.com"],
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("gmail", "msg_notify_002", {
    timestamp: now - 14 * DAY,
    title: "Your weekly Vercel usage report",
    participants: [
      {
        email: "noreply@vercel.com",
        displayName: "Vercel",
        source: "gmail",
        lastSeenTimestamp: now - 14 * DAY,
      },
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "gmail",
        lastSeenTimestamp: now - 14 * DAY,
      },
    ],
    preview:
      "Last week: 1,240 function invocations, 3.2GB bandwidth, 0 errors. Your usage is well within the Pro plan limits.",
    body: null,
    labels: ["INBOX"],
    metadata: {
      threadId: "thread_gmail_vercel_001",
      messageId: "msg_notify_002@mail.gmail.com",
      isUnread: false,
      isAutomated: true,
      from: "noreply@vercel.com",
      to: ["calvin@example.com"],
    },
    workstreamId: null,
    viewed: true,
  }),
];
