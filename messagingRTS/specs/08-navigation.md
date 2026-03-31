# Spec 08: Navigation

## Topic Statement

The navigation system allows users to move freely across the 2D strategy map and drill down into individual email threads. Pan and zoom are the primary means of traversal. Zoom level determines which layer of detail is visible - from a strategic overview of the entire communications landscape to a single thread's full conversation and reply interface. Navigation is continuous, reversible, and predictable: the user always knows where they are and can return to where they were.

---

## Scope

### In Scope

- Pan interactions: click-drag and edge scrolling
- Zoom interactions: scroll wheel, pinch gesture, and discrete zoom level stepping
- Four named zoom levels and their distinct visibility rules
- Animated transitions between zoom levels
- Thread entity selection via single click
- Thread detail zoom via double-click
- Search: keyword, sender, and label matching with map highlighting and camera pan
- Quick-navigation to named zones via UI labels and keyboard shortcuts
- Minimap: always-visible viewport position indicator
- Back navigation: escape and back button to return to the previous zoom level or camera position
- Keyboard navigation: arrow key movement between thread entities and tab cycling through zones
- Navigation history: the system tracks at minimum the last camera position and zoom level for back navigation

### Out of Scope

- Thread data fetching or synchronization (covered in Spec 01)
- Map rendering and visual appearance of entities (covered in Spec 02)
- Agent deployment gestures (drag-to-deploy is an agent interaction, not a navigation interaction)
- Zone assignment logic and thread positioning
- Reply composition and draft management (covered in Spec 01)
- Multi-window or multi-tab map state
- Touch interfaces beyond pinch-to-zoom

---

## Data Contracts

### Camera State

The navigation system maintains a camera state that the rendering system consumes:

- Current map coordinate at the center of the viewport (pan position)
- Current zoom level identifier (one of: Strategic, Tactical, Operational, Detail)
- Current zoom scale as a continuous value within the active level's range
- Viewport dimensions in pixels (received from rendering system, not owned by navigation)
- Previous camera state (pan position, zoom level, zoom scale) for back navigation

### Zoom Level Definitions

Each named zoom level has:

- A label (Strategic, Tactical, Operational, Detail)
- A continuous scale range (minimum and maximum zoom scale within the level)
- A canonical scale that the camera snaps to when the level is entered by a discrete jump (e.g., double-click, quick-nav)
- A set of entity visibility rules - which content categories are shown at this level

### Thread Entity (consumed, not owned)

The navigation system receives from the map layer:

- A unique identifier for each thread entity
- The map coordinate position of each entity
- The zone membership of each entity
- Whether each entity is selectable at the current zoom level

### Zone (consumed, not owned)

The navigation system receives from the map layer:

- A unique identifier for each zone
- The centroid coordinate of each zone (used as the pan target for quick-nav)
- The zone label (displayed in quick-nav UI)
- A keyboard shortcut assigned to the zone (if any)

### Selection State

The navigation system maintains:

- The currently selected thread entity identifier, or null if nothing is selected
- Whether the detail panel is open (Detail zoom level entered via selection)

### Search State

- Current search query string
- List of thread entity identifiers matching the current query
- Index of the currently focused match (for cycling through multiple results)

---

## Behaviors

Behaviors are listed in the order they occur during a user session.

### 1. Initial Map Load

- On first render, the camera opens at the Strategic zoom level, centered on the centroid of all thread entities currently present on the map.
- If no threads are present, the camera opens at the Strategic zoom level centered on the map origin.
- The minimap is visible immediately. It does not wait for all threads to finish loading.

### 2. Pan - Click-Drag

- When the user presses and holds the primary mouse button on the map canvas and moves the mouse, the map translates so that the map coordinate under the cursor at press-time remains under the cursor throughout the drag.
- Pan is continuous and has no perceptible lag between cursor movement and map translation.
- Pan does not select or activate any thread entity. A drag that begins on a thread entity pans the map rather than initiating a thread action.
- When the drag ends (mouse button released), the map holds at the final translated position. There is no momentum or coasting after release.

### 3. Pan - Edge Scrolling

