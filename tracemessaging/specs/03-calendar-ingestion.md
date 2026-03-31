# 03 - Google Calendar Ingestion

## Topic Statement

The system reads Google Calendar events to provide scheduling context for workstream detection and timeline display.

## Scope

**In-scope:** Reading calendar event data, normalizing events into activity records, tracking upcoming and recent events.

**Boundaries:** Creating or modifying calendar events is out of scope for MVP. Workstream assignment is out of scope (see 07-workstream-detection).

## Data Contracts

### Raw Calendar Event (input)

- Event ID (string)
- Summary (title)
- Start/end datetime
- Attendees: list of { email, displayName, responseStatus }
- Description (body text, may contain agenda/links)
- Location (physical or virtual meeting link)
- Recurrence rules (if recurring)
- Status (confirmed, tentative, cancelled)

### Normalized Activity Record (output)

- Source: "google-calendar"
- Source ID: event ID
- Timestamp: event start datetime
- Title: event summary
- Participants: attendee list as { email, displayName }
- Preview: first 200 characters of description, or location if no description
- Body: full description
- Labels: ["calendar", status]
- Metadata: { startTime, endTime, location, isRecurring, responseStatus, meetingLink }

## Behaviors (execution order)

1. **Data source**: Read calendar events from the cached `calendar_events.json` file. If OAuth is available via Nango, fetch directly from Google Calendar API for the current user. Fall back to cached file if API is unavailable.

2. **Time window**: Fetch events from 14 days in the past to 14 days in the future. Past events provide context for recent work. Future events provide context for upcoming work and preparation.

3. **Normalization**: Each calendar event becomes one activity record. Recurring events are expanded into individual instances within the time window. Cancelled events are excluded.

4. **Participant extraction**: Attendee lists provide strong signals for workstream detection. Each attendee's email and name are extracted. The user's own entry is excluded from the participant list.

5. **Meeting link extraction**: If the event description or location contains a video meeting URL (Zoom, Google Meet, etc.), it is extracted into metadata for display.

6. **Refresh**: Re-fetch calendar data every 5 minutes to capture new invitations and changes.

## Acceptance Criteria

- Reads calendar events from cached file or API
- Normalizes events into activity records with attendees, times, and descriptions
- Covers 14-day past and 14-day future window
- Expands recurring events into individual instances
- Extracts meeting links from descriptions and locations
- Refreshes every 5 minutes
- Excludes cancelled events
