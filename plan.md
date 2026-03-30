# Monet - Execution Plan

## What We're Building

An OS where you type what you want, agents do the work, and the system shows you results in the fastest possible UI for that task. You approve or reject. Done.

The OS is Debian with the default desktop stripped out and replaced with ours.

---

## What Actually Matters

1. **Agents that work** - connect to your email, GitHub, etc. and actually do useful things
2. **UI that gets fast decisions** - show results in the right format, get a yes/no, execute

Everything else (compositor, boot flow, packaging) is just plumbing we handle along the way.

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Base | Debian (stripped) | Stable, massive ecosystem, proven forkable |
| Compositor | Sway (off the shelf) | Works, don't build what we don't need |
| Shell UI | Flutter | Compiles native, great animations/gestures (Tinder swipes), canvas (whiteboard), runs as Wayland client. Not a web app in a browser. |
| Agent backend | Python + FastAPI | Claude Agent SDK is Python-first. Runs as systemd service. |
| Agent framework | Claude Agent SDK | Production loop, approval hooks, MCP, subagents |
| Integrations | Composio | MCP-native, pre-built Gmail/GitHub, managed OAuth |
| State | SQLite | Local, simple, no server |
| IPC | Unix socket / HTTP localhost | Shell <-> agent backend |

### Why Flutter for the shell

- Compiles to native ARM64 binary - no browser, no JS runtime, no Electron
- Built-in gesture system (swipe, drag, pinch) - critical for Tinder UI
- `CustomPaint` + canvas API - can build the whiteboard
- Rich animation framework - smooth transitions between UI patterns
- Hot reload - fast iteration during development
- Runs as a native Wayland client via `flutter-wayland`
- Single codebase can also target mobile later (approve from phone)

---

## Architecture

```
+------------------------------------------+
|              MONET OS                     |
|                                          |
|  Debian (stripped) + Linux kernel         |
|  Sway (Wayland compositor)               |
|                                          |
|  +------------------------------------+  |
|  |     Monet Shell (Flutter, native)  |  |
|  |                                    |  |
|  |  [Intent Bar] - always visible     |  |
|  |                                    |  |
|  |  [UI Pattern Renderer]            |  |
|  |    - Tinder (swipe cards)         |  |
|  |    - Whiteboard (canvas)          |  |
|  |    - Chat (iMessage-style)        |  |
|  |    - Diff (side-by-side)          |  |
|  |                                    |  |
|  |  [Status Bar] - connections,      |  |
|  |    running agents, notifications  |  |
|  +------------------------------------+  |
|           | Unix socket / HTTP           |
|  +------------------------------------+  |
|  |     Agent Backend (Python)         |  |
|  |                                    |  |
|  |  [Intent Router]                  |  |
|  |    - classify intent              |  |
|  |    - pick agent + UI pattern      |  |
|  |                                    |  |
|  |  [Agent Runner] Claude SDK        |  |
|  |    - Email Agent (subagent)       |  |
|  |    - Code Agent (subagent)        |  |
|  |    - Planning Agent (subagent)    |  |
|  |                                    |  |
|  |  [Approval Gate]                  |  |
|  |    - PreToolUse hook              |  |
|  |    - pause, show user, wait       |  |
|  |                                    |  |
|  |  [Tool Executor]                  |  |
|  |    - MCP -> Composio              |  |
|  |    - Gmail, GitHub, etc.          |  |
|  +------------------------------------+  |
+------------------------------------------+
```

---

## Phases

### Phase 1 - Agent Backend (Weeks 1-2)

**Goal:** Agents work. Type an intent in a terminal, agents do the thing. No UI yet.

- [ ] **Claude Agent SDK setup**
  - Basic agent loop: receive intent string, process, return structured result
  - Streaming output (tokens + events)
  - Session create/resume in SQLite
- [ ] **Intent router**
  - Takes natural language, returns `{ agent: "email"|"code"|"planning", ui_pattern: "tinder"|"whiteboard"|"chat"|"diff" }`
  - Start simple: keyword matching + Claude Haiku fallback
  - Upgrade to semantic similarity later
