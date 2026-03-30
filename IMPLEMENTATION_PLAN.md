# Monet Implementation Plan

> Prioritized checklist of everything needed for a bootable Debian-based OS with Flutter shell,
> AI agents (Claude Agent SDK + Nango), 4 dynamic UI patterns, and approval gates.
>
> Source of truth: `docs/plans/2026-03-29-monet-mvp.md`
> Status: **Phase 2 complete - Flutter shell with all 4 UI patterns, agent client, intent bar, status bar, and 103 passing tests (72 Python + 31 Flutter).**

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
- [ ] Session create/resume in SQLite

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
- [ ] Inline approve/edit/reject

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
- [ ] Animated transitions between patterns

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

- [ ] OAuth expired -> prompt to reconnect
- [ ] Agent fails -> error card with retry
- [ ] Network down -> queue actions, send when back

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
- [ ] Planning agent (agent/agents/planning.py - not yet spec'd in detail)

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
| State           | SQLite                              | Not started |
| IPC             | Unix socket / HTTP localhost        | Not started |

## Known Discrepancies

- `plan.md` and `research/architecture-research.md` recommend Composio + Tauri/React. The newer MVP plan (`docs/plans/2026-03-29-monet-mvp.md`) chose **Nango + Flutter**. The MVP plan is authoritative.
- `plan.md` mentions Composio as integration layer; MVP plan uses Nango throughout.
- Research doc recommends AG-UI protocol; MVP plan uses simple NDJSON streaming. AG-UI could be added later.
- Planning agent (`agent/agents/planning.py`) is referenced in project structure but has no detailed task spec in the MVP plan.
