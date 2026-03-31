# Spec 09: Thread Data Model

## Topic Statement

A thread is the primary entity in the Messaging RTS application. Each thread represents a single Gmail email conversation and carries all data necessary for positioning on the strategy map, scoring, display, agent interaction, and lifecycle tracking. This spec defines the complete data contract for a thread, its computed properties, contact enrichment, lifecycle states, and behavioral rules governing transitions and persistence.

---

## Scope

### In Scope

- The thread data contract: all stored and computed properties
- Contact/participant enrichment attached to each thread
- Thread lifecycle states and the conditions that trigger transitions between them
- Persistence behavior across browser sessions
- Batch selection and bulk action behavior
- Filtering behavior by zone, label, sender, and urgency

### Out of Scope

- The visual rendering of threads on the map (covered in a separate UI spec)
- The agent decision logic that generates urgency or value scores (covered in the agent spec)
- Gmail API integration details (covered in the connector spec)
- Cluster layout algorithms (covered in the map layout spec)
- Notification or alert behavior

---

## Data Contracts

### Core Thread Properties

Every thread carries the following observable properties sourced from the underlying Gmail thread:

- A unique thread identifier that maps 1:1 to a Gmail thread ID
- The conversation subject line
- A list of participants (see Contact Enrichment below)
- A count of total messages in the thread
- The timestamp of the most recent message
- The timestamp of the first message in the thread
- All Gmail labels currently applied to the thread
- A read/unread status flag
- A short text snippet or preview drawn from the latest message body

### Computed Properties

The following properties are derived and recalculated when their inputs change. They are not stored in Gmail - they are owned by the application:

- Urgency score: a numeric rating representing how time-sensitive the thread is
- Value score: a numeric rating representing strategic or relationship importance
- Map position: an x,y coordinate pair describing where the thread sits on the 2D strategy map
- Current zone: the named region of the map the thread currently occupies, derived from its x,y position
- Drift velocity: a directional rate of positional change that moves the thread across the map as time passes without a reply
- Cluster membership: the identifier of the cluster group this thread belongs to, if any

### Contact Enrichment

Each participant in a thread carries enrichment data beyond their email address:

- Display name
- Email address
- Organization or company affiliation
- VIP status flag (boolean)
- Relationship score: a numeric indicator of the strength and recency of the relationship with this contact
- Response history: a record of past reply patterns, including average response time and thread frequency

---

## Behaviors (Execution Order)

The following behaviors occur in this order when a thread enters or changes state within the application:

1. When the application loads, all threads are fetched from persistent storage first. If persistent state exists for a thread, it is restored before any re-computation occurs.

2. After restoration, computed properties (urgency score, value score, map position, zone, drift velocity, cluster membership) are recalculated against current data. If any computed value differs from the stored value, the stored value is updated.

3. When a new thread arrives from Gmail (no existing record), it is assigned default computed values, placed in the "new" lifecycle state, and written to persistent storage.

4. When an existing thread receives a new message from Gmail, the core properties (message count, latest timestamp, snippet, labels, read/unread) are updated first, then computed properties are recalculated, then lifecycle state is evaluated for a transition.

5. When the user sends a reply, the thread transitions lifecycle state before computed properties are recalculated, so that the post-reply scores reflect the post-reply state.

6. Drift is applied on a timed interval. On each drift tick, drift velocity is applied to map position. If the new position crosses a zone boundary, the current zone is updated. If the new zone meets the at-risk threshold, a lifecycle transition is evaluated.

7. Contact enrichment is fetched once per session per unique participant address. Enrichment data is attached to the participant record on the thread. If enrichment is unavailable, the thread is still displayed with the raw email address.

8. When an agent takes an action on a thread, the action is logged against the thread record and the relevant properties are updated before the result is surfaced to the user.

9. When the user manually moves a thread on the map, the x,y position is updated immediately. Drift velocity is recalculated from the new position. The zone is updated to match the new position.

---

## State Transitions

Threads follow a defined lifecycle. The states are:

- **New** - thread has arrived but the user has not engaged with it
- **Active** - thread is in active exchange; most recent reply is from the user or a recent inbound message has been received
- **Waiting** - the user has replied and is awaiting a response from the other party
- **At-Risk** - time has elapsed without a reply and the thread has drifted toward the at-risk zone
- **Lost** - the thread has exceeded the at-risk threshold with no engagement; presumed dropped
- **Handled** - the thread has been explicitly resolved by the user or an agent

### Transition Rules

The following conditions trigger state changes. Each condition is observable and verifiable:

**New -> Active**

- Triggered when the user opens and reads the thread for the first time
- Triggered when the user sends a reply to a new thread

**New -> Handled**

- Triggered when the user applies a "handled" action directly from the new state without replying

**Active -> Waiting**

- Triggered when the user sends a reply and no inbound message has arrived since that reply

**Active -> At-Risk**

- Triggered when drift velocity moves the thread into the at-risk zone while in active state without a recent reply

**Waiting -> Active**

- Triggered when a new inbound message arrives from the other party

**Waiting -> At-Risk**

- Triggered when a configured time threshold passes without a reply from the other party

**At-Risk -> Active**

- Triggered when a new inbound message arrives while in at-risk state
- Triggered when the user sends a reply while in at-risk state

**At-Risk -> Lost**

- Triggered when the at-risk threshold is exceeded and no engagement has occurred

**At-Risk -> Handled**

- Triggered when the user or agent explicitly marks the thread as handled from at-risk state

**Lost -> Active**

- Triggered when a new inbound message arrives on a lost thread

**Any State -> Handled**

- Triggered by explicit user action or agent action marking the thread as resolved

State transitions are recorded with a timestamp and the triggering event type so that the history is inspectable.

---

## Thread Persistence

- Thread state (lifecycle state, map position, drift velocity, computed scores, contact enrichment, cluster membership) is written to persistent storage whenever any property changes.
- On browser refresh or application restart, each thread loads from its last persisted state before any network fetch occurs.
- If the Gmail data for a thread has changed since the last session (new messages, label changes, read status), the updated Gmail data is merged into the persisted record and computed properties are recalculated.
- If a thread exists in persistent storage but no longer exists in Gmail, it is removed from the map.
- If a thread exists in Gmail but not in persistent storage, it is treated as new and initialized from scratch.

---

## Batch Operations

- The user can select multiple threads simultaneously. The selection is a distinct state tracked separately from individual thread state.
- When a batch action is applied, it is applied to each selected thread in sequence. Each thread transitions state independently - a batch action does not aggregate threads into a single record.
- Batch actions can include: mark as handled, move to zone, apply label, assign to agent.
- After a batch action, each thread's computed properties and lifecycle state are updated individually.
- Bulk selection is cleared after a batch action completes.

---

## Thread Filtering

- The application can show or hide threads based on filter criteria without deleting or modifying thread state.
- Filters can be applied by: map zone, Gmail label, sender email address or domain, urgency score range.
- A hidden thread retains all its state, continues to drift, and can receive new messages. It becomes visible again when the filter is cleared or the thread no longer matches the filter condition.
- If a hidden thread receives a new message that would trigger a lifecycle transition to at-risk or lost, it surfaces back into the visible set regardless of the active filter.
- Filter state persists across browser refresh.
