# Messaging RTS - Implementation Plan

Greenfield project. No source code exists yet. 12 specs written in `specs/`.

**Current state**: 1218 tests passing. Tags through v0.11.0.

**Implemented**: All 12 specs fully implemented. 1.1-1.7 Foundation (Gmail auth, thread model, fetching, sync, outbound actions, offline queue), 2.1-2.6 Core Map (shell, rendering, navigation, zones, drift, clustering), 3.1-3.5 Game Mechanics (risk scoring, trust, opportunities, front health, alerts), 4.1-4.3 Agent System (units, AI backend, deployment UI), 5.1-5.8 Spec Compliance Round 1 (drag interactions, animations, reconnect backoff, tone variants, context menu), 6.1-6.5 Spec Compliance Round 2 (quota UI, travel arc, history filters, cluster indicator, draft store), 7.1-7.6 Spec Compliance Round 3 (organic drift, cluster migration, cluster-biased placement, failed thread identification, batch queue, zone quick-nav), 8.1-8.7 Spec Compliance Round 4 (clustering affinity nudge, collision avoidance on target positions, wobble stability, onLabel/onMarkRead handlers, reauth banner, read-state-change sync, failedThreadIds full propagation), 9.1-9.3 Spec Compliance Round 5 (topicTags on Thread model with topic-biased placement, drifting-lost and approaching-archive lifecycle states, extractKeywords reuse from clustering), 10.1-10.3 Spec Compliance Round 6 (arrow key New->Active transition, search close focus zone restoration, three-step Escape with composerActive state), 11.1-11.3 Spec Compliance Round 7 (draft deletion on send, deployment progress/outcomeSummary fields, trust tier-crossing and 3-consecutive visual indicators), 12.1-12.4 Spec Compliance Round 8 (pinch-to-zoom gesture, snap-back animation on cancelled drag, agent hover tooltip with elapsed time, lastPositioningTick written after drift tick), 13.1-13.2 Spec Compliance Round 9 (smoothed urgency pulse fade-out with lerp, zoom density blend transitions with smooth crossfade), 14.1-14.6 Spec Compliance Round 10 (zoom min/max boundary flash, label truncation at tactical zoom, soft boundary membership indicator, context menu cluster filter, contact enrichment from message history, new thread evaluation timing already correct), 15.1-15.4 Spec Compliance Round 11 (quotaExhausted wiring, archived pulse suppression, cluster migration animation, cluster label at aggregate zoom, zone alert wiring, smooth zone boundaries, agent-completed alert, session counter reset, zoom anchor math fix, strategic cluster click, cooldown timer in agent dock, outcomeSummary rendering in deployment history, cluster-only deployment target validation per Spec 11 Section 10), 16.1-16.4 Spec Compliance Round 12 (dissolved cluster ID retirement per Spec 11, visualExtent high-water mark per Spec 11, search overlay z-index above notifications per Spec 12, distinct initial-load sync indicator per Spec 10), 17.1-17.5 Spec Compliance Round 13 (detail zoom reduced-opacity surrounding context, minimap cluster aggregate positions, label collision detection, map tooltip recall button, deployment history recall for in-progress entries), 18.1-18.5 Spec Compliance Round 14 (drift settlement snap, body topic tag extraction, mount alert evaluation, cluster membership restore, cluster-anchored results overlay), 19.1-19.11 Spec Compliance Round 15 (reply lifecycle transition on send, topic-tag-based cluster affinity, cluster label all-member participant rule, approaching-archive drift completion, opportunity-only high-value alert, most-recent thread type for trust decay, session-tracked zeroLostDays streak, agent dock history trigger, info notification auto-dismiss, AffinityScore meetsThreshold flag), 19.12-19.17 Spec Compliance Round 16 (front health critical threshold fix, arrow key zoom guard, action queue state lifecycle, visualExtent high-water mark, clustering meetsThreshold flag, strategic zoom thread hiding), 20.1-20.7 Spec Compliance Round 17 (notification stack direction, Escape state machine, strategic hit-test guard, double-click detail no-op, arrow key pan-to-keep-visible, cluster extent contraction, initializing StatusBar).

**Next priorities**: Remaining spec compliance gaps (see below), performance profiling, integration testing.

### Remaining Known Spec Gaps (prioritized)

**High**:

(none remaining)

**Medium**:

- Spec 09: Persistence batched every 5s, not on every property change (beforeunload mitigates) - spec says "whenever any property changes" but batching is a reasonable optimization to avoid IndexedDB flooding during 200ms drift ticks
- Spec 09: vipFlag always false, organization always null (no external enrichment API)

**Low**:

- Spec 06: Cancelled deployment record state not tracked (record is discarded on cancel, matching spec intent)
- Spec 07: Trust decay floor clock resets on tier transitions (established<->high-trust) - tierEntryDate resets on tier change, requiring 30 days at new tier before floor applies

**Resolved (this round)**:

