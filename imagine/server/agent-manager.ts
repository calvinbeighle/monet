import { query } from "@anthropic-ai/claude-agent-sdk";
import { v4 as uuid } from "uuid";
import { EventEmitter } from "events";
import { mkdirSync } from "fs";
import { generateVideo, generateImage } from "./image-generator";
import type { AgentSuggestion } from "./prediction-engine";

const USE_IMAGINE = process.env.USE_IMAGINE === "true";

export interface AgentCard {
  id: string;
  status: "idle" | "working" | "done" | "error";
  instruction: string | null;
  summary: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  rawOutput: string;
}

// Verified working stock videos + dynamic fetch from Pexels
const STOCK_VIDEOS: string[] = [
  "https://videos.pexels.com/video-files/3571264/3571264-uhd_2560_1440_30fps.mp4",
  "https://videos.pexels.com/video-files/1918465/1918465-uhd_2560_1440_24fps.mp4",
  "https://videos.pexels.com/video-files/2098989/2098989-uhd_2560_1440_30fps.mp4",
  "https://videos.pexels.com/video-files/2519660/2519660-uhd_2560_1440_24fps.mp4",
  "https://videos.pexels.com/video-files/4763824/4763824-uhd_2560_1440_24fps.mp4",
  "https://videos.pexels.com/video-files/2257010/2257010-uhd_2560_1440_24fps.mp4",
];

// Fetch more videos from Pexels API at startup
const PEXELS_KEY = process.env.PEXELS_API_KEY || "";
const PEXELS_QUERIES = [
  "nature landscape",
  "ocean waves",
  "mountains clouds",
  "forest rain",
  "sunset sky",
  "abstract light",
];

async function loadPexelsVideos() {
  if (!PEXELS_KEY) return;
  for (const q of PEXELS_QUERIES) {
    try {
      const res = await fetch(
        `https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=5&size=medium`,
        {
          headers: { Authorization: PEXELS_KEY },
        },
      );
      const data = await res.json();
      for (const v of data.videos || []) {
        for (const f of v.video_files || []) {
          if (f.quality === "hd" && f.width >= 1280) {
            STOCK_VIDEOS.push(f.link);
            break;
          }
        }
      }
    } catch {}
  }
  // Shuffle
  for (let i = STOCK_VIDEOS.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [STOCK_VIDEOS[i], STOCK_VIDEOS[j]] = [STOCK_VIDEOS[j], STOCK_VIDEOS[i]];
  }
  console.log(`Loaded ${STOCK_VIDEOS.length} stock videos`);
}

loadPexelsVideos();

let stockIndex = 0;
function nextStockVideo(): string {
  const url = STOCK_VIDEOS[stockIndex % STOCK_VIDEOS.length];
  stockIndex++;
  return url;
}

export class AgentManager extends EventEmitter {
  private agents = new Map<
    string,
    {
      card: AgentCard;
      abort: AbortController | null;
      sessionId: string | null;
      sandbox: string;
    }
  >();

  private static IDLE_SUBJECTS = [
    "water lilies on a still pond",
    "a Japanese bridge over a lily pond",
    "haystacks at golden hour",
    "a cathedral facade in morning light",
    "sailboats on choppy seas",
    "a poppy field with figures walking",
    "a Parisian boulevard with dappled sunlight",
    "a rowboat on a calm river",
    "a garden path with climbing roses",
    "sunset over the Thames",
    "irises and wisteria in a garden",
    "snow falling on a village",
    "a train station with steam and light",
    "cliffs at the seaside with crashing waves",
    "a wheat field blowing in the wind",
    "cherry blossoms over a stream",
    "fog lifting over a harbor",
    "autumn leaves floating on water",
    "a greenhouse full of tropical plants",
    "gondolas in Venice at dusk",
    "a windmill in a tulip field",
    "rain on a cobblestone street",
    "fireflies in a summer meadow",
    "northern lights over a frozen lake",
    "a lighthouse beam cutting through mist",
  ];

  private static IDLE_STYLES = [
    "in the impressionist style of Claude Monet with soft brushstrokes and dappled light",
    "painted in thick impasto oil like a Monet masterpiece with vibrant colors",
    "as a dreamy Monet waterscape with reflections dissolving into color",
    "in Monet's late style with abstract color fields and luminous atmosphere",
  ];

  private static randomIdle(): string {
    const subject =
      this.IDLE_SUBJECTS[Math.floor(Math.random() * this.IDLE_SUBJECTS.length)];
    const style =
      this.IDLE_STYLES[Math.floor(Math.random() * this.IDLE_STYLES.length)];
    return `${subject} ${style}`;
  }

