# Trace Messaging - Implementation Plan

## Status: Priority 2 in progress - Data ingestion layer built

Last audited: 2026-03-31 16:12 PDT

---

## Tech Stack

- **Framework:** React 19 + TypeScript 5.9, Vite 8 (match messagingRTS versions)
- **Styling:** Tailwind CSS v4.2
- **State:** Zustand 5 (client), TanStack React Query 5 (async/server)
- **Persistence:** IndexedDB via `idb` v8
- **AI:** Claude API (Anthropic SDK) for workstream detection, context linking, summaries
- **Gmail:** Nango OAuth proxy (existing at `../agent/nango.py`, agent code at `../agent/agents/email.py`)
- **Local data:** Extend existing FastAPI server at `../agent/main.py` with new endpoints (decision: reuse, not new server)
- **Testing:** Vitest 4 + React Testing Library 16
- **Path alias:** `@/` maps to `src/`

## Available Data Sources (verified on this machine, 2026-03-31 14:49 PDT)

| Source          | Location                                                         | Format     | Size / Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | ---------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gmail           | `../email/inbox.json` + Nango OAuth                              | JSON / API | 100 emails seed; schema: `{ emails: [{ id, threadId, from, to, subject, date, snippet, body, labelIds, isUnread, isStarred, isImportant }] }`                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Arc sidebar     | `~/Library/Application Support/Arc/StorableSidebar.json`         | JSON       | 959KB; `sidebar.containers[1].spaces[]` = alternating UUID/object pairs with space `title` and `containerIDs`; `sidebar.containers[1].items[]` = flat pool of alternating UUID/tab-object pairs; each tab has `data.tab.savedURL`, `data.tab.savedTitle`, `data.tab.timeLastActiveAt` (Apple Core Data epoch); items belong to spaces via `parentID` chain -> container UUID -> space `containerIDs`. 12 spaces (Personal, School, Angus, Calvin, etc.). Also `sidebarSyncState` (CloudKit-synced copy, ignore) and `firebaseSyncState` (Firebase copy, ignore). 30+ historical snapshots also available |
| Arc archive     | `~/Library/Application Support/Arc/StorableArchiveItems.json`    | JSON       | 3.8MB; `items[]` alternates UUID strings and item objects; each has `archivedAt` (Apple Core Data epoch, ~791M range), `reason` ("auto"), `source.space._0` (space UUID - must resolve to name via sidebar spaces list), `sidebarItem.data.tab.savedURL/savedTitle/timeLastActiveAt` as plain text. All timestamps Apple Core Data epoch (seconds since 2001-01-01)                                                                                                                                                                                                                                      |
| Arc history     | `~/Library/Application Support/Arc/User Data/Profile 13/History` | SQLite     | 144MB; Chromium schema (`urls` + `visits` tables); locked while Arc runs - must use `?immutable=1&mode=ro` URI; Windows FILETIME timestamps (microseconds since 1601-01-01). 4 profiles on disk (8, 9, 12, 13)                                                                                                                                                                                                                                                                                                                                                                                           |
| Calendar        | `~/BridgeIntelligence/GTM/calendar_events.json`                  | JSON       | 61KB; array of `{ summary, start (YYYY-MM-DD), end (always ""), calendar, account, attendees: [{ email, name, status }] }`. No time-of-day on ANY event. `end` is NEVER populated. Attendee `name` often empty. Statuses: accepted/declined/needsAction                                                                                                                                                                                                                                                                                                                                                  |
| Git repos       | `~/Monet/`                                                       | git CLI    | Single monorepo with sub-project directories (agent/, email/, messagingRTS/, tracemessaging/, etc.); current branch: ralph-build                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Claude sessions | `~/.claude/sessions/*.json`                                      | JSON       | 13 lightweight metadata files (119-144 bytes each): `{ pid, sessionId, cwd, startedAt }` where `startedAt` is Unix epoch ms. NOT conversation data                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Claude projects | `~/.claude/projects/`                                            | JSONL      | 59 project dirs (path-encoded, hyphens replace slashes); each contains `<sessionId>.jsonl` files with full conversation turns (tool calls, messages, file snapshots)                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| HubSpot CRM     | API via 1Password key                                            | REST       | Contacts + deals                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Reusable Code from messagingRTS

These files in `../messagingRTS/src/lib/` contain production-quality patterns to adapt:

| File                        | What to reuse                                                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `types/thread.ts`           | `ContactEnrichment` (displayName, email, organization, vipFlag, relationshipScore, responseHistory), `ThreadMessage`, two-section ownership split (Gmail-owned vs app-computed fields), `createThread()` factory with centralized defaults                                                 |
| `types/cluster.ts`          | `AffinityScore` (participantOverlap, topicKeywordOverlap, sharedLabelScore, temporalProximity, composite), `ClusterLifecycleState` (forming/active/dissolving/dissolved), `ThreadMembershipState` (unassigned/pending-evaluation/member/override-excluded)                                 |
| `types/sync.ts`             | `SyncMode` (initial-load/incremental/backfill), `ConnectivityStatus` (connected/syncing/error/offline), `ActionQueueEntry` (id, type, threadId, payload, retryCount, status), `ThreadChangeEvent` (new-thread/new-message/label-change/read-state-change)                                  |
| `stores/thread-store.ts`    | `Map<string, Thread>` backing + `Set<string>` batch selection, `transitionState(id, to, trigger)` with `StateTransition` audit objects appended to `stateHistory`, `updateThread()` auto-stamps `lastModified`, query methods on store (e.g. `getThreadsByZone`)                           |
| `utils/persistence.ts`      | Singleton `dbPromise` + `getDB()`, indexes (`by-zone`, `by-lifecycle`, `by-last-modified`), batch `persistThreads()` via single `readwrite` transaction, `mergeThreadData(persisted, fresh)` - spreads persisted first, overwrites only source-owned fields, preserves all computed fields |
| `utils/scoring.ts`          | Additive scoring with explicit per-component weights clamped to [0,1]; `computeUrgencyScore()` (neglect factor, VIP boost, unread boost, recency boost); `LATENCY_TABLE` per thread-type thresholds                                                                                        |
| `utils/thread-lifecycle.ts` | `VALID_TRANSITIONS: Record<State, State[]>` as single source of truth, `isValidTransition(from, to)` guard, event-driven `resolveTransition(current, event)` that returns next state or null                                                                                               |

