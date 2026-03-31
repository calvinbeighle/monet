# Spec 07 - Game Mechanics

## Topic Statement

Game mechanics transform passive inbox management into an active, high-stakes engagement loop. Every thread carries a latency clock. Every reply either builds or erodes trust. Opportunities open and close. Losses accumulate visibly. The system surfaces these dynamics continuously, creating accountability pressure and rewarding disciplined engagement patterns.

---

## Scope

### In Scope

- Response latency risk scoring and visual representation per thread
- Trust score calculation and decay per contact
- Opportunity detection, window tracking, and pulse behavior
- Lost-thread marking and running loss tally
- Streak counters for inbox-zero and zero-lost-thread days
- Session summary panel with engagement statistics
- Front health metric (global score visible at all times)
- Map-alert notifications for critical game events

### Out of Scope

- Leaderboards or social/competitive mechanics between users
- Gamification badges or achievement unlocks
- Monetization or premium tier gating tied to scores
- Thread content analysis (handled by agent layer, not mechanics layer)
- Contact-level data storage beyond trust scores and last-interaction timestamps
- Push notifications to external devices (in-app alerts only)

---

## Data Contracts

### Thread Record (game-relevant fields)

- Thread identifier
- Thread type - one of: cold-outreach, warm-intro, existing-relationship, internal, transactional
- Last inbound message timestamp
- Last outbound reply timestamp
- Current risk score - numeric, 0 to 100
- Risk tier - one of: safe, elevated, critical, lost
- Opportunity flag - boolean
- Opportunity window open timestamp
- Opportunity window expiry timestamp
- Opportunity state - one of: none, ripe, fading, expired

### Contact Record (game-relevant fields)

- Contact identifier
- Trust score - numeric, 0 to 100
- Trust tier - one of: new, building, established, high-trust
- Last reply timestamp (outbound to this contact)
- Consecutive response streak - integer count of on-time replies
- Trust decay active - boolean

### Session Record

- Session start timestamp
- Session end timestamp (or "active")
- Threads handled count
- Opportunities captured count
- Risks mitigated count
- Threads lost count
- Agents deployed count

### Front Health Record

- Computed health score - numeric, 0 to 100
- Component breakdown: risk load, trust average, opportunity capture rate, loss rate
- Last computed timestamp

### Streak Record

- Inbox-zero streak - integer days
- Zero-lost-thread streak - integer days
- Current day inbox-zero achieved - boolean
- Current day zero-lost achieved - boolean

### Latency Tolerance Table

Each thread type carries a defined tolerance window and critical threshold:

- cold-outreach: elevated at 12 hours, critical at 24 hours, lost at 48 hours
- warm-intro: elevated at 6 hours, critical at 12 hours, lost at 24 hours
- existing-relationship: elevated at 24 hours, critical at 48 hours, lost at 96 hours
- internal: elevated at 4 hours, critical at 8 hours, lost at 16 hours
- transactional: elevated at 48 hours, critical at 96 hours, lost at 168 hours

---

## Behaviors in Execution Order

### 1. Thread Ingestion

When a new inbound message arrives, the thread record is created or updated with the inbound timestamp. The latency clock starts immediately. The thread type is assigned (by the agent layer) before risk scoring begins. If no type is assigned within 60 seconds of ingestion, the thread defaults to existing-relationship.

Acceptance criteria:

- A newly ingested thread has a risk score of 0 and risk tier of "safe" at the moment of creation.
- Threads without an assigned type after 60 seconds display as existing-relationship for all latency calculations.
- The latency clock begins from the inbound message timestamp, not from when the user views the thread.

### 2. Continuous Risk Scoring

On a rolling cadence (at minimum every 5 minutes), each unanswered thread's elapsed time since last inbound message is compared against its type's latency tolerance thresholds. The risk score rises continuously between thresholds (not in discrete jumps). Crossing a threshold advances the risk tier.

Acceptance criteria:

- A thread's risk score increases monotonically as time passes without a reply, for every thread type.
- A thread that crosses the elevated threshold displays a color shift observable to the user without any interaction.
- A thread that crosses the critical threshold displays a pulsing visual indicator.
- A thread that crosses the lost threshold is visually moved toward or into the "lost zone" on the front map.
- Risk score does not decrease unless the user sends a reply.