- When the user is holding a drag and moves the cursor within a defined margin of the viewport boundary, the map continues to scroll in the direction of that edge even if the cursor stops moving.
- Edge scrolling speed is proportional to how close the cursor is to the viewport boundary - nearer to the edge produces faster scrolling.
- Edge scrolling stops as soon as the cursor leaves the edge margin, whether by the drag ending or the cursor moving back to center.
- Edge scrolling does not activate when the user is not mid-drag. Simply hovering near the edge does not scroll.

### 4. Zoom - Scroll Wheel

- Scrolling the mouse wheel up (or equivalent trackpad gesture) zooms in; scrolling down zooms out.
- Zoom is anchored to the map coordinate currently under the cursor. That coordinate remains under the cursor after the zoom step is applied.
- Zoom is continuous within a level's scale range. Crossing the boundary between two zoom levels causes the content visibility rules for the new level to apply.
- Zoom cannot exceed the maximum zoom scale of the Detail level or go below the minimum zoom scale of the Strategic level. At either boundary, further scroll input has no effect.

### 5. Zoom - Pinch Gesture

- A two-finger pinch gesture on a trackpad zooms in when fingers spread and zooms out when fingers contract.
- Pinch zoom is anchored to the midpoint between the two touch contacts, following the same rules as scroll wheel zoom.
- Pinch and scroll wheel zoom behave identically from the map's perspective - they are different inputs for the same operation.

### 6. Zoom Levels and Content Visibility

The four zoom levels define what is rendered on the map. The navigation system enforces these visibility rules by reporting the current zoom level to the rendering system:

**Strategic (fully zoomed out)**

- Zone boundaries and zone labels are visible.
- Cluster aggregate dots are visible, showing combined urgency and count.
- No individual thread entity labels or details are shown.
- No sender names, subjects, or previews are shown.
- The overall shape of the communications landscape - where load is concentrated, where zones are quiet - is readable.

**Tactical (mid zoom)**

- Zone names remain visible.
- Thread clusters are visible as labeled groups. Cluster labels are legible.
- Individual thread entities within clusters remain as dots without detail labels.
- Thread entities not assigned to a cluster are visible but without label text.

**Operational (zoomed in)**

- Individual thread entities are fully visible as distinct units.
- Each thread entity shows sender name and subject preview.
- Cluster boundaries remain visible but labels may reduce in prominence.
- Zone names remain visible.

**Detail (most zoomed in)**

- A single thread entity fills the primary view area. Full conversation is readable.
- The reply composer is accessible.
- Agent action options for this thread are surfaced.
- The surrounding map context remains visible at reduced opacity so the user retains spatial orientation.
- Other thread entities near the selected one are visible but de-emphasized.

Transitions between levels are smooth: content fades in or out as zoom crosses level boundaries rather than appearing or disappearing abruptly.

### 7. Zoom Level Transitions - Animation

- When the camera crosses a zoom level boundary (via scroll, pinch, or discrete jump), the transition animates over a short, fixed duration.
- During the animation, intermediate states are visually coherent - partial visibility of incoming content is acceptable, but rendering artifacts are not.
- The animation does not block further input. If the user continues zooming during a transition animation, the animation advances toward the new target rather than completing the prior animation first.

### 8. Thread Entity Selection - Single Click

- When the user clicks a thread entity without dragging, that entity becomes selected.
- A selection triggers the detail panel to open alongside the map. The map does not zoom automatically on a single click.
- Only one thread entity can be selected at a time. Clicking a second entity deselects the first and selects the second.
- Clicking empty map space (no entity under cursor) clears the selection and closes the detail panel.
- Selection is only possible when individual thread entities are visible - at Strategic zoom where only cluster aggregates appear, clicking a cluster dot does not select a thread. It zooms to Tactical instead (see zoom-to-cluster behavior below).

### 9. Zoom to Cluster - Click at Strategic Level

- At Strategic zoom, clicking a cluster dot zooms the camera to Tactical level, centering on that cluster.
- The zoom animates. The camera arrives at Tactical zoom centered on the clicked cluster's centroid.
- No thread is selected by this interaction. Selection requires clicking an individual entity at Operational or Detail level.

### 10. Thread Detail View - Double-Click

