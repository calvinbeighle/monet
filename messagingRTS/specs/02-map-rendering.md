# Spec 02: Map Rendering

## Topic Statement

The map rendering system displays email threads as positioned entities on a 2D strategy map, providing a spatial, real-time view of all communications as a living operations theater rather than a linear list.

---

## Scope

### In Scope

- Canvas and viewport rendering, including pan and zoom
- Thread entity rendering (position, appearance, state-driven visual variation)
- Cluster rendering for groups of related threads
- Zone boundary rendering as distinct map regions
- Rendering layer ordering and composition
- Minimap for global orientation
- Visual feedback tied to thread urgency and drift state
- Visual density management relative to zoom level
- Responsive behavior when viewport dimensions change
- Performance at scale (500+ thread entities)

### Out of Scope

- Thread data fetching or synchronization with Gmail/Outlook
- Zone assignment logic (which thread belongs to which zone)
- Cluster membership computation
- Agent behavior and decision logic
- User input handling (clicks, drags, keyboard shortcuts) - covered in a separate spec
- Notification or alert systems
- Authentication and authorization

---

## Data Contracts

### Thread Entity

Each thread entity presented to the rendering system carries:

- A unique identifier
- A 2D position on the map coordinate system
- An urgency level (categorical or continuous scale)
- A value signal (categorical or continuous scale)
- An age value (time elapsed since last activity)
- A state indicator: one of idle, active, drifting, archived, or agent-occupied
- A cluster membership reference (optional, absent if unassigned)
- A zone membership reference (optional, absent if unassigned)

### Cluster

Each cluster carries:

- A unique identifier
- A computed centroid position
- A list of member thread entity identifiers
- A label or subject summary
- A visual extent (bounding dimensions)

### Zone

Each zone carries:

- A unique identifier
- A boundary definition as a closed polygonal region in map coordinates
- A label
- A visual style category (e.g., operational area type)

### Viewport State

The rendering system maintains:

- Current pan offset (translation from map origin to screen origin)
- Current zoom scale
- Viewport pixel dimensions

---

## Behaviors (Execution Order)

### 1. Layer Composition

The map renders in a fixed layer order from bottom to top:

1. Background layer - zone boundaries and region fills
2. Mid layer - connection lines and relationship edges between thread entities or clusters
3. Foreground layer - thread entity units and cluster groupings
4. Overlay layer - agent indicators and UI chrome (minimap, scale indicator)

No foreground element appears beneath a background element. No overlay element is obscured by any map content.

### 2. Zone Rendering (Background Layer)

Zone regions are drawn as filled polygons with visually distinct but non-dominant styling. Zone labels appear within the region boundary. When zones overlap due to map design, their visual treatment remains distinguishable. Zones without any assigned threads are still rendered.

### 3. Connection Rendering (Mid Layer)

Relationship edges between thread entities (e.g., same contact, same project) are drawn as lines connecting entity positions. Edge rendering does not obscure zone fills beneath it. Connections involving clustered threads attach to the cluster boundary rather than individual entity positions when zoom is below the cluster-dissolution threshold.

### 4. Thread Entity Rendering (Foreground Layer)

Each thread entity is rendered as a distinct visual unit at its map position. Appearance varies according to state:

- Urgency is expressed through color intensity or glow magnitude - higher urgency produces a stronger, more saturated visual signal.
- Value is expressed through size - higher value threads appear larger.
- Age is expressed through opacity or visual decay - older threads with no recent activity appear more faded.
- Drifting threads animate with a continuous slow movement effect, visually distinguishable from idle threads at rest.
- Agent-occupied threads carry a visible indicator that an agent is currently acting on them.

Thread entities do not overlap their label text with adjacent entity glyphs at normal zoom levels.

### 5. Cluster Rendering (Foreground Layer, Co-planar with Thread Entities)

When multiple threads share cluster membership, they are visually grouped under a cluster boundary marker. The cluster boundary surrounds its member entities. The cluster label is visible. Individual thread entities within a cluster remain visible inside the cluster boundary at sufficient zoom levels. At low zoom, the cluster collapses to a single representative unit showing aggregate urgency and count.

### 6. Urgency Pulse and Glow

Thread entities with elevated urgency pulse at a rate proportional to urgency level. The pulse is a continuous animation - a rhythmic brightening and dimming of the entity's glow. The highest-urgency entities pulse fastest. Entities at baseline urgency do not pulse. This animation runs independently of frame-rate fluctuations and does not stutter during map interactions.