- ~~Spec 12: Notification stack direction inverted (newer at bottom instead of top)~~ - Changed flex-col-reverse to flex-col so newer notifications appear above older ones per Spec 12
- ~~Spec 08: Escape collapsed detail-close and deselect into one step~~ - Escape now follows spec state machine: Detail Panel Open -> Entity Selected (close panel) -> None (clear selection) as separate steps
- ~~Spec 08: Hit-testing invisible threads at strategic zoom~~ - Thread hit-test skipped at strategic zoom; only cluster aggregate dots are clickable
- ~~Spec 08: Double-click same entity at detail triggered zoom change~~ - No-op when already at detail level on the same entity per Spec 08
- ~~Spec 08: Arrow keys always centered camera instead of pan-to-keep-visible~~ - Now only pans when selected entity would be outside viewport (60px margin)
- ~~Spec 11: visualExtent never contracted when members left~~ - Extent now tracks current member count, contracting when members leave per Spec 11
- ~~Spec 12: No StatusBar in initializing state~~ - StatusBar now rendered in initializing state per Spec 12 (always visible)

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
- [x] **Spec**: 09-thread-data-model
- [x] **Tests**: State transitions (all valid paths), persistence round-trip, merge on reload, thread removal when deleted from Gmail

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

- [x] Action queue for offline operations (reply, archive, label change)
- [x] Queue entry states: pending -> in-flight -> succeeded / failed
- [x] Ordered replay on reconnect
- [x] Discard + notify when queued action is no longer valid
- [x] Last-write-wins conflict resolution with user notification
- [x] **Spec**: 10-real-time-sync (Offline Handling, Conflict Resolution)
- [x] **Tests**: Queue ordering, replay on reconnect, conflict detection, discard notification

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
- [x] Performance target: smooth rendering with 500+ entities
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

- [x] Integration with Claude API for agent intelligence
- [x] Per-agent-type prompt templates (Closer, Researcher, Scheduler, Cleaner, Drafter, Escalation Bot)
- [x] Thread context packaging: conversation history, participant data, enrichment data fed to LLM
- [x] Structured output parsing: proposals extracted from LLM response
- [x] Rate limiting and error handling for API calls
- [x] Drafter: produce 1 primary draft + up to 2 tone variants
- [x] Cleaner: batch grouping logic for bulk archive proposals
- [x] Escalation Bot: urgency signal detection rules
- [x] **Spec**: 05-agent-units (behavioral descriptions per type)
- [x] **Tests**: Prompt construction correctness, output parsing, error recovery, tone variant generation

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
- [x] Batch deployment: multi-cluster selection, independent records per cluster
- [x] Deployment history panel: reverse-chronological log, filter by role/status
- [x] Quick-deploy: right-click context menu, keyboard shortcuts per agent type
- [x] **Spec**: 06-agent-deployment
- [x] **Tests**: Drag validation states, confirmation flow, travel animation, progress updates, overlay lifecycle, recall behavior, batch deployment, quick-deploy shortcuts

---

## Cross-Cutting Concerns (address during relevant phases)

- [x] **Rate limiting**: Gmail API quota tracking, prioritize user actions over background sync (Phase 1)
- [x] **Error handling**: every Gmail failure surfaced to user, no silent drops (Phase 1)
- [x] **Accessibility**: keyboard navigation throughout, focus management, ARIA labels (Phase 2)
- [x] **Performance**: PixiJS object pooling for 500+ entities, IndexedDB batch writes (Phase 2)
- [x] **Responsive layout**: panels collapse at narrow viewports (Phase 2)
- [x] **Filter system**: show/hide threads by zone, label, sender, urgency; hidden threads still drift and can resurface on at-risk/lost transition (Phase 2)
- [x] **Batch operations**: multi-select threads, bulk actions (mark handled, move zone, apply label, assign agent) (Phase 2)
- [x] **Game mechanics runtime wiring**: front health, opportunity ticking, trust decay, streak evaluation, session stats all connected to drift tick loop and outbound actions (Spec 07)
- [x] **Session summary live data**: session summary modal reads real-time stats instead of hardcoded zeros (Spec 07, Spec 12)

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

### Implementation Notes - Offline Queue & Conflict Resolution (2026-03-31)

- Offline queue (Spec 10 Section 8): Action queue now persisted to IndexedDB via new `action-queue` object store (DB version bumped to 2). Queue entries survive tab close and are restored on startup via `loadPersistedActionQueue()` in the App.tsx init flow. Periodic persist (5s) writes queue alongside threads.
- Reconnect trigger: `performIncrementalSync()` detects offline->connected transition and automatically calls `replayActionQueue()` before resuming normal polling. Clears persisted queue after successful replay. Restores shell state from degraded.
- Conflict resolution (Spec 10 Section 6): `processChangeEvents()` detects pending/in-flight actions for incoming thread changes. Applies last-write-wins by comparing timestamps. If server wins, pending actions are removed and user is notified. If user wins, server merge is skipped for that thread and user is notified. Every conflict is logged.
- Queue cleanup: Succeeded entries are removed immediately after replay (not accumulated). Actions targeting deleted threads are discarded with user notification before attempting execution.
- Label-change action: `executeAction()` now handles `label-change` type via new `modifyThreadLabels()` gmail-client function that supports arbitrary add/remove label combinations.
- Test count: 604 total (6 new: 2 reconnect trigger, 2 conflict resolution, 1 thread-deleted discard, 1 label-change replay), all passing. Typecheck and lint clean.

### Implementation Notes - Agent AI Backend (2026-03-31)