**Critical pattern to preserve:** The split-ownership merge in `mergeThreadData()` - remote data refreshes must never clobber user-computed state (workstream assignments, scores, positions).

## Other Reusable Code

| File                       | What to reuse                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `../agent/nango.py`        | `NangoManager` with `check_connection()`, `create_connect_session()`, `PROVIDERS` dict. Requires `NANGO_SECRET_KEY` + `NANGO_BASE_URL` env vars. `configured` property returns False when key is unset.                                                                                                                          |
| `../agent/agents/email.py` | Gmail API via Nango proxy: all calls go to `{NANGO_BASE_URL}/v1/gmail/...` with `Authorization: Bearer {NANGO_SECRET_KEY}` + `connectionId` param. Endpoints: messages (list/read), drafts (create), messages/send, messages/{id}/modify. Uses `httpx` sync, 30s timeout. `approval_required = {"send_email", "archive_email"}`. |
| `../agent/main.py`         | ~885 lines, NO CORS middleware, NO `include_router()` pattern (all routes direct on `app`). Singletons: `approval_gate`, `runner`, `nango_mgr`, `auth_store`, etc. NDJSON streaming via `StreamingResponse`. No auth middleware - auth is opt-in per route. Port not set in code (uvicorn config).                               |
| `../email/inbox.json`      | Dev seed data: `{ "emails": [...] }` (single JSON object, not JSONL). Each email has `id`/`threadId` as hex strings, RFC 2822 `from`/`date` headers, HTML or plain `body`.                                                                                                                                                       |

---

## Priority 1: Foundation (specs: 14, 08) -- COMPLETED

All items complete. 32 unit tests passing (types, stores, merge logic). TypeScript strict mode, zero errors. Zustand stores for activities, workstreams, and app shell. IndexedDB persistence with split-ownership merge. Application shell with routing, error boundary, and notifications. Timeline, detail, and settings views (placeholder UI with full data binding).

- [x] **1.1 Project scaffold** - `npm create vite@latest` with React + TypeScript. Install: `zustand`, `@tanstack/react-query`, `idb`, `tailwindcss`, `@tailwindcss/vite`. Configure `@/` path alias in `tsconfig.json` and `vite.config.ts`. Create directory structure: `src/lib/types/`, `src/lib/stores/`, `src/lib/utils/`, `src/lib/services/`, `src/components/`, `src/features/`. Set up Vitest with React Testing Library. Match dependency versions from messagingRTS package.json (react ^19.2.4, zustand ^5.0.12, @tanstack/react-query ^5.96.0, idb ^8.0.3, tailwindcss ^4.2.2, vite ^8.0.1, typescript ~5.9.3, vitest ^4.1.2).

- [x] **1.2 Core type definitions** (spec 08) - Adapt from messagingRTS types. Define:
  - `ActivityRecord` - the normalized activity from any source (all fields from spec 08: activityId, source enum, sourceId, timestamp, title, participants, preview, body, labels, metadata, workstreamId, userOverride, viewed). Activity ID format: `{source}:{sourceId}` (e.g., "gmail:19d40f0981bfad11") to guarantee uniqueness across sources without UUID generation.
  - `SourceType` enum - "gmail" | "arc-browser" | "google-calendar" | "git" | "local-project" | "claude-code" | "hubspot"
  - `Workstream` - UUID, name, description (AI-generated one-liner, distinct from summary), activityIds, activityTimeline (sparse ordered list of `{timestamp, activityId, source}` tuples for rendering), sourceBreakdown, participants, primaryParticipant (most frequent non-self participant), timestamps (created, lastActivityTimestamp, lastPersistedTimestamp), status, AI fields (summary, recommendedAction, confidence, rationale), unreadCount, pendingActionCount
  - `Participant` - email, displayName, source, lastSeenTimestamp
  - `ContactEnrichment` - adapt from messagingRTS (displayName, email, organization, dealNames, lifecycleStage, vipFlag, relationshipScore)
  - `WorkstreamSummary` - statusSummary, keyDevelopments, recommendedAction, urgency, generatedAt
  - `RecommendedAction` - type enum (reply-email, schedule-meeting, review-document, follow-up, archive-workstream, no-action), description, targetActivityId, confidence
  - `WorkstreamStatus` - "active" | "stale" | "archived"
  - `AffinityScore` - adapt from messagingRTS cluster.ts (participantOverlap, topicKeywordOverlap, sharedLabelScore, temporalProximity, projectAssociation, crmAssociation, composite)
  - `SyncState`, `ActionQueueEntry` - adapt from messagingRTS sync.ts, extend ActionQueueEntry types for email actions (reply/archive/label-change/draft-save/draft-discard)
  - `AuthState` - "unauthenticated" | "authenticating" | "authenticated" (separate dimension from data state per spec 14)
  - `DataState` - "loading" | "loaded" | "error" | "offline" (orthogonal to auth state - enables combinations like "authenticated + offline")
  - `ViewRoute` - "timeline" | "detail" | "settings", with optional workstreamId param
  - `NotificationItem` - id, message, type (info/warning/error), timestamp, dismissable

- [x] **1.3 IndexedDB persistence layer** (spec 08) - Adapt from messagingRTS `persistence.ts`. Object stores:
  - `activities` - keyed by activityId, indexed by: source, sourceId, workstreamId, timestamp
  - `workstreams` - keyed by id, indexed by: status, lastActivityTimestamp
  - `summaryCache` - keyed by workstreamId, stores cached AI summaries with generatedAt timestamp
  - CRUD operations: persist/load/delete for both stores. Batch upsert via single transaction (copy messagingRTS pattern).
  - Merge logic: preserve workstream assignments, user overrides, and AI-computed fields when activity data refreshes from sources. Adapt `mergeThreadData()` split-ownership pattern. Source-owned fields (title, participants, body, labels from ingestion) overwritten; app-owned fields (workstreamId, userOverride, viewed, scores) preserved from persisted copy.
  - Singleton `getDB()` pattern with typed DB schema interface.
  - Schema versioning: use `idb` `upgrade` callback with version number. Start at version 1. Future migrations add stores/indexes in the upgrade callback (standard IndexedDB pattern). No custom migration framework needed for MVP.

- [x] **1.4 Activity store (Zustand)** - Adapt from messagingRTS `thread-store.ts` pattern. `Map<string, ActivityRecord>` for O(1) lookups. Actions: `addActivities`, `updateActivity`, `removeActivity`, `getActivitiesBySource`, `getActivitiesByWorkstream`, `getUnassignedActivities`. Loads from IndexedDB on init. Immutable updates (new Map on every mutation). Persist to IndexedDB on mutations (debounced). Auto-stamp `lastModified` on every update.

