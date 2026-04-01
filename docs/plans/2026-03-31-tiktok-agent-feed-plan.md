# TikTok Agent Feed Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TikTok-style vertical swipe web app where each card is a Claude Code agent session, with xAI-generated images and text overlays.

**Architecture:** React frontend with vertical swipe cards, Node/Express backend managing Claude Code CLI subprocesses via `--print --output-format stream-json --input-format stream-json`. SSE streams updates to frontend. xAI Imagine API generates card images on agent completion.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, Zustand, Express, node child_process, xAI Grok Imagine API

---

### Task 1: Scaffold the project

**Files:**

- Create: `imagine/package.json`
- Create: `imagine/tsconfig.json`
- Create: `imagine/vite.config.ts`
- Create: `imagine/tailwind.config.ts`
- Create: `imagine/index.html`
- Create: `imagine/src/main.tsx`
- Create: `imagine/src/App.tsx`
- Create: `imagine/server/package.json`
- Create: `imagine/server/tsconfig.json`

**Step 1: Initialize the frontend**

```bash
cd /Users/calvinbeighle/Monet/imagine
npm create vite@latest . -- --template react-ts
npm install zustand tailwindcss @tailwindcss/vite
```

**Step 2: Initialize the backend**

```bash
mkdir -p /Users/calvinbeighle/Monet/imagine/server
cd /Users/calvinbeighle/Monet/imagine/server
npm init -y
npm install express cors uuid
npm install -D typescript @types/express @types/cors @types/node @types/uuid tsx
```

**Step 3: Configure Tailwind in vite.config.ts**

```typescript
// imagine/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
```

**Step 4: Create minimal App.tsx**

```tsx
// imagine/src/App.tsx
export default function App() {
  return (
    <div className="h-screen w-screen bg-black text-white flex items-center justify-center">
      <p>Imagine</p>
    </div>
  );
}
```

**Step 5: Verify both run**

```bash
# Terminal 1
cd /Users/calvinbeighle/Monet/imagine && npm run dev
# Terminal 2
cd /Users/calvinbeighle/Monet/imagine/server && npx tsx index.ts
```

**Step 6: Commit**

```bash
git add imagine/
git commit -m "feat: scaffold imagine app - React frontend + Express backend"
```

---

### Task 2: Backend - Agent Manager (Claude Code process spawning)

**Files:**

- Create: `imagine/server/agent-manager.ts`
- Create: `imagine/server/index.ts`

**Step 1: Write agent-manager.ts**

This manages Claude Code subprocesses. Each agent is a long-running `claude` process using `--print --input-format stream-json --output-format stream-json` for bidirectional streaming.

```typescript
// imagine/server/agent-manager.ts
import { spawn, ChildProcess } from "child_process";
import { v4 as uuid } from "uuid";
import { EventEmitter } from "events";

export interface AgentCard {
  id: string;
  status: "idle" | "working" | "done" | "error";
  instruction: string | null;
  summary: string | null;
  imageUrl: string | null;
  rawOutput: string;
}

export class AgentManager extends EventEmitter {
  private agents = new Map<
    string,
    { card: AgentCard; process: ChildProcess | null }
  >();

  createAgent(): AgentCard {
    const card: AgentCard = {
      id: uuid(),
      status: "idle",
      instruction: null,
      summary: null,
      imageUrl: null,
      rawOutput: "",
    };
    this.agents.set(card.id, { card, process: null });
    this.emit("update", card);
    return card;
  }

  getAll(): AgentCard[] {
    return Array.from(this.agents.values()).map((a) => a.card);
  }

  getCard(id: string): AgentCard | undefined {
    return this.agents.get(id)?.card;
  }

  async sendInstruction(id: string, instruction: string): Promise<void> {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Agent ${id} not found`);

    agent.card.instruction = instruction;
    agent.card.status = "working";
    agent.card.rawOutput = "";
    agent.card.summary = null;
    this.emit("update", agent.card);

    // Spawn claude in print mode with stream-json for output
    const proc = spawn(
      "claude",
      [
        "--print",
        "--output-format",
        "stream-json",
        "--dangerously-skip-permissions",
        instruction,
      ],
      {
        cwd: process.env.HOME,
        env: { ...process.env },
      },
    );

    agent.process = proc;

    let fullOutput = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      fullOutput += text;

      // Parse stream-json lines for assistant messages
      const lines = text.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text") {
                agent.card.rawOutput += block.text;
              }
            }
          }
          // Also capture result type
          if (event.type === "result" && event.result) {
            agent.card.rawOutput = event.result;
          }
        } catch {
          // Not JSON, append raw
          agent.card.rawOutput += text;
        }
      }
      this.emit("update", agent.card);
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      // Claude Code writes status/progress to stderr
    });

    proc.on("close", (code) => {
      agent.process = null;
      if (code === 0) {
        // Summarize output to 1-2 lines for the card
        const output = agent.card.rawOutput;
        agent.card.summary =
          output.length > 200 ? output.slice(0, 200) + "..." : output;
        agent.card.status = "done";
      } else {
        agent.card.status = "error";
        agent.card.summary = `Agent exited with code ${code}`;
      }
      this.emit("update", agent.card);
      this.emit("agent-done", agent.card);
    });
  }

  removeAgent(id: string): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    if (agent.process) {
      agent.process.kill("SIGTERM");
    }
    this.agents.delete(id);
    this.emit("remove", id);
  }
}
```

**Step 2: Write server/index.ts**

```typescript
// imagine/server/index.ts
import express from "express";
import cors from "cors";
import { AgentManager } from "./agent-manager";

