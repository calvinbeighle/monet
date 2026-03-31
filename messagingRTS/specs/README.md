# Messaging RTS - Specification Overview

## Vision

Messaging as a real-time strategy game. Communications become an operations map where threads are moving units, not stacked inbox rows. You command fronts, not open folders.

## Core Concept

A 2D map where conversation clusters drift based on urgency, value, and recency. AI agents are deployable units you drag onto thread clusters to handle triage, drafting, scheduling, and cleanup.

Instead of "31 unread," you see:

- 4 threads about to die
- 2 warm opportunities ready for a push
- 1 legal risk that needs a precise reply
- 9 things the agent can handle without you

## MVP Scope

Start with email only (Gmail). A 2D map with:

- Conversation clusters positioned by urgency/value
- Urgency drift (neglected threads move toward "lost" zone)
- Agent deployment (drag AI units onto clusters)
- Basic game mechanics (response latency = risk, fast action = trust)

## Jobs to Be Done

1. **Map Rendering** - Visualize all email threads as positioned entities on a 2D strategy map
2. **Thread Positioning & Drift** - Threads move based on urgency, value, recency, and neglect
3. **Zone System** - Named regions on the map (close, lost, noise, base, opportunities)
4. **Agent Units** - Deployable AI agents with distinct roles (closer, researcher, scheduler, cleaner, drafter, escalation bot)
5. **Agent Deployment** - Drag agents onto thread clusters to execute actions
6. **Email Integration** - Gmail OAuth, read/send/draft/archive via API
7. **Game Mechanics** - Response latency risk, trust compounding, opportunity unlocks, visible losses
8. **Navigation** - Zoom out for landscape view, zoom in to inspect one thread/relationship

## Tech Decisions (to be determined by planning phase)

- Frontend framework
- Backend/API layer
- Email integration approach
- Map rendering engine
- Real-time update mechanism

## Anti-Gimmick Principle

The visual layer must sit on top of genuinely strong triage and drafting. If the RTS metaphor ever conflicts with real utility, utility wins.
