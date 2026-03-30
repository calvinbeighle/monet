# Monet

**A beautiful operating system for AI.**

Monet is a Linux-based operating system that makes AI accessible and delightful for non-technical people. Users log in, connect their tools, and interact with AI agents that handle email, coding, and writing -- all rendered in Monet's own visual language. No terminal. No typing commands. Just a computing environment where AI does the work and the user sees the results.

---

## Vision

The world's first operating system built around AI agents instead of applications. Where traditional OSes organize around files and apps, Monet organizes around agents and tools. The AI ingests data from connected services, re-presents it natively, and acts on the user's behalf.

Claude Code is the backend engine today. The architecture is model-agnostic from day one.

---

## Users

Non-technical knowledge workers. People who use email, write documents, and need code written -- but don't know what a terminal is and shouldn't have to.

---

## Architecture

### Kernel & Base

- Custom Linux distribution (minimal, purpose-built)
- Bootable USB image as first deliverable (testable via [UTM](https://mac.getutm.app/))
- Lightweight base -- strip everything that isn't needed for the agent runtime and UI layer
- No traditional desktop environment (no GNOME, no KDE) -- Monet IS the environment

### Backend (Agent Runtime)

- Model-agnostic agent orchestration layer
  - Claude (Anthropic) as default provider
  - Abstraction layer for swapping/adding models (OpenAI, Gemini, open-source)
- Agent execution engine running in the cloud with local sync
- Keystroke collection pipeline for user behavior modeling
  - Feeds into personalization: agents learn preferences, anticipate needs over time
- Tool integration framework (OAuth + API connectors)
- Keep it extremely lightweight -- minimal dependencies, fast boot, low resource footprint

### Frontend (The Environment)

- Full-screen native UI -- this IS the desktop
- Monet's own design language for all data (no embedded third-party UIs)
- Primary interaction: conversational UI with visual controls (buttons, cards, drag-and-drop)
- Voice input supported
- No raw text input required for any core flow

---

## MVP Scope (2-Week Demo Target: April 12, 2026)

Three features. Nothing else.

### 1. Login

**What it does:** User boots into Monet and authenticates.

- Lock screen on boot -- username and password, set during first-run setup
- Feels like logging into a computer, not a web app
- Session persistence (stay logged in until explicit logout or shutdown)
- Single-user for MVP (no teams/orgs)

**Out of scope for MVP:**

- Multi-user accounts on one device
- Biometrics / passkeys
- Account recovery

### 2. Connect Tools

**What it does:** User connects external services. Monet's AI ingests everything from the tool and re-presents it in Monet's native UI.

**Launch tools (3):**

| Tool                              | What Monet Shows                                                                                                  | What Agents Can Do                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **Email** (Gmail)                 | All emails, threads, contacts -- rendered in Monet's design language, not Gmail's UI                              | Read, draft, send, reply, organize |
| **Code** (GitHub / local)         | Repositories, files, diffs -- presented visually. User describes what they want, AI writes code, user sees output | Create, edit, commit, run code     |
| **Writing** (Google Docs / local) | Documents rendered natively                                                                                       | Draft, edit, rewrite, format       |

**Connection flow:**

1. User clicks "Connect a tool"
2. Selects tool category (Email / Code / Writing)
3. OAuth flow for cloud services, or local directory selection
4. AI ingests all data from the tool
5. Data re-rendered in Monet's visual language -- user never sees the original UI

**Out of scope for MVP:**

- Calendar, Slack, CRM, or other tool categories
- Granular permissions (agent gets full read/write access)
- Real-time sync (polling on interval is fine)

### 3. See Agents

**What it does:** A fun, visual dashboard showing all agents -- what they are, what they're doing, and what they've done.

**Agent types:**

- **Pre-built agents** ship with Monet (e.g., Email Agent, Code Agent, Writing Agent)
- **User-created agents** can be configured through conversation ("Make me an agent that summarizes my emails every morning")

**Dashboard shows:**

- Each agent as a visual entity (not a row in a table -- think characters, avatars, or living things)
- Real-time status: idle, working, completed task
- Activity feed: what each agent has done recently
- Click into an agent to see details, history, and configuration

**Agent capabilities:**

- Run autonomously in the background (cloud-hosted)
- Execute tasks across connected tools
- Report results back to the dashboard

**Out of scope for MVP:**

- Agent-to-agent communication
- Complex multi-step workflows
- Agent marketplace / sharing

---

## Keystroke Collection

Runs at the OS level. Captures interaction patterns (not passwords or sensitive input in auth fields).

**Purpose for MVP:** Data collection and storage. Lay the pipeline.

**Future purpose:** Personalization engine -- agents learn how the user works and anticipate needs.

---

## Technical Constraints

| Constraint  | Decision                                                       |
| ----------- | -------------------------------------------------------------- |
| Base OS     | Linux (minimal custom distro)                                  |
| Demo target | Bootable USB / UTM virtual machine                             |
| AI backend  | Claude Code (current), model-agnostic abstraction from day one |
| Weight      | Extremely lightweight -- fast boot, minimal packages           |
| Team        | 2 people (Calvin + cofounder)                                  |
| Timeline    | 2 weeks to demoable MVP                                        |

---

## What "Demoable" Means (April 12)

A person can:

1. Boot the USB image (or launch in UTM)
2. See a login screen, create an account, log in
3. Connect their Gmail account and see their emails rendered in Monet's UI
4. See a dashboard of agents with at least one pre-built agent active
5. Ask an agent to do something with their email (draft a reply, summarize inbox)
6. Watch the agent work and see the result -- all without touching a terminal

The demo proves: **this is a new kind of computer, and it's beautiful.**

---

## Open Questions

- [ ] What does "fun" look like for the agent dashboard? Avatars? Animations? A spatial/3D layout? Need design direction.
- [ ] Keystroke collection: what's the privacy model? Opt-in? Disclosure? On-device only?
- [ ] Code tool for MVP: does the user need to see code output, or just the result of running code (e.g., "I built you a website, here it is")?
- [ ] Brand identity: color palette, typography, visual language for the Monet UI?
- [ ] Cloud infrastructure for agent execution: where do background agents run? Your own infra, or a cloud provider?
- [ ] What does the user see between the three tools? Is there a "home screen" or is it agent-first (you see your agents, and they show you your data)?

---

## File Structure (Proposed)

```
~/Monet/
  SCOPE.md              # This document
  os/                   # Linux distro build (kernel config, packages, init)
  runtime/              # Agent orchestration backend
  ui/                   # Frontend / desktop environment
  tools/                # Tool connectors (Gmail, GitHub, Docs)
  keystroke/            # Keystroke collection pipeline
  scripts/              # Build scripts, USB image creation
```
