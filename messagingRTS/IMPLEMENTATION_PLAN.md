# Messaging RTS - Implementation Plan

Greenfield project. No source code exists yet. 12 specs written in `specs/`.

**Current state**: Project scaffolded and core systems implemented. 598 tests passing. Tags through v0.6.5. Build, typecheck, lint all clean.

**Implemented**: 1.1 Scaffolding, 1.2 Gmail Auth via Nango, 1.3 Thread Data Model (partial), 1.4 Thread Fetching & Initial Load, 1.5 Incremental Sync & Real-Time Updates, 1.6 Outbound Actions (Reply, Draft, Archive), 2.1 Application Shell, 2.2 Map Rendering,
2.3 Navigation, 2.4 Zone System, 2.5 Drift Engine,
2.6 Clustering, 3.1-3.5 Game Mechanics (including Map Alerts), 4.1 Agent Units, 4.3 Agent Deployment UI (drag-to-deploy, confirmation, recall, quick-deploy).

**Next priorities**: 1.7 Offline Queue & Conflict Resolution, 4.2 Agent AI Backend.

---

## Tech Stack Decisions

These must be resolved before implementation begins:

- **Frontend framework**: React + TypeScript (per project conventions)
- **Build tool**: Vite
- **Map rendering**: PixiJS (WebGL-backed 2D renderer) - needed for 500+ entity performance with smooth pan/zoom, layered rendering, pulse/glow animations, and drift. HTML Canvas alone lacks the scene graph; raw WebGL is too low-level. PixiJS provides the right abstraction.
- **State management**: Zustand for client state (per project conventions), React Query for server/async state (Gmail API calls)
- **Email integration**: Nango (managed OAuth + API proxy). Nango handles Gmail OAuth token exchange, storage, and refresh. All Gmail API calls go through Nango's proxy endpoint. No custom backend needed for auth.
- **Persistence**: IndexedDB (via idb or Dexie) for thread state, positions, scores, and offline cache. No external database for MVP.
- **Styling**: Tailwind CSS for shell/panels, PixiJS for map rendering
- **Testing**: Vitest + React Testing Library
- **Gmail API**: REST calls via Nango proxy (no googleapis npm package needed, no raw tokens)

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

### 1.2 Gmail Authentication via Nango