- AI backend replaces work-simulator with real Claude API integration (Spec 05 Section 4.2). Falls back to simulated proposals when VITE_ANTHROPIC_API_KEY is not configured - graceful degradation for development and testing.
- src/features/agents/claude-client.ts: Anthropic SDK wrapper with dangerouslyAllowBrowser for frontend. Semaphore-based rate limiting (default 3 concurrent). Exponential backoff retry (3 attempts) for rate limits, 5xx, and connection errors. Injectable \_setCreateMessageFn for testing.
- src/features/agents/context-packager.ts: Transforms Thread objects into structured text context for LLM consumption. Includes metadata (subject, zone, risk tier, urgency/value scores, opportunity state, neglect duration), participant info (org, VIP flag, relationship score, response history), and conversation messages (last 20, 2000 char limit per body, HTML->text fallback).
- src/features/agents/prompt-templates.ts: Per-agent-type system prompts and tool definitions. Uses Claude tool_use for structured output. Closer: submit_proposal (reply-draft, follow-up-draft, close-action-proposal). Researcher: submit_proposal (enriched-contact, company-background, thread-summary). Scheduler: submit_proposal (meeting-time-proposal, availability-summary, scheduling-reply-draft). Cleaner: submit_batch_proposal (archive-proposal, label-assignment, unsubscribe-proposal) with thread_ids array for atomic batch proposals. Drafter: submit_proposal with tone_label field for variants. Escalation Bot: submit_proposal with urgency_level field.
- src/features/agents/output-parser.ts: Parses Claude tool_use content blocks into ParsedProposal objects. Handles both submit_proposal (single thread) and submit_batch_proposal (Cleaner batches - expands to one proposal per thread). Validates required fields, filters invalid entries, prepends tone/batch labels to content. filterValidProposals drops proposals referencing threads not in the deployment.
- src/features/agents/ai-backend.ts: Orchestrator function processAgentWork(role, threadIds, threads). Checks isClaudeClientConfigured(), falls back to generateSimulatedProposals if not. Packages thread context, builds prompts, calls sendMessage, parses response, filters valid proposals. On any API error, falls back to simulation with error logging.
- deployment-confirmation.tsx: Replaced synchronous work-simulator call with async processAgentWork. Fetches thread objects from useThreadStore for AI context. Handles async completion and failure (failDeployment on catch).
- App.tsx: Initializes Claude client from VITE_ANTHROPIC_API_KEY on startup (Step 0 in init flow).
- @anthropic-ai/sdk added to dependencies. .env.example updated with VITE_ANTHROPIC_API_KEY.
- Test count: 664 total (60 new: 13 claude-client, 16 ai-backend, 14 output-parser, 6 prompt-templates, 11 context-packager), all passing. Typecheck and lint clean.

### Implementation Notes - Thread Data Model & Performance (2026-03-31)

- 1.3 Thread Data Model complete: Real IndexedDB persistence tests via fake-indexeddb (round-trip, bulk persist, zone index query, delete, count, thread removal reconciliation when deleted from Gmail). Merge-on-reload edge cases (empty array overwrite, falsy-but-not-nullish boolean). Thread store transitionState now guards against invalid transitions using isValidTransition. Multi-step state history accumulation tested (5-step lifecycle new->active->waiting->at-risk->lost->handled).
- 2.2 Performance optimizations for 500+ entities: Viewport culling (AABB from camera state, entities outside bounds hidden not destroyed), object pooling (Graphics/Text recycled via free list instead of destroy/recreate), dirty flagging (skip redraw for low-urgency threads with unchanged position/scores/visual state). Search mode bypasses culling to preserve dimming effect. Performance benchmark tests verify culling math, dirty flag behavior, and pool mechanics.
- Test count: 689 total (25 new: 15 persistence, 3 thread-store, 7 map-renderer performance), all passing. Typecheck and lint clean.

### Implementation Notes - Batch Deployment (2026-03-31)

- Batch deployment (Spec 06 Section 11): Multi-cluster selection and independent deployment records per cluster. Ctrl+click (or Cmd+click on macOS) on cluster centroids to toggle selection. When an agent is dragged with 2+ clusters selected, a batch confirmation dialog appears showing all target clusters, per-cluster thread counts, and total thread count. Confirming creates one independent DeploymentRecord per cluster, all sharing a batchId.
- deployment-store.ts: Added selectedClusterIds state, toggleClusterSelection/clearClusterSelection actions, confirmBatchDeployment (creates N records with shared batchId), getActiveDeploymentsForRole/getCompletedDeploymentsForRole (plural versions for batch), getBatchDeployments query. DeploymentRecord gains batchId field (null for single deployments).
- deployment-confirmation.tsx: Refactored to shared startAgentWorkPhase helper for both single and batch paths. Batch confirm creates staggered travel animations (300ms offset per cluster), then runs a single processAgentWork call with all threadIds. All deployment records complete/fail together.
- map-viewport.tsx: Added hitTestCluster function (distance to centroid). Ctrl+click toggles cluster selection. Agent drop with pre-selected clusters builds BatchTarget array and shows batch confirmation. Non-Ctrl clicks clear cluster selection.
- ConfirmationState extended with optional batchTargets: Array<BatchTarget> for batch mode. Dialog shows batch badge, cluster list with per-cluster thread counts, total counts.
- Test count: 702 total (13 new: 8 deployment-store batch, 3 deployment-confirmation batch, 2 cluster selection), all passing. Typecheck and lint clean.

### Implementation Notes - Filter System & Batch Operations (2026-03-31)

