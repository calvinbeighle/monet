# Spec 10 - Real-Time Sync

## Topic Statement

The 2D strategy map is a live representation of the user's Gmail inbox. Every thread visible on the map reflects the current state of that thread in Gmail, and every action the user takes through the map reflects back to Gmail without requiring manual refresh. Synchronization runs continuously in both directions: inbound (Gmail to map) and outbound (map to Gmail). The map also runs an independent positioning tick that updates thread drift even when no email activity is occurring. Together these two processes - email sync and positioning tick - ensure the map is always current and always in motion.

---

## Scope

### In Scope

- Initial load of all inbox threads from a configurable lookback window
- Incremental sync of changes (new messages, label changes, read state) after initial load
- Inbound sync: new or updated Gmail threads appearing as new or updated map entities
- Outbound sync: replies sent through the map appearing in the Gmail Sent folder
- Bidirectional sync: actions taken directly in Gmail (archive, label, reply) reflecting on the map
- Conflict detection and resolution when the same thread is acted on simultaneously in Gmail and the app
- A visible sync status indicator showing the current health of the Gmail connection
- Offline operation using cached data when the Gmail connection is unavailable
- Queueing of user-initiated actions taken offline, with ordered replay on reconnect
- An independent positioning tick that runs on a regular interval to update thread drift positions regardless of email activity

### Out of Scope

- Non-Gmail providers
- Initial authentication and OAuth token management (covered in Spec 01)
- How thread urgency, value, and drift are computed (covered in Spec 03)
- How the map renders thread positions and animations (covered in Spec 02)
- Sync of Gmail labels beyond Inbox, Sent, and user-applied labels already visible on threads
- Sync of Spam and Trash folders
- Push notification delivery to the user's device or operating system
- Multi-account sync

---

## Data Contracts

### Inbound - What Arrives from Gmail During Sync

**Thread change event**

- Thread identifier
- Type of change: new thread, new message added to existing thread, label applied, label removed, read state changed
- History identifier at the time of the change (used to advance the sync cursor)
- Timestamp of the change

**Updated thread detail (fetched after a change event)**

- All fields described in the Thread detail contract in Spec 01
- The full current label set, reflecting any changes made directly in Gmail
- The current read/unread state of each message

**Initial load batch**

- A bounded set of threads from the inbox ordered by last activity, covering the configured lookback window
- A starting history identifier representing the state of the inbox at the moment the initial load completed

### Outbound - What the Map Sends to Gmail During Sync

**Sent reply confirmation**

- Thread identifier
- Message identifier assigned by Gmail on send
- Timestamp of send
- Whether the sent message has been reflected back in the thread's local state

**Action queue entry**

- Action type: reply, archive, label change
- Thread identifier
- Full action payload (same as defined in Spec 01 outbound contracts)
- Timestamp at which the action was initiated by the user
- Retry count
- Status: pending, in-flight, succeeded, failed

### Internal Sync State Record

- Last confirmed history identifier received from Gmail
- Timestamp of the last successful sync completion
- Current sync mode: initial load, incremental, or backfill (used when history identifier has expired)
- Current connectivity status: connected, syncing, error, offline
- Count of actions currently queued for replay
- Timestamp of the last positioning tick

---

## Behaviors

Behaviors are listed in the order they occur during a normal session.

### 1. Initial Load

- On first connection after authentication, the system determines the lookback window. The default lookback window is 30 days. The window is configurable.
- The system fetches all inbox threads with last activity within the lookback window, in reverse chronological order by last activity.
- Threads become available to the map as each one finishes loading. The map does not wait for all threads to load before rendering the first available threads.
- The system records the history identifier returned at the end of the initial load. This identifier marks the sync cursor for all subsequent incremental sync operations.
- The initial load is considered complete when all threads within the lookback window have been fetched and their full detail is available locally.
- The sync status indicator shows a distinct "initial load in progress" state for the duration of the initial load.

### 2. Incremental Sync - Polling for Changes

- After initial load completes, the system begins incremental sync. Only changes since the last recorded history identifier are requested.
- The system polls for changes at a regular interval. The interval is short enough that a new email received by the user appears as a new or updated map entity within 10 seconds under normal network conditions.
- Each poll returns a list of change events and a new history identifier. The system processes the change events and advances the cursor to the new identifier.
- For each change event referencing a thread the system knows about, the system re-fetches that thread's full detail and updates local state.
- For each change event referencing a thread not yet known to the system (for example, a thread that arrived after the initial load cutoff), the system fetches the thread's full detail and introduces it to the map as a new entity.
- If the stored history identifier is reported by Gmail as expired or invalid, the system discards the cursor, performs a full re-fetch of all inbox threads within the lookback window (equivalent to a new initial load), and records the new history identifier. The occurrence is logged.
- The sync status indicator reflects the transition between idle and actively syncing on each poll cycle.

