# Spec 03 - Thread Positioning and Drift

## Topic Statement

Email threads are first-class units on a 2D strategy map. Each thread occupies a position on the map that reflects its current urgency, value, recency, and degree of neglect. Positions are not static - they continuously drift based on these factors over time. The map is a living representation of the user's inbox health: threads that demand attention move toward the active zone, threads the user has neglected drift toward the lost zone, and threads cluster with others that share participants or topic affinity.

---

## Scope

### In Scope

- Initial placement of a thread when it first appears on the map
- Continuous drift mechanics driven by urgency score, value score, recency, and neglect duration
- Repositioning when the user takes an action (reply, archive, label, mark read)
- Tick-based position updates independent of new email arrival
- Zone definitions and what it means for a thread to occupy each zone
- Urgency scoring inputs and how they combine into a single urgency value
- Value scoring inputs and how they combine into a single value value
- Clustering behavior for threads sharing participants or topic affinity
- Collision avoidance so threads do not overlap
- Transition smoothness and stability requirements (no jitter, no teleportation)
- Position persistence across sessions

### Out of Scope

- How the user interacts with threads once positioned (selection, opening, replying)
- Rendering and animation implementation details
- How urgency and value scores are computed from raw email data (that is a separate scoring spec)
- Archiving or deletion of threads from the map
- Multi-user or shared map state
- Mobile or responsive layout adaptations of the map

---

## Data Contracts

### Thread Record

Each thread has the following positioning-relevant attributes available at evaluation time:

- A unique thread identifier
- Current urgency score - a normalized float from 0.0 (no urgency) to 1.0 (maximum urgency)
- Current value score - a normalized float from 0.0 (no value) to 1.0 (maximum value)
- Timestamp of the most recent message in the thread (inbound or outbound)
- Timestamp of the user's most recent reply
- Neglect duration - elapsed time since the user last took any action on the thread
- Participant list - the set of email addresses involved in the thread
- Topic tags - a set of normalized topic labels derived from subject and body content
- Current map position - an (x, y) coordinate pair in map space
- Target position - the position the thread is currently drifting toward
- Zone assignment - the zone the thread currently occupies

### Zone Definitions

The map is divided into named zones. Each zone is a region of map space with defined boundaries:

- Active zone - upper area of the map, reserved for high-urgency or high-value threads that have recent activity
- Monitor zone - middle area, for threads with moderate scores or moderate neglect
- Lost zone - lower-far area, for threads with extended neglect regardless of original score
- Archive boundary - edge region threads approach when they are candidates for removal from the visible map

### Urgency Score Inputs

The urgency score is composed from:

- Time since the last reply from the user - longer gaps increase urgency
- Sender importance - messages from contacts flagged as VIP or in a high-priority list carry higher urgency weight
- Presence of explicit deadlines in message content - detected deadline phrases raise urgency
- Thread age combined with unresolved status - older unresolved threads carry increasing urgency over time

### Value Score Inputs

The value score is composed from:

- Sender relationship category - VIP contacts, new leads, and active relationships score higher than cold or unknown senders
- Subject and body keyword signals - keywords associated with deals, commitments, or high-stakes topics raise value
- Thread length and engagement depth - longer back-and-forth threads indicate higher relational value
- Whether the thread has been explicitly starred or labeled by the user

---

## Behaviors (Execution Order)

### 1. Thread Arrival - Initial Placement

When a thread appears on the map for the first time:

- The thread is assigned a starting position in the active zone if its urgency score exceeds the active zone threshold at arrival time
- The thread is assigned a starting position in the monitor zone if its urgency and value scores are both below the active threshold
- The starting position is placed within the appropriate zone, avoiding overlap with existing threads
- If other threads on the map share participants or topic tags with the new thread, the new thread's starting position is biased toward those threads' current positions, within the collision avoidance constraint
- The thread's target position is set equal to its starting position at arrival

### 2. Tick Cycle - Continuous Drift

On every tick (a regular time interval independent of new email arrival):