### 3. Risk Reset on Reply

When the user (or an approved agent acting on behalf of the user) sends a reply to a thread, the risk score resets to 0 and the risk tier returns to "safe." The latency clock restarts from the reply timestamp.

Acceptance criteria:

- Immediately after a reply is sent, the thread's visual state returns to the safe appearance with no latency indicators active.
- The risk clock restarts from zero from the moment the reply is sent, not from when the recipient reads it.
- Replies sent by agents count identically to user-sent replies for risk reset purposes.

### 4. Trust Score Update on Reply

When a reply is sent to a contact, the contact's trust score is evaluated. If the reply was sent within the "on-time" window for the thread type (before the elevated threshold), the consecutive response streak increments and the trust score increases. The trust increase is larger for high-latency-tolerance thread types (existing-relationship) than for low-latency-tolerance types (internal), reflecting that timely personal replies carry more weight.

Acceptance criteria:

- A contact's trust score is observable by inspecting that contact's record or hovering their name in any thread.
- Three consecutive on-time replies to the same contact produce a visible trust indicator on that contact's threads.
- An on-time reply that crosses the contact's trust tier boundary (e.g., building to established) triggers a visible state change on that contact's display across all their threads.

### 5. Trust Decay

When a contact has not received any reply for longer than twice the thread type's critical threshold, trust decay activates. Trust score decreases at a defined rate until either a reply is sent (which resets decay and resumes building) or the trust score reaches 0. Decay does not drop a contact below their established trust tier if they have held that tier for more than 30 days of continuous history.

Acceptance criteria:

- A contact whose trust decay is active displays a decay indicator distinguishable from their non-decaying state.
- Sending a reply to a contact with active decay immediately deactivates the decay indicator.
- A long-standing established-tier contact does not drop below the established tier floor regardless of decay duration.

### 6. Opportunity Detection

When the agent layer flags a thread as an opportunity (new lead, warm intro, decision-maker engagement), the thread record sets the opportunity flag to true and the opportunity window opens. The window duration is defined per opportunity subtype and is set by the agent layer at detection time.

Acceptance criteria:

- An opportunity-flagged thread is visually elevated on the front map above non-opportunity threads at the same risk tier.
- The opportunity window remaining time is visible on the thread without requiring the user to open the thread.

### 7. Opportunity Pulse and Fade

While an opportunity window is open and more than half of the window time remains, the thread displays a "ripe" pulse visual. When less than half the window time remains, the state shifts to "fading" with a distinct visual indicator. When the window expires without the user engaging, the opportunity state becomes "expired" and the thread's visual elevation drops. The opportunity is counted as missed in the session record.

Acceptance criteria:

- The visual difference between "ripe" and "fading" opportunity states is distinguishable without requiring tooltip or hover interaction.
- An expired opportunity is not removed from the front map - it remains visible but without elevation or pulse.
- Expired opportunities increment the session's missed-opportunity count.

### 8. Opportunity Capture

When the user (or an approved agent) replies to an opportunity-flagged thread while the window is open, the opportunity state transitions to captured. Captured opportunities increment the session's opportunities-captured count and contribute positively to front health.

Acceptance criteria:

- A captured opportunity displays a distinct captured state, different from both active and expired states.
- The session summary reflects the capture immediately, not only at session end.

### 9. Lost Thread Marking

When a thread crosses the lost threshold (risk tier becomes "lost"), it is marked visibly in the lost zone of the front map. The running tally of lost threads in the current session increments. Lost threads are not removed from view - they remain visible as a permanent accountability record for the session.

Acceptance criteria:

- A thread entering the lost zone is marked with a distinct visual that persists until the session ends.
- The running lost-thread tally is visible on the front map at all times once any thread has been lost in the session.
- A user reply to a lost-tier thread does not remove it from the lost tally for the session (loss is recorded, even if re-engaged).

### 10. Streak Evaluation