- [ ] **Email agent**
  - Composio MCP for Gmail
  - Tools: list inbox, read email, draft reply, send email
  - System prompt: "You are an email assistant..."
  - PreToolUse hook on `send_email` - returns pending approval instead of executing
  - Test: "handle my inbox" -> agent reads emails, drafts replies, returns list of `{ email, draft_reply, status: "pending_approval" }`
- [ ] **Code agent**
  - Composio MCP for GitHub
  - Tools: list PRs, read diff, post review, approve PR
  - PreToolUse hook on destructive actions (merge, approve, push)
  - Test: "review my PRs" -> agent reads PRs, writes reviews, returns list of `{ pr, review, status: "pending_approval" }`
- [ ] **Approval flow**
  - Agent pauses at approval gate
  - Returns structured data to caller (UI or terminal)
  - Caller sends approve/reject
  - Agent resumes or skips
- [ ] **CLI test harness**
  - Simple CLI that calls the agent backend
  - Verify everything works before building any UI
  - `python cli.py "handle my inbox"` -> see drafts -> type `approve 1,2,3` -> emails send

**Deliverable:** Working agents you can talk to from the command line. Email drafts, PR reviews, approvals - all functional.

---

### Phase 2 - Shell UI (Weeks 3-5)

**Goal:** Flutter shell with all 4 UI patterns. Runs on your Mac for now (not in VM yet).

- [ ] **Flutter project setup**
  - Desktop app targeting Linux + macOS (dev on Mac, deploy to Debian)
  - State management (Riverpod or Bloc)
  - Connect to agent backend via HTTP/WebSocket
- [ ] **Intent bar**
  - Persistent input field, always accessible
  - Keyboard shortcut to focus (Cmd/Ctrl+K or similar)
  - Shows "thinking..." while agent processes
  - Autocomplete/suggestions based on connected tools
