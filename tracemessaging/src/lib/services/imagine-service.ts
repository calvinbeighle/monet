/**
 * xAI Imagine Service - generates AI images for workstream card backgrounds.
 *
 * Why: The TikTok-style feed shows each workstream as a full-viewport card.
 * AI-generated imagery based on workstream context creates a cinematic,
 * immersive experience rather than showing raw data. Images are cached in
 * IndexedDB and regenerated when workstream context shifts significantly.
 */

import { apiPost } from "./api-client";
import { useWorkstreamStore } from "../stores/workstream-store";
import type { Workstream } from "../types";

// Cache images for 30 minutes before regenerating
const IMAGE_CACHE_TTL_MS = 30 * 60 * 1000;

// Debounce generation requests per workstream
const pendingGenerations = new Map<string, ReturnType<typeof setTimeout>>();
const GENERATION_DEBOUNCE_MS = 10_000;

type ImagineResponse = {
  workstreamId: string;
  url: string;
  b64_json: string;
  generatedAt: number;
};

/**
 * Build a visual prompt for the xAI Imagine API based on workstream context.
 * The prompt describes a mood/scene that represents the workstream's current state,
 * not a literal screenshot.
 */
function buildImagePrompt(workstream: Workstream): string {
  const parts: string[] = [];

  // Base aesthetic directive
  parts.push(
    "Dark, cinematic, abstract visualization. Moody lighting, deep shadows, editorial photography style.",
    "No text, no UI elements, no screens, no people's faces.",
  );

  // Source-based scene elements
  const sources = Object.keys(workstream.sourceBreakdown);
  if (sources.includes("gmail")) {
    parts.push(
      "Communication streams, flowing light trails, interconnected nodes.",
    );
  }
  if (sources.includes("git") || sources.includes("claude-code")) {
    parts.push(
      "Structured geometry, code-like patterns, digital architecture.",
    );
  }
  if (sources.includes("google-calendar")) {
    parts.push("Temporal flow, clock-like forms, scheduled rhythms.");
  }
  if (sources.includes("arc-browser")) {
    parts.push(
      "Information landscape, web-like structures, exploration paths.",
    );
  }
  if (sources.includes("hubspot")) {
    parts.push("Business topology, deal pipeline, relationship network.");
  }

  // Urgency mood
  const urgency = workstream.summary?.urgency;
  if (urgency === "high") {
    parts.push(
      "Warm red and amber tones, sense of urgency, dramatic contrast.",
    );
  } else if (urgency === "medium") {
    parts.push("Warm amber tones, gentle tension, anticipation.");
  } else {
    parts.push("Cool neutral tones, calm atmosphere, steady progression.");
  }

  // Workstream name as context (but abstract, not literal)
  parts.push(`Theme: ${workstream.name}.`);

  // Activity density mood
  const activityCount = workstream.activityIds.length;
  if (activityCount > 20) {
    parts.push("Dense, layered composition with many interweaving elements.");
  } else if (activityCount > 5) {
    parts.push("Moderate complexity, balanced composition.");
  } else {
    parts.push("Minimal, clean composition with focused elements.");
  }

  return parts.join(" ");
}

/**
 * Check if a workstream's cached image needs refresh.
 */
export function needsImageRefresh(workstream: Workstream): boolean {
  if (!workstream.imageUrl) return true;
  if (!workstream.imageGeneratedAt) return true;
  return Date.now() - workstream.imageGeneratedAt > IMAGE_CACHE_TTL_MS;
}

/**
 * Request image generation for a workstream. Debounced to avoid rapid API calls
 * when workstream state is changing quickly.
 */
export function requestImage(workstreamId: string, immediate = false): void {
  const existing = pendingGenerations.get(workstreamId);
  if (existing) clearTimeout(existing);

  const generate = () => {
    pendingGenerations.delete(workstreamId);
    generateImage(workstreamId).catch((err) => {
      console.error(
        `[Imagine] Failed to generate image for ${workstreamId}:`,
        err,
      );
    });
  };

  if (immediate) {
    generate();
  } else {
    pendingGenerations.set(
      workstreamId,
      setTimeout(generate, GENERATION_DEBOUNCE_MS),
    );
  }
}

/**
 * Generate an image for a workstream via the backend xAI Imagine proxy.
 */
async function generateImage(workstreamId: string): Promise<void> {
  const workstream = useWorkstreamStore.getState().getWorkstream(workstreamId);
  if (!workstream) return;

  const prompt = buildImagePrompt(workstream);

  try {
    const result = await apiPost<ImagineResponse>("/imagine/generate", {
      prompt,
      workstreamId,
    });

    // Store the URL (or base64 data URL) on the workstream
    let imageUrl = result.url;
    if (!imageUrl && result.b64_json) {
      imageUrl = `data:image/png;base64,${result.b64_json}`;
    }

    if (imageUrl) {
      useWorkstreamStore.getState().updateWorkstream(workstreamId, {
        imageUrl,
        imageGeneratedAt: result.generatedAt || Date.now(),
      });
    }
  } catch (err) {
    // Non-fatal: the card renders fine without an image
    console.error(`[Imagine] API error for ${workstreamId}:`, err);
  }
}

/**
 * Scan all workstreams and generate images for those that need refresh.
 * Called periodically or after significant state changes.
 */
export function refreshStaleImages(): void {
  const workstreams = useWorkstreamStore.getState().workstreams;
  for (const [id, ws] of workstreams) {
    if (ws.status === "archived") continue;
    if (needsImageRefresh(ws)) {
      requestImage(id);
    }
  }
}

/**
 * Stop all pending image generation requests.
 */
export function stopImagineService(): void {
  for (const timer of pendingGenerations.values()) {
    clearTimeout(timer);
  }
  pendingGenerations.clear();
}