- When the user double-clicks a thread entity, the camera zooms to Detail level and centers on that entity.
- The entity becomes selected as part of this action.
- If the camera is already at Detail level and the user double-clicks the same entity, no additional zoom occurs.
- If the camera is at Detail level and the user double-clicks a different entity, the camera pans to that entity and selects it.
- Double-clicking empty map space at Detail level does not trigger any action.

### 11. Search

- The search interface accepts a query string. The user can search by keyword (matches subject or body snippet), sender address or name, or label.
- As the user types, matching thread entities are highlighted on the map. Non-matching entities visually recede but remain present.
- When results exist, the camera pans to center the first matching entity in the viewport. If the first result is at a zoom level below the current camera level, the camera also zooms to Operational to make the result visible as an individual entity.
- The user can cycle through multiple results. Cycling advances to the next match in map-coordinate order (left-to-right, top-to-bottom), panning the camera to center each match.
- When the search query is cleared, all thread entities return to their normal visual state and the camera remains at whatever position it reached during search. It does not snap back.
- If the query returns no results, the map is not modified. The search input shows a no-results indicator. The camera does not move.

### 12. Quick-Navigation to Zones

- Zone names are displayed as clickable labels in a persistent UI panel or on the minimap.
- Clicking a zone name pans and zooms the camera to show that zone in full within the viewport. The zoom level adjusts to the nearest named level that fits the zone extent.
- If keyboard shortcuts are assigned to zones, pressing the assigned key performs the same action as clicking the zone name. Zone shortcut keys do not conflict with navigation keys (arrow keys, tab, escape).
- Quick-navigation is available at all zoom levels.

### 13. Minimap

- The minimap is always visible in a fixed corner of the viewport. It is not dismissible during normal use.
- The minimap shows a scaled-down representation of the entire map extent, including zone regions and the approximate positions of thread entities and clusters.
- A viewport indicator on the minimap shows the current visible area of the main map as a rectangle.
- Clicking a location on the minimap pans the main map so that the clicked coordinate is centered in the main viewport. The zoom level does not change on a minimap click.
- Dragging within the minimap pans the main map in real time, following the drag position.
- The minimap viewport indicator updates continuously as the main map pans or zooms.

### 14. Back Navigation

- Pressing Escape or the back button returns the camera to the previous zoom level and pan position.
- Navigation history is shallow: only the immediately prior camera state is stored. Pressing back a second time does nothing further (the history is exhausted).
- If the Detail view is open with the reply composer active, pressing Escape first dismisses the composer. A second Escape returns to the prior camera state.
- If a thread is selected, pressing Escape first clears the selection. A second Escape returns to the prior camera state.
- Back navigation is not available on first load (there is no prior state).

### 15. Keyboard Navigation - Arrow Keys

- When focus is on the map and no text input is active, the arrow keys move the current selection to the nearest thread entity in the indicated direction.
- Nearest is determined by Euclidean distance from the current entity's map position in the direction of the key pressed. The system finds the closest entity whose map coordinate is primarily in that direction (within a defined angular range).
- If no entity is selected, the first arrow key press selects the entity nearest to the current viewport center.
- Arrow key selection follows the same rules as mouse click selection: the camera pans to keep the selected entity visible if it would otherwise be outside the viewport.
- Arrow key navigation is only active at Operational or Detail zoom levels where individual entities are visible.

### 16. Keyboard Navigation - Tab to Cycle Zones

- Pressing Tab cycles focus through zone quick-nav labels in order.
- Pressing Enter while a zone label is focused triggers the quick-nav action for that zone (equivalent to clicking the label).
- Tab does not move the camera on its own - only Enter after Tab focus confirms navigation.
- Shift-Tab cycles in reverse order.

---

## State Transitions

### Camera Zoom Level State

States: Strategic, Tactical, Operational, Detail

Transitions:

- Strategic -> Tactical: user scrolls or pinches in past the Strategic/Tactical boundary; or user clicks a cluster dot; or user invokes quick-nav to a zone that fits within Tactical
- Tactical -> Strategic: user scrolls or pinches out past the Tactical/Strategic boundary; or user presses back
- Tactical -> Operational: user scrolls or pinches in past the Tactical/Operational boundary; or user invokes quick-nav to a zone that requires Operational to show
- Operational -> Tactical: user scrolls or pinches out past the Operational/Tactical boundary; or user presses back
- Operational -> Detail: user double-clicks a thread entity; or user scrolls or pinches in past the Operational/Detail boundary
- Detail -> Operational: user scrolls or pinches out past the Detail/Operational boundary; or user presses back
- Any level -> any other level: search result navigation may zoom to Operational if the camera is above Operational when a result is found; the camera does not zoom below Operational during search

