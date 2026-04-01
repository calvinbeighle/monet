import { query } from "@anthropic-ai/claude-agent-sdk";
import { v4 as uuid } from "uuid";
import { EventEmitter } from "events";
import { generateVideo, generateImage } from "./image-generator";

export interface AgentCard {
  id: string;
  status: "idle" | "working" | "done" | "error";
  instruction: string | null;
  summary: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  rawOutput: string;
}

export class AgentManager extends EventEmitter {
  private agents = new Map<
    string,
    { card: AgentCard; abort: AbortController | null }
  >();

  private static IDLE_PROMPTS = [
    "Claude Monet style water lilies floating on a pond reflecting a sky full of glowing neural networks",
    "Claude Monet impressionist painting of a misty sunrise over a field of wildflowers with soft brushstrokes",
    "Monet style painting of a Japanese bridge over a lily pond with dappled light filtering through willows",
    "Impressionist oil painting in the style of Monet depicting haystacks at golden hour with purple shadows",
    "Monet style cathedral facade dissolving into light and color at different times of day",
    "Claude Monet water garden with irises and wisteria reflected in still water soft pastels",
    "Monet impressionist seascape with sailboats on choppy water under dramatic clouds",
    "Monet style poppy field with figures walking through red flowers under a hazy blue sky",
    "Impressionist painting of a Parisian boulevard with trees and dappled sunlight in Monet style",
    "Monet style painting of a rowboat on a calm river surrounded by overhanging trees and reflections",
    "Claude Monet style garden path with roses and climbing flowers in soft morning light",
    "Monet impressionist sunset over the Thames with Parliament silhouetted in golden haze",
  ];

  createAgent(): AgentCard {
    const card: AgentCard = {
      id: uuid(),
      status: "idle",
      instruction: null,
      summary: null,
      imageUrl: null,
      videoUrl: null,
      rawOutput: "",
    };
    this.agents.set(card.id, { card, abort: null });
    this.emit("update", card);

    // Generate a random idle video
    const prompt =
      AgentManager.IDLE_PROMPTS[
        Math.floor(Math.random() * AgentManager.IDLE_PROMPTS.length)
      ];
    generateVideo(prompt)
      .then((url) => {
        card.videoUrl = url;
        this.emit("update", card);
      })
      .catch((err) => {
        console.error("Idle video gen failed, falling back to image:", err);
        generateImage(prompt)
          .then((url) => {
            card.imageUrl = url;
            this.emit("update", card);
          })
          .catch(() => {});
      });

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

    // Generate video immediately from the instruction
    generateVideo(`Artistic impressionist visualization of: ${instruction}`)
      .then((url) => {
        agent.card.videoUrl = url;
        this.emit("update", agent.card);
      })
      .catch((err) => console.error("Initial video gen failed:", err));

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

      // Generate result video
      generateVideo(
        `Artistic impressionist visualization of: ${instruction}. Result: ${agent.card.summary?.slice(0, 100)}`,
      )
        .then((url) => {
          agent.card.videoUrl = url;
          this.emit("update", agent.card);
        })
        .catch((err) => console.error("Result video gen failed:", err));
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
