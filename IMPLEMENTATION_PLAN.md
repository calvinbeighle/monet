# Monet Implementation Plan

> Prioritized checklist of everything needed for a bootable Debian-based OS with Flutter shell,
> AI agents (Claude Agent SDK + Nango), 4 dynamic UI patterns, and approval gates.
>
> Source of truth: `docs/plans/2026-03-29-monet-mvp.md`
> Status: **Phase 1 complete, Phase 2 complete, Phase 3 complete, Phase 4 Tasks 19-22 complete, Writing Agent complete, User-Created Agents complete, Scheduled Agent Execution complete, Keystroke Collection Pipeline complete - 741 passing tests (609 Python + 132 Flutter).**

---

## Phase 1 - Agent Backend (HIGHEST PRIORITY)

Agents must work from CLI before any UI. This proves the core concept.

### Task 1: Claude Agent SDK Setup

- [x] Create `agent/main.py` - FastAPI server with `/api/run`, `/api/stream`, `/api/health` endpoints
- [x] Create `agent/runner.py` - AgentRunner class with `run_sync()` and `stream_sync()` methods
- [x] Create `agent/requirements.txt` - fastapi, uvicorn, claude-agent-sdk, nango
- [x] Create `agent/__init__.py`
- [x] Create `agent/tests/__init__.py`
- [x] Create `agent/tests/test_runner.py` - tests for structured result and streaming events
- [x] Data models: AgentResult, AgentOutput, AgentEvent, UIPattern enum
- [x] Wire Claude Agent SDK into runner (implemented with anthropic SDK, real agent loop with tool execution)
- [x] Session create/resume in SQLite
- [x] Session management API endpoints (GET /api/sessions, DELETE /api/sessions/{id})

### Task 2: Intent Router

- [x] Create `agent/router.py` - IntentRouter with keyword matching + Claude Haiku fallback
- [x] Create `agent/tests/test_router.py` - tests for email/code/planning/unknown intent routing
- [x] RoutedIntent data model: `{ agent, ui_pattern, original }`
- [x] Keyword rules: email batch -> tinder, email single -> chat, code review -> diff, planning -> whiteboard
- [x] Wire router into AgentRunner.stream_sync()

### Task 3: Email Agent

- [x] Create `agent/agents/__init__.py`
- [x] Create `agent/agents/email.py` - EmailAgent with tool definitions and approval gates
- [x] Create `agent/tests/test_email_agent.py`
- [x] Tools: list_inbox, read_email, draft_reply, send_email, archive_email, label_email
- [x] Approval gate on send_email and archive_email
- [x] Wire Nango Gmail integration (MCP or direct API)
- [x] System prompt for email assistant behavior
- [x] PreToolUse hook for approval-required actions

### Task 4: Code Agent

- [x] Create `agent/agents/code.py` - CodeAgent with GitHub tool definitions
- [x] Create `agent/tests/test_code_agent.py`
- [x] Tools: list_prs, read_diff, read_file, post_review, approve_pr, merge_pr, push_code, create_branch, write_file
- [x] Approval gate on approve_pr, merge_pr, push_code
- [x] Wire Nango GitHub integration
- [x] System prompt for code assistant behavior

### Task 5: Approval Flow

- [x] Create `agent/approval.py` - ApprovalGate with create/approve/reject/list_pending
- [x] Create `agent/tests/test_approval.py`
- [x] ApprovalRequest and ApprovalStatus models
- [x] Add approval API routes to main.py: GET /api/approvals, POST /api/approvals/{id}/approve, POST /api/approvals/{id}/reject
- [x] Wire approval gate into agent runner PreToolUse hooks
- [x] Wire approval gate UI into Flutter shell (ApprovalOverlay dialog, approve/reject API calls)

### Task 6: CLI Test Harness

- [x] Create `agent/cli.py` - CLI that calls agent backend, shows streaming output, prompts for approvals
- [ ] Manual testing: `python -m agent.cli "handle my inbox"` works end-to-end

---

## Phase 2 - Shell UI (HIGH PRIORITY)

Flutter shell with all 4 UI patterns. Runs on Mac for dev, targets Linux aarch64 for OS.

### Task 7: Flutter Project Setup

- [x] Create `shell/` via `flutter create --platforms=linux,macos --org co.monet shell`
- [x] Add dependencies: http, provider, flutter_animate
- [x] Create `shell/lib/services/agent_client.dart` - HTTP client for agent backend (run, stream, approvals)
- [x] Create `shell/lib/main.dart` - MonetApp scaffold with intent bar, pattern router, status bar
- [x] Dark theme with custom colors (0xFF0A0A0F background, 0xFF12121A surfaces)
- [x] Pattern switching based on agent response `ui_pattern` field

