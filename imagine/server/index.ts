import express from "express";
import cors from "cors";
import { AgentManager } from "./agent-manager";
import { getPredictions } from "./prediction-engine";
import type { AgentSuggestion, SessionHistory } from "./prediction-engine";

const app = express();
app.use(cors());
app.use(express.json());

const manager = new AgentManager();

// Prediction buffer - pre-fetched in background
let predictionBuffer: AgentSuggestion[] = [];
let fetchingPredictions = false;

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

async function refillPredictions() {
  if (fetchingPredictions) return;
  fetchingPredictions = true;
  try {
    const history = getInAppHistory();
    const predictions = await getPredictions(history);
    predictionBuffer = predictions;
    console.log(`Prediction buffer: ${predictions.length} suggestions ready`);
  } catch (err) {
    console.error("Prediction refill failed:", err);
  } finally {
    fetchingPredictions = false;
  }
}

// Create 5 blank cards to start
for (let i = 0; i < 5; i++) {
  manager.createAgent();
}

// Pre-fetch predictions in background (non-blocking)
refillPredictions();

// Refill when any agent finishes - context has changed
manager.on("agent-done", () => {
  refillPredictions();
});

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
  const onDone = (card: any) => sendEvent("surface", { id: card.id });

  manager.on("update", onUpdate);
  manager.on("remove", onRemove);
  manager.on("agent-done", onDone);

  req.on("close", () => {
    manager.off("update", onUpdate);
    manager.off("remove", onRemove);
    manager.off("agent-done", onDone);
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

// Add a new card - use prediction if available
app.post("/api/cards", (_req, res) => {
  if (predictionBuffer.length > 0) {
    const prediction = predictionBuffer.shift()!;
    const card = manager.createAgentWithSuggestion(prediction);
    if (predictionBuffer.length < 2) refillPredictions();
    return res.json(card);
  }
  const card = manager.createAgent();
  if (!fetchingPredictions) refillPredictions();
  res.json(card);
});

// Interrupt a running agent
app.post("/api/cards/:id/interrupt", (req, res) => {
  try {
    manager.interruptAgent(req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(404).json({ error: e.message });
  }
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
