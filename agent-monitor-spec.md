# Agent Monitor - Design Spec

## Core Principle
**Visual over text in every way possible.** No walls of text. Use progress bars, status dots, icons, color coding, timelines, and spatial layout to communicate state at a glance.

---

## Sidebar View (Compact - Always Visible)

```
+----------------------------+
| AGENTS                     |
|                            |
| [====>    ] Email Agent    |
|  Step 3/5  *drafting*      |
|  [3] decisions ready       |
|                            |
| [==========] Code Agent    |
|  Done  *2hr ago*           |
|                            |
| [          ] Planning      |
|  Idle                      |
+----------------------------+
```

Visual elements per agent:
- **Progress bar** (thin, colored): shows current step / total steps
  - Violet while running, green when done, red on error, gray when idle
  - Animated shimmer while actively working
- **Status dot**: pulsing green (running), solid gray (idle), red (error)
- **Decision badge**: red circle with count (like iOS notification badge)
- **Current action**: 2-3 word label, NOT a sentence ("drafting reply", "reading PR")
- **Time**: relative ("2min ago", "running 45s")

No paragraphs. No sentences. Just visual indicators + short labels.

---

## Full Monitor View

### Layout: Timeline + Decision Cards

NOT three text tabs. Instead:

```
+----------------------------------------------------------+
|                                                            |
|  [TIMELINE]                    [DECISION CARDS]            |
|                                                            |
|  14:07 *------*                +--------------------+      |
|        | Email |               | Reply to Marcus    |      |
|        | Agent |               | [urgent]           |      |
|  14:05 |  o Read inbox         |                    |      |
|        |  o Analyze 5 msgs     | "Hi Marcus, re:    |      |
|  14:03 |  * Draft reply 1      |  pricing..."       |      |
|        |  * Draft reply 2      |                    |      |
|  14:02 |  o Draft reply 3      | [Edit] [Send] [Skip]     |
|        *------*                +--------------------+      |
|                                                            |
|  13:45 *------*                +--------------------+      |
|        | Code |                | Review PR #47      |      |
|        | Agent |               | [normal]           |      |
|  13:44 |  o Check PRs          |                    |      |
|        |  o Read diff          | 2 issues found     |      |
|  13:43 |  o Write review       | +14 -3 lines       |      |
|        *------*                |                    |      |
|                                | [View Diff] [Skip] |      |
|                                +--------------------+      |
+----------------------------------------------------------+
```

### Left Side: Visual Timeline
- Vertical timeline with time markers
- Each agent run is a segment with dots for each step
- **Filled dot** = completed step
- **Pulsing dot** = current step
- **Empty dot** = pending step
- Color matches agent (violet for email, blue for code, green for planning)
- Hover a dot to see detail tooltip
- Animated: new steps slide in from bottom

### Right Side: Decision Cards
- Stacked cards for pending decisions
- Each card shows:
  - **Color bar** on left edge (red = urgent, yellow = normal, gray = low)
  - **Icon** for the source (Gmail, GitHub, Calendar)
  - **Title** (bold, short)
  - **Preview** (1-2 lines max, truncated)
  - **Action buttons** inline: primary action (Send/Approve) + Skip
- Cards are the SAME cards used in the tinder view - consistent design
- Clicking a card can expand it or open the full decision view
- Badge count at top: "3 decisions waiting"

### Visual Status Bar (Top of Monitor)
```
[Email: ====>    3/5 steps] [Code: done] [Planning: idle]   [3 pending]
```
- Horizontal bar showing all agents at a glance
- Mini progress indicators
- Total pending decisions count

---

## Decision Card Design (Visual-First)

```
+------------------------------------------+
| [red bar]  [Gmail icon]                  |
|                                          |
|  Reply to Marcus Obi                     |
|  "Enterprise pricing follow-up"          |
|                                          |
|  +------------------------------------+  |
|  | Hi Marcus, thanks for the          |  |
|  | breakdown. Let me get back to      |  |
|  | you on the per-seat pricing...     |  |
|  +------------------------------------+  |
|                                          |
|  [Skip]              [Edit & Send ->]    |
+------------------------------------------+
```

- Left color bar = priority (red/yellow/green)
- Source icon with brand color
- Title is the action, not a description
- Preview box shows the draft (editable on click)
- Two buttons max. Primary action on the right.
- No "Are you sure?" modals. One click = done.

---

## Visual Activity Indicators (Instead of Text Logs)

Instead of "Reading inbox (5 most recent)" as text, show:

```
[Gmail icon] ---> [inbox icon: 5 items] ---> [filter icon: 3 actionable]
```

Instead of "Drafting reply to Marcus about pricing", show:

```
[Marcus avatar/initial] --> [draft icon with shimmer animation]
```

Use ICONS and FLOW ARROWS to show what the agent is doing.
Minimize text to labels only: "drafting", "reading", "reviewing"

---

## Backend: Structured Activity Events

Each agent step emits:
```json
{
  "agent_id": "email",
  "step": 3,
  "total_steps": 5,
  "action": "draft_reply",
  "label": "drafting",
  "icon": "edit",
  "target": "Marcus Obi",
  "target_icon": "gmail",
  "progress": 0.6,
  "timestamp": "2026-03-30T14:07:23Z"
}
```

The frontend renders this visually - never as a text paragraph.

---

## API Additions

- GET /activity - last 50 activity events (for timeline)
- GET /activity/stream - SSE real-time activity feed
- GET /decisions - pending decision cards
- POST /decisions/{id}/approve - approve with optional edit
- POST /decisions/{id}/skip - skip/dismiss
- GET /agents/status - all agents with progress bars

---

## Key Rules
1. If it can be a progress bar, make it a progress bar
2. If it can be an icon, don't use text
3. If it can be a color, don't use a label
4. Max 5 words per line in the monitor
5. Decisions should take 1 click, not 3
6. The monitor should be glanceable in under 2 seconds
