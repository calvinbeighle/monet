# Spec 05 - Agent Units

## Topic Statement

Agent Units are the deployable AI actors in the Messaging RTS. Each unit has a distinct role, capacity, visual identity, and output type. Users deploy units onto thread clusters on the 2D strategy map; the units analyze their assigned threads and propose actions. No action is taken until the user explicitly approves the proposal. This spec defines the six agent types, their capabilities, state lifecycle, data contracts, and behavioral rules.

---

## Scope

### In Scope

- Definition of the six agent types: Closer, Researcher, Scheduler, Cleaner, Drafter, Escalation Bot
- Per-agent visual identity (icon and color) on the map
- Per-agent status states and valid transitions
- Per-agent thread capacity (simultaneous thread handling limit)
- Per-agent output types
- The user-approval gate that applies to all agent outputs
- The cooldown and queue mechanic that governs redeployment
- Data contracts for agent instances and their outputs

### Out of Scope

- The thread cluster rendering and map layout (covered in a separate map spec)
- The user approval UI flow (covered in the proposal review spec)
- Agent creation or configuration by the user (covered in the agent management spec)
- AI model selection or prompt engineering internals
- Notification delivery channels (covered in the notifications spec)
- Calendar integration details for Scheduler (covered in the integrations spec)

---

## Data Contracts

### Agent Definition

Each agent type is a fixed definition in the system. An agent definition carries:

- A unique type identifier (one of the six named types)
- A display name shown on the map and in UI panels
- A visual icon key referencing the map icon set
- A hex color used for the unit's map marker and status ring
- A maximum thread capacity (integer, 1 or greater)
- A cooldown duration in seconds that begins after the agent reaches completed or failed status
- A list of output types the agent is permitted to produce

### Agent Instance

When a user deploys an agent onto a thread cluster, an agent instance is created. An instance carries:

- A unique instance identifier
- A reference to the agent type definition
- The identifier of the thread cluster it is assigned to
- The list of individual thread identifiers within scope
- The current status (one of: idle, deployed, working, completed, failed)
- Timestamps for: created, deployed, work started, completed or failed
- The cooldown expiry timestamp (set when status transitions to completed or failed)
- A list of pending proposals waiting for user review
- A count of approved and rejected proposals

### Proposal

When an agent completes analysis of a thread, it emits a proposal. A proposal carries:

- A unique proposal identifier
- The instance identifier that generated it
- The thread identifier the proposal targets
- The output type (draft, label assignment, archive action, enrichment data, time proposal, escalation flag)
- The proposed content appropriate to the output type
- A status: pending, approved, rejected
- Timestamps for: created, reviewed

---

## Agent Type Definitions

### Closer

- Icon: a closing bracket or checkmark marker; color: amber
- Capacity: up to 5 threads simultaneously
- Cooldown: 10 minutes after reaching completed or failed status
- Output types: reply draft, follow-up draft, close-action proposal (mark resolved, move to archive)
- The Closer targets threads where the conversation has reached a decision point or gone quiet after a substantive exchange. It drafts follow-up messages or final reply options intended to move the thread to a conclusion. It does not archive or close threads directly - it proposes the action and the user approves.

### Researcher

- Icon: a magnifying glass or document marker; color: teal
- Capacity: up to 8 threads simultaneously
- Cooldown: 5 minutes after reaching completed or failed status
- Output types: enriched contact data, company background summary, thread context summary
- The Researcher scans thread participants and any linked contact records. It produces structured background information attached to the thread cluster - seniority, organization, relationship history, prior interactions. It does not send messages or modify threads. All enrichment data is surfaced as a proposal the user can accept or dismiss.

### Scheduler

- Icon: a calendar or clock marker; color: blue
- Capacity: up to 4 threads simultaneously
- Cooldown: 8 minutes after reaching completed or failed status
- Output types: meeting time proposals, availability summary, draft scheduling reply
- The Scheduler reads thread context for meeting requests or coordination language. It cross-references available calendar windows and produces a set of candidate times. It drafts a scheduling reply presenting those options. It does not book meetings or send messages. The user approves the draft reply and the specific time slot before anything is committed.

### Cleaner

- Icon: a broom or filter marker; color: gray
- Capacity: up to 20 threads simultaneously
- Cooldown: 15 minutes after reaching completed or failed status
- Output types: archive proposals, label assignments, unsubscribe proposals, bulk-action batches
- The Cleaner identifies low-signal threads: newsletters, automated notifications, dormant mailing lists, and stale threads with no expected reply. It groups them into batches and proposes actions (archive, label, unsubscribe). Each batch is a single proposal the user can approve or reject in one step. The Cleaner does not execute any action directly.

### Drafter

