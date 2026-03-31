# Messaging RTS - Implementation Plan

Greenfield project. No source code exists yet. 12 specs written in `specs/`.

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

- [ ] Define thread data structure with all core properties (Spec 09)
- [ ] Define computed properties: urgency score, value score, map position, zone, drift velocity, cluster membership
- [ ] Define contact enrichment structure per participant
- [ ] IndexedDB schema and CRUD operations for threads
- [ ] Thread lifecycle state machine: new -> active -> waiting -> at-risk -> lost / handled
- [ ] State transition logging with timestamps and trigger events
- [ ] Merge logic: persisted state + fresh Gmail data on reload
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

- [ ] Map viewport as primary content area (fills available space)
- [ ] Status bar: sync indicator, front health score, streak counters, alert badges
- [ ] Agent dock: persistent panel showing agent types with status
- [ ] Detail panel: slides in from right on thread selection
- [ ] Search overlay: keyboard-activated, overlays top of viewport
- [ ] Notification area: alerts stack without obscuring map
- [ ] Minimap: fixed bottom-right corner overlay
- [ ] Shell states: Initializing -> Loading -> Active / Degraded / Unauthenticated
- [ ] Empty/loading states before threads arrive
- [ ] Responsive: panels collapse at narrow viewports
- [ ] Keyboard focus zones: map, dock, panels with tab navigation between them
- [ ] **Spec**: 12-application-shell
- [ ] **Tests**: Shell state transitions, panel open/close, responsive breakpoints, focus management

### 2.2 Map Rendering Engine

- [ ] PixiJS canvas setup within React viewport
- [ ] Layer system: background (zones) -> mid (connections) -> foreground (threads/clusters) -> overlay (agents, minimap)
- [ ] Thread entity rendering: position, urgency glow, value-driven size, age opacity
- [ ] Urgency pulse animation (rate proportional to urgency level)
- [ ] Drift animation (slow organic positional movement)
- [ ] Agent-occupied visual indicator on threads
- [ ] Archived thread fade to minimum opacity
- [ ] Performance target: smooth rendering with 500+ entities
- [ ] Viewport responsiveness on resize
- [ ] **Spec**: 02-map-rendering
- [ ] **Tests**: Layer ordering, entity state-driven appearance, 500-entity performance benchmark, resize behavior

### 2.3 Navigation (Pan, Zoom, Levels)

- [ ] Click-drag pan (map coordinate stays under cursor)
- [ ] Edge scrolling during drag
- [ ] Scroll wheel zoom (anchored to cursor position)
- [ ] Pinch-to-zoom (trackpad)
- [ ] Four zoom levels: Strategic, Tactical, Operational, Detail
- [ ] Content visibility rules per zoom level
- [ ] Smooth animated transitions between levels
- [ ] Single-click thread selection (opens detail panel)
- [ ] Double-click zoom to Detail view
- [ ] Click cluster dot at Strategic -> zoom to Tactical
- [ ] Minimap: viewport indicator, click-to-pan, drag-to-pan
- [ ] Search: keyword/sender/label matching, highlight results, pan to first match, cycle through results
- [ ] Quick-nav: zone labels clickable, keyboard shortcuts per zone
- [ ] Back navigation (Escape returns to prior zoom/position)
- [ ] Arrow key navigation between thread entities
- [ ] Tab cycling through zone labels
- [ ] **Spec**: 08-navigation
- [ ] **Tests**: Pan accuracy, zoom anchor correctness, level transitions, selection state machine, search highlighting, back navigation, keyboard nav

### 2.4 Zone System

- [ ] Six zones: Active Front, Opportunities, At Risk, Lost, Noise, Base/Handled
- [ ] Zone layout initialization (canonical positions on canvas)
- [ ] Zone rendering: filled polygons with color tinting, boundary indicators, labels
- [ ] Thread count display per zone (including zero)
- [ ] Adaptive zone sizing: area scales proportional to thread population
- [ ] Soft boundaries: threads drift across, not snap
- [ ] Zone alerts: threshold evaluation, active/inactive states, visual indication
- [ ] Manual thread reclassification via drag (user override flag)
- [ ] **Spec**: 04-zone-system
- [ ] **Tests**: Zone layout, count accuracy, adaptive sizing, alert threshold firing/resolution, drag override

### 2.5 Thread Positioning & Drift Engine

- [ ] Urgency scoring: time since last reply, sender importance, deadlines, thread age
- [ ] Value scoring: sender relationship, keywords, engagement depth, user labels/stars
- [ ] Initial placement: new threads positioned in Active or Monitor zone based on scores
- [ ] Tick-based continuous drift: target position computed from scores + neglect duration
- [ ] Smooth movement: actual position approaches target by fractional step per tick
- [ ] Neglect drift: proportional to neglect duration, toward Lost zone
- [ ] User action repositioning: reply snaps target to Active, archive drifts to archive boundary
- [ ] Collision avoidance: minimum separation distance enforcement
- [ ] Position persistence across sessions
- [ ] Score re-evaluation on session resume (reflect accumulated neglect)
- [ ] **Spec**: 03-thread-positioning
- [ ] **Tests**: Initial placement correctness, drift toward Lost over time, snap-back on reply, collision avoidance, persistence round-trip