### Task 8: Tinder UI Pattern (Swipe Cards)

- [x] Create `shell/lib/ui/patterns/tinder.dart`
- [x] Swipeable card stack with gesture detection
- [x] Right swipe = approve, left = reject
- [x] Progress counter ("3 of 12")
- [x] Undo button
- [x] Spring physics on swipe animation
- [x] Summary view at end (approved/rejected count)

### Task 9: Chat UI Pattern (iMessage)

- [x] Create `shell/lib/ui/patterns/chat.dart`
- [x] Threaded conversation view with message bubbles
- [x] Agent messages stream in with typing indicator
- [x] Reply suggestions as tappable chips
- [x] System messages for tool_call events (centered with icon)
- [x] Inline approve/reject cards (approval_request events render as inline cards with approve/reject buttons, status updates after decision)

### Task 10: Diff UI Pattern

- [x] Create `shell/lib/ui/patterns/diff.dart`
- [x] Side-by-side text comparison
- [x] Syntax highlighting
- [x] Color-coded added/removed/modified lines
- [x] "Approve All" / "Reject All" buttons

### Task 11: Whiteboard UI Pattern

- [x] Create `shell/lib/ui/patterns/whiteboard.dart`
- [x] Zoomable/pannable canvas via InteractiveViewer
- [x] Draggable nodes with title/body
- [x] Connection lines between nodes (CustomPainter)
- [x] Tap node to expand/act

### Task 12: Status Bar + Pattern Switching

- [x] Create `shell/lib/ui/status_bar.dart`
- [x] Connected tools indicators (green/gray dots)
- [x] Running agent indicator
- [x] Wire all 4 pattern widgets into main.dart
- [x] Wire tinder/diff decision callbacks to backend approval API
- [x] Animated transitions between patterns
- [x] "Agents" button in StatusBar to toggle AgentsDashboard

### Task 12a: See Agents Dashboard (SCOPE.md Feature 3)

- [x] `agent/activity_store.py` - ActivityStore class tracks every agent run in SQLite (start time, finish time, status, tool calls count, approvals count, summary)
- [x] Agent registry API endpoints: GET /api/agents, GET /api/agents/{name}, GET /api/agents/activity
- [x] Activity tracking wired into AgentRunner (run_sync and stream_sync)
- [x] Flutter `shell/lib/ui/agents_dashboard.dart` - agent cards with real-time status indicators (idle/working), tool count, run count, and clickable detail views
- [x] Detail view shows tool listing, stats, and activity history
- [x] Agent descriptions added to all 4 agents (email, code, planning, general)

---

## Phase 3 - End-to-End Flows (MEDIUM PRIORITY)

Full flows: intent -> agent -> UI -> approve -> execute.

### Task 13: Email Flow - Single Reply

- [x] "Reply to John's email" -> Chat UI
- [x] Agent reads email via Nango, drafts reply
- [x] Reply appears as suggestion bubble
- [x] Approve -> sends via Nango Gmail API

### Task 14: Email Flow - Batch Inbox

- [x] "Handle my inbox" -> Tinder UI
- [x] Cards stream in as agent drafts replies
- [x] Swipe approve/reject
- [x] Approved ones send, rejected skip

### Task 15: Code Flow - PR Review

- [x] "Review the open PR" -> Diff UI
- [x] Agent reads diff via Nango GitHub, writes review
- [x] Diff + inline comments displayed
- [x] Approve -> posts review to GitHub

### Task 16: Planning Flow

- [x] "Plan the next sprint" -> Whiteboard UI
- [x] Agent generates task nodes on canvas
- [x] User rearranges, connects, prioritizes
- [x] Tap node -> expand into subtasks

### Task 17: Cross-Pattern Flow

- [x] Multi-step intents decompose across patterns
- [x] Example: Whiteboard -> Tinder -> Chat
- [x] State carries forward between patterns
- [x] Smooth animated transitions

### Task 18: Error Handling

- [x] OAuth expired -> prompt to reconnect (implemented: runner detects 401/403/unauthorized in tool execution errors, emits oauth_expired error event, Flutter shell renders error card)
- [x] Agent fails -> error card with retry (implemented: runner catches all Anthropic API errors, Flutter shell renders error cards with retry button for retryable errors)
- [x] Network down -> error card with retry (full offline queue deferred to Phase 5)

---

## Phase 4 - Make It an OS (LOWER PRIORITY)

Debian VM boots directly into Monet.

### Task 19: Debian VM Setup