const app = express();
app.use(cors());
app.use(express.json());

const manager = new AgentManager();

// Create 5 initial agents
for (let i = 0; i < 5; i++) {
  manager.createAgent();
}

// SSE endpoint - streams card updates
app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Send current state
  sendEvent("init", manager.getAll());

  const onUpdate = (card: unknown) => sendEvent("update", card);
  const onRemove = (id: string) => sendEvent("remove", { id });

  manager.on("update", onUpdate);
  manager.on("remove", onRemove);

  req.on("close", () => {
    manager.off("update", onUpdate);
    manager.off("remove", onRemove);
  });
});

// Get all cards
app.get("/api/cards", (_req, res) => {
  res.json(manager.getAll());
});

// Send instruction to a card
app.post("/api/cards/:id/instruct", (req, res) => {
  const { instruction } = req.body;
  if (!instruction)
    return res.status(400).json({ error: "instruction required" });
  try {
    manager.sendInstruction(req.params.id, instruction);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(404).json({ error: e.message });
  }
});

// Add a new card
app.post("/api/cards", (_req, res) => {
  const card = manager.createAgent();
  res.json(card);
});

// Remove a card
app.delete("/api/cards/:id", (req, res) => {
  manager.removeAgent(req.params.id);
  res.json({ ok: true });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Imagine server running on http://localhost:${PORT}`);
});
```

**Step 3: Verify the server starts and creates 5 agents**

```bash
cd /Users/calvinbeighle/Monet/imagine/server && npx tsx index.ts
# In another terminal:
curl http://localhost:3001/api/cards | python3 -m json.tool
```

Expected: JSON array with 5 cards, all status "idle"

**Step 4: Commit**

```bash
git add imagine/server/
git commit -m "feat: add agent manager - spawns Claude Code CLI processes per card"
```

---

### Task 3: Backend - xAI Image Generation

**Files:**

- Create: `imagine/server/image-generator.ts`
- Modify: `imagine/server/agent-manager.ts` (add image gen on completion)

**Step 1: Write image-generator.ts**

```typescript
// imagine/server/image-generator.ts

export async function generateImage(prompt: string): Promise<string> {
  // Get API key from 1Password
  const { execSync } = await import("child_process");
  const apiKey = execSync(
    "op item get 'xAI Imagine API Key' --fields credential --reveal",
    { encoding: "utf-8" },
  ).trim();

  const response = await fetch("https://api.x.ai/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-imagine-image",
      prompt,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`xAI API error: ${JSON.stringify(data)}`);
  }

  // Return the image URL from the response
  return data.data?.[0]?.url ?? "";
}
```

**Step 2: Wire image generation into agent-manager.ts**

Add to the `proc.on('close')` handler, after setting status to 'done':

```typescript
// After agent.card.status = 'done', trigger image generation
import { generateImage } from "./image-generator";

// In the close handler, after status = 'done':
this.emit("update", agent.card);
this.emit("agent-done", agent.card);

// Generate image asynchronously
const imagePrompt = `Artistic impressionist visualization of: ${agent.card.instruction}. Result: ${agent.card.summary?.slice(0, 100)}`;
generateImage(imagePrompt)
  .then((url) => {
    agent.card.imageUrl = url;
    this.emit("update", agent.card);
  })
  .catch((err) => {
    console.error("Image generation failed:", err);
  });
