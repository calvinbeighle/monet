# Spec 01 - Email Integration

## Topic Statement

The system authenticates with Gmail on behalf of a user, reads that user's email threads, and allows the user to reply to threads, create drafts, and archive threads. Threads are the atomic unit of communication throughout - individual messages exist only as components of a thread and are never surfaced independently. All email state is kept synchronized with Gmail in near real time.

---

## Scope

### In Scope

- Gmail account authentication via OAuth2
- Reading thread lists and thread contents
- Sending replies within existing threads
- Creating, saving, and discarding drafts
- Archiving threads (removing the Inbox label)
- Extracting thread metadata for use by the map layer
- Keeping local thread state synchronized with Gmail
- Token refresh and session management
- Rate limit enforcement and quota-aware behavior
- Graceful degradation when the Gmail API is unavailable

### Out of Scope

- Non-Gmail providers (Outlook, IMAP, etc.)
- Composing messages that start new threads (outbound cold email)
- Label creation or management beyond applying/removing Inbox
- Attachment handling beyond acknowledging their presence
- Spam or Trash folder operations
- Multi-account support
- Search beyond what is required to populate the map view
- Push notification infrastructure beyond what Gmail natively provides via its watch mechanism

---

## Data Contracts

### Inbound - What the System Receives from Gmail

**Thread list entry**

- Thread identifier (opaque, stable)
- Snippet (short preview of the last message)
- History identifier (for incremental sync)

**Thread detail**

- Thread identifier
- Ordered list of messages within the thread
- For each message: sender address, recipient addresses (To, Cc, Bcc), timestamp, subject, plain-text and HTML body, list of label identifiers applied, list of attachment descriptors (filename, MIME type, size - no binary content)
- Labels applied to the thread as a whole

**Derived thread metadata (computed locally, not fetched)**

- All unique participant addresses
- Canonical subject (from the first message)
- Thread start timestamp (first message)
- Thread last-activity timestamp (most recent message)
- Message count
- Whether the thread contains unread messages
- Whether the thread is in the Inbox

### Outbound - What the System Sends to Gmail

**Reply**

- Thread identifier the reply belongs to
- In-Reply-To reference (message identifier of the message being replied to)
- References chain (all prior message identifiers in the thread)
- Recipient addresses (pre-populated from thread, editable)
- Subject (pre-populated as Re: <original subject>, not editable)
- Body

**Draft**

- Same fields as a reply, plus an explicit draft state flag
- Draft identifier (assigned by Gmail on creation, used for subsequent saves or sends)

**Archive action**

- Thread identifier
- Instruction to remove the Inbox label

---

## Behaviors

Behaviors are listed in the order they occur during a user session.

### 1. Authentication (via Nango)

