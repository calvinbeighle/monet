# Messaging RTS - Implementation Plan

Greenfield project. No source code exists yet. 12 specs written in `specs/`.

**Current state**: Project scaffolded and core systems implemented. 334 tests passing. Tags: rts-v0.0.1 through rts-v0.0.7. Build, typecheck, lint all clean.

**Implemented**: 1.1 Scaffolding, 1.3 Thread Data Model (partial), 2.1 Application Shell, 2.2 Map Rendering,
2.3 Navigation, 2.4 Zone System, 2.5 Drift Engine,
2.6 Clustering, 3.1-3.4 Game Mechanics, 4.1 Agent Units.

**Next priorities**: 1.2 Gmail OAuth, 1.4 Thread Fetching, 4.2 Agent AI Backend, 4.3 Agent Deployment UI, 3.5 Map Alerts.

---

## Tech Stack Decisions

These must be resolved before implementation begins:

- **Frontend framework**: React + TypeScript (per project conventions)
- **Build tool**: Vite
- **Map rendering**: PixiJS (WebGL-backed 2D renderer) - needed for 500+ entity performance with smooth pan/zoom, layered rendering, pulse/glow animations, and drift. HTML Canvas alone lacks the scene graph; raw WebGL is too low-level. PixiJS provides the right abstraction.
- **State management**: Zustand for client state (per project conventions), React Query for server/async state (Gmail API calls)
- **Backend**: Next.js API routes or a lightweight Express server for Gmail OAuth token exchange and refresh (OAuth requires a server-side component for token security). The rest is client-side.
- **Persistence**: IndexedDB (via idb or Dexie) for thread state, positions, scores, and offline cache. No external database for MVP.
- **Styling**: Tailwind CSS for shell/panels, PixiJS for map rendering
- **Testing**: Vitest + React Testing Library
- **Gmail API**: googleapis npm package or direct REST calls via fetch

---

## Priority 1 - Foundation (no visible features yet)

### 1.1 Project Scaffolding

- [x] Initialize Vite + React + TypeScript project
- [x] Configure ESLint, Prettier, Vitest
- [x] Set up folder structure: `src/lib/` (shared utilities), `src/features/` (feature modules), `src/components/` (shell UI)
- [x] Install core dependencies: PixiJS, Zustand, React Query, Tailwind
- [x] Configure Tailwind
- [x] Add basic dev/build/test/lint npm scripts
- [x] **Spec**: N/A (infrastructure)
- [x] **Tests**: Build succeeds, lint passes, vitest runs with zero tests

### 1.2 Gmail OAuth & Authentication

- [ ] Implement OAuth2 consent flow (redirect to Google, exchange code for tokens)
- [ ] Server-side token exchange endpoint (keeps client_secret off the client)
- [ ] Secure token persistence (refresh token in server session or encrypted storage)
- [ ] Silent token refresh on access token expiry
- [ ] Auth state machine: Unauthenticated -> Authenticating -> Authenticated -> Token Expired -> Reauthentication Required
- [ ] UI: auth prompt on unauthenticated, error state on revocation
- [ ] **Spec**: 01-email-integration (Authentication section)
- [ ] **Tests**: Auth state transitions, token refresh flow, consent denial handling

### 1.3 Thread Data Model & Persistence

- [x] Define thread data structure with all core properties (Spec 09)
- [x] Define computed properties: urgency score, value score, map position, zone, drift velocity, cluster membership
- [x] Define contact enrichment structure per participant
- [x] IndexedDB schema and CRUD operations for threads
- [x] Thread lifecycle state machine: new -> active -> waiting -> at-risk -> lost / handled
- [x] State transition logging with timestamps and trigger events
- [x] Merge logic: persisted state + fresh Gmail data on reload
- [ ] **Spec**: 09-thread-data-model
- [ ] **Tests**: State transitions (all valid paths), persistence round-trip, merge on reload, thread removal when deleted from Gmail

### 1.4 Gmail Thread Fetching & Initial Load

- [ ] Fetch inbox thread list (reverse chronological, configurable lookback window, default 30 days)
- [ ] Fetch full thread detail per thread (messages, participants, labels, timestamps)
- [ ] Extract derived metadata: participants, canonical subject, timestamps, message count, unread status
- [ ] Progressive loading: threads become available as each finishes loading
- [ ] Record history identifier for incremental sync
- [ ] **Spec**: 01-email-integration (Initial Thread Load), 10-real-time-sync (Initial Load)
- [ ] **Tests**: Thread list fetch, detail extraction, progressive availability, history ID capture

