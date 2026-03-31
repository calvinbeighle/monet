import type { ActivityRecord } from "@/lib/types";
import { createActivity } from "@/lib/types";

const now = Date.now();
const DAY = 86400000;

// Snap to midnight UTC for calendar events
function midnight(offsetDays: number): number {
  const d = new Date(now + offsetDays * DAY);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

export const calendarFixtures: ActivityRecord[] = [
  // --- Workstream: Trace Messaging Development ---
  createActivity("google-calendar", "cal_standup_001", {
    timestamp: midnight(-1),
    title: "Daily Standup - Monet team",
    participants: [
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "google-calendar",
        lastSeenTimestamp: midnight(-1),
      },
      {
        email: "sarah.chen@monet.dev",
        displayName: "Sarah Chen",
        source: "google-calendar",
        lastSeenTimestamp: midnight(-1),
      },
    ],
    preview: "Daily standup - 15 min. Monet team. Recurring weekdays 9am PT.",
    body: "Daily 15-minute standup for the Monet engineering team. Agenda: blockers, priorities, async updates.",
    labels: ["calendar calvin@example.com"],
    metadata: {
      calendarId: "calvin@example.com",
      eventId: "cal_standup_001",
      startTime: midnight(-1) + 9 * 3600000,
      endTime: midnight(-1) + 9 * 3600000 + 15 * 60000,
      durationMinutes: 15,
      isRecurring: true,
      recurrenceRule: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      location: "Google Meet",
      meetLink: "https://meet.google.com/abc-defg-hij",
      status: "confirmed",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("google-calendar", "cal_standup_002", {
    timestamp: midnight(0),
    title: "Daily Standup - Monet team",
    participants: [
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "google-calendar",
        lastSeenTimestamp: midnight(0),
      },
      {
        email: "sarah.chen@monet.dev",
        displayName: "Sarah Chen",
        source: "google-calendar",
        lastSeenTimestamp: midnight(0),
      },
    ],
    preview: "Daily standup - 15 min. Monet team. Recurring weekdays 9am PT.",
    body: "Daily 15-minute standup for the Monet engineering team.",
    labels: ["calendar calvin@example.com"],
    metadata: {
      calendarId: "calvin@example.com",
      eventId: "cal_standup_002",
      startTime: midnight(0) + 9 * 3600000,
      endTime: midnight(0) + 9 * 3600000 + 15 * 60000,
      durationMinutes: 15,
      isRecurring: true,
      recurrenceRule: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      location: "Google Meet",
      meetLink: "https://meet.google.com/abc-defg-hij",
      status: "confirmed",
    },
    workstreamId: null,
    viewed: false,
  }),

  createActivity("google-calendar", "cal_oneone_sarah", {
    timestamp: midnight(-3),
    title: "1:1 Calvin / Sarah - weekly",
    participants: [
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "google-calendar",
        lastSeenTimestamp: midnight(-3),
      },
      {
        email: "sarah.chen@monet.dev",
        displayName: "Sarah Chen",
        source: "google-calendar",
        lastSeenTimestamp: midnight(-3),
      },
    ],
    preview:
      "Weekly 1:1. Topics: workstream detection progress, affinity scoring review, upcoming sprint.",
    body: "Weekly 1:1 between Calvin and Sarah. Standing agenda: project blockers, code review backlog, roadmap alignment.",
    labels: ["calendar calvin@example.com"],
    metadata: {
      calendarId: "calvin@example.com",
      eventId: "cal_oneone_sarah",
      startTime: midnight(-3) + 14 * 3600000,
      endTime: midnight(-3) + 14 * 3600000 + 30 * 60000,
      durationMinutes: 30,
      isRecurring: true,
      recurrenceRule: "RRULE:FREQ=WEEKLY;BYDAY=WE",
      location: "Google Meet",
      meetLink: "https://meet.google.com/klm-nopq-rst",
      status: "confirmed",
    },
    workstreamId: null,
    viewed: true,
  }),

  // --- Workstream: Client Project - Acme Corp ---
  createActivity("google-calendar", "cal_acme_kickoff", {
    timestamp: midnight(2),
    title: "Acme Corp - Q2 dashboard review call",
    participants: [
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "google-calendar",
        lastSeenTimestamp: midnight(2),
      },
      {
        email: "jessica.park@acmecorp.com",
        displayName: "Jessica Park",
        source: "google-calendar",
        lastSeenTimestamp: midnight(2),
      },
      {
        email: "tom.riley@acmecorp.com",
        displayName: "Tom Riley",
        source: "google-calendar",
        lastSeenTimestamp: midnight(2),
      },
    ],
    preview:
      "Review current dashboard build with Jessica and Tom. Walk through updated KPI requirements. Confirm Q2 delivery date.",
    body: "Review current dashboard build with Jessica and Tom. Walk through updated KPI requirements. Confirm Q2 delivery timeline. Tom will present new filter requirements from the data team.",
    labels: ["calendar calvin@example.com"],
    metadata: {
      calendarId: "calvin@example.com",
      eventId: "cal_acme_kickoff",
      startTime: midnight(2) + 14 * 3600000,
      endTime: midnight(2) + 15 * 3600000,
      durationMinutes: 60,
      isRecurring: false,
      location: "Zoom",
      meetLink: "https://zoom.us/j/98765432100",
      status: "confirmed",
    },
    workstreamId: null,
    viewed: false,
  }),

  createActivity("google-calendar", "cal_acme_allhands", {
    timestamp: midnight(-5),
    title: "Acme Corp - VP preview all-hands",
    participants: [
      {
        email: "jessica.park@acmecorp.com",
        displayName: "Jessica Park",
        source: "google-calendar",
        lastSeenTimestamp: midnight(-5),
      },
      {
        email: "tom.riley@acmecorp.com",
        displayName: "Tom Riley",
        source: "google-calendar",
        lastSeenTimestamp: midnight(-5),
      },
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "google-calendar",
        lastSeenTimestamp: midnight(-5),
      },
    ],
    preview:
      "Preview dashboard for Acme VP at company all-hands. Live demo of core analytics.",
    body: "Calvin to present current dashboard build to Acme leadership during all-hands. Core charts and data pipeline must be functional. VP will have Q&A.",
    labels: ["calendar calvin@example.com"],
    metadata: {
      calendarId: "calvin@example.com",
      eventId: "cal_acme_allhands",
      startTime: midnight(-5) + 10 * 3600000,
      endTime: midnight(-5) + 11 * 3600000,
      durationMinutes: 60,
      isRecurring: false,
      location: "Acme Corp HQ - Conf Room A",
      status: "confirmed",
    },
    workstreamId: null,
    viewed: true,
  }),

  // --- Workstream: Hiring / Recruiting ---
  createActivity("google-calendar", "cal_interview_marcus", {
    timestamp: midnight(1),
    title: "Technical interview - Marcus Webb (Senior Engineer)",
    participants: [
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "google-calendar",
        lastSeenTimestamp: midnight(1),
      },
      {
        email: "marcus.webb@gmail.com",
        displayName: "Marcus Webb",
        source: "google-calendar",
        lastSeenTimestamp: midnight(1),
      },
    ],
    preview:
      "90-min technical interview with Marcus Webb. 30 min product discussion, 60 min live coding.",
    body: "Technical interview with Marcus Webb for Senior Engineer role. Format: 30 min product/culture discussion, 60 min live coding exercise (candidate choice of language). Evaluating: systems thinking, TypeScript fluency, async patterns.",
    labels: ["calendar calvin@example.com"],
    metadata: {
      calendarId: "calvin@example.com",
      eventId: "cal_interview_marcus",
      startTime: midnight(1) + 13 * 3600000,
      endTime: midnight(1) + 14 * 3600000 + 30 * 60000,
      durationMinutes: 90,
      isRecurring: false,
      location: "Google Meet",
      meetLink: "https://meet.google.com/uvw-xyza-bcd",
      status: "confirmed",
    },
    workstreamId: null,
    viewed: false,
  }),

  createActivity("google-calendar", "cal_interview_priya", {
    timestamp: midnight(4),
    title: "Intro call - Priya Nair (Senior Engineer candidate)",
    participants: [
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "google-calendar",
        lastSeenTimestamp: midnight(4),
      },
      {
        email: "priya.nair@protonmail.com",
        displayName: "Priya Nair",
        source: "google-calendar",
        lastSeenTimestamp: midnight(4),
      },
    ],
    preview:
      "30-min intro call with Priya Nair. Background in TypeScript/React at Series B fintech.",
    body: "Initial screening call with Priya Nair for Senior Engineer role. She has 6 years TypeScript/React experience at fintech. Discuss: background, Monet vision, role expectations, compensation range.",
    labels: ["calendar calvin@example.com"],
    metadata: {
      calendarId: "calvin@example.com",
      eventId: "cal_interview_priya",
      startTime: midnight(4) + 10 * 3600000,
      endTime: midnight(4) + 10 * 3600000 + 30 * 60000,
      durationMinutes: 30,
      isRecurring: false,
      location: "Google Meet",
      meetLink: "https://meet.google.com/efg-hijk-lmn",
      status: "tentative",
    },
    workstreamId: null,
    viewed: false,
  }),

  // --- Workstream: Infrastructure / DevOps ---
  createActivity("google-calendar", "cal_deploy_review", {
    timestamp: midnight(-4),
    title: "Agent v0.4 production deploy - go/no-go review",
    participants: [
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "google-calendar",
        lastSeenTimestamp: midnight(-4),
      },
      {
        email: "sarah.chen@monet.dev",
        displayName: "Sarah Chen",
        source: "google-calendar",
        lastSeenTimestamp: midnight(-4),
      },
    ],
    preview:
      "Go/no-go review before agent v0.4 production deploy. Review checklist, confirm OTEL bridge, rotate Nango secret.",
    body: "Pre-deploy review for agent v0.4. Agenda: walk through deploy checklist, confirm OTEL bridge is running, verify Nango webhook secret rotation, review rollback plan.",
    labels: ["calendar calvin@example.com"],
    metadata: {
      calendarId: "calvin@example.com",
      eventId: "cal_deploy_review",
      startTime: midnight(-4) + 16 * 3600000,
      endTime: midnight(-4) + 16 * 3600000 + 30 * 60000,
      durationMinutes: 30,
      isRecurring: false,
      location: "Google Meet",
      meetLink: "https://meet.google.com/opq-rstu-vwx",
      status: "confirmed",
    },
    workstreamId: null,
    viewed: true,
  }),

  // General / cross-team
  createActivity("google-calendar", "cal_allhands_monet", {
    timestamp: midnight(-6),
    title: "Monet monthly all-hands",
    participants: [
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "google-calendar",
        lastSeenTimestamp: midnight(-6),
      },
      {
        email: "sarah.chen@monet.dev",
        displayName: "Sarah Chen",
        source: "google-calendar",
        lastSeenTimestamp: midnight(-6),
      },
    ],
    preview:
      "Monthly all-hands. Agenda: product roadmap update, Q1 metrics review, open Q&A.",
    body: "Monthly Monet all-hands. Agenda: product roadmap update for Q2, Q1 metrics review (DAU, session length, workstream accuracy), open Q&A, shoutouts.",
    labels: ["calendar calvin@example.com"],
    metadata: {
      calendarId: "calvin@example.com",
      eventId: "cal_allhands_monet",
      startTime: midnight(-6) + 10 * 3600000,
      endTime: midnight(-6) + 11 * 3600000,
      durationMinutes: 60,
      isRecurring: true,
      recurrenceRule: "RRULE:FREQ=MONTHLY;BYDAY=1MO",
      location: "Google Meet",
      meetLink: "https://meet.google.com/yza-bcde-fgh",
      status: "confirmed",
    },
    workstreamId: null,
    viewed: true,
  }),

  createActivity("google-calendar", "cal_focus_block", {
    timestamp: midnight(3),
    title: "Deep work block - Trace Messaging fixtures",
    participants: [
      {
        email: "calvin@example.com",
        displayName: "Calvin Beighle",
        source: "google-calendar",
        lastSeenTimestamp: midnight(3),
      },
    ],
    preview: "Blocked for focused development. No meetings.",
    body: "Deep work block. Working on: fixture files for Trace Messaging dev seed data, workstream detection integration tests.",
    labels: ["calendar calvin@example.com"],
    metadata: {
      calendarId: "calvin@example.com",
      eventId: "cal_focus_block",
      startTime: midnight(3) + 9 * 3600000,
      endTime: midnight(3) + 13 * 3600000,
      durationMinutes: 240,
      isRecurring: false,
      location: null,
      status: "confirmed",
    },
    workstreamId: null,
    viewed: false,
  }),
];