- Filter store (src/lib/stores/filter-store.ts): Zustand store with localStorage persistence. Four filter dimensions per Spec 09: zone, Gmail label, sender email/domain, urgency score range. Pure functions (isFilterActive, shouldHideThread, getVisibleThreads) exported for use outside React. At-risk/lost threads always surface regardless of filter (escape hatch per Spec 09). Toggle actions for each dimension. 48 tests.
- Filter integration: map-viewport.tsx renders only visible (filtered) threads. Minimap shows filtered threads. App.tsx restores persisted filter on init. Filter store re-exported from stores/index.ts barrel.
- Batch operations (src/features/sync/batch-operations.ts): Orchestration layer for four batch actions per Spec 09: batchMarkHandled (lifecycle transition + Gmail archive), batchMoveToZone (zone + userOverrideZone flag), batchApplyLabel (optimistic + Gmail API), batchAssignAgent (deployment confirmation flow). Each thread transitions independently. Selection cleared after every action. Offline queueing for Gmail operations.
- Thread store (thread-store.ts): Already had selectedThreadIds (Set), toggleBatchSelect, clearBatchSelection from prior implementation. Selection is distinct from thread state per Spec 09.
- Map viewport batch selection: Shift+click toggles thread in batch selection set. Normal click clears batch selection. Click on empty space clears both selections.
- Batch action bar (src/components/batch-action-bar.tsx): Toolbar visible when selectedThreadIds.size > 0. Actions: Mark Handled, Move to Zone (dropdown), Apply Label (text input), Assign Agent (dropdown), Clear. ARIA toolbar role, descriptive aria-labels.
- Map renderer: batch-selected threads get cyan ring (0x00ccff) distinct from white single-selection ring. Dirty flag cache includes batchSelected state.
- Test count: 782 total (32 new batch operation tests), all passing. Typecheck and lint clean.

### Implementation Notes - Game Mechanics Runtime Wiring (2026-03-31)

- Game loop orchestrator (src/features/game-mechanics/game-loop.ts): Central tick function `runGameTick()` called from drift tick (200ms) in map-viewport.tsx. Throttles expensive operations: front health every 5s, trust decay every 30s, streak evaluation every 60s. Opportunity window ticking runs every tick (cheap). Returns `GameTickResult` with updated threads, optional health score, streaks, and session stat deltas.
- Front health score wired: `computeFrontHealth()` feeds real thread risk distribution, trust averages, and session stats into `appStore.frontHealthScore`. Status bar now shows live health instead of hardcoded 100.
- Opportunity system wired: `tickOpportunities()` transitions ripe -> fading -> expired on each tick. Reply during active window calls `captureOpportunity()` and increments `sessionStats.opportunitiesCaptured`. Expired transitions increment `sessionStats.opportunitiesMissed`.
- Trust system wired: `trustRecords` (Record<string, TrustRecord>) stored in app store. `updateTrustOnReply()` called on successful reply in outbound-actions.ts (creates records for new contacts, increments for known). `runTrustDecay()` evaluates all records every 30s against 2x critical threshold per thread type. Floor protection preserved for established contacts.
- Streak counters wired: `evaluateStreaks()` runs on streak check interval, only evaluates when date changes (YYYY-MM-DD comparison). `setStreaks()` action syncs `streakState` to `streakInboxZero`/`streakZeroLost` flat fields read by status bar.
- Session summary wired: App.tsx reads live `sessionStats` from app store instead of hardcoded zeros. `netHealthChange` computed as `frontHealthScore - initialHealthScore`. `sessionDurationMs` computed live from `sessionStats.sessionStart`. Counters incremented in: outbound-actions.ts (reply: trust, opportunity capture, risk mitigation), batch-operations.ts (threadsHandled), deployment-confirmation.tsx (agentsDeployed), game-loop.ts (opportunitiesMissed, lostThreadCount).
- determineChangeType fixed: sync-engine.ts now returns "label-change" for label deletions and non-UNREAD additions, "new-message" for UNREAD/INBOX additions. Previously both branches returned "new-message".
- Test count: 803 total (21 new: 17 game-loop, 4 app-store), all passing. Typecheck and lint clean.

### Implementation Notes - Rate Limiting & Bug Fixes (2026-03-31)

- Gmail API rate limiter (src/lib/utils/rate-limiter.ts): Sliding-window per-second tracking (250 units/s) and daily quota tracking (10,000 units conservative per-user limit). Operations cost-mapped: messages.send=100, threads.list=10, threads.get=5, history.list=2, etc. Three enforcement modes: (1) per-second overflow blocks with estimated wait time, (2) at 80% daily usage, background-sync reads are paused while user-action writes still proceed, (3) at daily exhaustion, enters read-only degraded mode (writes blocked, reads allowed). 429 responses trigger pauseFor() which blocks all calls for the server-indicated duration. getOperationName() maps Gmail API paths+methods to named operations. Injectable clock (\_setNow) for testing.
- gmail-client.ts integration: gmailFetch() now checks rateLimiter.canProceed() before every API call and records usage after. All user-initiated operations (sendReply, createDraft, updateDraft, deleteDraft, archiveThread, modifyThreadLabels) pass priority="user-action". Background operations (thread list, detail fetch, history poll) default to "background-sync". 429 responses update both the retry backoff and the rate limiter pause.
- Bug fix - zone alert thresholds: createZoneLayout() was initializing all zones with null alert thresholds, meaning evaluateZoneAlerts() could never fire. Fixed: at-risk zone now has maxThreads=10, lost zone has maxThreads=3.
- Bug fix - arrow key first-press: findNextThreadInDirection() was selecting threads[0] (array order) when nothing was selected. Now accepts optional viewportCenter parameter and uses findNearestThread() to select the thread nearest to the viewport center per Spec 08.
- Bug fix - empty zone threadCount: updateZoneSizes() returned early when total threads was 0, leaving stale threadCount values on zones. Now explicitly sets threadCount=0 for all zones in the zero-thread case per Spec 04.
- Test count: 826 total (23 new rate limiter tests), all passing. Typecheck and lint clean.