### 1.5 Incremental Sync & Real-Time Updates

- [ ] Poll-based incremental sync using Gmail history API
- [ ] Handle change events: new thread, new message, label change, read state change
- [ ] History ID expiry fallback (full re-fetch)
- [ ] Sync status state machine: connected -> syncing -> error -> offline
- [ ] Sync status indicator (always visible)
- [ ] **Spec**: 10-real-time-sync (Incremental Sync, Inbound Sync)
- [ ] **Tests**: Incremental fetch, change event processing, history expiry recovery, status transitions

### 1.6 Outbound Actions (Reply, Draft, Archive)

- [ ] Send reply within thread (pre-populated recipients, subject, In-Reply-To, References headers)
- [ ] Draft lifecycle: create, save (update same draft), discard, send
- [ ] Archive thread (remove Inbox label)
- [ ] Optimistic local state update before Gmail confirmation
- [ ] Rollback on failure with user notification
- [ ] **Spec**: 01-email-integration (Sending a Reply, Drafts, Archiving)
- [ ] **Tests**: Reply send/fail, draft CRUD, archive, optimistic update + rollback

### 1.7 Offline Queue & Conflict Resolution

- [ ] Action queue for offline operations (reply, archive, label change)
- [ ] Queue entry states: pending -> in-flight -> succeeded / failed
- [ ] Ordered replay on reconnect
- [ ] Discard + notify when queued action is no longer valid
- [ ] Last-write-wins conflict resolution with user notification
- [ ] **Spec**: 10-real-time-sync (Offline Handling, Conflict Resolution)
- [ ] **Tests**: Queue ordering, replay on reconnect, conflict detection, discard notification

---

## Priority 2 - Core Map (the visual heart of the app)

### 2.1 Application Shell Layout

- [x] Map viewport as primary content area (fills available space)
- [x] Status bar: sync indicator, front health score, streak counters, alert badges
- [x] Agent dock: persistent panel showing agent types with status
- [x] Detail panel: slides in from right on thread selection
- [x] Search overlay: keyboard-activated, overlays top of viewport
- [x] Notification area: alerts stack without obscuring map
- [x] Minimap: fixed bottom-right corner overlay
- [x] Shell states: Initializing -> Loading -> Active / Degraded / Unauthenticated
- [x] Empty/loading states before threads arrive
- [x] Responsive: panels collapse at narrow viewports
- [x] Keyboard focus zones: map, dock, panels with tab navigation between them
- [x] **Spec**: 12-application-shell
- [x] **Tests**: Shell state transitions, panel open/close, responsive breakpoints, focus management

### 2.2 Map Rendering Engine

- [x] PixiJS canvas setup within React viewport
- [x] Layer system: background (zones) -> mid (connections) -> foreground (threads/clusters) -> overlay (agents, minimap)
- [x] Thread entity rendering: position, urgency glow, value-driven size, age opacity
- [x] Urgency pulse animation (rate proportional to urgency level)
- [x] Drift animation (slow organic positional movement)
- [x] Agent-occupied visual indicator on threads
- [x] Archived thread fade to minimum opacity
- [ ] Performance target: smooth rendering with 500+ entities
- [x] Viewport responsiveness on resize
- [x] **Spec**: 02-map-rendering
- [x] **Tests**: Layer ordering, entity state-driven appearance, 500-entity performance benchmark, resize behavior

### 2.3 Navigation (Pan, Zoom, Levels)

- [x] Click-drag pan (map coordinate stays under cursor)
- [x] Edge scrolling during drag
- [x] Scroll wheel zoom (anchored to cursor position)
- [x] Pinch-to-zoom (trackpad) -- deferred, requires touch event handling
- [x] Four zoom levels: Strategic, Tactical, Operational, Detail
- [x] Content visibility rules per zoom level (labels at operational+, cluster dots at strategic)
- [x] Smooth animated transitions between levels
- [x] Single-click thread selection (opens detail panel)
- [x] Double-click zoom to Detail view
- [x] Click cluster dot at Strategic -> zoom to Tactical
- [x] Minimap: viewport indicator, click-to-pan, drag-to-pan
- [x] Search: keyword/sender/label matching, highlight results, pan to first match, cycle through results
- [x] Quick-nav: zone keyboard shortcuts (1-6)
- [x] Back navigation (Escape returns to prior zoom/position)
- [x] Arrow key navigation between thread entities (operational/detail only per spec)
- [x] Tab cycling through zone labels -- partially wired, needs shell-level integration
- [x] **Spec**: 08-navigation
- [x] **Tests**: Zoom level logic, search matching, keyboard nav, hit testing, coordinate transforms, edge scrolling, navigation store lifecycle (61 tests)