```

**Step 3: Test image generation standalone**

```bash
cd /Users/calvinbeighle/Monet/imagine/server
npx tsx -e "
import { generateImage } from './image-generator'
generateImage('A painting of autonomous AI agents working together in a control room').then(console.log)
"
```

Expected: Returns an image URL

**Step 4: Commit**

```bash
git add imagine/server/image-generator.ts imagine/server/agent-manager.ts
git commit -m "feat: add xAI Imagine image generation on agent completion"
```

---

### Task 4: Frontend - Zustand Store

**Files:**

- Create: `imagine/src/stores/feed-store.ts`
- Create: `imagine/src/lib/sse-client.ts`

**Step 1: Write the SSE client**

```typescript
// imagine/src/lib/sse-client.ts

export type CardData = {
  id: string;
  status: "idle" | "working" | "done" | "error";
  instruction: string | null;
  summary: string | null;
  imageUrl: string | null;
  rawOutput: string;
};

export function connectSSE(
  onInit: (cards: CardData[]) => void,
  onUpdate: (card: CardData) => void,
  onRemove: (id: string) => void,
): EventSource {
  const es = new EventSource("/api/events");

  es.addEventListener("init", (e) => {
    onInit(JSON.parse(e.data));
  });

  es.addEventListener("update", (e) => {
    onUpdate(JSON.parse(e.data));
  });

  es.addEventListener("remove", (e) => {
    const { id } = JSON.parse(e.data);
    onRemove(id);
  });

  return es;
}
```

**Step 2: Write the Zustand store**

```typescript
// imagine/src/stores/feed-store.ts
import { create } from "zustand";
import { CardData, connectSSE } from "../lib/sse-client";

interface FeedState {
  cards: CardData[];
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  init: () => void;
  sendInstruction: (id: string, instruction: string) => Promise<void>;
  addCard: () => Promise<void>;
  removeCard: (id: string) => Promise<void>;
}

export const useFeedStore = create<FeedState>((set, get) => ({
  cards: [],
  activeIndex: 0,

  setActiveIndex: (i) => set({ activeIndex: i }),

  init: () => {
    connectSSE(
      (cards) => set({ cards }),
      (card) =>
        set((s) => ({
          cards: s.cards.map((c) => (c.id === card.id ? card : c)),
        })),
      (id) =>
        set((s) => ({
          cards: s.cards.filter((c) => c.id !== id),
        })),
    );
  },

  sendInstruction: async (id, instruction) => {
    await fetch(`/api/cards/${id}/instruct`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction }),
    });
  },

  addCard: async () => {
    const res = await fetch("/api/cards", { method: "POST" });
    const card = await res.json();
    set((s) => ({ cards: [...s.cards, card] }));
  },

  removeCard: async (id) => {
    await fetch(`/api/cards/${id}`, { method: "DELETE" });
  },
}));
```

**Step 3: Commit**

```bash
git add imagine/src/stores/ imagine/src/lib/
git commit -m "feat: add Zustand feed store and SSE client"
```

---

### Task 5: Frontend - Card Component

**Files:**

- Create: `imagine/src/components/Card.tsx`

**Step 1: Write Card.tsx**

```tsx
// imagine/src/components/Card.tsx
import { useState } from "react";
import { CardData } from "../lib/sse-client";
import { useFeedStore } from "../stores/feed-store";

