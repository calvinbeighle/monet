// Gmail API client per Spec 01 - Email Integration
// All requests are proxied through Nango, which handles token injection and refresh.
// Retry logic handles rate limits (429) and server errors (5xx).
// Auth failures (401) indicate a broken Nango connection.

import { nangoProxy } from "../../lib/nango-client";
import { useAuthStore } from "./auth-store";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

export interface GmailThreadListEntry {
  id: string;
  snippet: string;
  historyId: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  internalDate: string;
  payload: {
    headers: Array<{ name: string; value: string }>;
    mimeType: string;
    body?: { data?: string; size: number };
    parts?: Array<{
      mimeType: string;
      body?: { data?: string; size: number };
      filename?: string;
    }>;
  };
}

export interface GmailThreadDetail {
  id: string;
  historyId: string;
  messages: GmailMessage[];
}

export interface GmailThreadListResponse {
  threads: GmailThreadListEntry[];
  nextPageToken?: string;
  resultSizeEstimate: number;
}

export interface GmailHistoryResponse {
  history: Array<{
    id: string;
    messagesAdded?: Array<{
      message: { id: string; threadId: string; labelIds: string[] };
    }>;
    messagesDeleted?: Array<{ message: { id: string; threadId: string } }>;
    labelsAdded?: Array<{
      message: { id: string; threadId: string };
      labelIds: string[];
    }>;
    labelsRemoved?: Array<{
      message: { id: string; threadId: string };
      labelIds: string[];
    }>;
  }>;
  historyId: string;
  nextPageToken?: string;
}

export interface SendReplyPayload {
  threadId: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  inReplyTo: string;
  references: string[];
}

export interface DraftPayload {
  threadId: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string[];
  draftId?: string;
}

class GmailApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryable: boolean,
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

// Injectable proxy function for testing
let _proxyFn: typeof nangoProxy = nangoProxy;

export function _setProxyFn(fn: typeof nangoProxy): void {
  _proxyFn = fn;
}

export function _resetProxyFn(): void {
  _proxyFn = nangoProxy;
}

async function gmailFetch(path: string, options: RequestInit = {}): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await _proxyFn(path, options);

      if (response.ok) return response;

      if (response.status === 401) {
        // Nango connection is broken - transition auth state
        useAuthStore.setState({
          authState: "reauthentication-required",
          error: "Gmail connection lost. Please reconnect.",
        });
        throw new GmailApiError("Authentication failed - connection broken", 401, false);
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        await sleep(waitMs);
        continue;
      }

      if (response.status >= 500) {
        await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt));
        continue;
      }

      const errorBody = await response.text().catch(() => "");
      throw new GmailApiError(
        `Gmail API error: ${response.status} ${errorBody}`,
        response.status,
        false,
      );
    } catch (err) {
      if (err instanceof GmailApiError && !err.retryable) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < MAX_RETRIES - 1) {
        await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt));
      }
    }
  }

  throw lastError ?? new GmailApiError("Request failed after retries", 0, false);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Encode email for Gmail API (RFC 2822 base64url)
function encodeEmail(headers: Record<string, string>, body: string): string {
  const headerLines = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n");
  const raw = `${headerLines}\r\n\r\n${body}`;
  return btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// --- Public API ---

export async function fetchThreadList(
  maxResults = 50,
  pageToken?: string,
  query = "in:inbox",
): Promise<GmailThreadListResponse> {
  const params = new URLSearchParams({
    maxResults: String(maxResults),
    q: query,
  });
  if (pageToken) params.set("pageToken", pageToken);

  const resp = await gmailFetch(`/threads?${params}`);
  return resp.json();
}

export async function fetchThreadDetail(threadId: string): Promise<GmailThreadDetail> {
  const resp = await gmailFetch(`/threads/${encodeURIComponent(threadId)}?format=full`);
  return resp.json();
}

export async function fetchHistoryChanges(
  startHistoryId: string,
  pageToken?: string,
): Promise<GmailHistoryResponse> {
  const params = new URLSearchParams({
    startHistoryId,
    historyTypes: "messageAdded,messageDeleted,labelAdded,labelRemoved",
  });
  if (pageToken) params.set("pageToken", pageToken);

  const resp = await gmailFetch(`/history?${params}`);
  return resp.json();
}

export async function sendReply(payload: SendReplyPayload): Promise<GmailMessage> {
  const headers: Record<string, string> = {
    To: payload.to.join(", "),
    Subject: payload.subject,
    "In-Reply-To": payload.inReplyTo,
    References: payload.references.join(" "),
    "Content-Type": "text/plain; charset=utf-8",
  };
  if (payload.cc && payload.cc.length > 0) {
    headers.Cc = payload.cc.join(", ");
  }

  const raw = encodeEmail(headers, payload.body);

  const resp = await gmailFetch("/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw, threadId: payload.threadId }),
  });
  return resp.json();
}