- OAuth2 authentication is handled entirely by Nango (managed OAuth platform). The application does not implement token exchange, refresh, or storage directly.
- On first launch, the system creates a Nango connect session via the Nango API and redirects the user to the Nango-hosted OAuth flow for Gmail.
- The user grants the minimum scopes required: read access to email, compose access, and modify access (for archiving).
- After the user approves, Nango stores the OAuth tokens. The application receives a connection confirmation.
- The application checks connection status via Nango's connection API (GET /connection/{connectionId}).
- All Gmail API calls are proxied through Nango's proxy endpoint, which handles token refresh transparently. The application never touches raw tokens.
- The user is not shown raw token values at any point.
- If the user denies the consent prompt, the system remains in an unauthenticated state and displays an explanation that email features are unavailable until authorization is granted.
- On subsequent launches, the system checks Nango connection status. If a valid connection exists, authentication is silent. The user is not shown a login screen.
- Environment variables required: NANGO_SECRET_KEY, NANGO_GMAIL_CONNECTION_ID (defaults to "gmail"), NANGO_HOST (defaults to https://api.nango.dev).

### 2. Initial Thread Load

- After successful authentication, the system fetches the user's Inbox thread list.
- Threads are fetched in reverse chronological order by last activity.
- For each thread in the list, the system fetches full thread detail.
- The system extracts and stores the derived metadata described in the data contracts section.
- The map layer is notified that threads are available once the initial batch is loaded. Partial loads are acceptable - threads become available to the map as each one finishes loading, not all at once.
- The system records the history identifier returned by Gmail so that subsequent syncs are incremental.

### 3. Ongoing Synchronization

- After initial load, the system checks for new activity at a regular interval. The interval must be short enough that a reply received by the user appears on the map within one minute under normal network conditions.
- The system uses Gmail's incremental history mechanism rather than re-fetching all threads. Only changes since the last recorded history identifier are requested.
- If the history identifier is no longer valid (Gmail history has been purged), the system falls back to a full re-fetch and logs the occurrence.
- When a thread changes (new message, label change, etc.), the system updates only that thread's local state and notifies the map layer of the specific change.
- If Gmail supports push notifications via its watch mechanism, the system may use that instead of polling. The synchronization guarantees above apply regardless of whether push or polling is used.

### 4. Sending a Reply

- The user composes a reply from within the map interface. The system pre-populates recipient addresses and subject from the thread.
- Before sending, the system validates that the reply has at least one recipient address and a non-empty body.
- If validation fails, the system surfaces a specific error describing what is missing. The draft is preserved.
- If validation passes, the system sends the reply to Gmail.
- On successful send, the sent message appears in the thread's local state immediately, without waiting for a sync cycle.
- On failure, the system retries according to the error handling rules below. The composed reply text is preserved and the user is informed of the failure.

### 5. Creating and Managing Drafts

- The user can save a reply in progress as a draft without sending.
- A draft is assigned a Gmail draft identifier on first save. Subsequent saves update the same draft rather than creating a new one.
- Drafts associated with a thread are visible in that thread's detail.
- The user can discard a draft. On discard, the draft is deleted from Gmail.
- When the user sends a draft, the system sends it as a reply and removes the draft state.

### 6. Archiving a Thread

- The user triggers an archive action on a thread from the map interface.
- The system removes the Inbox label from the thread in Gmail.
- The thread is immediately removed from the Inbox view in local state, without waiting for a sync cycle.
- If the archive call fails, the thread remains in the Inbox view and the user is informed of the failure.

---

## State Transitions

### Authentication State (Nango-managed)

- Unauthenticated - no Nango connection exists for this user
- Authenticating - the Nango OAuth flow is in progress (user redirected to Nango connect session)
- Authenticated - Nango reports a valid connection (token refresh is handled transparently by Nango)
- Reauthentication Required - Nango reports the connection is broken or revoked; the user must reconnect

Transitions:

- Unauthenticated -> Authenticating: user initiates sign-in (Nango connect session created)
- Authenticating -> Authenticated: Nango OAuth flow completes successfully
- Authenticating -> Unauthenticated: user denies consent or flow fails
- Authenticated -> Reauthentication Required: Nango reports connection broken (token revoked, refresh failed)
- Reauthentication Required -> Authenticating: user initiates reconnection

### Thread Sync State

- Unloaded - no local data for this thread
- Loading - thread detail fetch is in progress
- Loaded - thread detail is present and current
- Stale - a sync cycle has returned a change indicator but the updated detail has not yet been fetched
- Error - the last fetch attempt failed

Transitions:

- Unloaded -> Loading: initial load or sync identifies the thread
- Loading -> Loaded: fetch succeeds
- Loading -> Error: fetch fails after all retries exhausted
- Loaded -> Stale: sync cycle returns a change for this thread
- Stale -> Loading: re-fetch is initiated
- Error -> Loading: manual retry or next sync cycle

### Draft State

- None - no draft associated with the current reply composition
- Unsaved - the user has content in the compose area that has not been saved to Gmail
- Saved - a Gmail draft identifier exists and local content matches the last saved version
- Dirty - a Gmail draft identifier exists but local content has changed since the last save
- Sending - the draft is being submitted as a reply
- Discarded - the user has deleted the draft (terminal, returns the compose context to None)

Transitions:

- None -> Unsaved: user begins typing
- Unsaved -> Saved: first explicit save to Gmail succeeds
- Saved -> Dirty: user modifies content after a save
- Dirty -> Saved: save to Gmail succeeds
- Saved -> Sending: user triggers send
- Dirty -> Sending: user triggers send (save-then-send is acceptable)
- Sending -> None: send succeeds; draft is removed from Gmail
- Sending -> Saved: send fails; draft is preserved

---

## Error Handling and Offline Behavior

- When the Gmail API returns a rate limit or quota exceeded response, the system pauses all outbound requests for the duration indicated in the response. Reads are deprioritized before writes. User-initiated send and archive actions are queued and retried before background sync.
- When the Gmail API is unreachable (network failure, 5xx error), the system enters a degraded mode: local thread state remains visible and usable on the map, but no new data is fetched and the user is informed that Gmail is currently unavailable.
- In degraded mode, the system continues attempting to reconnect at an exponential backoff interval with a defined maximum interval.
- When connectivity is restored, the system resumes from the last valid history identifier. Actions queued during the outage (sends, archives) are executed in order.
- If a queued action can no longer be executed after connectivity is restored (for example, the thread was deleted by another client), the system discards the action, notifies the user, and logs the conflict.
- The system never silently drops a user-initiated action. Every failure is surfaced.

---

## Rate Limiting and Quota Management

- The system tracks the number of Gmail API units consumed per second and per day against known Gmail quota limits.
- Background sync operations consume fewer quota units than user-initiated operations. When quota is near exhaustion, background sync frequency is reduced first.
- If daily quota is exhausted, the system enters a read-only degraded mode for the remainder of the quota window. Sending, drafting, and archiving are disabled with a clear message to the user explaining why.
- The system never makes API calls that it can predict will exceed quota.