### Selection State

States: None, Entity Selected, Detail Panel Open

Transitions:

- None -> Entity Selected: user single-clicks a visible thread entity at Operational or Detail zoom
- Entity Selected -> None: user clicks empty map space; or user presses Escape (first press if composer is not open)
- Entity Selected -> Entity Selected (different entity): user single-clicks a different entity, or uses arrow keys to move selection
- Entity Selected -> Detail Panel Open: user double-clicks the selected entity, or presses Enter on a selected entity
- Detail Panel Open -> Entity Selected: user presses Escape (first press dismisses composer if open, second press collapses detail panel back to selection state)
- Detail Panel Open -> None: user presses Escape twice from a state with no composer open
- None -> Detail Panel Open: user double-clicks a thread entity directly from an unselected state (selection and detail open simultaneously)

### Search State

States: Inactive, Query Active (with results), Query Active (no results)

Transitions:

- Inactive -> Query Active (with results): user types a query that matches at least one thread
- Inactive -> Query Active (no results): user types a query that matches zero threads
- Query Active (with results) -> Query Active (no results): query is refined until no matches remain
- Query Active (no results) -> Query Active (with results): query is modified to produce matches again
- Query Active -> Inactive: user clears the search input

### Navigation History State

States: No History, Has Prior State

Transitions:

- No History -> Has Prior State: user performs any zoom level change or quick-nav jump
- Has Prior State -> No History: user invokes back navigation (history is consumed)
- Has Prior State -> Has Prior State (updated): user performs another navigation action; the prior state is replaced by the state immediately before the new action

---

## Acceptance Criteria

- When the user click-drags on the map, the map translates so the coordinate under the cursor at drag start remains under the cursor throughout the drag, with no perceptible lag.
- When the user drags near a viewport edge, the map scrolls in that direction without the cursor leaving the viewport. The scrolling stops when the cursor moves away from the edge margin.
- When the user scrolls the mouse wheel with the cursor over a thread entity, the entity remains under the cursor after the zoom step is applied.
- When zoom crosses from Tactical into Strategic, cluster aggregate dots replace individual entity representations and individual labels disappear from the map.
- When zoom crosses from Tactical into Operational, individual thread entities become visible with sender name and subject preview.
- When the user double-clicks a thread entity from Operational zoom, the camera zooms to Detail level, the entity is selected, and the full conversation and reply composer are accessible.
- When zoom is at Strategic and the user clicks a cluster dot, the camera zooms to Tactical level centered on that cluster, and no thread entity becomes selected.
- When the user types a search query that matches threads, those threads are highlighted on the map, non-matching threads visually recede, and the camera pans to the first matching entity.
- When the user cycles through search results, the camera pans to center each successive result in the viewport.
- When the search input is cleared, all thread entities return to their normal visual state and the camera does not snap back to its pre-search position.
- When the user clicks a zone name in the quick-nav panel, the camera pans and adjusts zoom to show that zone within the viewport.
- When the user clicks a location on the minimap, the main map pans so that location is centered in the viewport. The zoom level does not change.
- The minimap viewport indicator accurately reflects the current visible area of the main map at all times, including during continuous pan and zoom interactions.
- When the user presses Escape from the Detail view with no composer active, the camera returns to the zoom level and pan position that was active before entering Detail view.
- When arrow keys are used at Operational zoom, selection moves to the nearest thread entity in the indicated direction, and the camera pans to keep the selected entity visible.
- At Strategic zoom, arrow key presses do not move selection (no individual entities are selectable at that level).
- When Tab is pressed with map focus, zone labels are cycled in order and pressing Enter on a focused zone label performs the same navigation as clicking that label.
- Zoom level transitions animate: entering or leaving any named zoom level produces a smooth visual transition. Content fades in or out rather than snapping. Rendering artifacts are not present during any transition.
- Pressing back after a double-click zoom into Detail returns the camera to the exact zoom level and pan position that was active before the double-click.