### Implementation Notes - Spec Compliance Fixes (2026-03-31)

- Drift engine auto-lifecycle transitions (Spec 03, 07, 09): driftTick now calls computeRiskTier() on every tick to update thread.riskTier based on latency thresholds. When riskTier crosses to "critical", resolveTransition("time-threshold-waiting") auto-transitions waiting -> at-risk. When riskTier crosses to "lost", resolveTransition("time-threshold-lost") auto-transitions at-risk -> lost. State history entries recorded with triggers "risk-tier-critical" and "risk-tier-lost". Handled threads excluded from risk tier updates. This fixes the critical gap where threads drifted visually to the lost zone but lifecycle state never changed, making game mechanics (lost counts, streaks, front health) incorrect.
- Visual state auto-update: driftTick now updates thread.visualState on every tick based on drift magnitude (drifting when > 5px), zone (active when in active-front or unread), preserving archived and agent-occupied states.
- Agent-occupied visual state (Spec 02): deployment-confirmation.tsx now sets visualState="agent-occupied" on threads when startAgentWorkPhase fires, clears it in .finally() after completion/failure. agent-store.ts recall action clears agent-occupied state on recalled agent's threads.
- Filter UI panel (Spec 09): New filter-panel.tsx component with zone toggles, label/sender input, urgency range sliders. Accessible from status bar "Filter" button. Filter state persists via existing filter-store localStorage. "Clear all" button resets filters. Escape hatch note explains at-risk/lost threads always surface.
- Alert list UI (Spec 07): New alert-list.tsx component showing unacknowledged and acknowledged map alerts. Accessible by clicking the alert badge in status bar. Per-alert dismiss button calls acknowledgeMapAlert. Grouped display: unacknowledged first, acknowledged below dimmed.
- Thread-fetcher concurrency limit: performInitialLoad now uses fetchWithConcurrencyLimit(entries, 5, fn) instead of unbounded Promise.all. Limits to 5 parallel thread detail fetches per page to avoid Gmail API rate limit bursts.
- Status bar enhanced: Added filter trigger button (shows "Filtered" in blue when active), made alert badge clickable.
- App.tsx wired: Filter panel and alert list render as positioned popovers below status bar, toggled by new state variables. Mutually exclusive (opening one closes the other).
- Test count: 858 total (32 new: 7 drift-engine lifecycle, 8 filter-panel, 13 alert-list, 1 thread-fetcher concurrency, 3 agent-store recall), all passing. Typecheck and lint clean.

### Implementation Notes - Spec Compliance Fixes (2026-04-01)

- Streak timezone fix (Spec 07): evaluateStreaks now uses local date (getFullYear/getMonth/getDate) instead of UTC (toISOString) for midnight day boundary calculation. Users in non-UTC timezones now get correct streak evaluation.
- Trust display in detail panel (Spec 07): New ParticipantTrust component shows trust tier (color-coded), score, and 3+ consecutive streak indicator per participant. Reads trustRecords from app store.
- Zone alert visual state (Spec 04): renderZones now checks zone.alertState. Active alerts show red border (width 3, alpha 0.8), "! " label prefix, and increased label alpha (0.7 vs 0.4).
- Cluster layer ordering (Spec 02): Cluster graphics and labels now render on foreground layer (co-planar with thread entities) instead of mid layer, per Spec 02 Section 5.
- Connection line rendering (Spec 02 Section 3): New renderConnections() method draws faint edges between threads sharing participants. At low zoom, edges attach to cluster centroids. Participant index limits to 8 threads per participant to avoid O(n^2). Wired into map-viewport render loop.
- Session idle auto-trigger (Spec 07): 5-minute idle timer resets on mousedown/keydown/scroll/touchstart. Auto-opens session summary when no modal is active.
- Daily quota exhaustion notification (Spec 01): gmail-client now surfaces a critical notification to the user when rate limiter enters daily-exhausted read-only mode.
- Alert-list test type fix: Local MapAlert type replaced with imported type from game-mechanics.ts; message field added to makeAlert helper.
- Test count: 876 total (18 new: 1 game-loop timezone, 8 map-renderer, 3 detail-panel trust, 2 gmail-client quota, 4 misc), all passing. Typecheck and lint clean.

### Implementation Notes - Accessibility & Responsive Layout (2026-04-01)