### 3. Inbound Sync - New or Updated Threads Appear on the Map

- When a new thread is identified during incremental sync, it is introduced to the map as a new entity. The map positions it according to the positioning rules in Spec 03.
- When an existing thread receives a new message, the thread's local state is updated to include the new message. The thread's last-activity timestamp advances. The positioning engine is notified so the thread's urgency and drift can be re-evaluated.
- When a label change on an existing thread is detected (applied directly in Gmail), the thread's local label state is updated. If the change removes the Inbox label, the thread is treated as archived and moves toward the archive boundary on the map.
- When a read state change is detected on an existing thread (message marked read directly in Gmail), the thread's unread indicator on the map is updated.
- All inbound sync changes are reflected on the map within one positioning tick of the change being processed.

### 4. Outbound Sync - Map Actions Appear in Gmail

- When the user sends a reply through the map, the message is submitted to Gmail immediately. On successful send, the sent message appears in the thread's local state and in the Gmail Sent folder without waiting for the next sync cycle to confirm it.
- When the user archives a thread through the map, the Inbox label is removed in Gmail immediately. The thread moves toward the archive boundary on the map without waiting for the next sync cycle to confirm the label removal.
- Outbound actions are reflected optimistically in local state before Gmail confirmation is received. If Gmail subsequently returns a failure, local state is rolled back and the user is notified.

### 5. Bidirectional Sync - Actions Taken Directly in Gmail

- The system does not distinguish between changes that originated in the app and changes that originated directly in Gmail. All changes arrive through the incremental sync mechanism and are processed identically.
- If the user sends a reply directly in Gmail, that reply appears as a new message in the thread on the map after the next incremental sync cycle.
- If the user archives a thread directly in Gmail, the thread moves toward the archive boundary on the map after the next sync cycle detects the label removal.
- If the user applies or removes a label directly in Gmail, the thread's label state on the map is updated after the next sync cycle.

### 6. Conflict Resolution

- A conflict occurs when the user takes an action on a thread through the map at the same moment that a change to the same thread arrives via incremental sync from Gmail.
- The system applies a last-write-wins policy: whichever change carries the later timestamp is treated as the authoritative state.
- When a conflict is detected and resolved, the user is notified via a non-blocking message identifying the thread and describing what changed. The notification does not require user action to dismiss but remains visible long enough to read.
- Conflict resolution never silently discards a user-initiated action. If the user's action loses to an inbound change, the user is informed that their action was superseded.
- The system logs every conflict, including the thread identifier, the competing action types, and which write was applied.

### 7. Independent Positioning Tick

- The positioning engine runs on a regular tick interval that is independent of the email sync cycle. The tick interval and the sync poll interval are configured separately and do not need to be aligned.
- On each tick, the positioning engine re-evaluates all visible threads - updating neglect durations, recomputing target positions, and advancing actual positions toward targets - regardless of whether any new email has arrived since the last tick.
- The positioning tick fires even when the sync status is offline or error. Drift, clustering, and collision avoidance continue to run on cached local state while the Gmail connection is unavailable.
- The sync cycle notifies the positioning engine when a thread's data changes, but the positioning engine does not wait for sync events to advance its tick. The two processes are decoupled.

### 8. Offline Handling

- When the Gmail connection becomes unavailable (network failure or API error), the system transitions to offline mode. The map remains fully visible and navigable using cached thread data.
- In offline mode, the user can continue to compose replies, initiate archives, and take other actions. These actions are recorded in the action queue with a pending status rather than being submitted to Gmail immediately.
- The sync status indicator shows an offline state for the duration of the disconnection.
- The system attempts to reconnect at an exponential backoff interval with a defined maximum retry interval.
- When connectivity is restored, the system replays queued actions in the order they were initiated. Each action in the queue is submitted to Gmail and its status is updated to succeeded or failed based on the result.
- If a queued action cannot be applied on reconnect (for example, the thread has been deleted in Gmail), the action is discarded, the user is notified, and the discarded action is logged.
- After the action queue is drained, the system resumes incremental sync from the last valid history identifier. If the history identifier has expired during the offline period, a backfill re-fetch is performed.

### 9. Sync Status Indicator