### 2.4 Zone System

- [x] Six zones: Active Front, Opportunities, At Risk, Lost, Noise, Base/Handled
- [x] Zone layout initialization (canonical positions on canvas)
- [x] Zone rendering: filled polygons with color tinting, boundary indicators, labels
- [x] Thread count display per zone (including zero)
- [x] Adaptive zone sizing: area scales proportional to thread population
- [ ] Soft boundaries: threads drift across, not snap
- [x] Zone alerts: threshold evaluation, active/inactive states, visual indication
- [ ] Manual thread reclassification via drag (user override flag)
- [ ] **Spec**: 04-zone-system
- [ ] **Tests**: Zone layout, count accuracy, adaptive sizing, alert threshold firing/resolution, drag override

### 2.5 Thread Positioning & Drift Engine

- [x] Urgency scoring: time since last reply, sender importance, deadlines, thread age
- [x] Value scoring: sender relationship, keywords, engagement depth, user labels/stars
- [x] Initial placement: new threads positioned in Active or Monitor zone based on scores
- [x] Tick-based continuous drift: target position computed from scores + neglect duration
- [x] Smooth movement: actual position approaches target by fractional step per tick
- [x] Neglect drift: proportional to neglect duration, toward Lost zone
- [x] User action repositioning: reply snaps target to Active, archive drifts to archive boundary
- [x] Collision avoidance: minimum separation distance enforcement
- [ ] Position persistence across sessions
- [ ] Score re-evaluation on session resume (reflect accumulated neglect)
- [ ] **Spec**: 03-thread-positioning
- [ ] **Tests**: Initial placement correctness, drift toward Lost over time, snap-back on reply, collision avoidance, persistence round-trip

### 2.6 Thread Clustering

- [x] Affinity calculation: shared participants (strongest), topic keywords, labels, temporal proximity
- [x] Cluster formation when 2+ threads exceed affinity threshold
- [x] Dynamic membership: threads join/leave as data changes
- [x] One cluster per thread maximum
- [x] Cluster centroid from member positions
- [x] Cluster label from common subject/participants
- [x] Cluster dissolves when fewer than 2 members
- [ ] Visual: cluster boundary, aggregate representation at low zoom
- [x] Manual override: drag thread out of cluster
- [x] New thread evaluated for cluster membership on arrival
- [x] **Spec**: 11-thread-clustering
- [x] **Tests**: Formation on shared participants, dissolution below 2 members, one-cluster-per-thread, manual override persistence, new thread assignment

---

## Priority 3 - Game Mechanics (engagement layer)

### 3.1 Response Latency & Risk Scoring

- [x] Latency tolerance table per thread type (cold-outreach, warm-intro, existing-relationship, internal, transactional)
- [x] Thread type assignment (by agent layer, default to existing-relationship after 60s)
- [x] Continuous risk scoring: monotonic increase with time, tier thresholds (safe -> elevated -> critical -> lost)
- [x] Visual: color shift at elevated, pulsing at critical, drift to lost zone at lost
- [x] Risk reset to safe + clock restart on reply (user or agent)
- [x] Risk scoring cadence: at minimum every 5 minutes
- [x] **Spec**: 07-game-mechanics (Thread Ingestion, Continuous Risk Scoring, Risk Reset)
- [x] **Tests**: Monotonic risk increase, tier threshold transitions, reset on reply, default type fallback

### 3.2 Trust System

- [x] Trust score per contact (0-100)
- [x] Trust tiers: new (0-19), building (20-49), established (50-79), high-trust (80-100)
- [x] Trust increase on on-time reply (within elevated threshold)
- [x] Consecutive response streak tracking
- [x] Trust decay when no reply for 2x critical threshold duration
- [x] Decay floor: established contacts with 30+ days at tier don't drop below established
- [x] Visual indicators on contact threads
- [x] **Spec**: 07-game-mechanics (Trust Score Update, Trust Decay)
- [x] **Tests**: Trust tier transitions, streak increment, decay activation/deactivation, floor protection