- Shell-level Tab cycling (Spec 12 Section 12): handleGlobalKeyDown in App.tsx now intercepts Tab/Shift+Tab to programmatically cycle focus between four zones in order: status-bar -> map viewport -> agent dock -> right panel (if open) -> status-bar. When search overlay is active (checked via useNavigationStore.getState().searchActive), Tab is not intercepted at shell level since search overlay traps focus internally.
- Focus indicators (Spec 12 Section 12): All four focus zone wrapper divs now have `focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500/60` classes. This replaces the previous invisible focus state (tabIndex={0} with no outline).
- Search overlay focus trap (Spec 12 Section 6): Tab key within search overlay now cycles between the search input and close button. handleKeyDown moved from input to overlay div to capture Tab at container level. role="search" and aria-label added.
- Filter panel focus trap (Spec 12 Section 12): New ref, useEffect for auto-focus on mount, onKeyDown handler trapping Tab within the panel and closing on Escape. Added aria-modal="true" and tabIndex={-1} for programmatic focus.
- Alert list focus trap (Spec 12 Section 12): Same pattern as filter panel - auto-focus on mount, Tab trap, Escape to close. Added aria-modal="true" and tabIndex={-1}.
- Session summary modal ARIA (Spec 12 Section 10): Added role="dialog", aria-modal="true", aria-label="Session summary" to modal container. Focus trap was already implemented.
- Zone wrapper ARIA: All four zone divs (status-bar, map-viewport, agent-dock, right-panel) now have role="region" and aria-label attributes for screen reader landmark navigation.
- Escape behavior enhanced: Escape now closes filter panel and alert list popovers (returning focus to status bar) before checking right panel closure.
- Agent dock compact form (Spec 12 Section 11): AgentDock now accepts isCompact prop. Below RESPONSIVE_BREAKPOINT (768px), dock height reduces from h-16 to h-10, agent entries show only color dot and optional count badge (no name, no status label), with full info available via title tooltip. All entries remain interactive (draggable, recallable) in compact form.
- Test count: 896 total (20 new: 6 Tab cycling, 2 ARIA attributes, 1 Escape behavior, 2 responsive dock, 2 session-summary ARIA, 3 filter-panel a11y, 4 alert-list a11y), all passing. Typecheck and lint clean.

### Implementation Notes - Spec Compliance Fixes (2026-04-01)

- Lifecycle state machine fix (Spec 09): Added `active -> at-risk` as a valid transition. Previously, only `waiting -> at-risk` was allowed, meaning active threads that never entered waiting state could not transition to at-risk when risk thresholds were crossed. `resolveTransition("active", "time-threshold-waiting")` now returns `"at-risk"`. Drift engine already emits this event on critical risk tier crossing, so active threads now correctly transition.
- Continuous risk score 0-100 (Spec 07): Added `riskScore` field to Thread interface (continuous numeric 0-100). `computeRiskScore()` in scoring.ts uses piecewise linear interpolation between latency thresholds: 0->elevated maps to 0-33, elevated->critical maps to 33-66, critical->lost maps to 66-100. Wired into drift engine tick alongside existing `computeRiskTier()`. Reset to 0 on user reply.
- Trust on-time gate (Spec 07): `updateTrustOnReply()` now accepts `elapsedSinceRiskStart` parameter and checks against the elevated threshold before awarding trust. Late replies (beyond elevated threshold) create/update the contact record but do not increase score and reset the consecutive streak to 0. Callers in outbound-actions.ts pass `Date.now() - thread.riskTimerStart`.
- Cluster ID stability (Spec 11): `evaluateClusters()` now reuses existing cluster IDs when threads from a previous cluster are re-clustered together. `findExistingClusterId()` checks existing cluster membership for overlap. This fixes manual override exclusions which previously broke across evaluation ticks because new IDs were generated every pass.
- Sync error propagation (Spec 10): After `recordSyncFailure()` in incremental sync catch block, now checks if sync store transitioned to "error" (which happens at 2+ consecutive failures) and propagates to app store's sync status and shell state. Previously, the 2-failure threshold was correctly implemented in the sync store but never propagated to the user-visible app state.
- Test count: 906 total (10 new: 1 lifecycle transition, 5 risk score, 3 trust on-time gate, 2 cluster ID stability, minus 1 removed invalid-transition test for active->at-risk), all passing. Typecheck and lint clean.

### Implementation Notes - Thread Drag Interactions & Agent Drop Visuals (2026-04-01)

- Thread drag-to-zone reclassification (Spec 04 Section 9): map-viewport.tsx now supports dragging individual threads on the map. handleMouseDown runs hitTestThread; if a thread is hit, enters thread-drag mode (tracked via threadDragRef) instead of camera-pan mode. handleMouseMove updates thread position directly during drag. handleMouseUp detects drop zone via getZoneAtPosition, calls onManualReclassify to set zone + userOverrideZone flag. Cursor changes to cursor-move during thread drags.
- Thread drag-out-of-cluster (Spec 11 Section 9): When a dragged thread was a member of a cluster, handleMouseUp checks if the drop position falls outside the cluster boundary (computed from remaining member positions + 80px padding). If outside, calls excludeFromCluster(threadId, clusterId) to prevent the thread from rejoining that specific cluster for the session. Thread is free to join other clusters.
- Agent drop target validation visuals (Spec 06 Section 3): MapRenderer gains setAgentDragState() method tracking valid/invalid/already-deployed cluster sets plus hoverClusterId. During agent drag, handleMouseMove in map-viewport computes cluster hit-testing and builds validation sets using canDeployRole and active deployment records. renderClusters draws colored borders: green (0x44cc44) for valid targets, thicker when hovered; red (0xcc4444) for invalid; amber (0xddaa22) for already-deployed. Visuals clear on drag end.
- Test count: 922 total (16 new: 4 map-renderer agent drag state, 12 map-viewport thread drag tests covering hit-testing, reclassification, cluster exclusion, coordinate conversion), all passing. Typecheck and lint clean.

### Implementation Notes - Medium-Priority Spec Gaps (2026-04-01)

