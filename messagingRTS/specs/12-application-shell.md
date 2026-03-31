# Spec 12 - Application Shell

## Topic Statement

The application shell is the outermost UI container for the Messaging RTS. It defines the spatial arrangement of all major surface areas - the map viewport, agent dock, detail panel, status bar, search overlay, session summary modal, deployment history panel, minimap overlay, and notification area - and governs how those surfaces interact during loading, normal operation, and error states. The shell does not implement the content of any panel; it owns the layout boundaries, layering order, focus model, responsive behavior, and lifecycle sequencing that all other UI surfaces depend on.

---

## Scope

### In Scope

- Top-level layout regions and their size relationships
- Initial loading state and empty state before threads are available
- Status bar placement and its contained indicators
- Agent dock placement and persistence rules
- Detail panel slide-in behavior and its relationship to the map viewport
- Search overlay placement and activation behavior
- Session summary modal placement and trigger
- Deployment history panel placement and trigger
- Minimap overlay placement and layering rules
- Notification area placement and stacking behavior
- Responsive resizing and panel collapse behavior at narrow viewport widths
- Keyboard focus zones and tab order between shell regions
- Shell-level state transitions (loading, empty, authenticated, degraded)

### Out of Scope

- The content rendered inside the map viewport (covered in Map Rendering and Thread Positioning specs)
- The content of the agent dock entries (covered in Agent Units spec)
- The content of the detail panel thread conversation (covered in Thread Data Model and Email Integration specs)
- Status bar data sourcing (sync status, health score, streak values, alert counts)
- Session summary data computation
- Deployment history data sourcing
- Gmail authentication flow mechanics (covered in Email Integration spec)
- Notification content generation or routing logic
- Animation timing curves for individual content components within panels

---

## Data Contracts

### Shell receives from application state

- Authentication state: one of unauthenticated, authenticating, authenticated, reauthentication-required
- Initial sync state: one of idle, in-progress, complete, failed
- Selected thread identifier: present when a thread is selected, absent when none is selected
- Active panel: which slide-in or modal surface is currently open, if any - one of none, detail, deployment-history, session-summary, search
- Notification queue: ordered list of pending notifications, each carrying a severity level and a dismissal state
- Viewport width in pixels: used to determine responsive breakpoint
- Front health score: numeric value surfaced in status bar
- Streak counter values: one or more numeric values surfaced in status bar
- Unread alert count: numeric value surfaced as a badge in status bar
- Sync status: one of synced, syncing, offline, error

### Shell exposes to child surfaces

- Map viewport bounding rectangle: the pixel region the map canvas may occupy, updated whenever panels open or close or the window resizes
- Detail panel open/closed state: so the map can adjust its visible region
- Current focus zone: which major region currently holds keyboard focus - one of map, dock, detail-panel, status-bar, search, modal

---

## Behaviors

Behaviors are listed in the order they occur during a user session.

### 1. Initial Load Sequence

When the application first launches, the shell renders in a loading state before any thread data is available. The map viewport area is present but blank. The status bar is visible and shows a loading indicator in place of sync status. The agent dock is visible but empty. The detail panel is closed. No notifications are shown.

While Gmail authentication and initial sync are in progress, the shell occupies the loading state. A loading indicator is visible to the user within the map viewport area. The indicator is centered within the viewport bounds. No map content, thread entities, or interactive map controls are shown while loading is active.

If authentication is not yet complete, the shell shows an authentication prompt within the map viewport area instead of a loading indicator. The prompt contains enough context for the user to initiate the OAuth flow. The status bar reflects the unauthenticated state. The agent dock remains visible but inactive.

When initial sync completes successfully, the shell transitions the map viewport from the loading or empty state to the live map state. The transition does not produce an abrupt visual cut.

### 2. Layout Initialization

Once the authenticated and loaded state is reached, the shell establishes its full layout:

- The status bar occupies the full width at the top of the viewport window.
- The agent dock occupies a fixed strip along the bottom edge of the remaining space below the status bar.
- The map viewport fills the remainder of the available space between the status bar and the agent dock.
- No panel or overlay is open by default at this point.

### 3. Status Bar

The status bar is always visible. It does not scroll, collapse, or hide in any shell state including loading, empty, or error states. It spans the full window width.

The status bar contains, from left to right: sync status indicator, front health score display, streak counter display, and alert badge. Additional items may appear in the status bar but do not displace these four.

Clicking or activating the session summary trigger within the status bar opens the session summary modal overlay. Clicking or activating the deployment history trigger within the status bar opens the deployment history panel.

Alert badges in the status bar reflect the count of unacknowledged notifications. The count updates immediately when new notifications arrive or when existing ones are dismissed.

### 4. Agent Dock

The agent dock is a persistent panel. It does not close or hide during normal operation. It is visible at all times the shell is in the authenticated state.

The dock sits at the bottom of the shell, below the map viewport, above the window edge. Its height is fixed and does not change based on content. When the number of agent entries exceeds the available horizontal space, the dock scrolls horizontally. Scrolling within the dock does not affect map viewport pan state.

