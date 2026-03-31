import { createActivity } from "@/lib/types/activity";
import type { ActivityRecord, Participant } from "@/lib/types/activity";
import { apiGet } from "./api-client";

// Simple djb2 hash producing a hex string
function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return hash.toString(16);
}

interface CalendarAttendee {
  email: string;
  name?: string;
  displayName?: string;
}

interface CalendarEvent {
  summary?: string;
  start?: string; // ISO date string (date-only "YYYY-MM-DD" or datetime)
  end?: string;
  calendar?: string;
  account?: string;
  attendees?: CalendarAttendee[];
}

interface CalendarEventsResponse {
  events?: CalendarEvent[];
}

function parseDateToEpochMs(dateStr: string | undefined): number {
  if (!dateStr) return Date.now();
  // Date-only format "YYYY-MM-DD" -> interpret as midnight UTC
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(`${dateStr}T00:00:00Z`).getTime();
  }
  // ISO datetime
  const ms = Date.parse(dateStr);
  return isNaN(ms) ? Date.now() : ms;
}

function buildAttendeePreview(attendees: CalendarAttendee[]): string {
  if (attendees.length === 0) return "No attendees";
  if (attendees.length === 1) {
    const a = attendees[0];
    return a.name ?? a.displayName ?? a.email;
  }
  return `${attendees.length} attendees`;
}

function normalizeCalendarEvent(event: CalendarEvent): ActivityRecord {
  const summary = event.summary ?? "Untitled event";
  const start = event.start ?? "";
  const id = hashString(summary + start);
  const timestamp = parseDateToEpochMs(start);
  const attendees = event.attendees ?? [];

  const participants: Participant[] = attendees.map((a) => ({
    email: a.email,
    displayName: a.name ?? a.displayName ?? a.email,
    source: "google-calendar",
    lastSeenTimestamp: timestamp,
  }));

  const labels: string[] = [];
  if (event.calendar) labels.push(event.calendar);
  if (event.account) labels.push(event.account);

  return createActivity("google-calendar", id, {
    timestamp,
    title: summary,
    participants,
    preview: buildAttendeePreview(attendees),
    body: null,
    labels,
    metadata: {
      start: event.start ?? null,
      calendar: event.calendar ?? null,
      account: event.account ?? null,
      attendeeCount: attendees.length,
    },
  });
}

export async function fetchCalendarActivities(): Promise<ActivityRecord[]> {
  if (import.meta.env.VITE_DEV_MODE === "true") {
    try {
      const fixture = await import("@/lib/services/fixtures/calendar.json");
      const events: CalendarEvent[] = fixture.default ?? [];
      return events.map(normalizeCalendarEvent);
    } catch (err) {
      console.warn("[calendar-ingestion] dev fixture load failed:", err);
      return [];
    }
  }

  try {
    const res = await apiGet<CalendarEventsResponse>("/calendar/events");
    const events = res.events ?? [];
    return events.map(normalizeCalendarEvent);
  } catch (err) {
    console.error("[calendar-ingestion] fetchCalendarActivities failed:", err);
    return [];
  }
}