### 7. Drift Animation

Thread entities in the drifting state animate with a slow, continuous positional drift relative to their assigned map coordinates. The drift is smooth and organic, not mechanical or linear. The drift amplitude is small enough that the entity does not leave its logical map region. Drift animation is independent of urgency pulse.

### 8. Minimap

A minimap is rendered in the overlay layer, positioned at a fixed corner of the viewport. The minimap displays a scaled-down representation of the entire map extent, including zone regions and thread entity positions. A viewport indicator on the minimap shows the currently visible portion of the map. The minimap updates continuously as the viewport pans or zooms.

### 9. Visual Density Management

At high zoom levels (close in), individual thread entity details are fully visible: labels, urgency glow, value-driven sizing, age opacity, and drift animation.

At medium zoom levels, thread entities remain individually legible but label text may truncate.

At low zoom levels (far out), thread entities within clusters collapse to aggregate cluster representations. Individual thread details are suppressed to prevent visual noise. Zone labels remain visible. The overall map remains readable as a strategic overview.

Density transitions between zoom levels are smooth - elements fade in or out rather than snapping.

### 10. Viewport Responsiveness

When the viewport dimensions change (window resize, panel open/close, fullscreen toggle), the map canvas redraws to fill the new dimensions within one render frame. The map coordinate center visible before the resize remains centered after the resize. The zoom level is preserved. The minimap resizes proportionally.

---

## State Transitions

### Thread Entity Visual States

- When a thread transitions to the drifting state, its drift animation begins within the current render frame.
- When a thread transitions out of the drifting state, its drift animation stops and it settles at its assigned position within one second.
- When a thread's urgency increases above the pulse threshold, the pulse animation begins on the next render cycle.
- When a thread's urgency drops below the pulse threshold, the pulse animation fades out smoothly rather than cutting off.
- When a thread is claimed by an agent, the agent-occupied visual indicator appears immediately.
- When an agent releases a thread, the agent-occupied indicator disappears and the thread returns to its prior visual state.
- When a thread is archived, its visual representation fades to minimum opacity. Archived threads remain on the map but do not pulse or drift.

### Cluster State Transitions

- When threads are assigned to a cluster, they visually migrate toward the cluster centroid over a short animation (under 500ms).
- When a cluster gains or loses members, its boundary redraws to reflect the new extent.
- When zoom crosses the cluster-dissolution threshold while zooming in, cluster members animate apart into individual positions.
- When zoom crosses the threshold while zooming out, individual members animate together into the cluster representation.

### Viewport Transitions

- Pan: the map canvas translates continuously with the pan gesture, with no perceptible lag between input and canvas movement.
- Zoom: the map scales around the zoom focal point continuously, with all layers scaling in concert.
- On zoom-out past the minimum zoom level, the map stops scaling further. The boundary is visually communicated.
- On zoom-in past the maximum zoom level, the map stops scaling further.

---

## Acceptance Criteria

- When the map is loaded with 500 or more thread entities, rendering remains smooth with no visible frame drops during pan and zoom.
- When a thread's urgency is at maximum, it emits a visible pulsing glow that is perceptibly faster than a thread at medium urgency.
- When a thread is in the drifting state, it visibly moves in a slow, organic pattern; this movement stops when the thread leaves the drifting state.
- When the viewport is zoomed out to its minimum level, clustered threads are collapsed into aggregate cluster units and individual thread detail is not shown.
- When the viewport is zoomed in to its maximum level, all thread entity details are visible including labels, urgency glow, and size differentiation.
- When a zone has been defined, its region boundary and label are visible on the map regardless of whether it contains any threads.
- When the viewport is resized, the map redraws to fill the new dimensions without losing the current pan position or zoom level.
- When the minimap is visible, it accurately reflects the positions of all zones and thread entities, and the viewport indicator correctly shows the currently visible map region.
- When threads are assigned to a cluster, a visible cluster boundary surrounds the group and a cluster label is present.
- At all zoom levels, no rendering layer from a lower tier (e.g., background zones) obscures content from a higher tier (e.g., foreground thread entities).
- When a thread transitions between any two visual states, the change is animated or faded and does not produce an abrupt visual cut.
- When an agent occupies a thread, a distinct visual indicator appears on that thread unit on the map.
