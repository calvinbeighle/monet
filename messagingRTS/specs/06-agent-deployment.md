# Spec 06 - Agent Deployment

## Topic Statement

Agent Deployment defines how users command AI agents by dragging them from a persistent dock onto thread clusters on the 2D strategy map. A deployment is a discrete unit of work: it begins when the user drops an agent onto a valid target, proceeds through confirmation and execution, and ends when results are presented for approval or the deployment is recalled. This is the primary interaction model for directing agents in the Messaging RTS.

---

## Scope

### In Scope

- The agent dock region: its contents, layout, and agent status representation
- The drag-to-deploy gesture and all associated visual states
- Drop target validation during a drag
- Pre-deployment confirmation dialog
- Agent travel animation from dock to target
- In-progress state display on the map for a deployed agent
- Results presentation as an actionable overlay on the map
- Recall and cancellation before completion
- Batch deployment of one agent type across multiple clusters
- Deployment history log
- Quick-deploy shortcuts (keyboard and context menu)

### Out of Scope

- Agent AI logic, prompt construction, or model selection
- Email send/draft/archive API calls (covered in Email Integration spec)
- Thread positioning and drift (covered in Thread Positioning spec)
- Zone system rules (covered in Zone System spec)
- Agent unit definitions and role taxonomy (covered in Agent Units spec)
- Notifications or alerts for completed deployments while the map is not in focus

---

## Data Contracts

### Agent (in dock)

Each entry in the dock carries:

- A unique agent identity
- An agent role label (e.g., Closer, Drafter, Cleaner)
- Current status: idle, deployed, or cooling down
- Cooldown remaining duration when status is cooling down
- A count of active deployments for this agent type

### Thread Cluster (on map)

Each cluster on the map exposes:

- A unique cluster identity
- A list of thread identities contained in the cluster
- A list of agent role types that are valid targets for this cluster
- Whether a deployment is already active on this cluster

### Deployment Record

A deployment record is created at confirmation and persists through completion or recall. It carries:

- A unique deployment identity
- The agent type deployed
- The target cluster identity
- The list of thread identities in scope at the time of deployment
- Deployment start timestamp
- Status: confirming, traveling, in-progress, completed, recalled, or failed
- Progress expressed as a fraction of work units completed
- Outcome summary when status is completed or failed
- Recall timestamp when status is recalled

### Deployment History Entry

Each entry in the history log carries:

- Deployment identity
- Agent role label
- Target cluster label or a synthesized description of the threads in scope
- Final status
- Start and end timestamps
- Outcome summary (human-readable, one to two sentences)

---

## Behaviors in Execution Order

### 1. Agent Dock Display

The dock is always visible while the map is active. It shows every available agent type. Agents with idle status are visually prominent. Agents with deployed status show a badge indicating how many active deployments exist for that type. Agents in cooldown show a timer countdown and are visually dimmed. Hovering over any agent in the dock displays a tooltip with its role description and current status detail.

### 2. Drag Initiation

When the user begins dragging an agent from the dock, the dragged agent lifts visually to indicate it is in motion. The original slot in the dock transitions to a ghost state - it remains visible but de-emphasized - to preserve spatial memory of where the agent lives.

### 3. Drop Target Validation During Drag

While the drag is in progress, every thread cluster on the map evaluates whether it is a valid target for the dragged agent type.

Valid targets highlight with a clear affordance (distinct border or fill change) that communicates "this is a legal drop zone."

Invalid targets display a distinct negative affordance (different border treatment or icon) that communicates "dropping here will not work."

Clusters that already have an active deployment of the same agent type display a third state communicating "already deployed."

This feedback updates continuously as the dragged agent moves across the map.

### 4. Drop on Invalid Target

If the user releases the drag over an invalid target or over empty map space, the agent snaps back to its dock position with an animation. No deployment is created. No dialog appears.

### 5. Drop on Valid Target

If the user releases the drag over a valid target, the agent does not snap back. Instead it hovers over the cluster momentarily while the confirmation dialog opens.

### 6. Deployment Confirmation Dialog

The confirmation dialog appears immediately after a valid drop, positioned near the drop target without obscuring it. The dialog presents:

- The agent role being deployed
- A plain-language description of what the agent will do (e.g., "Draft replies to 4 threads in this cluster")
- The number of threads in scope
- A confirm action and a cancel action

The user must take an explicit action. There is no auto-confirm timer. Pressing cancel returns the agent to the dock with a snap-back animation. Confirming creates a deployment record and advances to the next phase.

### 7. Agent Travel Animation

After confirmation, the agent icon travels from its dock position to the target cluster on the map. The travel path is a smooth arc across the visible map. Travel duration is brief (long enough to read as intentional movement, short enough not to feel like waiting). While traveling, the cluster pulses lightly to indicate an agent is incoming.

### 8. In-Progress State on Map

Once the agent arrives at the cluster, it anchors to the cluster visually. The cluster displays a progress indicator showing work completion as a fraction. The agent icon remains visible and distinct from the cluster's own iconography so the user can identify which agent is deployed at a glance. The dock slot for this agent type updates its deployment badge count.

If the user hovers the deployed agent on the map, a tooltip shows elapsed time, threads processed so far, and a recall option.

### 9. Results Presentation

When the agent completes its work, the progress indicator resolves and an actionable overlay appears anchored to the cluster. The overlay presents the agent's output as a set of actions the user must approve or reject. The specific action types depend on agent role - examples include approving a draft reply, confirming a batch archive, or flagging a thread for escalation.

