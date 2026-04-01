import express from "express";
import cors from "cors";
import { AgentManager } from "./agent-manager";
import { getPredictions } from "./prediction-engine";
import type { AgentSuggestion } from "./prediction-engine";

const app = express();
app.use(cors());
app.use(express.json());

const manager = new AgentManager();

// Create initial agents, pre-populated with predictions where available
async function initializeAgents() {
  let predictions: AgentSuggestion[] = [];
  try {
    predictions = await getPredictions();
    console.log(`Loaded ${predictions.length} predictions from activity data`);
  } catch {
    console.log("No predictions available, creating blank agents");
  }

  // Create cards ordered by prediction score - suggestion shown as hint, not auto-executed
  const topPredictions = predictions.slice(0, 5);

  for (let i = 0; i < 5; i++) {
    if (i < topPredictions.length) {
      manager.createAgentWithSuggestion(topPredictions[i]);
    } else {
      manager.createAgent();
    }
  }

  // When user adds more cards via infinite scroll, also use predictions
  let nextPredictionIndex = 5;
}

initializeAgents();

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

// Get predictions from activity data
app.get("/api/predictions", async (_req, res) => {
  try {
    const predictions = await getPredictions();
    res.json(predictions);
  } catch {
    res.json([]);
  }
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

// Add a new card - use next prediction if available
app.post("/api/cards", async (_req, res) => {
  try {
    const predictions = await getPredictions();
    if (predictions.length > 0) {
      // Pick a random prediction to add variety
      const idx = Math.floor(Math.random() * Math.min(predictions.length, 10));
      const card = manager.createAgentWithSuggestion(predictions[idx]);
      return res.json(card);
    }
  } catch {}
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
