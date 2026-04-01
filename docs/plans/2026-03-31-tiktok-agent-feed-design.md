# TikTok-Style Agent Feed

**Date:** 2026-03-31
**Status:** Design approved

## Overview

A TikTok-style vertical swipe interface for managing multiple Claude Code agents. Each card is a full-screen xAI-generated image representing what an agent did (or is about to do), with a text overlay and input field. Users swipe between agents, type instructions, and agents execute via Claude Code CLI subprocesses.

## Architecture

### Frontend (React)

- React 19 + TypeScript + Vite
- Tailwind CSS for styling
- Zustand for state (card list, agent statuses)
- Full-screen vertical swipe between cards
- SSE connection to backend for real-time updates

### Backend (Node)

- Express server that manages Claude Code CLI subprocesses
- Spawns `claude` CLI via `child_process` - one per card
- Captures stdout, summarizes output on completion
- Calls xAI Imagine API to generate images from summaries
- Streams updates to frontend via SSE

### Image Generation

- xAI Grok Imagine API (`grok-imagine-image`)
- API key stored in 1Password ("xAI Imagine API Key")
- Called after each agent completes work
- Generates artistic visualization of what the agent did

## UI Design

### Card Layout (100vh x 100vw per card)

- Full-screen xAI generated image as background
- Semi-transparent dark gradient at bottom for text readability
- Text overlay in lower third:
  - Agent name / card number (small)
  - Task description or result summary (1-2 lines)
  - Status indicator when agent is working (pulse/spinner)
- Text input pinned to bottom - single-line field with send button

### Card States

1. **Empty** - new card, no instruction yet, placeholder image, input ready
2. **Working** - user submitted instruction, Claude Code running, loading indicator
3. **Done** - xAI image generated from result, text overlay shows what agent did, input ready for follow-up

### Navigation

- Vertical swipe (up = next, down = previous)
- No sidebar, no nav bar - full-screen cards only
- Dot indicator on right edge showing position in feed
- Plus button to add a new card (new Claude Code process)
- Minus/remove button to kill a card and its process

### Defaults

- Starts with 5 cards (5 Claude Code processes)
- Plus button adds more
- Each card is independent - its own Claude Code session

## Data Flow

```
App opens
  -> Backend spawns 5 Claude Code processes (idle, waiting for instructions)
  -> Frontend shows 5 cards with placeholder images
  -> User swipes to card, types instruction
  -> Backend pipes instruction to that card's Claude Code process
  -> Claude Code executes, output streams back
  -> On completion: summarize output, call xAI Imagine API
  -> Frontend updates card with new image + result text
  -> User can type follow-up or swipe to next card
```

## Tech Decisions

- **No prediction engine for now** - cards are manually managed. The card list source is a single function, easy to swap in prediction later.
- **Claude Code CLI** over SDK - uses the actual `claude` binary, same as running it in a terminal. Each card is effectively a terminal session.
- **xAI over other image APIs** - already have API key and working integration from the imagine/ prototype.

## File Structure

```
imagine/
  package.json
  vite.config.ts
  tsconfig.json
  tailwind.config.ts
  src/
    main.tsx
    App.tsx
    components/
      Feed.tsx          - vertical swipe container
      Card.tsx          - single full-screen card
      TextInput.tsx     - instruction input overlay
      AddButton.tsx     - plus button to add cards
    stores/
      feed-store.ts     - Zustand store for cards state
    lib/
      sse-client.ts     - SSE connection to backend
  server/
    index.ts            - Express server entry
    agent-manager.ts    - spawns/manages Claude Code processes
    image-generator.ts  - xAI Imagine API wrapper
    sse.ts              - SSE endpoint
```