- Each thread's urgency score and value score are re-evaluated from their current inputs
- Neglect duration is updated for all threads that have not received user action since the last tick
- A new target position is computed for each thread based on its updated scores and neglect duration
- Threads with increasing neglect duration have their target position shifted incrementally toward the lost zone - the rate of drift toward lost is proportional to neglect duration
- Threads with high and increasing urgency have their target position shifted toward the active zone
- Threads with high value but low urgency occupy stable positions in the monitor zone
- Threads that have crossed the neglect threshold for the lost zone are assigned a target position within the lost zone
- Actual position moves toward target position incrementally, not instantly - the gap closes by a fixed fraction per tick to produce smooth movement
- Clustering affinity is checked after target positions are computed: threads with overlapping participants or topic tags have their target positions nudged toward each other, within collision avoidance bounds
- Collision avoidance is applied after clustering adjustments: if two threads' target positions are within the minimum separation distance, they are pushed apart to satisfy the separation constraint before the next actual position update

### 3. User Action - Repositioning

When the user takes an action on a thread (reply, archive, label, mark read):

- Neglect duration resets to zero for that thread
- Urgency score inputs are re-evaluated immediately (not waiting for the next tick)
- If the action was a reply, the thread's target position snaps to the active zone immediately rather than drifting there gradually
- If the action was archive or a dismissal label, the thread's target position moves toward the archive boundary
- The thread's actual position begins moving toward the new target position using the standard fractional-step smoothing
- Clustering affinity and collision avoidance are re-evaluated for the affected thread immediately after repositioning target is set

### 4. Position Persistence

- Thread positions are persisted at the end of each tick cycle so they survive session restarts
- On session resume, threads are restored to their last persisted positions and drift resumes from that state
- Scores are re-evaluated on session resume so that threads that accumulated neglect during an offline period immediately reflect the correct drift state at next tick

---

## State Transitions

### Thread Zone States

A thread moves through the following zone states. Transitions are triggered by score evaluation on each tick (or immediately on user action):

- New - thread has just arrived and has not yet been assigned a stable position; transitions to Active or Monitor after initial placement completes
- Active - thread position is within the active zone; remains Active while urgency score stays above active threshold and neglect duration is below the neglect threshold; transitions to Monitor if urgency falls below the active threshold
- Monitor - thread position is within the monitor zone; transitions to Active if urgency rises above the active threshold; transitions to Drifting-Lost if neglect duration crosses the neglect threshold
- Drifting-Lost - thread target position is within or approaching the lost zone; thread is actively moving toward lost zone; transitions back to Monitor if user takes action before the thread fully enters the lost zone; transitions to Lost once actual position enters the lost zone
- Lost - thread is fully within the lost zone; remains Lost until user takes action; transitions to Active immediately on reply action, or to Monitor on other actions
- Approaching-Archive - thread target position is at the archive boundary following an archive or dismissal action; transitions to Archived once actual position reaches the archive boundary

### Score-to-Zone Mapping

- Urgency score above the active threshold and neglect duration below the neglect threshold - thread belongs in Active zone
- Urgency or value score in the moderate range, neglect duration below the neglect threshold - thread belongs in Monitor zone
- Neglect duration above the neglect threshold regardless of urgency or value - thread belongs in Drifting-Lost or Lost zone
- User has taken an archive or dismissal action - thread belongs in Approaching-Archive or Archived

---

## Acceptance Criteria

- A newly arrived thread appears in the active zone if its urgency score qualifies, and in the monitor zone otherwise, without requiring a user action or tick to trigger placement
- A thread that has not received any user action for an extended period visibly drifts toward the lost zone across multiple ticks, arriving in the lost zone before the neglect duration reaches the system-defined maximum neglect threshold
- A thread in the lost zone returns to the active zone when the user replies to it, and the return happens within one tick after the reply is recorded
- Two threads that share participants or topic tags are positioned closer to each other than two threads with no shared attributes, all else being equal
- No two threads on the map occupy the same position at the same time; threads that would overlap are separated by at least the minimum separation distance
- Thread positions do not jump discontinuously between ticks; movement between any two consecutive positions is smooth and bounded by the per-tick step fraction
- Thread positions are stable when scores are stable - a thread that has not changed scores or neglect duration between two ticks does not change its actual position between those ticks
- After a session restart, thread positions on the map match the last persisted positions, and drift resumes correctly reflecting any neglect that accumulated while the session was closed
- A thread that is drifting toward the lost zone but receives a user action (any action) before fully entering the lost zone is redirected away from the lost zone and does not complete the transition to Lost state
- Tick-based drift occurs on a regular interval even when no new email arrives; the map updates autonomously