At the end of each calendar day (midnight in the user's local timezone), the system evaluates whether the user achieved inbox-zero (all threads at risk tier "safe" at day end) and zero-lost-threads (no threads entered the lost tier during the day). If both conditions are met for the day, both streak counters increment. If either condition is not met, the corresponding streak counter resets to 0. Streaks are evaluated independently.

Acceptance criteria:

- The streak counter is visible on the front map at all times.
- A streak counter that increments changes its display immediately at midnight, not at the next user session.
- A streak counter that resets to 0 after a missed day displays 0 (not the previous count) at the start of the following day's session.

### 11. Front Health Calculation

Front health is computed continuously from four components: current risk load (the distribution of threads across risk tiers, weighted by thread type), average contact trust score across all active contacts, opportunity capture rate (captured vs. total opportunities this session), and loss rate (lost threads as a percentage of total active threads). These components are weighted and combined into a single 0-to-100 score.

Acceptance criteria:

- The front health score is visible on the front map at all times without any interaction required.
- The front health score changes visibly within 5 minutes of any event that affects its components.
- When front health drops below 50, the score display changes visual state to indicate degraded health.
- When front health drops below 25, the score display changes visual state to indicate critical health.

### 12. Map Alert Notifications

Critical game events surface as map alerts - persistent overlays on the front map that require acknowledgment. Alert types and their trigger conditions:

- New high-value thread: a thread with opportunity-flag true and less than 30 minutes on the window clock
- Thread about to be lost: any thread within 30 minutes of crossing the lost threshold
- Agent task completed: an approved agent finishes a drafting or action task
- Streak at risk: the current day is within 2 hours of midnight and inbox-zero has not yet been achieved

Acceptance criteria:

- Map alerts appear without any user interaction being required to trigger them.
- Each alert type is visually distinguishable from other alert types.
- Acknowledging (dismissing) an alert removes it from the map without taking any action on the underlying thread.
- An alert for "thread about to be lost" that resolves before acknowledgment (because the user replied) auto-dismisses.
- Multiple simultaneous alerts stack or queue without obscuring each other or critical front map information.

### 13. Session Summary

When the user requests a session summary (via explicit action) or when the system detects session end (no interaction for a configurable idle period), a summary panel is presented. The panel shows: threads handled, opportunities captured, opportunities missed, risks mitigated (threads that were at elevated or critical and received a reply), threads lost, agents deployed, and the net change in front health from session start to end.

Acceptance criteria:

- The session summary is accessible via a single action from the front map.
- Every count in the summary matches the running tallies observable during the session.
- The session summary does not auto-dismiss - it requires explicit user dismissal.
- After dismissal, a new session record begins with all counters reset to 0.

---

## State Transitions

### Thread Risk Tier

```
safe -> elevated    : elapsed time exceeds type's elevated threshold
elevated -> critical : elapsed time exceeds type's critical threshold
critical -> lost    : elapsed time exceeds type's lost threshold
elevated -> safe    : reply sent
critical -> safe    : reply sent
lost -> safe        : reply sent (loss remains recorded in session tally)
```

### Opportunity State

```
none -> ripe        : agent layer sets opportunity flag, window opens, more than 50% window time remains
ripe -> fading      : window time drops below 50% remaining
fading -> expired   : window time reaches 0 with no user or agent engagement
ripe -> captured    : user or approved agent replies while window is open
fading -> captured  : user or approved agent replies while window is open
```

### Trust Tier

```
new -> building     : trust score crosses building threshold (score >= 20)
building -> established : trust score crosses established threshold (score >= 50)
established -> high-trust : trust score crosses high-trust threshold (score >= 80)
high-trust -> established : trust decay reduces score below high-trust threshold (floor applies after 30 days)
established -> building : trust decay reduces score below established threshold (floor applies after 30 days)
building -> new     : trust decay reduces score below building threshold
```

### Contact Trust Decay

```
inactive -> decaying : no reply sent to contact for longer than 2x the critical threshold of the most recent thread type
decaying -> inactive : reply sent to contact
```

### Streak State (per streak type)

```
0 -> 1              : day ends with condition met (inbox-zero or zero-lost)
N -> N+1            : day ends with condition met, previous day also met
N -> 0              : day ends with condition not met
```

### Front Health Tier

```
healthy (>=75) -> degraded (<50) : health score drops below 50
degraded -> healthy              : health score rises to or above 75
degraded -> critical (<25)       : health score drops below 25
critical -> degraded             : health score rises to or above 25
```