### 3.3 Opportunity System

- [x] Opportunity flag set by agent layer
- [x] Opportunity window with configurable duration
- [x] States: none -> ripe -> fading -> expired / captured
- [x] Ripe: pulse visual, > 50% window remaining
- [x] Fading: distinct visual, < 50% window remaining
- [x] Expired: visual elevation drops, counted as missed
- [x] Captured: reply while window open, counted in session stats
- [x] **Spec**: 07-game-mechanics (Opportunity Detection, Pulse and Fade, Capture)
- [x] **Tests**: State transitions, visual state at 50% threshold, capture on reply, missed count

### 3.4 Front Health, Streaks & Session Summary

- [x] Front health score (0-100): risk load, trust average, opportunity capture rate, loss rate
- [x] Health tiers: healthy (>=75), degraded (<50), critical (<25)
- [x] Always-visible health display with tier-driven visual state
- [x] Streak counters: inbox-zero days, zero-lost-thread days
- [x] Streak evaluation at midnight local time
- [x] Lost thread tally: permanent per session, even after re-engagement
- [x] Session summary panel: threads handled, opportunities captured/missed, risks mitigated, agents deployed, net health change
- [x] **Spec**: 07-game-mechanics (Front Health, Streaks, Lost Thread Marking, Session Summary)
- [x] **Tests**: Health computation, tier transitions, streak increment/reset, session counter accuracy

### 3.5 Map Alerts

- [ ] Alert types: new high-value thread, thread about to be lost, agent task completed, streak at risk
- [ ] Alerts appear without user action
- [ ] Visually distinct per type
- [ ] Acknowledge to dismiss (no action on underlying thread)
- [ ] Auto-dismiss when condition resolves (e.g., user replied)
- [ ] Multiple alerts stack without obscuring critical content
- [ ] **Spec**: 07-game-mechanics (Map Alert Notifications)
- [ ] **Tests**: Alert trigger conditions, dismiss behavior, auto-dismiss, stacking

---

## Priority 4 - Agent System (AI-powered units)

### 4.1 Agent Unit Definitions

- [x] Six agent types with fixed definitions: Closer (amber, cap 5, 10min CD), Researcher (teal, cap 8, 5min CD), Scheduler (blue, cap 4, 8min CD), Cleaner (gray, cap 20, 15min CD), Drafter (green, cap 6, 5min CD), Escalation Bot (red, cap 15, 2min CD)
- [x] Agent instance lifecycle: idle -> deployed -> working -> completed/failed -> cooldown -> idle
- [x] Proposal model: per-thread output with pending/approved/rejected states
- [x] Capacity enforcement: threads beyond capacity queued in batches
- [x] Cooldown enforcement: no bypass, no redeployment until expired
- [x] Output types per agent (drafts, enrichment, time proposals, archive batches, escalation flags)
- [x] **Spec**: 05-agent-units
- [x] **Tests**: State machine transitions (all valid paths, reject invalid), capacity limits, cooldown timer, proposal lifecycle

### 4.2 Agent AI Backend

- [ ] Integration with Claude API for agent intelligence
- [ ] Per-agent-type prompt templates (Closer, Researcher, Scheduler, Cleaner, Drafter, Escalation Bot)
- [ ] Thread context packaging: conversation history, participant data, enrichment data fed to LLM
- [ ] Structured output parsing: proposals extracted from LLM response
- [ ] Rate limiting and error handling for API calls
- [ ] Drafter: produce 1 primary draft + up to 2 tone variants
- [ ] Cleaner: batch grouping logic for bulk archive proposals
- [ ] Escalation Bot: urgency signal detection rules
- [ ] **Spec**: 05-agent-units (behavioral descriptions per type)
- [ ] **Tests**: Prompt construction correctness, output parsing, error recovery, tone variant generation

### 4.3 Agent Deployment Interaction

