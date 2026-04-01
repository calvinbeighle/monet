import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env file
try {
  const envPath = resolve(import.meta.dirname || __dirname, ".env");
  const envFile = readFileSync(envPath, "utf-8");
  for (const line of envFile.split("\n")) {
    const [key, ...rest] = line.split("=");
    if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
  }
} catch {}

function getApiKey(): string {
  return process.env.XAI_API_KEY || "";
}

export async function generateVideo(prompt: string): Promise<string> {
  const apiKey = getApiKey();

  // Submit video generation request
  const submitRes = await fetch("https://api.x.ai/v1/videos/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-imagine-video",
      prompt,
    }),
  });

  const submitData = await submitRes.json();
  if (!submitRes.ok) {
    throw new Error(`xAI video submit error: ${JSON.stringify(submitData)}`);
  }

  const requestId = submitData.request_id;
  if (!requestId) throw new Error("No request_id returned");

  // Poll for completion
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));

    const pollRes = await fetch(`https://api.x.ai/v1/videos/${requestId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const pollData = await pollRes.json();

    if (pollData.status === "done" && pollData.video?.url) {
      return pollData.video.url;
    }
    if (pollData.status === "failed" || pollData.status === "expired") {
      throw new Error(`Video generation ${pollData.status}`);
    }
    // else pending, keep polling
  }

  throw new Error("Video generation timed out");
}

// Keep image generation as fallback
export async function generateImage(prompt: string): Promise<string> {
  const apiKey = getApiKey();

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

  return data.data?.[0]?.url ?? "";
}