The dock is a distinct focus zone. Tab navigation reaching the dock cycles through its entries before moving focus to the next shell region.

### 5. Detail Panel

The detail panel is hidden by default. It opens when a thread is selected on the map. It slides in from the right edge of the map viewport. When open, it occupies a fixed-width strip on the right side of the shell. The map viewport shrinks horizontally to accommodate the panel - the map canvas is given a new bounding rectangle that excludes the panel width. The map does not scroll or reposition to compensate; it simply redraws within the reduced bounds.

The panel closes when the thread selection is cleared (the user clicks away from any thread or presses the escape key while focus is in the map or panel). On close, the panel slides out to the right and the map viewport expands back to its full width.

While the detail panel is open, it is a distinct focus zone. Keyboard focus can be explicitly moved to the panel via the tab order. Focus does not automatically jump to the panel on open; it remains where it was (typically on the map).

At narrow viewport widths below the responsive breakpoint, the detail panel overlays the map viewport rather than shrinking it. The map remains visible but partially obscured. The map receives pointer events only in its unobscured region while the panel is in overlay mode.

### 6. Search Overlay

The search overlay is hidden by default. It activates via a keyboard shortcut. When active, it appears as a bar overlaid at the top of the map viewport, directly below the status bar. It does not occlude the status bar. It extends the full width of the map viewport, not the full window width.

When the search overlay opens, keyboard focus moves to the search input immediately. The map and dock do not receive keyboard input while the search overlay is active.

The search overlay closes when the user presses escape, submits a search, or clicks outside the overlay area. On close, focus returns to the map viewport.

The search overlay is rendered in a layer above all map content and above the minimap overlay but below any open modal.

### 7. Minimap

The minimap is a fixed-position overlay within the map viewport. It is anchored to the bottom-right corner of the map viewport bounding rectangle. It does not move when the map pans or zooms. It does not move when the detail panel opens or closes; it remains anchored to the current map viewport edge, not the window edge.

The minimap is always visible when the shell is in the authenticated, loaded state. It does not hide when the detail panel is open, when the search overlay is active, or when the agent dock scrolls.

The minimap is rendered in the overlay layer above all map content but below the search overlay and all slide-in panels.

No notification stacking region occupies the bottom-right corner of the map viewport. Notifications are placed so they do not overlap the minimap.

### 8. Notification Area

Notifications stack in the bottom-left corner of the map viewport. Each new notification appears above the previous one. The stack does not extend beyond the top edge of the map viewport. When the maximum visible stack height is reached, older notifications that exceed the stack are dismissed automatically.

Notifications do not overlap the minimap. Notifications do not overlap the status bar. Notifications do not overlap the agent dock.

Notifications are rendered in a layer above map content and above the minimap but below the search overlay, detail panel, and any modal.

Each notification in the stack is individually dismissible. Dismissed notifications animate out of the stack and remaining notifications close the gap.

### 9. Deployment History Panel

The deployment history panel is hidden by default. It opens when triggered from the status bar or from the agent dock. It slides in from the right edge of the shell. When the detail panel is already open, the deployment history panel opens on top of it, not beside it. Only one slide-in panel occupies the right edge at a time.

When the deployment history panel is open, it is the active focus zone on the right side of the shell. Tab navigation within the panel is contained to the panel until the user explicitly moves focus out.

The panel closes when the user presses escape while focus is within the panel, or when the user activates the close control within the panel.

### 10. Session Summary Modal

The session summary modal is a full-screen overlay. It appears centered over the shell. It dims all content beneath it. While the modal is open, map interactions, dock interactions, and panel interactions are disabled. Pointer events on the dimmed region below the modal dismiss the modal.

The modal opens from the session summary trigger in the status bar. It closes when the user presses escape, activates the close control within the modal, or clicks the dimmed region behind it.

When the modal opens, focus moves to the modal. When it closes, focus returns to the element that triggered it.

### 11. Responsive Layout

The shell observes a single responsive breakpoint based on viewport width.

Above the breakpoint, the layout is as described in previous sections: status bar full width, agent dock full width at the bottom, map viewport filling the remainder, detail panel shrinking the map when open.

Below the breakpoint, the following changes apply:

- The detail panel overlays the map viewport rather than shrinking it.
- The deployment history panel overlays the map viewport rather than shrinking it.
- The agent dock may reduce in height to a compact form if the available height is insufficient for the full dock height. In compact form, agent entries are represented with reduced visual detail but remain interactive.
- The search overlay width is reduced to match the narrower map viewport.

Transitions between layout modes happen without losing the current panel open/closed state, selected thread, or map position.

### 12. Keyboard Focus Management

The shell defines four primary focus zones: the map viewport, the agent dock, the right panel area (detail panel or deployment history panel, whichever is open), and the status bar.

Tab order cycles: status bar -> map viewport -> agent dock -> right panel area (if open) -> status bar.

When no right panel is open, the right panel area is skipped in the tab cycle.