The overlay remains on the map until the user acts on it. It does not auto-dismiss. The deployed agent icon remains on the cluster until the overlay is resolved.

After the user acts on all items in the overlay, the overlay dismisses, the agent icon leaves the cluster, and the agent returns to its dock slot. The dock slot transitions the agent to cooling-down status. A deployment history entry is created with the final outcome.

### 10. Recall Before Completion

While an agent is in the traveling or in-progress state, the user can recall it. Recall is accessible via the tooltip that appears on hover of the deployed agent on the map, and via the deployment history panel.

On recall confirmation, the agent stops work, any partial output is discarded, and the agent icon travels back to the dock. The deployment record is updated with recalled status and a recall timestamp. The cluster returns to its undeployed visual state. The agent returns to idle status in the dock without entering cooldown.

### 11. Batch Deployment

The user can deploy one agent type across multiple clusters in a single operation. Batch deployment is initiated by selecting multiple clusters before dragging an agent, or by using the context menu on a selected set of clusters.

The confirmation dialog for a batch deployment shows the full list of target clusters, the total thread count across all targets, and confirms the agent role. Confirming creates one deployment record per cluster. The travel animation shows the agent icon splitting or fanning out to each target in sequence. Each cluster behaves independently for in-progress display, results presentation, and recall.

### 12. Deployment History Panel

The deployment history panel is accessible from the map UI at any time. It shows a reverse-chronological log of deployment records. Each entry displays the agent role, a cluster description, the final status, and the outcome summary.

Entries for in-progress deployments show current status and a recall option. Entries for completed deployments are read-only. The panel supports filtering by agent role and by status. It retains history for the current session and persists across sessions up to a defined retention limit.

### 13. Quick-Deploy Shortcuts

Right-clicking a thread cluster opens a context menu that includes a "Deploy Agent" submenu listing agent types that are valid for that cluster. Selecting an agent type from the submenu initiates deployment at step 6 (confirmation dialog), skipping the drag gesture entirely.

Keyboard shortcuts can trigger quick-deploy when a cluster is selected on the map. The shortcut scheme assigns a key per agent type. Pressing the shortcut while a cluster is focused opens the confirmation dialog for that agent type on that cluster. If the selected cluster is not a valid target for the triggered agent type, the shortcut produces no action and a brief invalid-target affordance appears on the cluster.

---

## State Transitions

### Agent Dock Slot States

- idle - the agent is available for deployment
- deployed - one or more deployments of this agent type are active; the slot shows a count badge
- cooling-down - the agent completed a deployment and is temporarily unavailable; the slot shows a countdown timer
- idle (restored) - cooldown expires; the slot returns to idle

An agent transitions from idle to deployed on confirmation of a deployment. It transitions from deployed back toward idle when all active deployments of that type are either completed or recalled. Completed deployments trigger cooldown. Recalled deployments return to idle without cooldown.

### Deployment Record States

- confirming - dialog is open, user has not yet confirmed or cancelled
- cancelled - user dismissed the confirmation dialog; record is discarded
- traveling - user confirmed; agent is animating toward the target
- in-progress - agent has arrived and is executing work
- completed - agent finished all work items; results overlay is visible
- resolved - user has acted on all results; overlay dismissed
- recalled - user cancelled an in-progress or traveling deployment
- failed - agent encountered an error it could not recover from; treated the same as resolved for dock state purposes, with an error summary in the history entry

### Drop Target States During Drag

- neutral - no drag in progress; normal cluster appearance
- valid-target - drag in progress, agent type is compatible with this cluster, no active deployment of same type
- invalid-target - drag in progress, agent type is not compatible with this cluster
- already-deployed - drag in progress, a deployment of the same agent type is already active on this cluster
- incoming - user has dropped on this cluster and confirmed; agent is traveling here

### Results Overlay States

- pending - results are ready, waiting for user action
- partially-resolved - user has acted on some items but not all
- resolved - user has acted on all items; overlay dismisses

---

## Acceptance Criteria

- When an agent in the dock is dragged over the map, every cluster on the map shows a visually distinct state indicating valid, invalid, or already-deployed - before the user releases the drag.
- When a drag is released over an invalid target or empty space, the agent returns to its dock slot and no dialog appears.
- When a drag is released over a valid target, a confirmation dialog appears that names the agent role, describes what will happen, and states how many threads are in scope.
- When the user cancels the confirmation dialog, the agent returns to its dock slot with no deployment created.
- When the user confirms, the agent travels across the map to the target cluster with a visible arc animation before any work begins.
- While an agent is deployed and working, the target cluster displays a progress indicator that advances as work completes.
- When work completes, an overlay appears on the cluster presenting the agent's output as discrete approve/reject or confirm actions.
- The overlay does not dismiss until the user explicitly acts on every item in it.
- After the overlay is resolved, the agent returns to the dock and enters cooldown; the cluster returns to its undeployed visual state.
- An agent that is traveling or in-progress can be recalled; after recall the agent returns to idle (not cooldown) and the cluster returns to undeployed state.
- A batch deployment against multiple clusters creates independent deployment records per cluster and displays the correct total thread count in the confirmation dialog.
- The deployment history panel shows all past deployments for the session, each with agent role, cluster description, final status, and outcome summary.
- The context menu on a cluster includes a deploy submenu listing only agent types that are valid for that cluster.
- A keyboard shortcut triggered on a selected cluster opens the confirmation dialog for the assigned agent type if the cluster is a valid target, and produces no action if it is not.
- An agent in cooldown cannot be dragged or quick-deployed; the dock slot shows the remaining cooldown duration.