- Detail panel slide animation (Spec 12 Section 5): Added CSS transition-transform with duration-300 ease-out. Panel starts translate-x-full (off-screen right) and animates to translate-x-0 via requestAnimationFrame callback in useEffect tied to selectedThreadId.
- Session summary modal backdrop (Spec 12 Section 10): Already had fixed inset-0 bg-black/60 z-50 backdrop. Added tests to verify.
- Reconnect exponential backoff (Spec 10 Section 8): sync-engine.ts now tracks consecutivePollFailures. getRetryInterval() computes min(baseInterval \* 2^failures, 60000ms). Resets on success. Replaces fixed 5s interval for retries.
- Drafter tone variants in results UI (Spec 07): results-overlay.tsx now groups proposals by threadId for Drafter agent. extractToneLabel() parses [tone_label] prefixes. ToneVariantGroup component renders tabbed navigation when multiple tone variants exist for the same thread.
- Right-click deploy context menu (Spec 06): map-viewport.tsx handleContextMenu hit-tests clusters and threads. Renders positioned menu listing all 6 agent types with availability status (Available/Busy/Cooldown/Unavailable). Selecting available agent triggers showConfirmation flow.
- Test count: 943 total (21 new: 2 detail-panel animation, 2 session-summary backdrop, 4 sync-engine backoff, 5 results-overlay tone variants, 8 context-menu), all passing. Typecheck and lint clean.

### Implementation Notes - Quota UI, Travel Arc, History Filters, Cluster Indicator, Draft Store (2026-04-01)

- Quota-disabled UI (Spec 01): app-store gains quotaExhausted boolean. detail-panel disables Send/Save Draft/Archive buttons with tooltip when exhausted. batch-action-bar disables Mark Handled/Apply Label with "Quota exhausted" badge.
- Agent travel arc animation (Spec 06): deployment-store gains TravelAnimation interface and travelAnimations array. map-renderer adds renderTravelArcs() using quadratic bezier curves from dock to cluster centroid. Animated dots travel along the arc over 800ms.
- Deployment history filtering (Spec 06): deployment-history-panel adds role and status filter dropdowns with outcome summary bar (deployment count, approved/rejected counts).
- In-progress cluster indicator (Spec 06): map-renderer tracks inProgressClusterIds set. renderClusters draws pulsing gold ring on clusters with active deployments at both zoom levels.
- Draft reactive store (Spec 01): New useDraftStore Zustand store mirrors draft lifecycle state reactively. outbound-actions.ts syncs all draft mutations to the store. detail-panel reads draft state reactively instead of from module-level Map.
- Test count: 1008 total (65 new: 15 quota UI, 16 travel arc, 10 history filters, 6 cluster indicator, 18 draft store), all passing. Typecheck and lint clean.

### Implementation Notes - Final Spec Compliance (2026-04-01)

- Organic drift animation (Spec 02): driftTick now adds per-thread hash-seeded sine-wave wobble perpendicular to drift direction. Each thread gets unique phase offset via threadHash(id). Wobble amplitude 3px scaled by DRIFT_FRACTION for subtle organic movement.
- Cluster member migration animation (Spec 02): Module-level clusterMigrations Map tracks ClusterMigrationTarget entries with start/target positions and 500ms duration. driftTick uses ease-out cubic interpolation (1-(1-t)^3) for smooth deceleration. Exports setClusterMigration/clearClusterMigration for external use.
- Cluster-biased initial placement (Spec 03): placeNewThread extended with optional existingThreads and clusters parameters. When new thread's participants overlap >= 50% with a cluster's members, initial position biased toward cluster centroid with +/-30px jitter.
- Failed thread identification (Spec 05): ai-backend.ts AIBackendResult now includes failedThreadIds/succeededThreadIds. results-overlay.tsx shows red-tinted markers with "Failed" badge for unprocessed threads.
- Batch thread queue (Spec 05): processAgentWorkBatched splits thread IDs into capacity-sized chunks, processes sequentially, accumulates proposals/errors/stats across batches.
- Zone quick-nav label panel (Spec 08): New zone-quick-nav.tsx component renders compact overlay with 6 zone labels and keyboard shortcut indicators. Integrated into map-viewport.
- Test count: 1040 total (32 new), all passing. Typecheck and lint clean.

### Implementation Notes - Spec Compliance Round 4 (2026-04-01)