The search overlay, when active, intercepts the full tab cycle. Tab navigation is contained within the search overlay while it is active.

The session summary modal, when open, intercepts the full tab cycle. Tab navigation is contained within the modal while it is open.

Pressing escape from within any overlay, modal, or slide-in panel closes that surface and returns focus to its prior location.

Focus indicators are visible at all times within all focus zones. Focus does not become invisible or ambiguous at any point during tab navigation.

---

## State Transitions

### Shell Lifecycle State

- Initializing - the shell has mounted but authentication state and sync state are not yet known
- Unauthenticated - authentication state is unauthenticated or reauthentication-required; the auth prompt is shown in the map viewport area
- Loading - authentication is complete but initial sync has not finished; the loading indicator is shown in the map viewport area
- Empty - authentication is complete, sync has completed, but no threads are in the local store; an empty state message is shown in the map viewport area
- Active - authentication is complete, sync is complete, and at least one thread is loaded; the live map is shown
- Degraded - the system is authenticated and has local data but Gmail is unreachable; the map shows existing data with a sync error indicator in the status bar

Transitions:

- Initializing -> Unauthenticated: authentication state resolves to unauthenticated or reauthentication-required
- Initializing -> Loading: authentication state resolves to authenticated and sync begins
- Unauthenticated -> Loading: user completes OAuth flow and sync begins
- Loading -> Empty: sync completes with zero threads
- Loading -> Active: sync completes with one or more threads
- Loading -> Degraded: sync fails due to network or API error after authentication succeeded
- Empty -> Loading: user action triggers a re-sync or the sync interval fires
- Active -> Degraded: Gmail becomes unreachable during an ongoing session
- Degraded -> Active: Gmail becomes reachable again and sync resumes successfully
- Active -> Unauthenticated: token revocation signal received; all local session state is cleared

### Panel Open/Close State

At any given moment, the right panel area holds one of: none, detail, deployment-history.

- none -> detail: a thread is selected on the map
- none -> deployment-history: deployment history is triggered from status bar or dock
- detail -> none: thread selection is cleared or escape is pressed while detail panel has focus
- detail -> deployment-history: deployment history is triggered while detail panel is open (detail panel is replaced, not stacked)
- deployment-history -> none: escape is pressed while deployment history panel has focus, or close control is activated
- deployment-history -> detail: a thread is selected on the map while deployment history is open (deployment history is replaced by detail panel)

Modal state is independent of panel state. The session summary modal can open regardless of which panel is currently showing. When the modal opens, the panel beneath it remains in its current open/closed state and returns to that state when the modal closes.

Search overlay state is independent of panel state. The search overlay can open regardless of which panel is currently showing.

---

## Acceptance Criteria

- When the application launches before authentication is complete, the map viewport area shows an authentication prompt and the status bar is visible above it.
- When authentication is complete and initial sync is in progress, the map viewport area shows a centered loading indicator and no map content is visible.
- When initial sync completes with threads available, the map viewport transitions from the loading indicator to live map content without an abrupt visual cut.
- When initial sync completes with no threads, the map viewport shows an empty state indication instead of a loading indicator or blank canvas.
- When the application is in the active state, the status bar spans the full width of the window, the agent dock spans the full width below the map viewport, and the map viewport fills the space between them.
- When the detail panel is closed, the map viewport occupies the full horizontal space between the left window edge and the right window edge (minus agent dock and status bar in the vertical axis).
- When a thread is selected, the detail panel slides in from the right and the map viewport shrinks horizontally so that no map content is obscured by the panel at viewport widths above the responsive breakpoint.
- When the detail panel closes, the map viewport expands back to its previous width.
- When the deployment history panel opens while the detail panel is also open, the deployment history panel replaces the detail panel in the right panel area; two slide-in panels are never simultaneously visible side by side.
- When the session summary modal is open, all interactions with the map, dock, detail panel, and deployment history panel are disabled and visually dimmed.
- When the session summary modal closes, focus returns to the element that triggered it.
- When the search overlay is activated via keyboard shortcut, it appears at the top of the map viewport area and focus moves immediately to the search input.
- When escape is pressed while the search overlay is active, the overlay closes and focus returns to the map viewport.
- When notifications arrive, they stack in the bottom-left corner of the map viewport without overlapping the minimap in the bottom-right corner.
- When the notification stack reaches its maximum visible height, notifications that exceed the limit are dismissed without user action.
- When the viewport width crosses below the responsive breakpoint, the detail panel switches to overlay mode and no longer causes the map viewport to shrink.
- When tab is pressed while focus is in the agent dock and no right panel is open, focus moves to the status bar.
- When tab is pressed while focus is in the agent dock and a right panel is open, focus moves into the right panel.
- When escape is pressed while focus is within any slide-in panel, the panel closes and focus returns to the map viewport.
- When the shell is in the degraded state (Gmail unreachable), the map viewport continues to show existing thread data and the status bar reflects the error condition.
- The minimap remains anchored to the bottom-right corner of the map viewport when the detail panel opens and closes, tracking the current map viewport boundary rather than the window boundary.