export async function createDraft(payload: DraftPayload): Promise<{ id: string }> {
  const headers: Record<string, string> = {
    To: payload.to.join(", "),
    Subject: payload.subject,
    "Content-Type": "text/plain; charset=utf-8",
  };
  if (payload.cc && payload.cc.length > 0) {
    headers.Cc = payload.cc.join(", ");
  }
  if (payload.inReplyTo) {
    headers["In-Reply-To"] = payload.inReplyTo;
  }
  if (payload.references && payload.references.length > 0) {
    headers.References = payload.references.join(" ");
  }

  const raw = encodeEmail(headers, payload.body);

  const resp = await gmailFetch("/drafts", {
    method: "POST",
    body: JSON.stringify({ message: { raw, threadId: payload.threadId } }),
  });
  return resp.json();
}

export async function updateDraft(draftId: string, payload: DraftPayload): Promise<{ id: string }> {
  const headers: Record<string, string> = {
    To: payload.to.join(", "),
    Subject: payload.subject,
    "Content-Type": "text/plain; charset=utf-8",
  };
  if (payload.cc && payload.cc.length > 0) {
    headers.Cc = payload.cc.join(", ");
  }

  const raw = encodeEmail(headers, payload.body);

  const resp = await gmailFetch(`/drafts/${encodeURIComponent(draftId)}`, {
    method: "PUT",
    body: JSON.stringify({ message: { raw, threadId: payload.threadId } }),
  });
  return resp.json();
}

export async function deleteDraft(draftId: string): Promise<void> {
  await gmailFetch(`/drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" });
}

export async function archiveThread(threadId: string): Promise<void> {
  await gmailFetch(`/threads/${encodeURIComponent(threadId)}/modify`, {
    method: "POST",
    body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
  });
}

// --- Helpers for thread data extraction ---

export function extractHeader(message: GmailMessage, headerName: string): string | undefined {
  return message.payload.headers.find((h) => h.name.toLowerCase() === headerName.toLowerCase())
    ?.value;
}

export function extractPlainTextBody(message: GmailMessage): string {
  if (message.payload.mimeType === "text/plain" && message.payload.body?.data) {
    return decodeBase64Url(message.payload.body.data);
  }
  if (message.payload.parts) {
    const textPart = message.payload.parts.find((p) => p.mimeType === "text/plain");
    if (textPart?.body?.data) {
      return decodeBase64Url(textPart.body.data);
    }
  }
  return "";
}

export function extractHtmlBody(message: GmailMessage): string {
  if (message.payload.mimeType === "text/html" && message.payload.body?.data) {
    return decodeBase64Url(message.payload.body.data);
  }
  if (message.payload.parts) {
    const htmlPart = message.payload.parts.find((p) => p.mimeType === "text/html");
    if (htmlPart?.body?.data) {
      return decodeBase64Url(htmlPart.body.data);
    }
  }
  return "";
}

export function extractAttachments(
  message: GmailMessage,
): Array<{ filename: string; mimeType: string; size: number }> {
  if (!message.payload.parts) return [];
  return message.payload.parts
    .filter((p) => p.filename && p.filename.length > 0)
    .map((p) => ({
      filename: p.filename!,
      mimeType: p.mimeType,
      size: p.body?.size ?? 0,
    }));
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(
    atob(base64)
      .split("")
      .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join(""),
  );
}