- Front health tier thresholds fixed (Spec 07): `getHealthTier` now returns "degraded" for scores >= 50 (was >= 25 incorrectly), "critical" for < 50. Matches spec's state transition table: healthy >= 75, degraded < 50.
- Initial camera zoom fixed (Spec 08 Section 1): Camera now opens at strategic zoom level (0.15) instead of tactical (0.5). Spec requires strategic overview on first render.
- Selection gating fixed (Spec 08 Section 8): Thread selection is now only possible at operational and detail zoom levels. At tactical zoom, clicking a thread zooms to operational instead of selecting. At strategic, clicking zooms to tactical (unchanged).
- New->Active lifecycle transition wired (Spec 09): Clicking a thread at operational/detail zoom now fires `transitionState(id, "active", "user-opened")` when thread is in "new" state, per Spec 09 state transition rules.
- Incremental sync thread placement (Spec 11 Section 3): New threads arriving via incremental sync now go through `placeNewThread` with cluster bias evaluation, rather than being inserted with default position. Ensures cluster-biased initial placement per spec.
- Lost-thread tally in status bar (Spec 07 Section 9): Running lost-thread count now always visible in status bar when > 0, using red color. Previously only shown in session summary modal.
- lostThreadCount in session summary (Spec 07 Section 13): Session summary modal now displays "Threads Lost" count alongside other session stats.
- Escape closes detail panel from map focus (Spec 12 Section 5): Escape key now closes the detail panel when focus is in the map zone, not just when focus is in the right-panel zone. Matches spec requirement.
- Tab zone cycling implemented (Spec 08 Section 16): Tab key in map viewport now cycles focus through the 6 zone labels in ZoneQuickNav. Shift+Tab cycles backwards. Enter on a focused zone navigates to it (zoom to fit). ZoneQuickNav component integrated into MapViewport with focusedZone highlight, aria-selected, and role="tab" attributes.
- Trust decay active flag (Spec 07 Section 5): `TrustRecord` now includes `decayActive: boolean` per spec data contracts. Set to true by `evaluateDecay` when decay is active, cleared to false by `onTimeReply` and when within threshold.
- 60-second thread type fallback (Spec 07 Section 1): Game loop tick now checks threads in "new" lifecycle state older than 60 seconds and defaults their threadType to "existing-relationship" if the agent layer hasn't assigned a type.
- Test count: 1062 total (22 new: 4 trust-system, 3 session-summary, 3 status-bar, 4 game-loop, 5 zone-quick-nav, 3 status-bar basic), all passing. Typecheck and lint clean.

### Implementation Notes - Spec Compliance Round 11 (2026-04-01)

- Deep audit of all 12 specs using parallel agents identified and resolved critical/high gaps
- Spec 01: rateLimiter.isExhausted now propagated to useAppStore.quotaExhausted (set on exhaustion, cleared when day rolls after successful API call)
- Spec 02: Archived threads no longer pulse (isArchived guard on pulse computation), cluster labels shown at aggregate zoom, setClusterMigration wired on cluster membership changes
- Spec 04: evaluateZoneAlerts wired into drift tick (was dead code), zone boundary transitions smoothed via lerp
- Spec 07: createAgentCompletedAlert fired on deployment completion, session stats reset on summary modal dismissal
- Spec 08: Zoom anchor math fixed (screen-to-map coordinate conversion), strategic cluster dot click hit-tests clusters
- Test count: 1146 total (4 new tests), all passing

### Implementation Notes - Spec Compliance Round 13 (2026-04-01)

- Deadline detection (Spec 03): 14 regex patterns match deadline phrases in message subject and body (day names, month+date, deadline/due/EOD/ASAP keywords, ISO dates, expiration phrases). detectDeadline() exported from scoring.ts. Urgency boost of +0.15 when deadline found.
- Body keyword scanning (Spec 03): computeValueScore now scans thread.messages[].bodyPlain and bodyHtml for value keywords in addition to subject. Same keyword list (deal, contract, proposal, etc.).
- Opportunity zone stabilization (Spec 03): driftTick skips neglect drift for threads whose targetZone is "opportunities". High-value/low-urgency threads occupy stable positions per spec.
- Opportunity window start (Spec 07): opportunityWindowStart field added to Thread interface. flagOpportunity stores the open timestamp. evaluateOpportunity uses stored start for custom window durations instead of back-calculating from DEFAULT_WINDOW_MS.
- Risk load weighting (Spec 07): computeRiskLoad in front-health.ts now weights each thread's tier score by THREAD_TYPE_RISK_WEIGHT (internal=1.5, warm-intro=1.4, existing-relationship=1.0, cold-outreach=0.8, transactional=0.5). Tighter tolerance = higher weight.
- Status bar ordering (Spec 12): All four primary indicators (sync, health, streaks, alert badge) now render left-to-right in a single flex group per Spec 12 Section 3. Additional items (lost tally, deployments, filter, summary) grouped separately on the right.
- Test count: 1167 total (21 new: 12 deadline detection, 2 body keyword, 1 drift stabilization, 3 opportunity window start, 1 risk weighting, 1 status bar ordering, 1 sync-engine fixture), all passing. Typecheck and lint clean.

### Implementation Notes - Spec Compliance Round 14 (2026-04-01)

- Thread queue mechanic (Spec 05): deployAgent() now queues overflow threads beyond capacity. getBatchQueue(), hasQueuedThreads(), dequeueNextBatch() manage the batch lifecycle. Each dequeue returns up to capacity threads, remaining stay queued. Queue is module-level Map keyed by agent ID.
- Deployment history persistence (Spec 06): IndexedDB schema bumped to v3 with new "deployments" object store. persistDeployments() writes up to 100 most recent records. loadDeployments() returns sorted by startedAt descending. Deployment store gains loadPersistedDeployments() and persistDeploymentHistory() actions.
- Forced reclassification (Spec 04): driftTick now clears userOverrideZone when a thread's risk tier crosses from safe/elevated to critical or lost. This allows the classifier to reassign the thread to at-risk/lost zones despite a prior user override.
- Thread resurfacing alerts (Spec 09): New "thread-resurfaced" MapAlertType. When a thread that would be hidden by the active filter transitions to at-risk/lost lifecycle state, a notification alert is created. The filter store already force-shows at-risk/lost threads; this adds the visual notification push.
- Test count: 1174 total (7 new: 4 batch queue, 1 forced reclassification, 2 resurfacing alerts), all passing. Typecheck and lint clean.