- [x] Create `os/strip.sh` - remove GNOME, GDM, desktop apps; keep kernel, systemd, apt, NetworkManager, PipeWire
- [x] Create `os/install.sh` - install Sway, compile Flutter shell for aarch64, deploy agent backend
- [x] Create `os/sway.config` - launch Flutter shell fullscreen, no decorations, no bar
- [x] Create `os/monet-agent.service` - systemd unit for agent backend
- [x] Auto-login user (configured via systemd getty override in install.sh)
- [ ] Boot flow: power on -> Debian -> auto-login -> Sway -> Monet shell fullscreen (needs VM testing)

### Task 20: First-Boot Onboarding and Login

- [x] Create `agent/auth.py` - SQLite user store with bcrypt/pbkdf2 password hashing
- [x] Create `agent/tests/test_auth.py`
- [x] Create `shell/lib/ui/onboarding.dart` - first-boot: create user + connect tools
- [x] Lock screen on subsequent boots (fully implemented - persistent session tokens survive app restarts; cold start validates token via /api/auth/verify and skips login if valid)
- [x] Session persistence until explicit logout
- [x] Auth API routes in FastAPI

### Task 21: System Integration

- [x] WiFi management via NetworkManager (nmcli - scan, connect, disconnect, status; API endpoints + Flutter WiFi sheet)
- [x] Volume/brightness controls (wpctl for PipeWire volume, brightnessctl for display; API endpoints + status bar indicators)
- [x] Shutdown/restart from shell (systemctl power actions via API + Flutter power menu dialog; polkit rules for unprivileged access)
- [x] Plymouth boot splash with Monet branding (monet.plymouth + monet.script - dark theme with pulsing dot, installed via install.sh)
- [x] Suppress kernel messages (quiet boot - GRUB quiet splash loglevel=0, sysctl kernel.printk=1, vt.global_cursor_default=0)
- [x] Sway hardware key bindings for volume (XF86Audio*) and brightness (XF86MonBrightness*)
- [ ] Boot flow: needs VM testing to verify Plymouth + quiet boot + Sway auto-start end-to-end

### Task 22: Image Build Script

- [x] Create `os/build-image.sh` - stock Debian ISO -> custom Monet .qcow2
- [x] Automated: strip, install deps, copy Monet, configure boot
- [ ] Test on fresh UTM instance (needs VM testing)

---

## Phase 5 - Polish (FUTURE)

- [x] Keystroke collection pipeline (OS-level capture -> SQLite -> personalization)
- [ ] Dark/light theme
- [ ] Animation polish on pattern transitions
- [ ] More integrations (Slack, Calendar, Notion, Linear)
- [ ] Smarter intent routing (semantic embeddings, learn from usage)
- [ ] Voice input
- [ ] Mobile companion (Flutter - same codebase)
- [x] Planning agent (agent/agents/planning.py - implemented with 5 tools)

---

## Implementation Notes (2026-03-30)

### Remaining Gaps Discovered

- **Tinder batch approval UX:** Cards are currently populated from `done` event outputs, not from streaming `approval_request` events. For true batch approval UX, cards should be created incrementally as `approval_request` events arrive during streaming.
- **Session ID from backend:** Fixed - the backend now includes `session_id` in routing event metadata.
- **Done event now carries outputs:** Fixed - `stream_sync` now collects text outputs and includes them in the `done` event metadata along with agent name, ui_pattern, and session_id. This enables pattern population from streaming responses.
- **Real-time token streaming fixed:** Previously tokens were buffered in a local `streamedContent` string and only rendered on the `done` event. Now tokens stream into the UI on each event via mutable `ChatMessage` updates.
- **Intent bar hidden on initial load:** The intent bar is hidden when `_activePattern` is null (initial state), relying on chat pattern's built-in input field. This is intentional - chat is the default landing view.
- **Tool connection status fixed:** StatusBar now polls `/api/tools/status` endpoint every 10 seconds for real Nango connection state. `NangoManager` in `agent/nango.py` queries Nango API for Gmail/GitHub OAuth status.
- **Auth session persistence:** Resolved - session tokens are now cryptographically random, persisted via shared_preferences, and validated on cold start via /api/auth/verify.

### Implementation Notes (2026-03-30) - Batch 2

- **PlanningAgent implemented:** `agent/agents/planning.py` with 5 tools (create_node, connect_nodes, update_node, remove_node, get_plan); registered in runner alongside email and code agents.
- **`_tool_read_diff` fixed:** Added `Accept: application/vnd.github.v3.diff` header so the GitHub API returns actual diff content instead of PR metadata.
- **Duplicate input bar fixed:** Shell intent bar is hidden when chat pattern is active; chat pattern has its own input bar.
- **Whiteboard `shouldRepaint` fixed:** `ConnectionPainter.shouldRepaint` now compares node positions and connection lists instead of always returning true.
- **Animated transitions added:** `AnimatedSwitcher` with 300ms cross-fade wraps pattern switching in `main.dart`.
- **Test count:** 153 total (111 Python + 42 Flutter), all passing.

