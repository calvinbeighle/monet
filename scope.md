# Monet - Agent Native Web App

## Objective
A web app that:
> takes intent - runs agents - generates the optimal UI - user approves - executes across connected tools

---

## Thesis

> Human work shifts to:
1. expressing intent
2. monitoring agent activity
3. making decisions / giving feedback

We are building the interface optimized for this new mode of work.

---

## Core Idea

> The system chooses the interface, not the user.

Not one UI (chat).
It dynamically renders the best format for the task.

---

## Stack

- **Frontend:** React + TypeScript + Tailwind + Framer Motion
- **Backend:** Python FastAPI
- **LLM:** OpenRouter (Gemini Flash for email, Claude Sonnet for everything else)
- **Integrations:** Composio (Gmail, GitHub, etc.)
- **Auth:** Composio OAuth for tool connections
- **Deployment:** Vercel (frontend) + Railway/Fly (backend)

---

## Core UI Patterns

### 1. Tinder (Batch Decisions)
Use when:
- many similar outputs

Examples:
- content ideas
- outbound messages
- email triage

UI:
- swipe right = approve
- swipe left = reject
- editable reply/action before approving

---

### 2. Figma Whiteboard (Exploration)
Use when:
- open-ended / creative / planning

Examples:
- product flows
- strategy maps

UI:
- canvas
- nodes + connections
- zoomable

---

### 3. iMessage (Conversation)
Use when:
- communication tasks

Examples:
- replies
- follow-ups

UI:
- chat thread
- inline suggestions
- approve/edit/send

---

### 4. Diff / Compare (Precision)
Use when:
- edits or selecting best option

Examples:
- code
- rewrites

UI:
- side-by-side
- highlight changes
- choose best

---

## Core Flows (v1 focus)

### 1. Email
- Connect: Gmail / Outlook
- Use cases:
  - draft replies
  - follow-ups
  - outbound sequences
- UI:
  - iMessage-style threads
  - quick approve/edit/send
  - batch handling via Tinder UI

---

### 2. Code
- Connect: GitHub
- Use cases:
  - generate code
  - review PRs
  - fix bugs
- UI:
  - diff / compare view
  - approve changes
  - apply + push

---

## Flow

1. User enters intent
2. Agents run (LLMs + tools)
3. System selects UI format
4. UI is rendered
5. User approves/rejects
6. Actions execute in connected tools

---

## Integrations

- Users connect tools (email, GitHub, etc.) via Composio OAuth
- Agents use these connections to:
  - send emails
  - push code
  - update external systems

---

## Key Principle

> UI is generated per task to minimize decision time

---

## Success Metric

- decisions in seconds
- minimal reading
- high approval rate

---

## One-line

> AI that builds the right interface so you can decide and act fast