### 2.6 Thread Clustering

- [ ] Affinity calculation: shared participants (strongest), topic keywords, labels, temporal proximity
- [ ] Cluster formation when 2+ threads exceed affinity threshold
- [ ] Dynamic membership: threads join/leave as data changes
- [ ] One cluster per thread maximum
- [ ] Cluster centroid from member positions
- [ ] Cluster label from common subject/participants
- [ ] Cluster dissolves when fewer than 2 members
- [ ] Visual: cluster boundary, aggregate representation at low zoom
- [ ] Manual override: drag thread out of cluster
- [ ] New thread evaluated for cluster membership on arrival
- [ ] **Spec**: 11-thread-clustering
- [ ] **Tests**: Formation on shared participants, dissolution below 2 members, one-cluster-per-thread, manual override persistence, new thread assignment

---

## Priority 3 - Game Mechanics (engagement layer)

### 3.1 Response Latency & Risk Scoring

- [ ] Latency tolerance table per thread type (cold-outreach, warm-intro, existing-relationship, internal, transactional)
- [ ] Thread type assignment (by agent layer, default to existing-relationship after 60s)
- [ ] Continuous risk scoring: monotonic increase with time, tier thresholds (safe -> elevated -> critical -> lost)
- [ ] Visual: color shift at elevated, pulsing at critical, drift to lost zone at lost
- [ ] Risk reset to safe + clock restart on reply (user or agent)
- [ ] Risk scoring cadence: at minimum every 5 minutes
- [ ] **Spec**: 07-game-mechanics (Thread Ingestion, Continuous Risk Scoring, Risk Reset)
- [ ] **Tests**: Monotonic risk increase, tier threshold transitions, reset on reply, default type fallback

### 3.2 Trust System

- [ ] Trust score per contact (0-100)
- [ ] Trust tiers: new (0-19), building (20-49), established (50-79), high-trust (80-100)
- [ ] Trust increase on on-time reply (within elevated threshold)
- [ ] Consecutive response streak tracking
- [ ] Trust decay when no reply for 2x critical threshold duration
- [ ] Decay floor: established contacts with 30+ days at tier don't drop below established
- [ ] Visual indicators on contact threads
- [ ] **Spec**: 07-game-mechanics (Trust Score Update, Trust Decay)
- [ ] **Tests**: Trust tier transitions, streak increment, decay activation/deactivation, floor protection

### 3.3 Opportunity System

- [ ] Opportunity flag set by agent layer
- [ ] Opportunity window with configurable duration
- [ ] States: none -> ripe -> fading -> expired / captured
- [ ] Ripe: pulse visual, > 50% window remaining
- [ ] Fading: distinct visual, < 50% window remaining
- [ ] Expired: visual elevation drops, counted as missed
- [ ] Captured: reply while window open, counted in session stats
- [ ] **Spec**: 07-game-mechanics (Opportunity Detection, Pulse and Fade, Capture)
- [ ] **Tests**: State transitions, visual state at 50% threshold, capture on reply, missed count

### 3.4 Front Health, Streaks & Session Summary

- [ ] Front health score (0-100): risk load, trust average, opportunity capture rate, loss rate
- [ ] Health tiers: healthy (>=75), degraded (<50), critical (<25)
- [ ] Always-visible health display with tier-driven visual state
- [ ] Streak counters: inbox-zero days, zero-lost-thread days
- [ ] Streak evaluation at midnight local time
- [ ] Lost thread tally: permanent per session, even after re-engagement
- [ ] Session summary panel: threads handled, opportunities captured/missed, risks mitigated, agents deployed, net health change
- [ ] **Spec**: 07-game-mechanics (Front Health, Streaks, Lost Thread Marking, Session Summary)
- [ ] **Tests**: Health computation, tier transitions, streak increment/reset, session counter accuracy

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

- [ ] Six agent types with fixed definitions: Closer (amber, cap 5, 10min CD), Researcher (teal, cap 8, 5min CD), Scheduler (blue, cap 4, 8min CD), Cleaner (gray, cap 20, 15min CD), Drafter (green, cap 6, 5min CD), Escalation Bot (red, cap 15, 2min CD)
- [ ] Agent instance lifecycle: idle -> deployed -> working -> completed/failed -> cooldown -> idle
- [ ] Proposal model: per-thread output with pending/approved/rejected states
- [ ] Capacity enforcement: threads beyond capacity queued in batches
- [ ] Cooldown enforcement: no bypass, no redeployment until expired
- [ ] Output types per agent (drafts, enrichment, time proposals, archive batches, escalation flags)
- [ ] **Spec**: 05-agent-units
- [ ] **Tests**: State machine transitions (all valid paths, reject invalid), capacity limits, cooldown timer, proposal lifecycle

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