export function Card({ card }: { card: CardData }) {
  const [input, setInput] = useState("");
  const sendInstruction = useFeedStore((s) => s.sendInstruction);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendInstruction(card.id, input.trim());
    setInput("");
  };

  return (
    <div className="h-screen w-screen relative snap-start flex-shrink-0">
      {/* Background image */}
      {card.imageUrl ? (
        <img
          src={card.imageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-900 to-black" />
      )}

      {/* Gradient overlay for text readability */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

      {/* Status indicator */}
      {card.status === "working" && (
        <div className="absolute top-6 right-6 flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-yellow-400 animate-pulse" />
          <span className="text-white/70 text-sm">Working...</span>
        </div>
      )}

      {/* Text overlay - lower third */}
      <div className="absolute bottom-0 left-0 right-0 p-6 pb-24">
        <p className="text-white/60 text-sm mb-1">
          Agent {card.id.slice(0, 8)}
        </p>
        {card.instruction && (
          <p className="text-white/90 text-lg font-medium mb-2">
            {card.instruction}
          </p>
        )}
        {card.summary && (
          <p className="text-white/70 text-base">{card.summary}</p>
        )}
        {card.status === "idle" && !card.instruction && (
          <p className="text-white/40 text-lg italic">
            What should this agent do?
          </p>
        )}
      </div>

      {/* Input field */}
      <form
        onSubmit={handleSubmit}
        className="absolute bottom-0 left-0 right-0 p-4"
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type an instruction..."
            className="flex-1 bg-white/10 backdrop-blur-md border border-white/20 rounded-full px-5 py-3 text-white placeholder-white/40 outline-none focus:border-white/40"
          />
          <button
            type="submit"
            className="bg-white/20 backdrop-blur-md border border-white/20 rounded-full px-5 py-3 text-white hover:bg-white/30 transition"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add imagine/src/components/Card.tsx
git commit -m "feat: add Card component - full-screen image card with text overlay and input"
```

---

### Task 6: Frontend - Feed Component (TikTok swipe)

**Files:**

- Create: `imagine/src/components/Feed.tsx`

**Step 1: Write Feed.tsx**

Vertical snap-scroll container. Each child is a full-screen card.

```tsx
// imagine/src/components/Feed.tsx
import { useEffect, useRef } from "react";
import { useFeedStore } from "../stores/feed-store";
import { Card } from "./Card";

export function Feed() {
  const { cards, activeIndex, setActiveIndex, addCard, removeCard } =
    useFeedStore();
  const containerRef = useRef<HTMLDivElement>(null);

  // Track which card is visible via scroll position
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const index = Math.round(container.scrollTop / window.innerHeight);
      setActiveIndex(index);
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [setActiveIndex]);

  return (
    <div className="relative h-screen w-screen">
      {/* Swipe container */}
      <div
        ref={containerRef}
        className="h-screen w-screen overflow-y-scroll snap-y snap-mandatory"
      >
        {cards.map((card) => (
          <Card key={card.id} card={card} />
        ))}
      </div>

      {/* Dot indicators */}
      <div className="fixed right-3 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-50">
        {cards.map((card, i) => (
          <div
            key={card.id}
            className={`w-2 h-2 rounded-full transition-all ${
              i === activeIndex ? "bg-white scale-125" : "bg-white/30"
            }`}
          />
        ))}
      </div>

      {/* Add/remove buttons */}
      <div className="fixed top-4 right-4 flex gap-2 z-50">
        <button
          onClick={() => addCard()}
          className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white text-xl flex items-center justify-center hover:bg-white/20 transition"
        >
          +
        </button>
        {cards.length > 1 && (
          <button
            onClick={() => {
              const current = cards[activeIndex];
              if (current) removeCard(current.id);
            }}
            className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white text-xl flex items-center justify-center hover:bg-red-500/30 transition"
          >
            -
          </button>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add imagine/src/components/Feed.tsx
git commit -m "feat: add Feed component - TikTok-style vertical snap scroll with dot indicators"
```

---

### Task 7: Wire it all together

**Files:**

- Modify: `imagine/src/App.tsx`
- Modify: `imagine/src/index.css` (add Tailwind import)

**Step 1: Update index.css**

```css
/* imagine/src/index.css */
@import "tailwindcss";
```

**Step 2: Update App.tsx**

```tsx
// imagine/src/App.tsx
import { useEffect } from "react";
import { useFeedStore } from "./stores/feed-store";
import { Feed } from "./components/Feed";

export default function App() {
  const init = useFeedStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  return <Feed />;
}
```

**Step 3: Verify end-to-end**

```bash
# Terminal 1: Start backend
cd /Users/calvinbeighle/Monet/imagine/server && npx tsx index.ts

# Terminal 2: Start frontend
cd /Users/calvinbeighle/Monet/imagine && npm run dev
```

Open browser. Should see 5 full-screen black cards that snap-scroll vertically. Type an instruction, see it go to "working" state, then "done" with an image.

**Step 4: Commit**

```bash
git add imagine/src/
git commit -m "feat: wire up App with Feed - end-to-end TikTok agent swipe working"
```

---

### Task 8: Polish and edge cases

**Files:**

- Modify: `imagine/src/components/Card.tsx` (error state, loading animation)
- Modify: `imagine/server/agent-manager.ts` (timeout handling)

**Step 1: Add error state to Card**

Add after the status indicator in Card.tsx:

```tsx
{
  card.status === "error" && (
    <div className="absolute top-6 right-6 flex items-center gap-2">
      <div className="w-3 h-3 rounded-full bg-red-400" />
      <span className="text-red-300 text-sm">Error</span>
    </div>
  );
}
```

**Step 2: Add 5-minute timeout to agent-manager**

In `sendInstruction`, after spawning the process:

```typescript
// Kill after 5 minutes
const timeout = setTimeout(
  () => {
    if (agent.process) {
      agent.process.kill("SIGTERM");
      agent.card.status = "error";
      agent.card.summary = "Timed out after 5 minutes";
      this.emit("update", agent.card);
    }
  },
  5 * 60 * 1000,
);

proc.on("close", () => {
  clearTimeout(timeout);
  // ... rest of close handler
});
```

**Step 3: Commit**

```bash
git add imagine/
git commit -m "feat: add error states and timeout handling"
```
