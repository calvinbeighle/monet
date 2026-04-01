import { query } from "@anthropic-ai/claude-agent-sdk";
import { v4 as uuid } from "uuid";
import { EventEmitter } from "events";
import { generateImage } from "./image-generator";

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
    { card: AgentCard; abort: AbortController | null }
  >();

  private static IDLE_PROMPTS = [
    "A surreal dreamscape of autonomous AI agents floating through a digital cosmos",
    "An impressionist painting of a futuristic command center with holographic displays",
    "A watercolor of robots tending a garden of glowing data streams at sunrise",
    "An oil painting of a lone conductor orchestrating a symphony of light and code",
    "A vivid abstract painting of interconnected minds sharing ideas across space",
    "A monet-style landscape where rivers of information flow through rolling hills",
    "A renaissance painting of machines and humans collaborating in a grand workshop",
    "An ethereal painting of constellation patterns forming into intelligent beings",
  ];

  createAgent(): AgentCard {
    const card: AgentCard = {
      id: uuid(),
      status: "idle",
      instruction: null,
      summary: null,
      imageUrl: null,
      rawOutput: "",
    };
    this.agents.set(card.id, { card, abort: null });
    this.emit("update", card);

    // Generate a random idle image
    const prompt =
      AgentManager.IDLE_PROMPTS[
        Math.floor(Math.random() * AgentManager.IDLE_PROMPTS.length)
      ];
    generateImage(prompt)
      .then((url) => {
        card.imageUrl = url;
        this.emit("update", card);
      })
      .catch((err) => console.error("Idle image gen failed:", err));

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

    // Generate image immediately from the instruction
    generateImage(`Artistic impressionist visualization of: ${instruction}`)
      .then((url) => {
        agent.card.imageUrl = url;
        this.emit("update", agent.card);
      })
      .catch((err) => console.error("Initial image gen failed:", err));

    // Use Claude Agent SDK
    const abort = new AbortController();
    agent.abort = abort;

    try {
      const stream = query({
        prompt: instruction,
        options: {
          cwd: "/tmp",
          permissionMode: "bypassPermissions",
          persistSession: false,
          abortController: abort,
        },
      });

      for await (const message of stream) {
        if (message.type === "assistant" && message.message?.content) {
          for (const block of message.message.content) {
            if ("text" in block && block.text) {
              agent.card.rawOutput += block.text;
              this.emit("update", agent.card);
            }
          }
        } else if (message.type === "result") {
          agent.card.rawOutput +=
            typeof message.result === "string" ? message.result : "";
        }
      }

      // Done
      const output = agent.card.rawOutput;
      agent.card.summary =
        output.length > 200 ? output.slice(0, 200) + "..." : output;
      agent.card.status = "done";
      this.emit("update", agent.card);
      this.emit("agent-done", agent.card);

      // Generate result image
      generateImage(
        `Artistic impressionist visualization of: ${instruction}. Result: ${agent.card.summary?.slice(0, 100)}`,
      )
        .then((url) => {
          agent.card.imageUrl = url;
          this.emit("update", agent.card);
        })
        .catch((err) => console.error("Result image gen failed:", err));
    } catch (err: any) {
      agent.card.status = "error";
      agent.card.summary = err.message || "Agent failed";
      this.emit("update", agent.card);
      this.emit("agent-done", agent.card);
    } finally {
      agent.abort = null;
    }
  }

  removeAgent(id: string): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    if (agent.abort) {
      agent.abort.abort();
    }
    this.agents.delete(id);
    this.emit("remove", id);
  }
}
