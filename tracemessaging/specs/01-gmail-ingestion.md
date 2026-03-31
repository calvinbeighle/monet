# 01 - Gmail Ingestion

## Topic

Fetching, normalizing, and continuously syncing Gmail email data into the local activity store.

## Scope

**In-scope:** Gmail OAuth authentication, initial inbox fetch, incremental sync, offline caching, normalization of email threads into a common activity format.

**Boundaries:** What happens after activities are stored (workstream detection, UI rendering) is out of scope. Outbound email actions (reply, draft, archive) are covered in spec 10.

## Data Contracts

### Raw Gmail Thread (input)

- Thread ID (unique, stable across syncs)
- Messages: ordered list, each with sender, recipients, timestamp, subject, body (HTML/text), labels, attachment descriptors
- History ID (for incremental sync cursor)
- Labels: INBOX, UNREAD, STARRED, IMPORTANT, CATEGORY\_\*, user labels

### Normalized Activity (output)

- Source: "gmail"
- Source ID: Gmail thread ID
- Title: canonical subject (stripped of Re:/Fwd: prefixes)
- Participants: deduplicated list of all senders and recipients with email + display name
- Timestamps: first message, latest message, latest user reply
- Snippet: latest message preview text
- Body content: full message bodies (for AI processing)
- Labels/tags: Gmail labels mapped to local tag set
- Read/unread flag
- Starred flag
- Raw metadata: full Gmail thread object for reference

## Behaviors

### Authentication

- OAuth2 flow via Nango proxy (provider config key: "google-mail")
- On first launch: redirect to Nango connect URL, wait for callback confirming active connection
- On subsequent launches: verify existing Nango connection is active; if token expired, Nango handles refresh transparently
- If connection is revoked or unrecoverable: transition to unauthenticated state, surface re-auth prompt

### Initial Load

- Fetch all inbox threads from the past 30 days (configurable lookback window)
- Threads are normalized and stored as they arrive (progressive, not batch)
- Each stored thread is immediately available for workstream detection
- Initial load completes when all threads in the lookback window are fetched and stored

### Incremental Sync

- Poll-based using Gmail history API with stored history cursor
- Poll interval: 30 seconds (configurable)
- New threads and thread updates (new messages, label changes, read state changes) are fetched, normalized, and upserted into the activity store
- History ID expiry triggers a full re-fetch of the lookback window (backfill mode), then resumes incremental
- New or updated activities are available within one sync cycle of the change occurring in Gmail

### Offline Behavior

- All fetched activities are persisted locally (IndexedDB)
- When offline: no sync attempts, exponential backoff for reconnection
- On reconnect: resume incremental sync from last stored history cursor
- If history cursor is expired on reconnect: full backfill

### Normalization Rules

- Thread subject: strip leading Re:/Fwd: prefixes, collapse whitespace
- Participants: extract email + display name from From/To/CC headers, deduplicate by email
- Timestamps: parse to UTC epoch milliseconds
- Body: preserve HTML for display, extract plain text for AI processing
- Labels: map Gmail system labels to local tags (INBOX -> "inbox", STARRED -> "starred", etc.), preserve user label names as-is

## Acceptance Criteria

- Gmail OAuth completes without manual token management
- 30-day inbox loads progressively, each thread available immediately after fetch
- Incremental sync detects new emails within 30 seconds of arrival
- History ID expiry triggers automatic backfill without data loss
- All threads persist locally and survive app restart
- Normalized activities contain all fields required for workstream detection (participants, timestamps, subject, body, labels)