- A visible sync status indicator is present on the map at all times. It reflects one of the following states: connected and idle, actively syncing, error, or offline.
- The indicator transitions to "actively syncing" at the start of each poll cycle and returns to "connected and idle" when the cycle completes with no errors.
- The indicator transitions to "error" when two or more consecutive sync cycles fail. It remains in error state until a sync cycle completes successfully.
- The indicator transitions to "offline" when the system enters offline mode and returns to "connected and idle" after reconnection and action queue drain complete.
- The indicator is always visible without requiring the user to navigate away from the map or open a settings view.

---

## State Transitions

### Sync Mode

The system operates in one of three sync modes after initial authentication:

- Initial Load - the system is performing the first full fetch of threads within the lookback window; no incremental sync is running
- Incremental - initial load is complete; the system is polling for changes using the history identifier cursor
- Backfill - the history identifier has expired; the system is performing a full re-fetch to restore the cursor; transitions back to Incremental when the re-fetch completes

Transitions:

- Initial Load -> Incremental: initial load completes and a valid history identifier is recorded
- Incremental -> Backfill: history identifier is reported expired by Gmail
- Backfill -> Incremental: full re-fetch completes and a new history identifier is recorded
- Any mode -> Initial Load: authentication is reset or the user explicitly clears local state

### Connectivity Status

- Connected - the Gmail API is reachable and the last sync cycle completed without error
- Syncing - a sync cycle is actively in progress
- Error - two or more consecutive sync cycles have failed; the system is retrying at backoff intervals
- Offline - the network is unreachable or the system has determined connectivity is lost; the action queue is active

Transitions:

- Connected -> Syncing: a sync poll cycle starts
- Syncing -> Connected: the sync cycle completes without error
- Syncing -> Error: the sync cycle fails; the previous cycle also failed
- Error -> Syncing: a retry attempt begins
- Connected -> Offline: network becomes unreachable
- Error -> Offline: retry attempts confirm network is unreachable
- Offline -> Syncing: connectivity is restored and the system begins reconnect sequence
- Syncing -> Connected: reconnect sync completes and action queue is drained

### Action Queue Entry Status

Each queued action moves through the following states:

- Pending - the action has been initiated by the user but not yet submitted to Gmail (offline or awaiting retry)
- In-Flight - the action has been submitted to Gmail and a response is awaited
- Succeeded - Gmail confirmed the action; the local state reflecting the action is authoritative
- Failed - Gmail returned an unrecoverable error for this action; the action is discarded and the user is notified

Transitions:

- Pending -> In-Flight: the system submits the action to Gmail
- In-Flight -> Succeeded: Gmail returns a success response
- In-Flight -> Pending: Gmail returns a retryable error (rate limit, transient 5xx)
- In-Flight -> Failed: Gmail returns a non-retryable error or the thread no longer exists

---

## Acceptance Criteria

- A new email received by the user in Gmail appears as a new or updated thread entity on the map within 10 seconds of arrival under normal network conditions, without any user interaction.
- A reply sent through the map appears in the user's Gmail Sent folder within the same network round-trip as the send confirmation. The sent message is visible in the thread on the map immediately after send, without waiting for a sync cycle.
- A thread archived directly in Gmail by the user moves toward the archive boundary on the map within one sync cycle of the archive action being taken in Gmail.
- A reply sent directly in Gmail by the user appears as a new message in the corresponding thread on the map within one sync cycle of the send.
- On first connection with no prior local state, the system loads all inbox threads from the last 30 days. Threads become visible on the map as they load; the map does not wait for all threads before rendering any.
- After initial load, sync operates incrementally - only changed threads are re-fetched, not the full thread list.
- When the user acts on a thread in the map and an inbound change to the same thread arrives simultaneously, the conflict is resolved by last-write-wins and the user is notified which change was applied.
- The sync status indicator always reflects the current connectivity and sync state. It shows a visually distinct state for each of connected, syncing, error, and offline. The transition from any state to any other is observable on the map without navigating to a separate view.
- When the Gmail connection is lost, the map remains usable with cached thread data. The user can continue to compose actions. The map does not go blank or become unresponsive.
- Actions taken while offline are submitted to Gmail in the order they were initiated when connectivity is restored. No offline action is silently dropped; every failure is surfaced to the user.
- Thread positions drift and update on each positioning tick even when no new email has arrived and the sync status is offline. The positioning tick is observable as continuous motion on the map independent of inbox activity.
- A thread that accumulates neglect during an offline period reflects the correct accumulated drift immediately on the next positioning tick after the session resumes, without requiring a new email to trigger the update.