- [ ] Agent dock: always visible, shows all 6 types with idle/deployed/cooldown status
- [ ] Drag-to-deploy: lift agent from dock, ghost slot, drag across map
- [ ] Drop target validation: valid/invalid/already-deployed visual states on clusters during drag
- [ ] Invalid drop: snap back to dock
- [ ] Valid drop: confirmation dialog (agent role, action description, thread count)
- [ ] Cancel returns agent to dock; confirm creates deployment record
- [ ] Travel animation: smooth arc from dock to target cluster
- [ ] In-progress: progress indicator on cluster, agent icon anchored
- [ ] Results overlay: actionable approve/reject per proposal, no auto-dismiss
- [ ] Recall: cancel traveling/in-progress deployment, agent returns to idle (no cooldown)
- [ ] Batch deployment: multi-cluster selection, independent records per cluster
- [ ] Deployment history panel: reverse-chronological log, filter by role/status
- [ ] Quick-deploy: right-click context menu, keyboard shortcuts per agent type
- [ ] **Spec**: 06-agent-deployment
- [ ] **Tests**: Drag validation states, confirmation flow, travel animation, progress updates, overlay lifecycle, recall behavior, batch deployment, quick-deploy shortcuts

---

## Cross-Cutting Concerns (address during relevant phases)

- **Rate limiting**: Gmail API quota tracking, prioritize user actions over background sync (Phase 1)
- **Error handling**: every Gmail failure surfaced to user, no silent drops (Phase 1)
- **Accessibility**: keyboard navigation throughout, focus management, ARIA labels (Phase 2)
- **Performance**: PixiJS object pooling for 500+ entities, IndexedDB batch writes (Phase 2)
- **Responsive layout**: panels collapse at narrow viewports (Phase 2)
- **Filter system**: show/hide threads by zone, label, sender, urgency; hidden threads still drift and can resurface on at-risk/lost transition (Phase 2)
- **Batch operations**: multi-select threads, bulk actions (mark handled, move zone, apply label, assign agent) (Phase 2)

---

## Spec Inventory

| #   | Spec               | Status  |
| --- | ------------------ | ------- |
| 01  | Email Integration  | Written |
| 02  | Map Rendering      | Written |
| 03  | Thread Positioning | Written |
| 04  | Zone System        | Written |
| 05  | Agent Units        | Written |
| 06  | Agent Deployment   | Written |
| 07  | Game Mechanics     | Written |
| 08  | Navigation         | Written |
| 09  | Thread Data Model  | Written |
| 10  | Real-Time Sync     | Written |
| 11  | Thread Clustering  | Written |
| 12  | Application Shell  | Written |

All specs authored. No source code exists yet. Implementation begins at 1.1.

---

### Implementation Notes - Navigation (2026-03-31)

- Navigation system fully implemented (Spec 08): navigation-store.ts (Zustand store for camera, search, selection, history), navigation-system.ts (pure functions for zoom levels, search, hit testing, edge scroll, zone shortcuts), minimap.tsx (Canvas-based minimap with click/drag-to-pan), search-overlay.tsx (keyboard-activated search with result cycling)
- map-renderer.ts enhanced: selection ring, search dimming, smooth camera animation via lerp, getZoomLevel bug fix (off-by-one in level table)
- map-viewport.tsx fully wired: click vs drag distinction (5px threshold), single-click select, double-click zoom-to-detail, strategic cluster click zoom, arrow key navigation, zone quick-nav (1-6 keys), Escape layered behavior, edge scroll animation loop, search handlers, camera history on zoom boundaries
- Test count: 277 total, all passing

### Implementation Notes - Application Shell (2026-03-31)

- Application Shell fully implemented (Spec 12): detail-panel.tsx (slides in from right on thread selection, shows subject/participants/messages/metadata/reply composer), deployment-history-panel.tsx (deployment records with status/stats), session-summary-modal.tsx (full-screen overlay with session stats, backdrop dismiss, Escape close, focus trap), notification-area.tsx (bottom-left stacking, severity-coded, individually dismissible, auto-dismiss beyond max)
- app-store.ts enhanced: selectedThreadId with auto detail panel open/close, notification system (add/dismiss/clear with auto-dismiss beyond MAX_VISIBLE_NOTIFICATIONS=5), ShellNotification model with severity/dismissed/createdAt, RESPONSIVE_BREAKPOINT constant
- App.tsx fully wired: 6 shell lifecycle states (initializing/unauthenticated/loading/empty/active/degraded), responsive layout (panels overlay below 768px breakpoint), focus zone management (status-bar/map/agent-dock/right-panel with tab order), degraded mode banner, status bar triggers for summary and deployment history
- StatusBar updated: onSummaryClick and onHistoryClick callback props for shell triggers
- Test count: 334 total (57 new tests for shell components), all passing