### Implementation Notes (2026-03-30) - Batch 3

- **GeneralAgent implemented:** `agent/agents/general.py` - conversational fallback for unknown intents. No tools, pure Claude conversation. Registered in runner alongside email, code, and planning agents.
- **PlanningAgent per-session state fixed:** Node state is now scoped per session via `_sessions` dict keyed by session_id. Runner calls `set_session()` before executing tools. Concurrent planning sessions are isolated.
- **Error handling implemented:** Runner catches `AuthenticationError`, `RateLimitError`, `APIConnectionError`, `APITimeoutError`, and general `APIError` from Anthropic SDK. Tool execution errors are caught with OAuth detection (401/403/unauthorized). Stream and sync paths both handle errors gracefully.
- **Flutter error cards implemented:** Chat pattern renders error cards with error icon, message, and retry button (for retryable errors). AgentClient catches network/connection errors and emits synthetic error+done events.
- **Test count:** 176 total (129 Python + 47 Flutter), all passing.

### Implementation Notes (2026-03-30) - Batch 4

- **Real-time token streaming fixed:** Tokens now render in the chat UI as they arrive instead of buffering until the `done` event. `ChatMessage.content` is now mutable. `MonetShellState` tracks `_streamingMessageIndex` - on first token, creates a new assistant message; on subsequent tokens, appends to it in-place with `setState()`. Typing indicator (bouncing dots) only shows before the first token arrives, then disappears as the streaming message takes over. Chat scroll now triggers continuously during streaming.
- **Test count:** 176 total (129 Python + 47 Flutter), all passing.

### Implementation Notes (2026-03-30) - Batch 5

- **Auth system implemented:** `agent/auth.py` with SQLite-backed AuthStore using PBKDF2-HMAC-SHA256 (100k iterations, 16-byte random salt). Three API routes: GET /api/auth/status (first-boot detection), POST /api/auth/create, POST /api/auth/login.
- **Onboarding UI implemented:** `shell/lib/ui/onboarding.dart` with automatic first-boot detection. Shows create account form when no users exist, login form when users exist. Falls back to login with error message when backend is unreachable.
- **MonetApp now gates on auth:** Shell is only shown after successful authentication. OnboardingScreen renders first, calls /api/auth/status to decide between create-account and login flows.
- **Test count:** 204 total (153 Python + 51 Flutter), all passing.

### Implementation Notes (2026-03-30) - Batch 6

- **Planning flow wired end-to-end:** Intent "plan the next sprint" now routes to PlanningAgent -> Whiteboard UI. Backend emits `whiteboard_update` events after each planning tool call (create_node, connect_nodes, etc.) so the whiteboard renders nodes incrementally during streaming. The `done` event's `outputs` field now contains the full node state from `PlanningAgent._nodes` instead of just text content.
- **WhiteboardNode priority support:** Flutter `WhiteboardNode` now includes a `priority` field. Nodes render with a color-coded priority dot and border: red for high, purple for medium, green for low.
- **Node tap expands into subtasks:** Tapping a whiteboard node sends a follow-up intent "Break down '{title}' into subtasks" to the agent, which creates child nodes.
- **Node drag positions update correctly:** `onNodeMoved` callback is now wired in MonetShell so connection lines redraw after drag.
- **Test count:** 211 total (156 Python + 55 Flutter), all passing.

### Implementation Notes (2026-03-30) - Batch 7

- **Router priority fix:** Moved planning rules above code-write rules so "write a plan" correctly routes to PlanningAgent + whiteboard instead of CodeAgent + chat. Added "prioritize" and "organize" keywords to planning rules.
- **Chat suggestions wired end-to-end:** Added `suggestions` property to BaseAgent with overrides in all 4 agents (email, code, planning, general). Runner includes agent suggestions in `done` event metadata. Flutter shell populates suggestion chips from `done` event and clears them on new intent.
- **Test count:** 223 total (168 Python + 55 Flutter), all passing.

### Implementation Notes (2026-03-30) - Batch 8