- [ ] **Tinder UI pattern**
  - Swipeable card stack (Flutter's gesture system)
  - Each card: summary of item + agent's recommendation
  - Swipe right = approve, left = reject, up = edit/expand
  - Progress counter ("3 of 12")
  - Undo button
  - Smooth spring physics on swipe
- [ ] **Chat UI pattern (iMessage)**
  - Threaded conversation view
  - Agent messages stream in with typing indicator
  - User can approve/edit/reject inline
  - Reply suggestions as tappable bubbles
- [ ] **Diff UI pattern**
  - Side-by-side text comparison
  - Syntax highlighting (use a Flutter code editor package)
  - Line-level approve/reject
  - "Apply all" / "Reject all" buttons
- [ ] **Whiteboard UI pattern**
  - Zoomable/pannable canvas
  - Agent places nodes (text boxes, cards)
  - User can drag, connect, rearrange
  - Tap node to expand/act on it
- [ ] **Pattern switching**
  - Agent response includes `ui_pattern` field
  - Shell animates transition to the right pattern
  - All patterns pre-initialized on app start for instant switching
- [ ] **Status bar**
  - Connected accounts (Gmail, GitHub icons)
  - Running agent indicator
  - Notification badges

**Deliverable:** A Flutter desktop app that renders all 4 UI patterns, connected to the agent backend. Test on Mac.

---

### Phase 3 - Wire It Together (Weeks 6-7)

**Goal:** Full flows work end-to-end. Intent -> agent -> UI -> approve -> execute.

- [ ] **Email flow: single reply**
  - "Reply to John's email" -> Chat UI
  - Agent reads the email, drafts reply
  - Reply appears as suggestion bubble
  - User taps approve -> email sends
- [ ] **Email flow: batch inbox**
  - "Handle my inbox" -> Tinder UI
  - Cards stream in as agent drafts replies
  - Swipe through them
  - Approved ones send, rejected ones skip
- [ ] **Code flow: PR review**
  - "Review the open PR on monet" -> Diff UI
  - Agent reads diff, writes review
  - User sees diff + inline comments
  - Approve -> review posts to GitHub
- [ ] **Planning flow**
  - "Plan the next sprint" -> Whiteboard UI
  - Agent generates task nodes on canvas
  - User rearranges, prioritizes
  - Tap a task -> expands into subtasks
- [ ] **Cross-pattern flow**
  - "Brainstorm marketing ideas and draft emails for the best ones"
  - Whiteboard -> Tinder (pick best) -> Chat (draft emails)
  - Smooth transitions between patterns
- [ ] **Error handling**
  - OAuth expired -> prompt to reconnect
  - Agent fails -> show error, offer retry
  - Network down -> queue actions, send when back

**Deliverable:** Every core flow works end to end. You can handle email, review PRs, and plan - all from the shell.

---

### Phase 4 - Make It an OS (Weeks 8-9)

**Goal:** Debian VM boots directly into Monet.

- [ ] **Debian VM setup**
  - Debian 12 aarch64 minimal install in UTM
  - No desktop environment
  - Install Sway, configure auto-start
- [ ] **Strip Debian**
  - Remove: GNOME, GDM, desktop apps, games, office suite
  - Keep: kernel, systemd, apt, NetworkManager, PipeWire, firmware
  - Script it: `os/strip.sh`
- [ ] **Install Monet**
  - Compile Flutter shell for Linux aarch64
  - Deploy agent backend as systemd service
  - Sway config: launch Flutter shell fullscreen, no decorations, no bar
  - Auto-login user
  - Script it: `os/install.sh`
- [ ] **Boot flow**
  ```
  Power on -> Debian boots -> auto-login -> Sway starts -> Monet shell (fullscreen) -> Intent bar ready
  ```
- [ ] **System integration**
  - WiFi management (from within Monet shell via NetworkManager DBus API)
  - Volume/brightness controls
  - Shutdown/restart from shell
  - Boot splash (Plymouth theme with Monet branding)
- [ ] **Image script**
  - `os/build-image.sh`: takes stock Debian ISO -> outputs custom Monet `.qcow2`
  - Automated: strip, install deps, copy Monet, configure boot
  - Run it again anytime to get a fresh image

**Deliverable:** A VM image that boots into Monet. No traditional desktop anywhere. Just the agent shell.

---

### Phase 5 - Polish (Weeks 10+)

- [ ] Onboarding flow (first boot: connect Gmail, GitHub)
- [ ] Dark/light theme
- [ ] Animation polish on pattern transitions
- [ ] More integrations (Slack, Calendar, Notion, Linear)
- [ ] Smarter intent routing (semantic embeddings, learn from usage)
- [ ] Prebuilt component responses (agent pre-generates common UI states)
- [ ] Voice input
- [ ] Mobile companion (approve from phone via Flutter - same codebase)

---

## Project Structure

```
monet/
  agent/                    # Python agent backend
    main.py                 # FastAPI server
    router.py               # Intent classification
    agents/
      email.py              # Email subagent
      code.py               # Code subagent
      planning.py           # Planning subagent
    approval.py             # Approval gate logic
    cli.py                  # CLI test harness
  shell/                    # Flutter desktop shell
    lib/
      main.dart
      ui/
        intent_bar.dart
        patterns/
          tinder.dart
          whiteboard.dart
          chat.dart
          diff.dart
        status_bar.dart
      services/
        agent_client.dart   # Talks to Python backend
        auth.dart           # OAuth flows
  os/                       # Debian customization
    strip.sh                # Remove desktop packages
    install.sh              # Install Monet on bare Debian
    build-image.sh          # Create VM image
    sway.config             # Sway config for Monet
    monet-agent.service     # systemd unit for agent backend
  scope.md
  plan.md
```

---

## Priority Order

The most important thing is **agents that work and UI that renders their output**. The OS packaging is last because it's the easiest part - it's just scripts.

1. Agents work from CLI (prove the concept)
2. UI renders agent output (prove the experience)
3. Full flows end to end (prove the product)
4. Package it as an OS (prove the vision)

---

## Success Criteria

- "Handle my inbox" -> swipe through email drafts -> approved ones send
- "Review my PRs" -> see diffs with agent commentary -> approve/reject
- "Plan next sprint" -> whiteboard of tasks appears -> rearrange and confirm
- Decisions in seconds, not minutes
- Boots from a VM image into the agent shell - no traditional desktop