- [x] **1.5 Workstream store (Zustand)** - `Map<string, Workstream>` store. Actions: `createWorkstream`, `updateWorkstream`, `addActivityToWorkstream`, `removeActivityFromWorkstream`, `archiveWorkstream`, `transitionStatus` (with audit trail via `StateTransition` objects appended to `stateHistory`, adapt messagingRTS `transitionState` pattern). On every `addActivityToWorkstream`/`removeActivityFromWorkstream`, synchronously recompute: `lastActivityTimestamp`, `participantList`, `sourceBreakdown`, `unreadCount`, `primaryParticipant`, `activityTimeline`. Computed: sorted active workstreams (primary: lastActivityTimestamp desc, secondary: unreadCount desc), unread counts per workstream, source breakdown. Loads from IndexedDB on init. Lifecycle: active -> stale (7 days) -> archived (30 days), any new activity resets to active. Removal below 2 activities triggers archive.

- [x] **1.6 Application shell** (spec 14) - Outermost container. Layout regions: header bar (app name "Trace", search input, sync status indicator, settings gear), main content area (timeline or detail view), notification toast area (bottom-right, max 3 visible). Two-dimensional state: `AuthState` (unauthenticated/authenticating/authenticated) x `DataState` (loading/loaded/error/offline) - orthogonal dimensions to support combinations like "authenticated + offline". Startup sequence: auth check -> if unauthenticated show OAuth prompt -> if authenticated show loading with per-source checkmark progress (on EVERY load, not just first launch) -> when at least one source has data, transition to timeline. Sync status indicator: green (synced), spinning (syncing), red (error with hover tooltip listing failed sources), gray (offline). View router for timeline <-> detail <-> settings transitions with browser pushState. React error boundary wrapping main content area. Auth expiration mid-session shows non-blocking banner (not full-screen prompt). Reconnection from offline auto-triggers sync.

## Priority 2: Data Ingestion (specs: 01-06)

Each source is independent - all 6 can be built in parallel. Local file sources (Arc, git, Claude sessions, calendar seed) require backend endpoints.

### Backend (extends existing FastAPI)

- [x] **2.0a Extend FastAPI backend - CORS + router setup** - Add `CORSMiddleware` to `../agent/main.py` (`allow_origins=["http://localhost:5173"]` for Vite dev server). Create new router file `../agent/trace_router.py` using `APIRouter()` - this will be the FIRST router in main.py (no existing `include_router` pattern). Register via `app.include_router(trace_router, prefix="/api/trace")`. Router needs access to `nango_mgr` singleton from main.py - use factory function pattern: `make_trace_router(nango_mgr)`.

- [x] **2.0b Backend data endpoints** - All in `../agent/trace_router.py`:
  - `GET /api/trace/arc/sidebar` - reads `~/Library/Application Support/Arc/StorableSidebar.json`. Use ONLY `sidebar.containers[1]` (ignore `sidebarSyncState` and `firebaseSyncState` which are CloudKit/Firebase sync copies). Two-step parse: (1) Build space UUID->name map from `sidebar.containers[1].spaces[]` (alternating UUID/object pairs, each object has `title` and `containerIDs`). (2) Read items from `sidebar.containers[1].items[]` (alternating UUID/object pairs); each tab object has `data.tab.savedURL`, `data.tab.savedTitle`, `data.tab.timeLastActiveAt` (Apple Core Data epoch), `parentID`, `createdAt`, `isUnread`. Resolve space membership by traversing `parentID` chain up to a container UUID, then matching against space `containerIDs`. Items with `data.folder` instead of `data.tab` are folders (skip or use as grouping context). Returns normalized tabs with URL, title, space name (resolved), isPinned (parent is pinned container), domain (extracted from URL), dataSource ("sidebar"). 12 spaces currently: Personal, School, Angus, Calvin, Calvin Angus, Calvin Angus Beighle, Martian Yash, Martian Etan, Martian - Personal, etc.
  - `GET /api/trace/arc/archive` - reads `~/Library/Application Support/Arc/StorableArchiveItems.json`. Items array alternates UUID strings and item objects. Filter by `archivedAt` (Apple Core Data timestamp - seconds since 2001-01-01, NOT Unix epoch; value ~791M for 2026) to past 7 days. Extract `sidebarItem.data.tab.savedURL/savedTitle` and `source.space._0` (UUID - resolve to space name using sidebar spaces map, requires loading sidebar first or caching the map).
  - `GET /api/trace/arc/history` - reads History SQLite (Profile 13) via `sqlite3.connect("file:///path?immutable=1&mode=ro", uri=True)`. Join `urls.url/title/visit_count` + `visits.visit_time`. Convert Windows FILETIME timestamps (microseconds since 1601-01-01) to Unix epoch. Past 7 days.
  - `GET /api/trace/git/commits` - Note: `~/Monet/` is a single monorepo (not multiple repos). Run `git log --since="14 days ago" --author=<current user>` from repo root. Extract: commit hash, message, branch, files changed, insertions/deletions. Also scan sub-project directories for structural metadata.
  - `GET /api/trace/claude-sessions` - Two-step data join: (1) Read `~/.claude/sessions/*.json` for metadata (`{ pid, sessionId, cwd, startedAt }` where `startedAt` is Unix epoch MILLISECONDS). (2) Read corresponding JSONL files in `~/.claude/projects/<encoded-path>/<sessionId>.jsonl` for conversation data (first user message as title, turn count, last turn timestamp). Path encoding: absolute path with slashes replaced by hyphens (e.g., `/Users/calvinbeighle/Monet` -> `-Users-calvinbeighle-Monet`). The session metadata files are plain JSON (119-144 bytes each); the conversation files are JSONL with one event per line. Filter to past 14 days by `startedAt`.
  - `GET /api/trace/calendar/events` - reads `~/BridgeIntelligence/GTM/calendar_events.json`. IMPORTANT: `start` is date-only (YYYY-MM-DD), `end` is ALWAYS an empty string (never populated), and NO events have time-of-day info. Treat all as date-level events. Attendee `name` is often empty string (use email as fallback). Filter to 14-day past/future window, exclude cancelled, normalize attendees.
  - Gmail proxy endpoints (for item 2.1 - frontend should NOT call Nango directly):
    - `GET /api/trace/gmail/threads` - list threads via `nango_proxy_request("GET", "gmail/v1/users/me/threads", "google-mail", "gmail-default", params={q, maxResults})`
    - `GET /api/trace/gmail/threads/{id}` - get full thread with messages
    - `GET /api/trace/gmail/history` - incremental sync via history ID
    - `POST /api/trace/gmail/drafts` - create/update draft (correct RFC 2822 base64url encoding, not the broken pattern in email.py)
    - `POST /api/trace/gmail/send` - send message
    - `POST /api/trace/gmail/messages/{id}/modify` - archive/label
  - All endpoints return JSON arrays of pre-normalized activity record shapes (except Gmail proxy which returns raw Gmail API responses).

