import express from "express";
import cors from "cors";
import { AgentManager } from "./agent-manager";
import { getPredictions } from "./prediction-engine";
import type { SessionHistory } from "./prediction-engine";

const app = express();
app.use(cors());
app.use(express.json());

const manager = new AgentManager();

// Create 5 blank cards to start
for (let i = 0; i < 5; i++) {
  manager.createAgent();
}

// Get in-app history from completed/active agents
function getInAppHistory(): SessionHistory[] {
  return manager
    .getAll()
    .filter(
      (c) => c.instruction && (c.status === "done" || c.status === "working"),
    )
    .map((c) => ({
      instruction: c.instruction!,
      status: c.status,
      rawOutput: c.rawOutput,
    }));
}

// SSE endpoint
app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

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

// Add a new card - use prediction engine if there's session history
app.post("/api/cards", async (_req, res) => {
  const history = getInAppHistory();

  // Only run predictions if user has done something or trace data exists
  if (history.length > 0) {
    try {
      const predictions = await getPredictions(history);
      if (predictions.length > 0) {
        const card = manager.createAgentWithSuggestion(predictions[0]);
        return res.json(card);
      }
    } catch {}
  }

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
