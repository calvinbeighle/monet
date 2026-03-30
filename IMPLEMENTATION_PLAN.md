# Monet Implementation Plan

> Prioritized checklist of everything needed for a bootable Debian-based OS with Flutter shell,
> AI agents (Claude Agent SDK + Nango), 4 dynamic UI patterns, and approval gates.
>
> Source of truth: `docs/plans/2026-03-29-monet-mvp.md`
> Status: **Phase 1 complete, Phase 2 complete - 153 passing tests (111 Python + 42 Flutter).**

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
- [ ] Syntax highlighting
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

---

## Phase 3 - End-to-End Flows (MEDIUM PRIORITY)

Full flows: intent -> agent -> UI -> approve -> execute.

### Task 13: Email Flow - Single Reply

- [ ] "Reply to John's email" -> Chat UI
- [ ] Agent reads email via Nango, drafts reply
- [ ] Reply appears as suggestion bubble
- [ ] Approve -> sends via Nango Gmail API

### Task 14: Email Flow - Batch Inbox

- [ ] "Handle my inbox" -> Tinder UI
- [ ] Cards stream in as agent drafts replies
- [ ] Swipe approve/reject
- [ ] Approved ones send, rejected skip

### Task 15: Code Flow - PR Review

- [ ] "Review the open PR" -> Diff UI
- [ ] Agent reads diff via Nango GitHub, writes review
- [ ] Diff + inline comments displayed
- [ ] Approve -> posts review to GitHub

### Task 16: Planning Flow

- [ ] "Plan the next sprint" -> Whiteboard UI
- [ ] Agent generates task nodes on canvas
- [ ] User rearranges, connects, prioritizes
- [ ] Tap node -> expand into subtasks

### Task 17: Cross-Pattern Flow

- [ ] Multi-step intents decompose across patterns
- [ ] Example: Whiteboard -> Tinder -> Chat
- [ ] State carries forward between patterns
- [ ] Smooth animated transitions

### Task 18: Error Handling

- [x] OAuth expired -> prompt to reconnect (implemented: runner detects 401/403/unauthorized in tool execution errors, emits oauth_expired error event, Flutter shell renders error card)
- [x] Agent fails -> error card with retry (implemented: runner catches all Anthropic API errors, Flutter shell renders error cards with retry button for retryable errors)
- [x] Network down -> error card with retry (full offline queue deferred to Phase 5)

---

## Phase 4 - Make It an OS (LOWER PRIORITY)

Debian VM boots directly into Monet.

### Task 19: Debian VM Setup

- [ ] Create `os/strip.sh` - remove GNOME, GDM, desktop apps; keep kernel, systemd, apt, NetworkManager, PipeWire
- [ ] Create `os/install.sh` - install Sway, compile Flutter shell for aarch64, deploy agent backend
- [ ] Create `os/sway.config` - launch Flutter shell fullscreen, no decorations, no bar
- [ ] Create `os/monet-agent.service` - systemd unit for agent backend
- [ ] Auto-login user
- [ ] Boot flow: power on -> Debian -> auto-login -> Sway -> Monet shell fullscreen

### Task 20: First-Boot Onboarding and Login

- [ ] Create `agent/auth.py` - SQLite user store with bcrypt/pbkdf2 password hashing
- [ ] Create `agent/tests/test_auth.py`
- [ ] Create `shell/lib/ui/onboarding.dart` - first-boot: create user + connect tools
- [ ] Lock screen on subsequent boots
- [ ] Session persistence until explicit logout
- [ ] Auth API routes in FastAPI

### Task 21: System Integration

- [ ] WiFi management via NetworkManager DBus API
- [ ] Volume/brightness controls
- [ ] Shutdown/restart from shell
- [ ] Plymouth boot splash with Monet branding
- [ ] Suppress kernel messages (quiet boot)

### Task 22: Image Build Script

- [ ] Create `os/build-image.sh` - stock Debian ISO -> custom Monet .qcow2
- [ ] Automated: strip, install deps, copy Monet, configure boot
- [ ] Test on fresh UTM instance

---

## Phase 5 - Polish (FUTURE)

- [ ] Keystroke collection pipeline (OS-level capture -> SQLite -> personalization)
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
- **Test count:** 174 total (129 Python + 45 Flutter), all passing.

---

## Architecture Notes

| Layer           | Choice                              | Status      |
| --------------- | ----------------------------------- | ----------- |
| Base OS         | Debian 12 aarch64 (stripped)        | Not started |
| Compositor      | Sway                                | Not started |
| Shell UI        | Flutter (native Wayland client)     | Implemented |
| Agent backend   | Python + FastAPI                    | Implemented |
| Agent framework | Claude Agent SDK                    | Implemented |
| Integrations    | Nango (managed OAuth, Gmail/GitHub) | Implemented |
| State           | SQLite                              | Implemented |
| IPC             | Unix socket / HTTP localhost        | Implemented |

## Known Discrepancies

- `plan.md` and `research/architecture-research.md` recommend Composio + Tauri/React. The newer MVP plan (`docs/plans/2026-03-29-monet-mvp.md`) chose **Nango + Flutter**. The MVP plan is authoritative.
- `plan.md` mentions Composio as integration layer; MVP plan uses Nango throughout.
- Research doc recommends AG-UI protocol; MVP plan uses simple NDJSON streaming. AG-UI could be added later.
- Planning agent (`agent/agents/planning.py`) is implemented with 5 tools; no detailed task spec exists in the MVP plan but the implementation covers core whiteboard node operations.
