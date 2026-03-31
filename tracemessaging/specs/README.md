# Trace Messaging - Specification Overview

## Vision

Messaging attached to what you were actually doing. Instead of organizing messages by sender or app, Trace Messaging organizes them by work context. The unit of messaging becomes the workstream, not the thread.

## Core Concept

A message is attached to:

- The document you were editing
- The company you were researching
- The CRM record
- The browser tabs open
- The proposal you were drafting
- The work pattern you were in when it arrived

Example: You are building a proposal for a client. Instead of checking Gmail, Slack, and LinkedIn separately, you open the "client workstream" and see the inbound email, your draft, past meeting notes, the website mockup, suggested reply, decision points, and next step.

## Interaction Model

The home screen is a vertical timeline of active workstreams. Each workstream contains:

- Messages (email, Slack, etc.)
- Files (documents, code, assets)
- Tasks
- Notes
- AI summaries
- Recommended action

You can still reply like normal. But the mental model is different. Messaging is now just one event in a broader operational stream.

## AI Role

The agent continuously answers:

- What is this about?
- What was I doing related to this?
- What should happen next?
- Can I handle this without Calvin?

## Game Mechanics / Value Drivers

- Context preservation eliminates the cost of switching between apps
- Workstream grouping surfaces relationships humans miss
- AI triage reduces cognitive load by pre-answering "what does this relate to?"
- Recommended actions turn passive inbox checking into active decision-making

## MVP Scope

Email (Gmail) plus local files plus calendar plus browser tabs. One workstream view. AI links messages to active projects.

### MVP Data Sources (confirmed available on this machine)

1. **Email** - Gmail via inbox.json / Nango OAuth / Gmail API
2. **Browser tabs** - Arc browser StorableArchive JSON snapshots (timestamped tab state)
3. **Calendar** - Google Calendar via cached API data and MCP
4. **Local files** - Git repos, project directories, recent file activity
5. **Claude Code sessions** - Task history with session context
6. **CRM** - HubSpot via API (credentials in 1Password)

### MVP Features

1. Workstream detection - AI clusters messages, files, tabs, and calendar events into workstreams
2. Workstream timeline - vertical timeline of active workstreams as the home screen
3. Workstream detail view - all context for one workstream in a single view
4. Message reply - reply to emails from within the workstream context
5. AI summary - per-workstream summary of status, next steps, and recommended actions
6. Context linking - when a new message arrives, AI attaches it to the right workstream

## Why This Wins

This is messaging for operators, founders, and knowledge workers who live across tools. It matches how work actually happens. If done right, this stops feeling like "an inbox product" and starts feeling like an operating system for commercial work.

## Risk

The context-linking AI must be accurate. If it misgroups messages or misses workstream associations, the whole model breaks. The AI layer has to be genuinely strong at understanding work context, not just keyword matching.