- [ ] **2.0c Backend AI proxy endpoints** (decision 9) - Proxy Claude API calls through the backend to avoid exposing the Anthropic API key in browser code. Key from 1Password or env var. Endpoints:
  - `POST /api/trace/ai/detect` - accepts activity records, returns workstream clustering
  - `POST /api/trace/ai/link` - accepts new activity + candidate workstreams, returns assignment decision
  - `POST /api/trace/ai/summarize` - accepts workstream context, returns summary + recommended action
  - All endpoints wrap Claude API calls with the Anthropic SDK, handle rate limiting, and return structured JSON.
  - **Global rate limiter:** asyncio semaphore or token bucket limiting concurrent Claude API calls (max 3 concurrent, queue overflow). Prevents detection (every 5min) + linking (real-time) + summaries (on trigger) from overwhelming the API. On failure: return structured error with `retry_after` hint; frontend should show stale cached data and retry.

### Frontend Ingestion Services

- [~] **2.1 Gmail ingestion** (spec 01) - Frontend service implemented, backend proxy endpoints done. Needs Nango OAuth integration testing. - OAuth via Nango (`check_connection` + `create_connect_session` pattern from `nango.py`). Initial: fetch 30-day inbox threads. Incremental: poll via Gmail history API every 30 seconds. Use stored history cursor. Cursor expiry triggers full backfill (not just incremental). Normalize: strip Re:/Fwd: from subjects, extract participants from headers, UTC epoch ms timestamps, preserve HTML body + extract plain text for AI. Progressive store on initial load (each thread available immediately, not batch-at-end). Dev mode: load from `../email/inbox.json` (parse as `json["emails"]`). Gmail API calls should go through the backend (add Gmail proxy endpoints to trace_router.py that use `nango_proxy_request()` with provider_config_key="google-mail", connection_id="gmail-default"). Correct Nango proxy URL pattern: `{NANGO_BASE_URL}/proxy/gmail/v1/users/me/messages` with headers `Authorization: Bearer {key}`, `Connection-Id`, `Provider-Config-Key`. Do NOT call Nango directly from browser code. Offline: exponential backoff, resume from last stored history cursor on reconnect.