- [x] Create `src/lib/nango-client.ts` - Nango API client (connection status, create connect session, proxy Gmail API calls)
- [x] Auth state machine: Unauthenticated -> Authenticating -> Authenticated -> Reauthentication Required (no token management - Nango handles refresh transparently)
- [x] Create Nango connect session and redirect user to Nango OAuth flow
- [x] Poll/check Nango connection status on app load (GET /connection/{connectionId})
- [x] All Gmail API calls proxied through Nango (Nango handles token refresh)
- [x] UI: auth prompt on unauthenticated, reconnect prompt on broken connection
- [x] Environment config: VITE_NANGO_SECRET_KEY, VITE_NANGO_HOST (default https://api.nango.dev), VITE_NANGO_GMAIL_CONNECTION_ID (default "gmail")
- [x] **Spec**: 01-email-integration (Authentication via Nango section)
- [x] **Tests**: Auth state transitions, connection status check, connect session creation, proxy call construction

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

### 1.4 Gmail Thread Fetching & Initial Load (via Nango proxy)

- [x] Fetch inbox thread list via Nango proxy (reverse chronological, configurable lookback window, default 30 days)
- [x] Fetch full thread detail per thread via Nango proxy (messages, participants, labels, timestamps)
- [x] Extract derived metadata: participants, canonical subject, timestamps, message count, unread status
- [x] Progressive loading: threads become available as each finishes loading
- [x] Record history identifier for incremental sync
- [x] **Spec**: 01-email-integration (Initial Thread Load), 10-real-time-sync (Initial Load)
- [x] **Tests**: Thread list fetch, detail extraction, progressive availability, history ID capture

### 1.5 Incremental Sync & Real-Time Updates

- [x] Poll-based incremental sync using Gmail history API
- [x] Handle change events: new thread, new message, label change, read state change
- [x] History ID expiry fallback (full re-fetch)
- [x] Sync status state machine: connected -> syncing -> error -> offline
- [x] Sync status indicator (always visible)
- [x] **Spec**: 10-real-time-sync (Incremental Sync, Inbound Sync)
- [x] **Tests**: Incremental fetch, change event processing, history expiry recovery, status transitions

### 1.6 Outbound Actions (Reply, Draft, Archive)

- [x] Send reply within thread (pre-populated recipients, subject, In-Reply-To, References headers)
- [x] Draft lifecycle: create, save (update same draft), discard, send
- [x] Archive thread (remove Inbox label)
- [x] Optimistic local state update before Gmail confirmation
- [x] Rollback on failure with user notification
- [x] **Spec**: 01-email-integration (Sending a Reply, Drafts, Archiving)
- [x] **Tests**: Reply send/fail, draft CRUD, archive, optimistic update + rollback

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
- [x] Soft boundaries: threads drift across, not snap
- [x] Zone alerts: threshold evaluation, active/inactive states, visual indication
- [x] Manual thread reclassification via drag (user override flag)
- [x] **Spec**: 04-zone-system
- [x] **Tests**: Zone layout, count accuracy, adaptive sizing, alert threshold firing/resolution, drag override

### 2.5 Thread Positioning & Drift Engine

- [x] Urgency scoring: time since last reply, sender importance, deadlines, thread age
- [x] Value scoring: sender relationship, keywords, engagement depth, user labels/stars
- [x] Initial placement: new threads positioned in Active or Monitor zone based on scores
- [x] Tick-based continuous drift: target position computed from scores + neglect duration
- [x] Smooth movement: actual position approaches target by fractional step per tick
- [x] Neglect drift: proportional to neglect duration, toward Lost zone
- [x] User action repositioning: reply snaps target to Active, archive drifts to archive boundary
- [x] Collision avoidance: minimum separation distance enforcement
- [x] Position persistence across sessions
- [x] Score re-evaluation on session resume (reflect accumulated neglect)
- [x] **Spec**: 03-thread-positioning
- [x] **Tests**: Initial placement correctness, drift toward Lost over time, snap-back on reply, collision avoidance, persistence round-trip

### 2.6 Thread Clustering

- [x] Affinity calculation: shared participants (strongest), topic keywords, labels, temporal proximity
- [x] Cluster formation when 2+ threads exceed affinity threshold
- [x] Dynamic membership: threads join/leave as data changes
- [x] One cluster per thread maximum
- [x] Cluster centroid from member positions
- [x] Cluster label from common subject/participants
- [x] Cluster dissolves when fewer than 2 members
- [x] Visual: cluster boundary, aggregate representation at low zoom
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

- [x] Alert types: new high-value thread, thread about to be lost, agent task completed, streak at risk
- [x] Alerts appear without user action (evaluateAlerts runs on tick)
- [x] Visually distinct per type (severity-coded via notification area)
- [x] Acknowledge to dismiss (no action on underlying thread)
- [x] Auto-dismiss when condition resolves (e.g., user replied)
- [x] Multiple alerts stack without obscuring critical content (notification area bottom-left)
- [x] Alerts wired into drift tick runtime: evaluateAlerts() runs on every drift tick (200ms) in map-viewport.tsx; app store gains mapAlerts state with setMapAlerts/acknowledgeMapAlert
- [x] **Spec**: 07-game-mechanics (Map Alert Notifications)
- [x] **Tests**: Alert trigger conditions (about-to-be-lost, high-value-urgent, streak-at-risk, agent-completed), acknowledge, auto-resolve, dedup, countActiveAlerts (27 tests)

---

## Priority 4 - Agent System (AI-powered units)

### 4.1 Agent Unit Definitions

- [x] Six agent types with fixed definitions: Closer (amber, cap 5, 10min CD), Researcher (teal, cap 8, 5min CD), Scheduler (blue, cap 4, 8min CD), Cleaner (gray, cap 20, 15min CD), Drafter (green, cap 6, 5min CD), Escalation Bot (red, cap 15, 2min CD)
- [x] Agent instance lifecycle: idle -> deployed -> working -> completed/failed -> cooldown -> idle
- [x] Proposal model: per-thread output with pending/approved/rejected states
- [x] Capacity enforcement: threads beyond capacity queued in batches
- [x] Cooldown enforcement: no bypass, no redeployment until expired
- [x] Output types per agent (drafts, enrichment, time proposals, archive batches, escalation flags)
- [x] Agent store (Zustand) implemented: connects agent-manager.ts pure functions to the dock UI, managing 6 singleton agent instances with full lifecycle actions; cooldown ticking runs in the drift loop via tickCooldowns() on every drift tick
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

- [x] Agent dock: always visible, shows all 6 types with idle/deployed/cooldown status
- [x] Drag-to-deploy: lift agent from dock, ghost slot, drag across map
- [x] Drop target validation: valid/invalid/already-deployed visual states on clusters during drag
- [x] Invalid drop: snap back to dock
- [x] Valid drop: confirmation dialog (agent role, action description, thread count)
- [x] Cancel returns agent to dock; confirm creates deployment record
- [x] Travel animation: smooth arc from dock to target cluster
- [x] In-progress: progress indicator on cluster, agent icon anchored
- [x] Results overlay: actionable approve/reject per proposal, no auto-dismiss
- [x] Recall: cancel traveling/in-progress deployment, agent returns to idle (no cooldown)
- [ ] Batch deployment: multi-cluster selection, independent records per cluster
- [x] Deployment history panel: reverse-chronological log, filter by role/status
- [x] Quick-deploy: right-click context menu, keyboard shortcuts per agent type
- [x] **Spec**: 06-agent-deployment
- [x] **Tests**: Drag validation states, confirmation flow, travel animation, progress updates, overlay lifecycle, recall behavior, batch deployment, quick-deploy shortcuts

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

### Implementation Notes - Map Alerts & Detail Panel Metadata (2026-03-31)

- Map alerts engine (Spec 07): src/features/game-mechanics/map-alerts.ts with pure functions: isAboutToBeLost (30 min window before lost threshold per thread type latency table), isHighValueUrgent (value > 0.7, opportunity window < 30 min), isStreakAtRisk (within 2h of midnight, unsafe threads, streak > 0), evaluateAlerts (dedup, auto-resolve, preserve existing), createAgentCompletedAlert, acknowledgeAlert, countActiveAlerts
- Detail panel enhanced: thread metadata grid showing zone, lifecycle state, risk tier (color-coded), opportunity state (color-coded), urgency %, value %. ARIA attributes for accessibility (role=complementary, aria-label on panel and close button). Message timestamps displayed.
- Test count: 361 total (27 new map alert tests + 3 new detail panel tests), all passing

### Implementation Notes - Agent Store & Alert Wiring (2026-03-31)

- Agent store (src/lib/stores/agent-store.ts): Zustand store managing 6 singleton agent instances with full lifecycle actions (deploy, startWork, complete, fail, beginCooldown, tickCooldowns, recall, resolve). Integrates agent-manager.ts pure functions.
- Agent dock (src/components/agent-dock.tsx): Now reads real status from agent store. Shows idle/deploying/working/done/failed/cooldown states with color-coded labels, thread count badges, and visual dimming for cooldown.
- Map alerts wired into runtime: evaluateAlerts() runs on every drift tick (200ms) in map-viewport.tsx. App store gains mapAlerts state with setMapAlerts/acknowledgeMapAlert. Notification area displays active map alerts alongside shell notifications with severity-coded styling.
- Cooldown ticking: useAgentStore.tickCooldowns() called on every drift tick to auto-transition agents from cooldown to idle.
- Test count: 385 total, all passing

### Implementation Notes - Position Persistence (2026-03-31)

- Persistence manager (src/features/sync/persistence-manager.ts): Connects thread store to IndexedDB for position persistence across sessions. loadPersistedThreads re-evaluates urgency/value scores and neglect duration on session resume per Spec 03. saveThreadState batches writes to IndexedDB. startPeriodicPersist/stopPeriodicPersist manage a 5-second interval. flushPersist for immediate save (beforeunload).
- App.tsx initialization flow: async load persisted threads -> set in thread store -> start periodic persist -> transition to active. beforeunload handler flushes to IndexedDB. Error fallback proceeds without persisted data.
- App.test.tsx updated: mocks persistence manager to avoid IndexedDB dependency in jsdom, tests properly handle async initialization state.
- Test count: 395 total, all passing

### Implementation Notes - Zone Soft Boundaries & Manual Reclassification (2026-03-31)

- Soft boundaries (Spec 04): Removed premature zone snap in driftTick. Zone assignment now follows actual position via getZoneAtPosition() rather than snapping immediately when scores change. Target position still pulls toward score-driven zone, but thread visually drifts across boundary. User actions (reply, archive) still snap since they are explicit decisions.
- Manual reclassification: onManualReclassify() function added to drift-engine.ts. Sets userOverrideZone flag so drift engine respects manual placement. Accepts optional drop position for precision placement.
- Test count: 399 total, all passing

### Implementation Notes - Cluster Visual Rendering (2026-03-31)

- Cluster rendering added to MapRenderer (Spec 02 section 5): renderClusters() method on mid layer. At operational/detail zoom: rounded-rect boundary around member positions with cluster label. At strategic/tactical zoom: aggregate representation (single circle at centroid with urgency color ring, member count label), member thread graphics hidden.
- Cluster evaluation wired into drift tick in map-viewport.tsx: evaluateClusters() runs each tick, results stored in ref and passed to renderClusters on render.
- Zoom-level-aware visibility: clustered thread graphics hidden at low zoom, restored at high zoom. Non-clustered threads always visible.
- Test count: 402 total, all passing

### Implementation Notes - Agent Deployment UI (2026-03-31)

- Deployment store (src/lib/stores/deployment-store.ts): Manages drag state, confirmation dialog, deployment records, and lifecycle (confirming/traveling/in-progress/completed/recalled/failed). Separate from agent store to cleanly separate UI interaction from agent state machine.
- Agent dock enhanced: Drag-to-deploy with 8px threshold to distinguish clicks from drags. Ghost slot (dashed border, dimmed) when agent is being dragged. Floating drag ghost follows cursor. Recall button appears on deployed/working agents, returns to idle without cooldown per Spec 06.
- Deployment confirmation dialog (src/components/deployment-confirmation.tsx): Shows agent role, description, thread count, capacity. Confirm triggers deploy in agent store and starts travel/work lifecycle. Cancel returns agent to dock.
- Map viewport drop handling: On mouse up during agent drag, validates drop by finding threads within radius. Shows confirmation if threads found, cancels if empty area. Quick-deploy keyboard shortcuts (Shift+1-6) deploy to threads near viewport center.
- Test count: 422 total, all passing

### Implementation Notes - Results Overlay & Deployment Store Refactor (2026-03-31)

- ResultsOverlay component (src/components/results-overlay.tsx): Shows proposals from completed agent deployments. Approve/reject per proposal with done button only enabled when all proposals are resolved. Triggers agent cooldown and deployment resolution on done.
- Deployment store enhanced: Added "resolved" status, resolveDeployment action, getCompletedDeploymentForRole query to support overlay lifecycle.
- DeploymentHistoryPanel refactored to read from stores directly (single source of truth) instead of prop injection.
- App.tsx wired: Detects completed agents with proposals, renders ResultsOverlay, connects deployment history panel to deployment store.
- Test count: 437 total (15 new), all passing

### Implementation Notes - Gmail Auth via Nango (2026-03-31)

- Auth module fully rewritten for Nango-managed OAuth (Spec 01). Previous direct Google OAuth implementation replaced - no backend needed. Nango handles token exchange, storage, and refresh transparently through its proxy.
- src/lib/nango-client.ts: Core Nango API client with checkConnectionStatus (GET /connection/{id}), createConnectSession (POST /connect-sessions), nangoProxy (proxied Gmail API calls with Connection-Id and Provider-Config-Key headers), getNangoConfig.
- src/features/auth/auth-types.ts: 4-state machine (unauthenticated/authenticating/authenticated/reauthentication-required). No token-expired state because Nango handles refresh. Removed AuthTokens/AuthConfig/GMAIL_SCOPES types (not needed with Nango).
- src/features/auth/auth-store.ts: Zustand store with checkConnection (app load), startAuth (create session + redirect), handleAuthComplete (verify connection after OAuth callback), handleConsentDenied, signOut. Injectable \_checkConnectionStatus/\_createConnectSession/\_redirect for testing.
- src/features/auth/gmail-client.ts: All API calls now route through nangoProxy instead of direct Gmail API. Injectable \_setProxyFn/\_resetProxyFn for testing. On 401, transitions auth to reauthentication-required (Nango connection broken). Retry logic preserved (3 attempts, exponential backoff, 429 rate limit handling).
- App.tsx init flow updated: checks Nango connection first, transitions to unauthenticated if no connection. Connect Gmail button wired to startAuth. Auth errors displayed in auth prompt.
- .env.example added with VITE_NANGO_SECRET_KEY, VITE_NANGO_HOST, VITE_NANGO_GMAIL_CONNECTION_ID. .gitignore updated to exclude .env files.
- App.test.tsx updated: mocks auth store to prevent Nango API calls during tests.
- Test count: 506 total (58 new: 16 auth-types, 15 auth-store, 13 nango-client, 14 gmail-client), all passing

### Implementation Notes - Thread Fetching & Sync (2026-03-31)

- Thread fetcher (src/features/sync/thread-fetcher.ts): Pure conversion functions (convertGmailMessage, convertGmailThread) transform Gmail API responses into Thread objects per Spec 01 data contracts. Extracts participants (deduped by email), canonical subject, timestamps, labels, unread status. Computes initial urgency/value scores and neglect duration. Address parsing helpers (extractEmailAddress, extractDisplayName, parseAddressList) handle RFC 5322 formats. performInitialLoad orchestrates paginated thread list fetch with progressive loading (onThreadLoaded callback per Spec 10). Injectable \_setFetchFns/\_resetFetchFns for testing.
- Sync store (src/lib/stores/sync-store.ts): Zustand store managing sync cursor (lastHistoryId, syncMode, connectivityStatus), consecutive failure tracking (error after 2+ failures per Spec 10), and action queue (enqueue/update/remove with pending/in-flight/succeeded/failed states per Spec 10). Default 5s poll interval (within spec's 10s requirement) and 30-day lookback.
- Sync engine (src/features/sync/sync-engine.ts): Orchestrates initial load (calls performInitialLoad, records history ID, transitions shell state), incremental sync (polls fetchHistoryChanges, processes change events, merges updated threads preserving position/scores), history ID expiry detection (falls back to backfill/full re-fetch), network error detection (transitions to offline), and action queue replay (executes pending actions in order on reconnect, surfaces failures per Spec 10). Injectable \_setEngineFetchFns for testing.
- App.tsx init flow extended: auth check -> load persisted threads (immediate display) -> startInitialLoad (fetch from Gmail) -> startPolling (incremental sync). Cleanup stops polling. Shell transitions through loading -> active/empty/degraded based on results.
- Pre-existing gmail-client.ts type errors fixed: GmailApiError class field declarations converted from parameter properties to explicit fields (erasableSyntaxOnly compatibility). gmail-client.test.ts mock proxy function typed with proper signature; non-null assertions added for opts parameter access.
- Test count: 570 total (64 new: 30 thread-fetcher, 18 sync-store, 16 sync-engine), all passing. Typecheck and lint clean.

### Implementation Notes - Outbound Actions (2026-03-31)

- Outbound actions orchestration layer (src/features/sync/outbound-actions.ts): Coordinates reply, draft, and archive operations per Spec 01 Sections 4-6. Each action applies optimistic local state updates before the Gmail API call and rolls back on failure. Offline actions are queued in the sync store for ordered replay on reconnect (Spec 10 Section 8).
- sendReplyAction: Validates recipients + body per Spec 01, creates optimistic ThreadMessage in thread store, resets risk tier to safe + restarts risk timer (Spec 07), replaces optimistic message ID with real Gmail ID on success, full rollback on failure. Clears any active draft on success.
- Draft lifecycle (Spec 01 Section 5): Module-level Map tracks per-thread DraftRecord with state machine (none -> unsaved -> saved -> dirty -> sending -> discarded). beginDraft, updateDraftContent, saveDraftAction (create or update Gmail draft), discardDraftAction (delete from Gmail). Subsequent saves update the same draft ID rather than creating new ones.
- archiveThreadAction: Optimistic INBOX label removal + archived visual state, full rollback on failure. User notification on both success paths (offline queue) and failure.
- Sync engine enhanced: executeAction now handles draft-save (createDraft/updateDraft) and draft-discard (deleteDraft) action types for offline queue replay. Previously these fell through to console.warn.
- Detail panel (src/components/detail-panel.tsx): Reply composer placeholder replaced with functional ReplyComposer component. Textarea with send/save-draft/discard buttons. Recipients auto-populated from thread participants. Archive button in header (visible when thread has INBOX label). Draft state indicator shows current draft lifecycle state.
- Test count: 598 total (28 new outbound action tests), all passing. Typecheck and lint clean.
