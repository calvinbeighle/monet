# Monet - Execution Plan

## What We're Building

A web app that looks and feels like DIA browser - clean command bar, contextual suggestions, minimal chrome. But underneath, background agents are constantly working: triaging your inbox, monitoring your PRs, scanning your calendar. When you open Monet, decisions are already staged and waiting for you.

**Core loop:**
1. Agents run in the background on a schedule (or on-demand)
2. They gather information, draft responses, flag urgent items
3. When you open the app, everything is pre-staged
4. You make decisions fast (approve/edit/skip) and move on

---

## Design: DIA-Inspired UI

### Main Screen (Command Bar + Suggestions)
```
+----------------------------------------------------------+
| [sidebar] |  [<] [>] [reload]          [Skills] [Prefs]  |
|           |                                               |
|           |                                               |
|           |               [Monet logo]                    |
|           |                                               |
|           |  +------------------------------------------+ |
|           |  | [search] Ask anything...           [mic] | |
|           |  +------------------------------------------+ |
|           |                                               |
|           |  [G] Review security alert - google.com       |
|           |  [M] 3 emails need replies - gmail            |
|           |  [GH] PR #47 ready for review - github        |
|           |  [Cal] Meeting prep for tomorrow - calendar   |
|           |                                               |
|           |  + Add tabs or files  ...                     |
+----------------------------------------------------------+
```

- **Command bar:** Single input for everything (like DIA/Spotlight)
- **Suggestions:** Pre-staged action items from background agents
- **Sidebar:** Running agents, connected accounts, history
- Each suggestion is clickable - opens the right UI pattern for that task

### Sidebar (Agent Monitor)
```
+------------------+
| AGENTS           |
|                  |
| * Email Agent    |
|   Running - 3min |
|   5 emails ready |
|                  |
| * Code Agent     |
|   Idle           |
|   Last: 2hr ago  |
|                  |
| * Planning Agent |
|   Idle           |
|                  |
| CONNECTIONS      |
|                  |
| [G] Gmail  [ok]  |
| [GH] GitHub [ok] |
| [+] Add more     |
|                  |
| HISTORY          |
|                  |
| Today            |
|  Triaged inbox   |
|  Reviewed PR #47 |
|                  |
+------------------+
```

### Decision Views (opened from suggestions)
When you click a suggestion, Monet opens the right UI:
- **Email triage** -> Tinder cards (swipe through emails with draft replies)
- **PR review** -> Diff view (side-by-side code changes)
- **Planning** -> Whiteboard (nodes and connections)
- **General question** -> Chat (conversational)

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | React + TypeScript + Vite | Fast, standard, huge ecosystem |
| Styling | Tailwind + Framer Motion | Utility CSS + smooth animations |
| State | Zustand | Simple, no boilerplate |
| Backend | Python FastAPI | Agent frameworks are Python-first |
| LLM | OpenRouter | Multi-model: Gemini Flash (cheap), Claude Sonnet (smart) |
| Integrations | Composio | Pre-built Gmail, GitHub, Calendar connectors |
| Database | SQLite (dev) / Postgres (prod) | Session storage, agent history |
| Deployment | Vercel (frontend) + Railway (backend) | Simple, cheap |

---

## Architecture

```
React Frontend (Vite)
    |
    | REST + SSE
    |
FastAPI Backend
    |
    +-- Agent Runner (background tasks)
    |     +-- Email Agent (Gemini Flash)
    |     +-- Code Agent (Claude Sonnet)
    |     +-- Planning Agent (Claude Sonnet)
    |
    +-- Intent Router (classify user input)
    |
    +-- Composio (Gmail, GitHub, Calendar OAuth)
    |
    +-- OpenRouter (LLM calls)
    |
    +-- SQLite/Postgres (sessions, history, staged decisions)
```

---

## Phases

### Phase 1 - DIA Clone Shell (Week 1)

**Goal:** Beautiful React app that looks like DIA. Command bar, sidebar, suggestions. No agents yet - just the UI.