- [x] **2.1a Dev seed data fixtures** (gap #1) - Create static JSON fixtures in `src/lib/fixtures/` for all non-Gmail sources so frontend development can proceed before backend endpoints are ready. Files: `calendar-events.fixture.json` (10-15 events with attendees matching Gmail contacts), `git-commits.fixture.json` (20 commits across 3 branches), `arc-tabs.fixture.json` (30 tabs across 4 spaces, mix of sidebar/archive), `claude-sessions.fixture.json` (5 sessions with project paths). Each fixture matches the normalized `ActivityRecord` shape. Ingestion services check for `VITE_DEV_MODE=true` env var and load fixtures instead of calling backend. This unblocks P4 UI work without waiting for P2 backend endpoints.

- [~] **2.2 Arc browser ingestion** (spec 02) - Frontend ingestion services implemented, backend endpoints done. Needs end-to-end testing with real data. - Three data sources, all via backend endpoints:
  1. StorableSidebar.json - current tabs with URLs, titles, space context. Poll every 60s via `GET /api/trace/arc/sidebar`. On each poll, diff against previous read - emit only new/changed tabs, update timestamps for changed tabs (not full reload).
  2. StorableArchiveItems.json - archived tabs with archivedAt timestamps, space names. Initial load via `GET /api/trace/arc/archive`, past 7 days.
  3. History SQLite (optional) - URLs with visit timestamps and counts. Via `GET /api/trace/arc/history`. Past 7 days. 4 profiles exist (8, 9, 12, 13); Profile 13 is primary.
  - Source ID: hash of (url + space name). Domain extraction + path summary for keyword matching (e.g., "github.com/anthropics/claude-code" -> domain: "github.com", path: "anthropics/claude-code"). Space names as labels. Metadata must include: url, spaceName, isPinned, isBookmark, domain, visitCount, dataSource. Graceful skip if data not found (no user-facing error).
  - Note: 30+ historical sidebar snapshots (`StorableSidebar.YYYY-MM-DD-*.json`) exist on disk but are deferred for MVP - could provide historical tab context in future.

- [~] **2.3 Calendar ingestion** (spec 03) - Frontend ingestion services implemented, backend endpoints done. Needs end-to-end testing with real data. - Read via `GET /api/trace/calendar/events`. 14-day past/future window. Exclude cancelled. Expand recurring events into individual instances (not stored as single record). Attendee emails are strong workstream detection signals (exclude self/user's own entry). Extract meeting links from description/location (Zoom, Google Meet patterns). Refresh every 5 minutes. Fall back to cached file if API unavailable.

- [~] **2.4 Git activity ingestion** (spec 04) - Frontend ingestion services implemented, backend endpoints done. Needs end-to-end testing with real data. - Via `GET /api/trace/git/commits`. Two output types: (1) per-commit records with hash, message, branch, files changed, insertions/deletions; (2) per-project-directory records with structural metadata (path, fileCount, lastModified, hasPackageJson, hasGitRepo). Only commits by current user (matched by git config email). Branch names as labels. Refresh every 5 minutes.

- [~] **2.5 Claude Code session ingestion** (spec 05) - Frontend ingestion services implemented, backend endpoints done. Needs end-to-end testing with real data. - Via `GET /api/trace/claude-sessions`. Backend joins session metadata (`~/.claude/sessions/*.json`) with conversation data (`~/.claude/projects/<path>/<sessionId>.jsonl`). Title: first user message truncated to 100 chars. Body: null (privacy/size). Labels: [project directory name]. Metadata: { sessionId, projectPath, turnCount, duration, lastActiveTimestamp }. 14-day window. Refresh every 5 minutes.

- [ ] **2.6 HubSpot CRM ingestion** (spec 06) - API key from 1Password. Fetch contacts with emails -> build enrichment lookup table keyed by email (shared with ALL other sources): { displayName, companyName, dealNames, lifecycleStage, vipFlag, relationshipScore }. VIP flag: true if deal amount exceeds threshold OR lifecycle is "customer" (OR condition). Relationship score: deal stage progression + activity recency + lifecycle stage (customer > opportunity > lead). Fetch open deals -> normalize as activity records (preview: "Stage: [stage] - $[amount]"). Refresh every 15 minutes. Graceful skip if key unavailable (warning logged, no user-facing error).

## Priority 3: AI Core (specs: 07, 09, 12)

Depends on P1 (types, stores) and P2 (data to cluster). The AI layer that makes workstreams actually work. All Claude API calls proxy through backend (2.0c).

- [ ] **3.1 Workstream detection service** (spec 07) - After initial data load from all sources, send activity records to backend AI proxy for clustering. Signal weights (highest first): participant overlap, topic/keyword overlap, temporal proximity, project association (repo/space/project path), CRM association, label overlap. Adapt `AffinityScore` from messagingRTS. Requirements:
  - Minimum cluster: 2 activities from 2+ sources
  - Returns: workstream names, member IDs, confidence scores, rationale
  - Merge candidates: >60% participant overlap + >40% topic overlap -> AI evaluates (not automatic merge)
  - Splitting: confidence < 0.5 for some members -> AI auto-splits, preserves original ID for dominant cluster (dominant = most activities)
  - Staleness: 7 days no activity -> stale, 30 days -> archived
  - Re-evaluate every 5 minutes on past 24 hours + unassigned activities
  - User overrides are NEVER overridden by AI (treated as strong future signals)
  - Stable workstream UUIDs across re-evaluations (existing workstreams updated, not recreated)
  - Send only titles/participants/timestamps/labels to Claude (not full bodies) for cost management
  - **Token limit guard:** if a workstream has >100 activities, send only the 50 most recent + 50 highest-scored (by urgency/recency) to stay within context limits. Include a count of omitted activities in the prompt.
  - **Failure handling:** if Claude API call fails, preserve existing workstream assignments. Log error. Frontend shows "AI unavailable" indicator on timeline. Retry on next 5-minute cycle.

- [ ] **3.2 Context linking service** (spec 09) - Real-time evaluation of new activities. Fast-path (no AI call): same Gmail thread ID (confidence 1.0), same calendar event series (1.0), same repo+branch (0.9). If no fast-path: batch within 5-second window, send to backend AI proxy with top 5 candidate workstreams (ranked by: participant overlap score first, then recency of last activity). Thresholds: >=0.7 auto-assign, 0.4-0.7 flag uncertain, <0.4 unassigned. On assignment: increment workstream unread count, emit notification. Re-link uncertain assignments (<0.7) when workstreams merge/split. **Failure handling:** if Claude API call fails, leave activity unassigned (not silently dropped). Re-evaluate on next cycle. Updated activities (not just new) also trigger evaluation.

- [ ] **3.3 AI summary service** (spec 12) - Per-workstream summary generation via backend AI proxy. Triggers: creation, new activity, user refresh, cache >30min old. Debounce: 60-second window after LAST activity arrives (not after first). Output: status summary (2-3 sentences), key developments (up to 3 bullets), recommended action (typed, references specific activity ID - if no action needed, type is "no-action" not null), urgency (low/medium/high). Urgency signals: time since last response, upcoming deadlines (calendar), deal stage (CRM), explicit urgency in content. Cache in IndexedDB `summaryCache` store. Include previous summary for continuity (highlight changes, not repeat). Cost control: send titles/participants/timestamps/previews only. **Token limit guard:** for workstreams with >100 activities, send only 50 most recent + summarize older activities as counts/date-ranges. **Failure handling:** on Claude API error, serve stale cached summary with "last updated X ago" indicator. Do not block UI.

- [ ] **3.4 Contact enrichment integration** (spec 06 cross-cutting) - Merge HubSpot enrichment into participant records across all sources. Lookup by email address. Display: name, email, company, deal context, relationship score, VIP flag. Primary participant per workstream: most frequently appearing non-self participant. Adapt `ContactEnrichment` interface from messagingRTS.

## Priority 4: UI Features (specs: 10, 11, 13) -- TikTok-Style Vertical Feed

Depends on P1 (shell, stores) and P3 (AI summaries to display).

**Design philosophy: TikTok for work.** Full-screen vertical swipe. One workstream per screen. Scroll/swipe to navigate between workstreams. Each card is immersive and self-contained - you see everything you need without opening a detail view. Dark, cinematic UI. Snap scrolling. The feed IS the app.

- [ ] **4.0 Design system + animation library** - Install Framer Motion (or Motion for React). Define design tokens: dark palette (near-black bg, high-contrast text, accent colors per urgency level). Typography: monospace for metadata/labels, serif for summaries/content. Micro-interactions on every touch point. CSS snap scrolling (`scroll-snap-type: y mandatory`) for the feed. Shared transition variants for mount/unmount animations.

- [ ] **4.1 Workstream feed (home screen)** (spec 10) - **Full-viewport vertical scroll feed.** Each workstream is a full-height card that snaps into view (CSS scroll-snap + touch/wheel). Sorted by: urgency first, then last activity. Card layout (single screen, no scrolling within card):
  - **Top zone:** workstream name (large serif), urgency indicator (color-coded left edge or glow), relative timestamp, unread badge
  - **Middle zone:** AI summary (2-3 sentences, italic serif), recommended action as a prominent tappable button (not buried in a corner)
  - **Bottom zone:** source icons row, participant avatars (circular, with CRM enrichment tooltip on hover), activity sparkline (7-day mini chart showing activity density), action buttons (reply, archive, snooze)
  - **Right edge (TikTok-style):** vertical icon column - like/bookmark workstream, share, mute, archive. Appears on hover/focus.
  - **Swipe gestures:** swipe right = execute recommended action, swipe left = snooze/dismiss, swipe up/down = navigate feed
  - Between cards: thin separator showing "3 of 7 workstreams" progress indicator
  - Real-time: new activity pushes workstream to top with slide-in animation. Current card stays stable (doesn't jump), new item indicated by a pulse at top of feed.
  - Filter chips at top (floating, semi-transparent): All / Urgent / Deals / Engineering / Stale. Chips filter the feed in-place with crossfade animation.
  - Empty state: cinematic onboarding with staggered source connection cards
  - Keyboard: J/K to navigate, Enter to open detail, A to assign, R to reply

- [ ] **4.1a Workstream assignment dialog** - Bottom sheet (slides up from bottom, TikTok comment-style). Triggered by tapping unassigned items in a dedicated "triage" section at the end of the feed. Shows: searchable list of existing workstreams ranked by AI-suggested relevance, "Create new" option at top. Assignment animates the item flying into the workstream card. User override = permanent (AI never reassigns).

- [ ] **4.1b Triage mode** - Dedicated mode (toggle in header or swipe to last section). Shows unassigned activities as full-screen swipeable cards (like Tinder). Swipe right = assign to AI-suggested workstream. Swipe left = dismiss/archive. Swipe up = create new workstream from this activity. Badge on main feed shows triage count.

- [ ] **4.2 Workstream detail view** (spec 11) - Full-screen takeover with slide-up transition (like opening a TikTok comment section or expanding a story). Layout:
  1. **Sticky header:** workstream name (editable inline), urgency badge, close/back button (swipe down to dismiss), participant avatars
  2. **AI summary card:** pinned at top, frosted glass background. Summary text, recommended action button, "last updated" timestamp, refresh icon. This card is always visible even when scrolling activities below.
  3. **Activity feed:** vertical timeline below the summary card. Each activity is an expandable card. Email: sender, subject, preview (tap to expand full body inline). Calendar: time, attendees, meeting link button. Git: commit hash, message, file count. Browser: favicon + title + URL. Claude: session title + project. Source filter tabs slide horizontally (All, Email, Calendar, Git, Browser, Claude).
  4. **Participant drawer:** swipe from right edge to reveal CRM-enriched contact cards (company, deals, relationship score, last interaction). Tap participant to filter timeline to just their activities.
  - Transition: detail view slides up over the feed (feed stays underneath, blurred). Swipe down or tap outside to dismiss. Browser pushState for `/workstream/:id`.
  - **Workstream merge:** long-press header -> "Merge with..." -> bottom sheet with workstream picker -> confirm -> merge animation.

- [ ] **4.3 Email reply composer** (spec 13) - Bottom sheet (slides up over detail view). Full-width, expands to ~60% of screen. Pre-populated recipients (Reply = sender, Reply All = all). Minimal rich text (bold, italic, links, lists - toolbar at bottom like iMessage). Draft auto-save every 30s via Gmail API (using existing nango_proxy_request, NOT email.py's broken patterns). Correct RFC 2822 construction: base64url-encoded MIME message with In-Reply-To (Message-ID from headers), References chain, "Re:" subject. Send: confirmation sheet showing recipient + subject + body preview, explicit "Send" button. Optimistic local update with rollback on failure. After send: workstream last activity timestamp updates, AI summary re-evaluates. Swipe down to minimize (draft persists). AI-drafted replies OUT OF SCOPE for MVP.

- [ ] **4.4 Visual design spec** - Dark theme, cinematic feel. Near-black background (#0a0a0b). Urgency colors: red (urgent/overdue), amber (needs follow-up), green (on track), blue (informational). Typography: DM Mono for labels/metadata/timestamps, Newsreader (serif) for names/summaries/content. Cards have subtle depth (1px borders at 6% white opacity, hover lifts with translateY). Activity sparklines on each card (7 tiny bars showing last 7 days of activity). Scan-line overlay for CRT/operations-center feel. Animations: spring physics for card transitions (not linear easing), staggered reveals on feed load, parallax on scroll between cards. Command palette (Cmd+K) for power users.

## Priority 5: Polish and Integration

- [ ] **5.1 Offline mode** - Detect network state via `navigator.onLine` + events. Show cached data when offline (IndexedDB data remains navigable). Queue email actions via `ActionQueueEntry` pattern (adapt from messagingRTS sync.ts - id, type, threadId, payload, retryCount, status fields). Replay on reconnect with exponential backoff. Show "you're offline" for network-dependent actions. Auto-sync on reconnect (no user action needed).

- [ ] **5.2 Notification system** - Toast notifications (bottom-right stack, max 3 visible, overflow queues). Types: info (auto-dismiss 5s), warning (auto-dismiss 10s), error (manual dismiss only). Events: new activity assigned, summary updated, email send success/failure, sync errors, source connection changes. Zustand notification store.

- [ ] **5.3 Onboarding / empty state** - First-launch: Gmail OAuth connect button, explain workstreams concept, per-source loading progress with checkmarks as each completes. Transition to timeline when at least one source has data (not all). Source connection status persisted. Loading messages per source ("Connecting to Gmail...", "Reading browser tabs...").

- [ ] **5.4 Settings panel** - Accessible from header gear icon. Source connections (connect/disconnect, show status per source), sync intervals (configurable per source), notification preferences. Auth expiration shows non-blocking banner (cached data remains visible and navigable).

- [ ] **5.5 Performance optimization** - Virtualized lists for large activity counts. Debounced re-renders on rapid store updates. IndexedDB pagination for initial load. Lazy loading of email bodies (load on expand). AI call batching/caching as specified.

---

## Design Decisions (resolved)

1. **Web app + local API server** - not Electron/Tauri. Extend existing FastAPI at `../agent/main.py` with `/api/trace/*` endpoints. Rationale: already has Nango, runs on port 9001, avoids two servers.

2. **Arc data sources** - StorableArchive.json is NOT usable (64 bytes, effectively empty - verified 2026-03-31). Use StorableSidebar.json (current tabs, 30+ historical snapshots also on disk), StorableArchiveItems.json (4MB, archived tabs with Apple Core Data timestamps), and optionally History SQLite (144MB, full browsing history via immutable URI mode, 4 profiles: 8, 9, 12, 13). Arc archive timestamps are Apple Core Data format (seconds since 2001-01-01), not Unix epoch.

3. **AI cost management** - Batching (5s window for context linking), caching (summaries in IndexedDB with 30min TTL), debouncing (60s per workstream for summaries), and sending only titles/participants/timestamps/labels to Claude (not full bodies) for detection.

4. **Polling for MVP** - 30s Gmail, 60s Arc, 5min git/calendar/Claude sessions, 15min HubSpot. No file watchers for v1.

5. **Adapt messagingRTS patterns** - Don't copy wholesale, but adapt the persistence split-ownership merge, store immutability pattern (new Map on every mutation), lifecycle state machine with audit trail (`StateTransition` objects), event-driven transitions (`resolveTransition`), and decomposed affinity scoring interface.

6. **CORS middleware required** - The existing FastAPI backend has NO CORS middleware. Must add `CORSMiddleware` with `allow_origins=["http://localhost:5173"]` for Vite dev server cross-origin requests.

7. **Claude Code session data architecture** - Two data locations: (a) `~/.claude/sessions/*.json` are lightweight process metadata (pid, sessionId, cwd, startedAt) - use `json.load()`. (b) `~/.claude/projects/<encoded-path>/<sessionId>.jsonl` are full conversation logs (JSONL, one event per line). Backend must cross-reference both: read session metadata first, then look up corresponding JSONL in projects directory for content (first user message, turn count).

8. **Backend router isolation** - New Trace endpoints live in `trace_router.py` using FastAPI `APIRouter`. This will be the FIRST router in main.py (no existing `include_router` pattern). Use factory function `make_trace_router(nango_mgr)` to pass singletons since main.py has no dependency injection framework.

9. **Claude API key routing** - AI calls (detection, linking, summaries) proxy through the backend via `/api/trace/ai/*` endpoints. Key sourced from 1Password or environment variable. Frontend never sees the Anthropic API key.

10. **Git repository structure** - `~/Monet/` is a single monorepo, not multiple independent repos. Git operations run from repo root. Sub-project directories (agent/, email/, messagingRTS/, etc.) are tracked as subdirectories of the same repo, current branch `ralph-build`.

11. **Nango proxy architecture** - `nango_proxy_request()` in `nango.py` constructs `{NANGO_BASE_URL}/proxy/{path}` (e.g., `https://api.nango.dev/proxy/gmail/v1/users/me/messages`). Required headers: `Authorization: Bearer {secret_key}`, `Connection-Id: {connection_id}`, `Provider-Config-Key: {config_key}`. Currently configured providers: gmail (config_key="google-mail", connection_id="gmail-default"), github, google-docs, google-drive. Google Calendar is NOT configured - would need to add a new provider entry if direct calendar API access is desired.

12. **Apple Core Data epoch** - All Arc browser timestamps (sidebar `timeLastActiveAt`/`createdAt`, archive `archivedAt`) use seconds since 2001-01-01 00:00:00 UTC. Convert to Unix epoch: `unix_ts = core_data_ts + 978307200`.

## Identified Gaps

1. **Dev mode seed data for non-Gmail sources** - Only Gmail has seed data (`../email/inbox.json`). Consider creating seed data fixtures for calendar events and git commits so the UI can be developed before backend endpoints are ready.

2. **Rate limiting for Claude API calls** - Multiple AI features (detection every 5min, linking in real-time, summaries on triggers) could generate many API calls. Need a global rate limiter/request queue on the backend AI proxy layer (2.0c).

3. **Backend authentication for Trace endpoints** - No route in main.py verifies auth tokens via `Depends()`. Trace endpoints can follow the same pattern (no forced auth), but should consider adding a session token check for consistency as the app matures.

4. **Workstream assignment dialog** (added as 4.1a) - Spec 10 mentions tapping an unassigned activity opens a "workstream assignment dialog" but this UI component is not detailed in any spec. Needs: searchable list of existing workstreams, create new option, relevance ranking.

5. **Calendar event time resolution** - VERIFIED: `calendar_events.json` has NO time-of-day on ANY event (start is date-only YYYY-MM-DD, end is always empty string ""). Nango Google Calendar API is the only path to time-specific events. Without it, all events are day-level granularity, which weakens temporal proximity signals for workstream detection. Consider adding Nango calendar provider to `PROVIDERS` dict in nango.py (currently only gmail, github, google-docs, google-drive are configured).

6. **Arc sidebar space resolution for archive items** - VERIFIED: Archive items reference space via `source.space._0` (UUID), NOT by name. The sidebar endpoint must build and cache a space UUID->name lookup map from `sidebar.containers[1].spaces[]`. The archive endpoint depends on this map. Consider: (a) load sidebar first, cache map in memory; or (b) return a combined endpoint that returns both sidebar + archive data with resolved space names.

7. **Arc sidebar parentID chain traversal** - VERIFIED: Items are in a flat pool, not nested under spaces. Resolving which space an item belongs to requires: item.parentID -> parent item or container UUID -> match container UUID against space.containerIDs. This is a multi-hop traversal, not a direct lookup. Backend must build a container-UUID->space-name index for efficient resolution. Some items may have parentID pointing to folder items (which have `data.folder` instead of `data.tab`), requiring recursive traversal.

8. **Historical Arc sidebar snapshots** - 30+ `StorableSidebar.YYYY-MM-DD-*.json` files exist on disk (~960KB each) providing historical tab state. Spec 02 documents them as a data source. Deferred for MVP but could provide rich historical browsing context.

9. **Arc profiles** - 4 profiles exist on disk (8, 9, 12, 13), not 3 as spec states. Profile 13 is primary (138MB). No fallback strategy defined if Profile 13 is unavailable.

10. **email.py draft_reply has a known bug** - The `_tool_draft_reply` method in `../agent/agents/email.py` sends `raw: ""` and non-standard fields to the Gmail drafts API. Do NOT copy this pattern for item 4.3. Build correct RFC 2822 message construction (base64url-encoded message with proper headers) from the Gmail API docs.

11. **Nango proxy URL pattern** - VERIFIED: `nango_proxy_request()` constructs `{NANGO_BASE_URL}/proxy/{path}` (not `/v1/gmail/...`). Headers: `Authorization: Bearer {key}`, `Connection-Id: {connection_id}`, `Provider-Config-Key: {config_key}`. Gmail connection ID defaults to `gmail-default`, config key is `google-mail`. The plan item 2.1 references the wrong URL pattern - the frontend Gmail ingestion service should use the backend as a proxy rather than calling Nango directly from the browser.

12. **main.py has no include_router yet** - VERIFIED: all routes are defined directly on `app`. Adding `app.include_router(trace_router, prefix="/api/trace")` will be the first use of the router pattern. Ensure it does not conflict with existing direct routes (all under `/api/` prefix but none under `/api/trace/`).

13. **Activity ID generation mechanism** - No spec defines the format. Recommended: `{source}:{sourceId}` (e.g., "gmail:19d40f0981bfad11", "git:abc123f", "arc-browser:hash(url+space)"). Guarantees uniqueness across sources without UUID overhead. Must be deterministic (same source input always produces same ID) so deduplication works across ingestion cycles.

14. **Arc URL deduplication across data sources** - The same URL can appear in StorableSidebar (current tab), StorableArchiveItems (archived tab), and History SQLite (visit record). No spec defines dedup strategy. Recommended: sidebar takes precedence (most recent state), then archive, then history. Dedup by normalized URL + space name. When merging, keep highest visitCount and most recent timestamp.

15. **Claude API token limits for large workstreams** - A workstream with hundreds of activities could exceed Claude's context window when sent for detection (spec 07) or summarization (spec 12). Need truncation strategy: send N most recent + M highest-scored activities with a count of omitted. Added to plan items 3.1 and 3.3.

16. **Concurrent workstream modification during AI re-evaluation** - If user manually reassigns an activity while AI re-evaluation is in-flight, the AI response may reference stale state. Strategy: user actions always win. On AI response, diff against current store state; skip any assignments that conflict with changes made since the AI call was initiated (use a request timestamp watermark).

17. **Workstream merge UI** - Spec 11 mentions "merge this workstream with another" but no detailed UI is specified. Added to plan item 4.2: button in header -> searchable workstream picker -> confirm dialog -> merge execution.

18. **Settings view navigation** - Spec 14 leaves undecided whether settings is a slide-in panel or a separate page. Recommendation: slide-in panel (does not push to browser history, preserves timeline/detail state underneath). Settings is lightweight enough to not need its own route.

19. **email.py send_email is also broken** - VERIFIED: `_tool_send_email` in `../agent/agents/email.py` posts flat JSON `{to, subject, body}` to Gmail send endpoint, but Gmail API requires base64url-encoded RFC 2822 in a `raw` field. Same bug as draft_reply. Do NOT reuse either pattern. Build correct MIME construction for plan item 4.3.

20. **email.py label_email passes names not IDs** - VERIFIED: `_tool_label_email` passes label display names (e.g., "Work") but Gmail's `messages.modify` requires label IDs (system labels like "INBOX" or user label IDs like "Label_123"). Will fail for non-system labels.

21. **main.py static vs parameterized route ordering** - VERIFIED: main.py has explicit comments about static routes needing to come before parameterized routes on the same prefix (e.g., `/api/agents/tool-sets` before `/api/agents/{agent_name}`). trace_router.py must follow the same pattern if any prefix has both static and parameterized routes.

22. **Gmail ingestion serial message fetching** - Gmail ingestion service fetches individual messages serially for full content. Should batch-fetch or use threads endpoint for efficiency.

23. **Ingestion services lack unit tests** - Ingestion services need tests. Currently only covered by type checking - should add unit tests with fixture data.

## Spec Coverage

| Spec                         | Plan Items            | Status      |
| ---------------------------- | --------------------- | ----------- |
| 01-gmail-ingestion           | 2.0b, 2.1, 2.1a       | In progress |
| 02-arc-browser-ingestion     | 2.0a, 2.0b, 2.2, 2.1a | In progress |
| 03-calendar-ingestion        | 2.0b, 2.3, 2.1a       | In progress |
| 04-file-activity-ingestion   | 2.0b, 2.4, 2.1a       | In progress |
| 05-claude-sessions-ingestion | 2.0b, 2.5, 2.1a       | In progress |
| 06-hubspot-ingestion         | 2.6, 3.4              | Not started |
| 07-workstream-detection      | 2.0c, 3.1             | Not started |
| 08-workstream-data-model     | 1.2, 1.3, 1.4, 1.5    | Complete    |
| 09-context-linking           | 2.0c, 3.2             | Not started |
| 10-workstream-timeline       | 4.1, 4.1a             | Not started |
| 11-workstream-detail-view    | 4.2 (incl. merge UI)  | Not started |
| 12-ai-summary                | 2.0c, 3.3             | Not started |
| 13-email-actions             | 4.3                   | Not started |
| 14-application-shell         | 1.6, 5.2, 5.3, 5.4    | In progress |

## Implementation Order (recommended)

Build in this sequence to get a visible, working demo fastest:

1. **1.1** Project scaffold (Vite + React + TypeScript + all deps)
2. **1.2** Core types (parallel with scaffold once it exists)
3. **2.0a** Backend CORS + router setup (parallel with frontend types - unblocks all backend work)
4. **2.0b** Backend data endpoints (parallel with frontend foundation)
5. **1.3** Persistence layer (IndexedDB with schema versioning)
6. **1.4 + 1.5** Activity + workstream stores (parallel)
7. **1.6** Application shell (minimal - header + content area + sync indicator)
8. **2.1** Gmail ingestion (highest-value source, seed data in `../email/inbox.json` enables immediate dev without OAuth)
9. **2.1a** Dev seed data fixtures (parallel with 2.1 - enables frontend dev for non-Gmail sources)
10. **4.1** Workstream timeline (home screen - even without AI, can display raw activities grouped by source)
11. **2.0c** Backend AI proxy endpoints with rate limiter (unblocks all AI features)
12. **3.1** Workstream detection with token limit guard (makes the app useful - transforms activities into workstreams)
13. **3.2** Context linking with failure handling (makes it real-time - new activities auto-assign)
14. **4.2** Workstream detail view including merge UI (drill into a workstream)
15. **3.3** AI summaries (makes detail view rich)
16. **2.2-2.5** Remaining local ingestion sources (Arc, calendar, git, Claude sessions - parallel, each independent)
17. **2.6** HubSpot CRM ingestion (enrichment layer)
18. **3.4** Contact enrichment integration
19. **4.1a** Workstream assignment dialog
20. **4.3** Email composer (correct RFC 2822 + base64url - do NOT copy email.py patterns)
21. **5.1-5.5** Polish items (offline, notifications, onboarding, settings as slide-in panel, perf)

**Rationale:** Steps 1-7 produce a running app shell. Step 8 loads real email data. Step 9 creates fixtures so the full UI can be developed without waiting for all backend endpoints. Step 10 shows data on screen. That is the first visible demo: a list of email activities on a timeline. Steps 11-13 turn it into the actual product by clustering activities into workstreams. Backend work (steps 3-4, 11) is sequenced early because multiple features depend on it and it can be built in parallel with frontend foundation work.