- **Diff parser implemented:** `agent/diff_parser.py` parses unified diff format into structured DiffLine data (left/right/type). Handles add, remove, modified (paired remove+add), unchanged, multi-file diffs, and hunk headers.
- **diff_update streaming event:** Runner now emits `diff_update` events when code agent's `read_diff` tool returns data in diff UI mode. Parsed diff lines are sent to the Flutter shell during streaming so the DiffPattern renders incrementally.
- **Tinder cards from approval_request events:** Flutter shell now creates TinderCards from `approval_request` events when in tinder mode. Card title uses email subject or recipient, body uses email content. Each card carries the `approval_id` in metadata so swipe decisions resolve the backend approval. Previously cards were only populated from the `done` event.
- **Flutter diff_update handling:** Shell now handles `diff_update` events in the stream listener, parsing structured diff lines into DiffLine objects for the DiffPattern widget.
- **Missing tool execution tests added:** Added tests for email agent (draft_reply, archive_email, label_email add/remove, send_email with reply, list_inbox unread_only) and code agent (read_file, post_review, approve_pr, create_branch, write_file, push_code).
- **E2E flow tests added:** Comprehensive tests for all three Phase 3 flows: Email Single Reply (read->draft->send chain, streaming approval, rejection), Email Batch Inbox (multiple approvals, mixed approve/reject), Code PR Review (list->read->review chain, diff_update emission, merge approval, error handling).
- **Test count:** 258 total (203 Python + 55 Flutter), all passing.

### Implementation Notes (2026-03-30) - Batch 9

- **Session persistence implemented end-to-end:** Backend issues cryptographically random 32-byte tokens on login/create, stores them in an `auth_tokens` SQLite table. Flutter shell persists the token via shared_preferences. On cold start, MonetApp calls /api/auth/verify to validate the stored token - if valid, skips the login screen entirely. If invalid or backend unreachable, clears the stale token and shows login.
- **Logout wired end-to-end:** StatusBar has a logout button that calls /api/auth/logout to revoke the token server-side, then clears local storage and returns to the login screen.
- **Test count:** 277 total (219 Python + 58 Flutter), all passing.

### Implementation Notes (2026-03-30) - Batch 10

- **Cross-pattern flow implemented end-to-end:** `FlowStep` and `FlowPlan` data models in `agent/models.py`. `IntentRouter.route_flow()` detects compound intents via keyword regex rules (3 flow rules: plan+inbox -> whiteboard->tinder->chat, review+fix -> diff->chat, brainstorm+prioritize -> whiteboard->tinder). `AgentRunner.stream_flow()` orchestrates multi-step execution with user-advance gates (threading.Event) between steps. State carries forward via `carry_map` on FlowStep (e.g., whiteboard nodes become tinder cards). New events: `flow_start`, `pattern_transition`, `flow_done`. `/api/flow/advance` endpoint signals user readiness. Flutter shell renders flow progress bar with step indicators and "Continue" button, handles all new events, auto-populates pattern data from carried state.
- **`_stream_step` extracted:** Core streaming agent loop factored out of `stream_sync` into `_stream_step` so both single-step and multi-step paths share the same agent execution logic without duplication.
- **API stream endpoint updated:** `/api/stream` now uses `stream_flow()` which transparently handles both single-step (delegates to `stream_sync`) and multi-step flows.
- **Test count:** 308 total (247 Python + 61 Flutter), all passing.

---

### Implementation Notes (2026-03-30) - Batch 11

