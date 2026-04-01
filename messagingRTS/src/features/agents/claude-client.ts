// Claude API client wrapper for agent AI backend (4.2)
// Provides rate-limited access to Claude API with error handling.
// Uses @anthropic-ai/sdk with dangerouslyAllowBrowser for frontend usage.

import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";

export interface ClaudeClientConfig {
  apiKey: string;
  model?: string;
  maxConcurrent?: number;
  maxRetries?: number;
  baseRetryDelayMs?: number;
}

export interface ClaudeResponse {
  content: Anthropic.ContentBlock[];
  stopReason: string | null;
  usage: { inputTokens: number; outputTokens: number };
}

export class ClaudeClientError extends Error {
  statusCode: number | undefined;
  retryable: boolean;

  constructor(message: string, statusCode?: number, retryable: boolean = false) {
    super(message);
    this.name = "ClaudeClientError";
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_RETRY_DELAY_MS = 1000;

// Simple semaphore for rate limiting concurrent API calls
class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;
  private max: number;

  constructor(max: number) {
    this.max = max;
  }

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

let _client: Anthropic | null = null;
let _config: ClaudeClientConfig | null = null;
let _semaphore: Semaphore | null = null;

export function initClaudeClient(config: ClaudeClientConfig): void {
  _config = config;
  _client = new Anthropic({
    apiKey: config.apiKey,
    dangerouslyAllowBrowser: true,
  });
  _semaphore = new Semaphore(config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);
}

export function isClaudeClientConfigured(): boolean {
  return _client !== null;
}

export function resetClaudeClient(): void {
  _client = null;
  _config = null;
  _semaphore = null;
}

// Injectable for testing - accepts any function returning a Message-like object
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _createMessageFn: ((params: MessageCreateParamsNonStreaming) => Promise<any>) | null = null;

export function _setCreateMessageFn(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (params: MessageCreateParamsNonStreaming) => Promise<any>,
): void {
  _createMessageFn = fn;
}

export function _resetCreateMessageFn(): void {
  _createMessageFn = null;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendMessage(params: {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  tools?: Anthropic.Tool[];
  maxTokens?: number;
}): Promise<ClaudeResponse> {
  if (!_client || !_config || !_semaphore) {
    throw new ClaudeClientError("Claude client not initialized. Call initClaudeClient first.");
  }

  const maxRetries = _config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelay = _config.baseRetryDelayMs ?? DEFAULT_BASE_RETRY_DELAY_MS;

  await _semaphore.acquire();
  try {
    return await executeWithRetry(params, maxRetries, baseDelay);
  } finally {
    _semaphore.release();
  }
}

async function executeWithRetry(
  params: {
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    tools?: Anthropic.Tool[];
    maxTokens?: number;
  },
  maxRetries: number,
  baseDelay: number,
): Promise<ClaudeResponse> {
  const requestParams: MessageCreateParamsNonStreaming = {
    model: _config?.model ?? DEFAULT_MODEL,
    max_tokens: params.maxTokens ?? 4096,
    system: params.system,
    messages: params.messages,
    ...(params.tools && params.tools.length > 0 ? { tools: params.tools } : {}),
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = _createMessageFn
        ? await _createMessageFn(requestParams)
        : await _client!.messages.create(requestParams);

      return {
        content: response.content,
        stopReason: response.stop_reason,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (error: unknown) {
      const isLast = attempt === maxRetries;

      if (error instanceof Anthropic.RateLimitError) {
        if (isLast) throw new ClaudeClientError("Rate limit exceeded after retries", 429, true);
        await sleep(baseDelay * Math.pow(2, attempt));
        continue;
      }

      if (error instanceof Anthropic.APIError) {
        const status = error.status;
        // 5xx errors are retryable
        if (typeof status === "number" && status >= 500 && !isLast) {
          await sleep(baseDelay * Math.pow(2, attempt));
          continue;
        }
        throw new ClaudeClientError(
          error.message,
          typeof status === "number" ? status : undefined,
          typeof status === "number" && status >= 500,
        );
      }

      if (error instanceof Anthropic.APIConnectionError) {
        if (isLast) throw new ClaudeClientError("Connection failed after retries", undefined, true);
        await sleep(baseDelay * Math.pow(2, attempt));
        continue;
      }

      // Non-retryable errors
      throw new ClaudeClientError(
        error instanceof Error ? error.message : "Unknown error",
        undefined,
        false,
      );
    }
  }

  // Should not reach here, but TypeScript needs it
  throw new ClaudeClientError("Exhausted retries", undefined, true);
}

export { DEFAULT_MODEL, DEFAULT_MAX_CONCURRENT };
