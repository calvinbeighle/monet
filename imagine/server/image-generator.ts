import { execSync } from "child_process";

// Load API key once at startup
const cachedApiKey = execSync(
  "op item get 'xAI Imagine API Key' --fields credential --reveal",
  { encoding: "utf-8" },
).trim();

function getApiKey(): string {
  return cachedApiKey;
}

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
