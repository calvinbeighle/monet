# Spec 04: Zone System

## Topic Statement

The map surface is divided into named spatial regions called zones. Threads drift into zones based on their classification state. Zones give the strategy map a persistent spatial grammar so users can orient themselves at a glance and understand the health of their entire communication pipeline without reading individual threads.

---

## Scope

### In Scope

- The six canonical zones and their definitions
- Soft spatial boundaries and drift behavior
- Visual identity per zone (color tinting, boundary indicators)
- Thread count display per zone
- Adaptive zone sizing based on thread distribution
- Alert thresholds when zone populations cross defined limits
- Manual user drag to reclassify a thread into a different zone

### Out of Scope

- The classification logic that assigns a thread to a zone (covered in thread classification spec)
- The physics engine that positions threads within a zone (covered in map physics spec)
- Notification delivery mechanisms (email, push, OS-level alerts)
- Zone configuration or renaming by the user in this version
- More than six zones

---

## Zone Definitions

### Active Front

Threads with recent activity that require user attention. This is the most prominent zone on the map. A thread belongs here when a response has arrived recently or an action is pending from the user.

### Opportunities

High-value threads that are warm and ready for engagement. This includes warm leads, important contacts, and threads where initiating a conversation would be timely. Threads here have not yet crossed into neglect territory.

### At Risk

Threads where response latency is becoming dangerous. The window for a productive reply is narrowing. Threads in this zone are approaching but have not yet crossed the recovery threshold.

### Lost

Threads that have been neglected past the recovery threshold. A reply is still technically possible but the strategic moment has passed. The zone is visually subdued to signal finality without full removal from the map.

### Noise / Low Priority

Low-value automated emails, newsletters, and notifications. These threads are not candidates for personal engagement. They populate the periphery of the map.

### Base / Handled

Threads that are resolved, replied to, or delegated to an agent. These threads are settled. They drift toward the most stable, least prominent area of the map.

---

## Data Contracts

Each zone has:

- A canonical identifier and display name
- A defined spatial region expressed as a bounding area on the 2D map canvas
- A color tint value and boundary indicator style
- A current thread count
- An alert threshold (minimum and/or maximum thread count that triggers a zone alert)
- A dynamic size weight that scales the zone's area proportionally to its population relative to all other zones

Each thread carries:

- Its current zone assignment
- A position on the 2D canvas
- A previous zone assignment (to detect transitions)
- A flag indicating whether its zone assignment was set by the classifier or overridden by the user

Zone alert state carries:

- The zone identifier
- The threshold that was crossed
- Whether the alert is active or resolved
- The thread count at the time the alert fired

---

## Behaviors (Execution Order)

### 1. Zone Layout Initialization

When the map is first rendered, the six zones are placed at fixed canonical positions on the canvas. Active Front occupies the most prominent central-forward area. Opportunities occupies a prominent adjacent area. At Risk occupies a visually urgent quadrant. Lost occupies a receded area. Noise occupies the far periphery. Base/Handled occupies a stable background area. These canonical positions serve as anchors for all subsequent layout adaptation.

### 2. Thread Classification Produces Zone Assignment

The thread classifier (external to this spec) produces a zone assignment for each thread. The zone system receives this assignment and records it on the thread. If the thread has no prior position on the canvas, it is placed within the boundary of its assigned zone.

### 3. Thread Drift to Assigned Zone

When a thread's zone assignment changes, the thread does not teleport. It drifts toward the spatial region of its new zone over a perceptible transition. The thread's position moves continuously from its current coordinates into the bounding area of the destination zone. The drift speed is proportional to the distance to the zone boundary. A thread is considered to have "arrived" in a zone once its position is within the zone's boundary.

### 4. Soft Boundary Enforcement

Zone boundaries are not hard walls. A thread that has recently drifted into a zone may sit near the boundary and appear visually close to a neighboring zone. The boundary indicator (color tint gradient, border marker) communicates zone membership even when the thread is near an edge. A thread is assigned to exactly one zone at a time, but its rendered position may be near the boundary of an adjacent zone.

