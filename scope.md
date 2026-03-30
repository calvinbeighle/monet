# Monet - Agent Native OS

## Objective
Fork an open-source desktop OS and replace the interaction layer with an agent-native interface that:
> takes intent - runs agents - generates the optimal UI - user approves - executes across connected tools

---

## Starting Point

Fork an existing open-source desktop OS (e.g. a Linux distro) and run it in a VM for development and testing. The base OS provides the kernel, drivers, filesystem, networking, and process management. We replace the desktop shell and application layer with our agent-native UI.

---

## Thesis

> Human work shifts to:
1. expressing intent
2. monitoring agent activity
3. making decisions / giving feedback

We are building the OS optimized for this new mode of work.

---

## Core Idea

> The system chooses the interface, not the user.

Not one UI (chat).
It dynamically renders the best format for the task.

---

## Core UI Patterns

### 1. Tinder (Batch Decisions)
Use when:
- many similar outputs

Examples:
- content ideas
- outbound messages

UI:
- swipe right = approve
- swipe left = reject

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

## Integrations (light)

- Users connect tools (email, GitHub, etc.)
- Handled via an integration layer (e.g. Nango)
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

> An OS where AI builds the right interface so you can decide and act fast
