# 08 - Workstream Data Model

## Topic Statement

The workstream is the central data entity - a persistent, evolving container that groups related activities across sources and tracks status over time.

## Scope

**In-scope:** Workstream record structure, lifecycle states, persistence, activity membership, computed properties.

**Boundaries:** How workstreams are detected/created is out of scope (see 07-workstream-detection). How workstreams are displayed is out of scope (see 10-workstream-timeline, 11-workstream-detail-view).

## Data Contracts

### Workstream Record

**Identity:**

- Workstream ID: stable UUID, never reused
- Name: AI-generated, user-editable (e.g., "Acme Corp Proposal")
- Description: AI-generated one-line summary of what this workstream is about

**Membership:**

- Activity IDs: ordered set of activity record IDs (ordered by timestamp)
- Source breakdown: count of activities per source type

**Participants:**

- Participant list: deduplicated union across all member activities, each with { email, displayName, source, lastSeenTimestamp }
- Primary participant: the most frequently appearing non-self participant
- CRM enrichment per participant (if available): company, deal, VIP flag, relationship score

**Temporal:**

- Created timestamp: when the workstream was first detected
- Last activity timestamp: timestamp of the most recent member activity
- Activity timeline: sparse ordered list of (timestamp, activityId, source) tuples

**Status:**

- Lifecycle state: active, stale, archived
- Unread count: number of member activities not yet viewed by user
- Pending actions: count of AI-recommended actions not yet acted on

**AI-generated:**

- Summary: current status paragraph (see 12-ai-summary)
- Recommended action: single next-step recommendation
- Confidence: 0-1, clustering confidence
- Rationale: why these activities are grouped

**Persistence:**

- All fields persisted to IndexedDB
- Computed fields (summary, recommended action) are cached and refreshed on demand
- Last persisted timestamp for staleness detection

### Activity Record (member of workstream)

- Activity ID: unique across all sources
- Source: enum (gmail, arc-browser, google-calendar, git, local-project, claude-code, hubspot)
- Source ID: identifier within the source system
- Timestamp
- Title
- Participants: list of { email, displayName }
- Preview: short text preview
- Body: full content (nullable)
- Labels: list of strings
- Metadata: source-specific key-value pairs
- Workstream ID: nullable (null if unassigned)
- User override: boolean (true if manually assigned)
- Viewed: boolean

## Behaviors

1. **Creation**: A workstream is created by the detection system (07) with at least an ID, name, and initial set of activity IDs. All other fields are computed or defaulted.

2. **Activity addition**: When an activity is added to a workstream, the workstream's last activity timestamp, participant list, source breakdown, and unread count are recomputed.

3. **Activity removal**: When an activity is removed (reassigned to another workstream or unassigned), the same fields are recomputed. If membership drops below 2 activities, the workstream transitions to archived.

4. **Lifecycle transitions**: active -> stale (7 days no activity) -> archived (30 days no activity). Any new activity resets to active. User can manually archive or reactivate.

5. **Persistence**: Workstream records are persisted to IndexedDB. On app load, all workstreams are restored from storage before network fetches begin. Computed AI fields (summary, recommended action) are loaded from cache and refreshed in background.

6. **Ordering**: Workstreams are ordered by last activity timestamp (most recent first) for timeline display. Secondary sort by unread count (higher first).

## Acceptance Criteria

- Workstream records contain all specified fields
- Activity membership changes trigger recomputation of derived fields
- Lifecycle transitions follow defined rules (active -> stale -> archived)
- All records persist to IndexedDB and restore on app load
- Workstream IDs are stable UUIDs, never reused
- Ordering by last activity timestamp with unread count tiebreaker