### 5. Thread Count Display

Each zone displays a count of the threads currently assigned to it. This count updates whenever a thread's zone assignment changes. The count is visible on the zone label or boundary indicator at all times. A zone with zero threads still renders with its label and boundary indicator visible, showing a count of zero.

### 6. Adaptive Zone Sizing

After each update to thread counts, the system recalculates the spatial area allocated to each zone. A zone whose population is larger relative to other zones is allocated proportionally more canvas area. The canonical positions of zones remain fixed as anchors, but the extent of each zone's boundary expands or contracts around that anchor. The total canvas area covered by all zones remains constant. Zone boundaries move smoothly to their new extents rather than jumping.

### 7. Zone Alert Evaluation

After each thread count update, each zone's current count is compared against its defined alert threshold. If a zone's count crosses its threshold (e.g., At Risk count exceeds the defined maximum before alert, or Active Front drops below a minimum), an alert is fired for that zone. The alert remains active until the count returns to within the acceptable range. If the count was already outside the threshold range at initialization, an alert fires immediately on load.

### 8. Zone Alert Display

An active zone alert is visually indicated on the zone itself - its boundary indicator or label changes state to signal the alert. The alert state is also surfaced in any global status area on the map that aggregates zone health. When the alert resolves (count returns to normal range), the zone returns to its default visual state.

### 9. Manual Thread Reclassification via Drag

A user may drag a thread from its current zone into a different zone. When the user releases the thread inside the boundary of a destination zone, the thread's zone assignment is updated to that zone and flagged as user-overridden. The classifier will not reassign a user-overridden thread on its next classification pass unless the thread's underlying state changes significantly enough to warrant a forced reclassification (defined by the classifier spec). The thread settles into its new position within the destination zone boundary. Thread counts for both the source and destination zones update immediately.

---

## State Transitions

### Thread Zone Transition

A thread transitions from one zone to another when:

- The classifier produces a new zone assignment that differs from the current one, or
- The user drags the thread into a different zone

Upon transition:

- The previous zone assignment is recorded
- The new zone assignment is applied
- The thread begins drifting toward the spatial region of the new zone
- Thread counts for both source and destination zones decrement and increment respectively
- Adaptive zone sizing recalculates
- Alert thresholds for both affected zones are re-evaluated

### Zone Alert State Transition

A zone alert transitions from inactive to active when its thread count crosses the defined threshold. It transitions from active to inactive when the thread count returns to within the acceptable range. These are the only two states for a zone alert. A zone alert does not have a "dismissed" state in this version - it resolves only when the underlying condition resolves.

### Zone Size Transition

A zone's spatial boundary transitions from its current extent to a new extent whenever the distribution of threads across zones changes. This transition is continuous and smooth. The zone's anchor position does not move during a size transition - only the extent of the boundary changes.

---

## Acceptance Criteria

- When the map loads with a set of classified threads, each thread appears within the spatial boundary of its assigned zone.
- A thread whose zone assignment changes drifts to the new zone visually over time rather than appearing there instantly.
- A thread near a zone boundary is visually identifiable as belonging to a specific zone through color tinting or boundary indicator, even if its position is close to the boundary.
- Each zone displays the correct count of threads assigned to it at all times, including zero when the zone is empty.
- When a disproportionate number of threads are assigned to one zone, that zone occupies more canvas area than zones with fewer threads, and the change in area is visible.
- When the At Risk zone's thread count exceeds its defined threshold, the At Risk zone displays an alert indicator.
- When the alert condition resolves (thread count drops back within threshold), the alert indicator is no longer displayed.
- A user can drag a thread from one zone and drop it into another zone, and the thread remains in the destination zone on the next classifier pass.
- Thread counts for both the source and destination zone update immediately when a drag-and-drop reclassification completes.
- All six zones are visible on the map at all times, including when their thread count is zero.