- **Debian VM setup scripts implemented (Task 19):** `os/strip.sh` removes GNOME, GDM, X11, desktop apps, and unnecessary services from stock Debian 12. Keeps kernel, systemd, apt, NetworkManager, PipeWire, Python 3, SSH. `os/install.sh` installs Sway and Wayland stack, creates monet user, deploys agent backend in a Python venv at /opt/monet, copies pre-built Flutter shell binary, installs systemd service, configures Sway, and sets up auto-login via getty override + bash_profile Sway auto-start on tty1.
- **Sway config implemented:** `os/sway.config` launches Flutter shell fullscreen with no decorations, no status bar, no titlebars. Background color matches Monet theme (#0A0A0F). Includes swayidle for lock/power-off, essential keybindings only (emergency terminal, reload, exit/shutdown/restart dialog). Input configured for natural scrolling touchpad.
- **systemd service implemented:** `os/monet-agent.service` runs uvicorn on localhost:8000 with security hardening (NoNewPrivileges, ProtectSystem=strict, PrivateTmp, etc.), reads .env for API keys, restarts on failure with backoff, 512M memory limit.
- **Diff syntax highlighting implemented (Task 10):** `SyntaxHighlighter` class in `shell/lib/ui/patterns/diff.dart` - lightweight regex-based tokenizer that highlights keywords (blue, VS Code-style), strings (warm orange), comments (muted green), numbers (light green), and decorators/annotations (yellow). Covers keywords from Python, JS/TS, Dart, Go, Rust, Java, C. No external dependencies - pure Dart regex. `DiffPattern` now uses `RichText` with `TextSpan` children instead of plain `Text` widgets.
- **Test count:** 319 total (247 Python + 72 Flutter), all passing.

### Implementation Notes (2026-03-30) - Batch 12

- **System integration implemented (Task 21):** Full WiFi, volume, brightness, and power management stack. Backend: `agent/system.py` SystemManager class wraps nmcli (WiFi scan/connect/disconnect/status), wpctl (PipeWire volume get/set/mute), brightnessctl (display brightness get/set), and systemctl (shutdown/restart/suspend). All methods gracefully degrade when tools are missing (returns safe defaults). 11 new API endpoints under `/api/system/`.
- **Flutter system controls:** StatusBar now shows real-time WiFi signal strength (3 tiers), volume level with mute toggle, brightness level, and power button. WiFi tap opens a bottom sheet with network scan, password dialog, and connect. Power tap opens a dialog with shutdown/restart/suspend options. System state polled every 10 seconds.
- **OS layer updates:** Sway config adds XF86Audio* and XF86MonBrightness* hardware key bindings. install.sh now installs brightnessctl and plymouth. Plymouth theme (monet.plymouth + monet.script) renders dark background (#0A0A0F) with "M O N E T" text and pulsing dot. GRUB configured for quiet boot (quiet splash loglevel=0 vt.global_cursor_default=0). Kernel printk suppressed via sysctl. Polkit rules allow monet user to shutdown/restart/suspend without password.
- **Test count:** 383 total (293 Python + 90 Flutter), all passing.

### Implementation Notes (2026-03-30) - Batch 13

- **Image build script implemented (Task 22):** `os/build-image.sh` automates the full pipeline from stock Debian 12 cloud image to bootable Monet .qcow2. Downloads official Debian cloud image (arm64 or amd64), resizes to 8GB, injects Monet source tree via virt-customize, runs strip.sh and install.sh inside the image, compacts the output. Supports --arch, --size, --source, --skip-download, --api-key, --nango-key, --password flags. Requires libguestfs-tools + qemu-utils on a Linux build host. Uses a staging directory + install wrapper script to bridge install.sh's repo-relative path expectations. Final image is compressed qcow2 ready for UTM/QEMU.
- **Build script tests:** 37 new tests in `test_build_image.py` covering script existence, permissions, shebang, strict mode, root guard, required tool checks, repo file verification, architecture support, download/resize/strip/install pipeline, argument parsing (--help exits 0, unknown flags exit 1), output path construction, safety (no hardcoded keys, operates on copy not base, growpart+resize2fs), and repo file presence.
- **Test count:** 420 total (330 Python + 90 Flutter), all passing.
- **Connect Tools onboarding implemented:** `onboarding.dart` now has a third step after account creation showing Gmail/GitHub connection status with Connect buttons. Backend generates Nango OAuth URLs via `/api/tools/connect/{provider}`.

### Implementation Notes (2026-03-30) - Batch 14

- **Connect Tools onboarding implemented (SCOPE.md Feature 2):** New `agent/nango.py` with `NangoManager` class wraps Nango API for connection status checks (`GET /connection/{connectionId}`) and OAuth session creation (`POST /connect/sessions`). Two new API endpoints: `GET /api/tools/status` returns all tool connection states, `GET /api/tools/connect/{provider}` returns an OAuth URL. Flutter `onboarding.dart` now has a three-step flow: create account -> connect tools -> enter shell. Connect Tools step shows Gmail/GitHub with green/grey status indicators and Connect buttons. Gracefully degrades when Nango is not configured (shows message about setting NANGO_SECRET_KEY).
- **Real-time tool status in StatusBar:** `main.dart` now polls `/api/tools/status` every 10 seconds (alongside existing system state polling) and feeds real `ConnectedTool` data into the `StatusBar` widget. Previously hardcoded `connected: false` for both tools.
- **Test count:** 455 total (355 Python + 100 Flutter), all passing.
- **Remaining gaps:** VM testing needed for Tasks 19, 21, 22 boot flow. Writing tool connector not implemented.

### Implementation Notes (2026-03-31) - Batch 15

- **See Agents dashboard implemented (SCOPE.md Feature 3):** `agent/activity_store.py` with ActivityStore class tracks every agent run in SQLite (start time, finish time, status, tool calls count, approvals count, summary). Three new API endpoints: GET /api/agents returns all agents with metadata and stats, GET /api/agents/{name} returns detail with recent activity, GET /api/agents/activity returns global activity feed. Activity tracking wired into both run_sync and stream_sync in AgentRunner. Flutter `agents_dashboard.dart` renders agents as visual entity cards (not table rows) with real-time status indicators (idle/working), tool count, run count, and clickable detail views with tool listing, stats, and activity history. StatusBar has new "Agents" button that toggles the dashboard. All four agents now have description fields.
- **Test count:** 517 total (400 Python + 117 Flutter), all passing.
- **Remaining gaps:** VM testing needed for Tasks 19, 21, 22 boot flow. User-created agents (SCOPE.md mentions "configured through conversation") not implemented.

### Implementation Notes (2026-03-31) - Batch 16

- **Writing Agent implemented (SCOPE.md Feature 2 - Writing tool):** `agent/agents/writing.py` with WritingAgent class - 5 tools (list_documents, read_document, create_document, edit_document, search_documents). Uses Nango Google Docs integration for OAuth and API access. create_document and edit_document require user approval. Registered in runner alongside email, code, planning, and general agents.
- **Google Docs provider added to Nango:** `agent/nango.py` now includes google-docs provider with config_key, connection_id (NANGO_GDOCS_CONNECTION_ID env var), and display_name. Connection status and OAuth session creation work for all three providers.
- **Writing routing rules added:** `agent/router.py` now routes writing-specific intents (document, doc, article, blog, essay, report, memo, notes, summarize, rewrite, proofread, google doc) to the writing agent with CHAT UI pattern. Rule is placed before the code-write rule so "write a document" routes to writing while "write a function" still routes to code.
- **Onboarding updated for three tools:** `shell/lib/ui/onboarding.dart` Connect Tools step now shows Gmail, GitHub, and Google Docs with appropriate icons (description_outlined for docs). Fallback tool list includes all three providers. OAuth dialog handles google-docs provider name.
- **Test count:** 551 total (434 Python + 117 Flutter), all passing.

### Implementation Notes (2026-03-31) - Batch 17

- **User-created agents implemented (SCOPE.md Feature 3):** `agent/custom_agent_store.py` with CustomAgentStore class persists user-defined agent configurations in SQLite (name, description, system_prompt, tool_sets, approval_tools, ui_pattern, suggestions). `agent/agents/custom.py` with CustomAgent class extends BaseAgent - borrows tool definitions and implementations from built-in agents (email, code, writing) based on user's tool_sets selection. Approval sets are merged (inherited from built-in agents + custom overrides). Three new API endpoints: POST /api/agents/custom (create with validation for reserved names, invalid tool sets, invalid UI patterns), PUT /api/agents/custom/{name} (update), DELETE /api/agents/custom/{name} (delete). GET /api/agents and GET /api/agents/{name} now include `custom: true/false` flag. AgentRunner loads custom agents from SQLite on startup and supports dynamic register/update/unregister. Router detects "create/make/set up/configure an agent/bot/assistant" intents (placed before email rules to avoid false matches). Flutter `agents_dashboard.dart` updated with "Create Agent" card in the grid, creation dialog with name/description/instructions fields, tool set selection (email/code/writing), UI pattern selection, and validation. Detail view shows "Custom" badge and delete button for user-created agents.
- **Test count:** 612 total (488 Python + 124 Flutter), all passing.
- **Remaining gaps:** VM testing needed for Tasks 19, 21, 22 boot flow. Keystroke collection pipeline not implemented. Voice input not implemented.

### Implementation Notes (2026-03-31) - Batch 18

- **Scheduled agent execution implemented (SCOPE.md Feature 3 - autonomous background agents):** `agent/scheduler.py` with ScheduleStore (SQLite-backed persistence for schedule configs) and AgentScheduler (background daemon thread that polls for due schedules and executes them via the runner). Two schedule types: interval (every N minutes) and daily (at HH:MM). ScheduleStore tracks id, agent_name, intent, schedule_type, interval_minutes, daily_time, enabled, last_run_at, next_run_at timestamps. AgentScheduler runs a polling thread that checks list_due() and dispatches to runner.run_sync(). Execution results logged in-memory (capped at 100 entries). No external dependencies (no APScheduler/Celery) - pure threading + SQLite.
- **Schedule API endpoints:** 8 new endpoints under /api/schedules: GET (list, with optional agent_name filter), GET /{id}, POST (create with agent/type validation), PUT /{id} (partial update), DELETE /{id}, POST /{id}/toggle, GET /status (scheduler running state + counts). Create validates agent exists, schedule_type is valid, interval >= 1 minute.
- **Flutter schedule UI:** AgentSchedule data model in agent_client.dart with scheduleLabel computed property (formats "Every 30 min", "Every hour", "Daily at 09:00"). AgentsDashboard shows schedule indicator on agent cards (clock icon + label for agents with enabled schedules). Agent detail view has full Schedules section with Add Schedule button, schedule rows showing intent + frequency + toggle/delete controls. \_CreateScheduleDialog provides intent field, interval/daily type toggle, and interval/time preset chips.
- **Flutter AgentClient schedule methods:** listSchedules(), createSchedule(), deleteSchedule(), toggleSchedule(), schedulerStatus() - all wired to the backend API.
- **Test count:** 671 total (539 Python + 132 Flutter), all passing.
- **Remaining gaps:** VM testing needed for Tasks 19, 21, 22 boot flow. Keystroke collection pipeline not implemented. Voice input not implemented.

### Implementation Notes (2026-03-31) - Batch 19

- **Keystroke collection pipeline implemented (SCOPE.md - OS-level interaction capture for personalization):** `agent/keystroke_store.py` with KeystrokeStore class - SQLite-backed store for raw keystroke events. Two tables: `keystroke_events` (id, event_type, key_code, timestamp, context, modifiers, session_id) and `keystroke_hourly_agg` (pre-computed hourly aggregates for fast dashboard queries). Batch ingest with MAX_BATCH_SIZE=1000 cap, INSERT OR IGNORE for dedup, indexed on timestamp/context/session. Summary endpoint computes events_per_minute, peak_hour, top_contexts, active_days for the personalization engine. Auto-prune with configurable retention (default 30 days). Privacy-first: clear_all endpoint for full data wipe.
- **Keystroke collector daemon:** `agent/keystroke_collector.py` with KeystrokeCollector class - threaded daemon that reads from Linux evdev devices (/dev/input/event\*), filters sensitive contexts (password fields, auth screens, sudo, gpg, ssh-askpass), batches events every 5 seconds, and writes to KeystrokeStore. Sway IPC integration for active window context (swaymsg -t get_tree). Modifier key tracking (ctrl, shift, alt, meta). On non-Linux (macOS dev), runs in mock mode - no evdev, but the queue/flush/ingest pipeline is fully functional for testing. Entry point: `python -m agent.keystroke_collector`.
- **Keystroke API endpoints:** 7 new endpoints under /api/keystrokes: POST /ingest (batch insert from collector), GET /summary (personalization aggregates with configurable days param), GET /events (filtered query with since/until/context/session_id/limit), GET /count (event count with time range), GET /hourly (pre-computed hourly aggregates), POST /prune (retention-based cleanup), DELETE / (privacy reset - clear all data).
- **Sensitive context filtering:** 12 sensitive keywords (password, passwd, secret, credential, keychain, unlock, sudo, login, auth, gpg, ssh-askpass, pinentry) checked case-insensitively against the active window title. Events from sensitive contexts are dropped at the collector level before they ever reach the store.
- **OS integration:** `os/monet-keystroke.service` systemd unit runs alongside monet-agent.service. User=monet, Group=input for /dev/input/\* access. Same security hardening as the agent service (NoNewPrivileges, ProtectSystem=strict, PrivateTmp). `os/install.sh` updated to install and enable both services. `agent/requirements.txt` adds evdev>=1.7.0 (Linux-only conditional).
- **Test count:** 741 total (609 Python + 132 Flutter), all passing.
- **Remaining gaps:** VM testing needed for Tasks 19, 21, 22 boot flow. Voice input not implemented.

---

## Architecture Notes

| Layer           | Choice                              | Status                                                                         |
| --------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| Base OS         | Debian 12 aarch64 (stripped)        | Scripts ready (needs VM test)                                                  |
| Compositor      | Sway                                | Config ready (needs VM test)                                                   |
| Shell UI        | Flutter (native Wayland client)     | Implemented                                                                    |
| Agent backend   | Python + FastAPI                    | Implemented (6 agents: email, code, planning, general, writing + user-created) |
| Agent framework | Claude Agent SDK                    | Implemented                                                                    |
| Integrations    | Nango (managed OAuth, Gmail/GitHub) | Implemented                                                                    |
| State           | SQLite                              | Implemented                                                                    |
| IPC             | Unix socket / HTTP localhost        | Implemented                                                                    |
| Keystroke       | evdev + SQLite pipeline             | Implemented (collector daemon + store + API)                                   |

## Known Discrepancies

- `plan.md` and `research/architecture-research.md` recommend Composio + Tauri/React. The newer MVP plan (`docs/plans/2026-03-29-monet-mvp.md`) chose **Nango + Flutter**. The MVP plan is authoritative.
- `plan.md` mentions Composio as integration layer; MVP plan uses Nango throughout.
- Research doc recommends AG-UI protocol; MVP plan uses simple NDJSON streaming. AG-UI could be added later.
- Planning agent (`agent/agents/planning.py`) is implemented with 5 tools; no detailed task spec exists in the MVP plan but the implementation covers core whiteboard node operations.