- Icon: a pen or quill marker; color: green
- Capacity: up to 6 threads simultaneously
- Cooldown: 5 minutes after reaching completed or failed status
- Output types: reply draft
- The Drafter reads the thread history and infers relationship context (formal vs. informal, tenure, prior tone). It produces a reply draft calibrated to that context. It surfaces one primary draft and up to two tone variants (more direct, more warm). The user selects a variant or edits before sending. The Drafter never sends a message.

### Escalation Bot

- Icon: an alert triangle or flag marker; color: red
- Capacity: up to 15 threads simultaneously
- Cooldown: 2 minutes after reaching completed or failed status
- Output types: escalation flag, urgency notification, SLA breach alert
- The Escalation Bot monitors threads for signals of urgency: explicit time pressure, unread high-priority sender, thread age exceeding a response threshold. When a signal is detected, it emits an escalation proposal that surfaces the thread prominently on the map and notifies the user. It does not draft replies or take actions. The user acknowledges or dismisses the flag.

---

## Behaviors in Execution Order

The following describes what happens from deployment to completion in the order events occur.

1. The user selects an undeployed agent instance in the idle state from the agent roster panel.

2. The user targets a thread cluster on the map. The system validates that the agent type is compatible with the selected cluster (cluster has at least one thread within the agent's scope). If incompatible, the deployment is blocked and the agent returns to idle.

3. On successful targeting, the agent instance transitions from idle to deployed. The map renders the agent's icon and color on the cluster with a deployed visual indicator.

4. The system assigns the threads in the cluster to the agent instance up to the agent's capacity limit. If the cluster contains more threads than the capacity, threads are queued and processed in batches.

5. The agent instance transitions from deployed to working. The map renders an active animation on the agent's marker.

6. The agent analyzes each assigned thread. For each thread, it produces zero or more proposals. Each proposal is emitted in pending status and added to the instance's proposal list.

7. After processing all assigned threads (or the current batch), the agent instance transitions to completed if all threads were processed without error, or to failed if the agent could not process one or more threads.

8. On transition to completed or failed, the cooldown timer starts. The cooldown expiry timestamp is set on the instance. The map renders the agent's marker with a cooldown visual indicator. The agent cannot be redeployed until the cooldown expires.

9. After cooldown expires, the agent instance transitions back to idle. The agent marker on the map updates to the idle visual state and the unit is available for redeployment.

10. At any point while proposals are in pending status, the user can open the proposal review panel. Each proposal is displayed with its full content. The user approves or rejects each proposal individually. Approved proposals are passed to the execution layer (out of scope for this spec). Rejected proposals are marked rejected and removed from the pending list. The agent's approved and rejected proposal counters update accordingly.

---

## State Transitions

Agent instances move through the following states. Transitions that are not listed are invalid and must not occur.

- idle -> deployed: user successfully targets a thread cluster
- deployed -> working: system confirms thread assignment and begins analysis
- working -> completed: all assigned threads processed without critical error
- working -> failed: one or more threads could not be processed (API failure, no accessible thread data, etc.)
- completed -> idle: cooldown duration has elapsed
- failed -> idle: cooldown duration has elapsed

No transition bypasses cooldown. An agent in completed or failed status cannot move to deployed or working until it has first returned to idle.

Proposals do not affect the agent instance state. An agent can reach completed status while proposals remain in pending state. Pending proposals persist after the agent returns to idle and remain reviewable until the user acts on them.

---

## Acceptance Criteria

- When a user deploys a Closer onto a thread cluster, the map renders the Closer's amber icon with a deployed indicator on that cluster before any analysis begins.
- When an agent is working, the map displays an active animation on the agent's marker that is visually distinct from the idle and deployed states.
- When a Drafter finishes analyzing a thread, the proposal review panel shows at least one draft and up to two tone variants for user selection, with no message sent until the user approves.
- When a Researcher completes its work, the thread cluster displays enriched contact and organization data that was not present before deployment.
- When a Scheduler produces a time proposal, the proposal contains candidate meeting times and a draft scheduling reply; no calendar event is created until the user approves.
- When a Cleaner produces a bulk archive proposal, approving the single proposal causes all threads in that batch to be acted upon, and rejecting the single proposal leaves all threads in that batch unchanged.
- When an Escalation Bot flags a thread, the thread cluster is visually elevated on the map (distinct from non-escalated clusters) and the user receives a notification.
- When an agent transitions to completed or failed, it cannot be redeployed until the cooldown duration has fully elapsed; any attempt to deploy during cooldown is blocked and communicated to the user.
- When an agent's cooldown expires, its map marker returns to the idle visual state without user action.
- When a user rejects a proposal, the action it describes is never executed; rejected proposals remain visible in the review history with rejected status.
- When an agent has reached its thread capacity limit and more threads exist in the cluster, the remaining threads are queued and only processed after the current batch is complete.
- When an agent instance is in failed status, the specific threads that could not be processed are identifiable in the proposal review panel, distinct from threads that were successfully processed.