- [ ] Scaffold React + Vite + TypeScript + Tailwind
- [ ] **Command bar** - centered input, focus on load, submit on Enter
- [ ] **Sidebar** - collapsible left panel with agents, connections, history sections
- [ ] **Suggestion cards** - below command bar, hardcoded for now
- [ ] **Top bar** - navigation arrows, Skills/Personalization buttons (cosmetic)
- [ ] **Dark theme** - DIA-style: near-black bg, subtle borders, violet accents
- [ ] **Animations** - Framer Motion for sidebar toggle, card hover, page transitions
- [ ] **Responsive** - works on desktop, tablet passable

### Phase 2 - Agent Backend (Week 2)

**Goal:** FastAPI backend with agents that actually run and produce staged decisions.

- [ ] FastAPI scaffold with CORS, SSE streaming, session management
- [ ] **Agent runner** - background task system that runs agents on schedule or on-demand
- [ ] **Email agent** (Gemini Flash) - fetches emails, drafts replies, stages as suggestions
- [ ] **Code agent** (Claude Sonnet) - checks PRs, writes reviews, stages as suggestions
- [ ] **Intent router** - classifies command bar input, picks agent + UI pattern
- [ ] **Staged decisions** - database table of pre-computed action items
- [ ] **SSE streaming** - real-time updates as agents work
- [ ] **API endpoints:**
  - POST /intent - submit command bar input
  - GET /suggestions - get pre-staged action items
  - GET /stream/{session_id} - SSE stream
  - POST /approve/{id} - approve a staged action
  - POST /reject/{id} - reject/skip
  - GET /agents - list agents with status
  - GET /connections - list connected services
  - POST /connect/{service} - initiate OAuth

### Phase 3 - Wire Frontend to Backend (Week 3)

**Goal:** Suggestions come from real agents. Clicking them opens the right UI pattern.

- [ ] Fetch /suggestions on load, render as suggestion cards
- [ ] Command bar submits to /intent, opens result in right pattern
- [ ] **Chat view** - streaming messages, tool call badges
- [ ] **Tinder view** - email cards with editable replies, approve/skip
- [ ] **Diff view** - side-by-side code with approve/reject
- [ ] **Whiteboard view** - draggable nodes for planning
- [ ] Sidebar shows live agent status from /agents
- [ ] Connection management from sidebar

### Phase 4 - Composio Integration (Week 4)

**Goal:** Real Gmail, GitHub, Calendar data.

- [ ] Composio OAuth flow for Gmail
- [ ] Composio OAuth flow for GitHub
- [ ] Email agent uses real Gmail data (slim responses, Gemini Flash)
- [ ] Code agent uses real GitHub data
- [ ] Background agent scheduler (run email agent every 15 min)
- [ ] Staged decisions persist across sessions

### Phase 5 - Polish + Deploy (Week 5)

- [ ] Onboarding flow (connect accounts on first visit)
- [ ] Agent scheduling UI (how often to check inbox, PRs)
- [ ] Notification badges on suggestions
- [ ] Keyboard shortcuts (Cmd+K for command bar, arrow keys for suggestions)
- [ ] Deploy frontend to Vercel
- [ ] Deploy backend to Railway
- [ ] Custom domain

---

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| DIA-style UI | Single command bar + contextual suggestions is the best UX for agent-driven workflows. Users don't navigate - they decide. |
| Background agents | The killer feature. When you open Monet, work is already done. You just approve/edit/skip. |
| Staged decisions | Agents pre-compute action items and store them. The UI pulls from this cache, not from live agent runs. Fast. |
| Gemini Flash for email | Email triage is high-volume, low-complexity. $0.0003 per call vs $1.24 for Sonnet. |
| Claude Sonnet for code | Code review needs reasoning quality. Worth the cost. |
| Composio for integrations | Pre-built OAuth + API wrappers. Don't reinvent Gmail/GitHub auth. |

---

## Success Criteria

- Open Monet -> see 5+ pre-staged action items immediately (no loading)
- Click "3 emails need replies" -> tinder cards with drafts pre-filled
- Swipe through 5 emails in 30 seconds
- Click "PR ready for review" -> diff view with agent's review inline
- Total time from open to "inbox zero": under 2 minutes