  createAgent(): AgentCard {
    const id = uuid();
    const sandbox = `/tmp/imagine-sandbox/${id.slice(0, 8)}`;
    mkdirSync(sandbox, { recursive: true });

    const card: AgentCard = {
      id,
      status: "idle",
      instruction: null,
      summary: null,
      imageUrl: null,
      videoUrl: null,
      rawOutput: "",
    };
    // Set video before first emit to avoid flicker
    if (!USE_IMAGINE) {
      card.videoUrl = nextStockVideo();
    }
    this.agents.set(card.id, { card, abort: null, sessionId: null, sandbox });
    this.emit("update", card);

    if (USE_IMAGINE) {
      const prompt = AgentManager.randomIdle();
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
    }

    return card;
  }

  getAll(): AgentCard[] {
    const cards = Array.from(this.agents.values()).map((a) => a.card);
    // Order: done (by output length desc) -> working -> idle
    const done = cards
      .filter((c) => c.status === "done")
      .sort((a, b) => b.rawOutput.length - a.rawOutput.length);
    const working = cards.filter((c) => c.status === "working");
    const idle = cards.filter(
      (c) => c.status === "idle" || c.status === "error",
    );
    return [...done, ...working, ...idle];
  }

  getCard(id: string): AgentCard | undefined {
    return this.agents.get(id)?.card;
  }

  async sendInstruction(id: string, instruction: string): Promise<void> {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Agent ${id} not found`);

    agent.card.instruction = instruction;
    agent.card.status = "working";
    // Append a separator for follow-up messages instead of clearing
    if (agent.card.rawOutput) {
      agent.card.rawOutput +=
        "\n\n--- New instruction: " + instruction + " ---\n\n";
    }
    agent.card.summary = null;
    this.emit("update", agent.card);

    if (USE_IMAGINE) {
      // Generate video immediately from the instruction
      generateVideo(`Artistic impressionist visualization of: ${instruction}`)
        .then((url) => {
          agent.card.videoUrl = url;
          this.emit("update", agent.card);
        })
        .catch((err) => console.error("Initial video gen failed:", err));
    }

    // Use Claude Agent SDK
    const abort = new AbortController();
    agent.abort = abort;

    try {
      const stream = query({
        prompt: instruction,
        options: {
          cwd: agent.sandbox,
          permissionMode: "bypassPermissions",
          abortController: abort,
          systemPrompt: `You are a sandboxed coding agent. Your working directory is ${agent.sandbox}. Create all files here. Do NOT read, write, or modify files outside this directory. Do NOT access ~/*, /Users/*, or any other project directories. If the user asks you to work on an existing project, build a fresh version in your sandbox instead.`,
          allowedTools: [
            "Read",
            "Write",
            "Edit",
            "Bash",
            "Glob",
            "Grep",
            "WebSearch",
            "WebFetch",
            "Agent",
            "NotebookEdit",
          ],
        },
      });

      for await (const message of stream) {
        if (message.type === "assistant" && message.message?.content) {
          for (const block of message.message.content) {
            if ("text" in block && block.text) {
              if (
                agent.card.rawOutput &&
                !agent.card.rawOutput.endsWith("\n")
              ) {
                agent.card.rawOutput += "\n";
              }
              agent.card.rawOutput += block.text;
              this.emit("update", agent.card);
            } else if ("type" in block && block.type === "tool_use") {
              const tool = (block as any).name || "tool";
              const input = (block as any).input || {};
              const file =
                input.file_path || input.command || input.pattern || "";
              const short =
                typeof file === "string" ? file.split("/").pop() : "";
              agent.card.rawOutput += `\n[${tool}: ${short}]`;
              this.emit("update", agent.card);
            }
          }
        }
        // Skip result type - it duplicates assistant text
      }

      // Done
      const output = agent.card.rawOutput;
      agent.card.summary =
        output.length > 200 ? output.slice(0, 200) + "..." : output;
      agent.card.status = "done";
      this.emit("update", agent.card);
      this.emit("agent-done", agent.card);

      if (USE_IMAGINE) {
        generateVideo(
          `Artistic impressionist visualization of: ${instruction}. Result: ${agent.card.summary?.slice(0, 100)}`,
        )
          .then((url) => {
            agent.card.videoUrl = url;
            this.emit("update", agent.card);
          })
          .catch((err) => console.error("Result video gen failed:", err));
      }
    } catch (err: any) {
      console.error("Agent error:", err);
      agent.card.status = "error";
      agent.card.summary = err.message || "Agent failed";
      this.emit("update", agent.card);
      this.emit("agent-done", agent.card);
    } finally {
      agent.abort = null;
    }
  }

  interruptAgent(id: string): void {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Agent ${id} not found`);
    if (agent.abort) {
      agent.abort.abort();
      agent.abort = null;
    }
    if (agent.card.status === "working") {
      agent.card.status = "done";
      agent.card.summary = "Interrupted";
      this.emit("update", agent.card);
      this.emit("agent-done", agent.card);
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
