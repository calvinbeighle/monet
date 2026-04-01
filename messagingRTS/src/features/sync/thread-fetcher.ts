// Thread fetcher per Spec 01 (Initial Thread Load) and Spec 10 (Initial Load)
// Converts Gmail API responses to Thread objects and orchestrates progressive loading.
// Pure conversion functions are separated from side-effectful fetch orchestration
// so that conversion logic can be tested independently.

import {
  fetchThreadList,
  fetchThreadDetail,
  extractHeader,
  extractPlainTextBody,
  extractHtmlBody,
  extractAttachments,
} from "../auth/gmail-client";
import type { GmailThreadDetail, GmailMessage, GmailThreadListEntry } from "../auth/gmail-client";
import { createThread } from "../../lib/types";
import type { Thread, ThreadMessage, ContactEnrichment } from "../../lib/types";
import { computeUrgencyScore, computeValueScore } from "../../lib/utils/scoring";

// Bounded concurrency: runs at most `limit` async tasks in parallel
async function fetchWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  };

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// --- Pure conversion functions ---

// Convert a Gmail message to our internal ThreadMessage format.
// Extracts headers, body content, and attachment descriptors per Spec 01 data contracts.
export function convertGmailMessage(msg: GmailMessage): ThreadMessage {
  const sender = extractHeader(msg, "From") ?? "";
  const toHeader = extractHeader(msg, "To") ?? "";
  const ccHeader = extractHeader(msg, "Cc") ?? "";
  const bccHeader = extractHeader(msg, "Bcc") ?? "";

  return {
    id: msg.id,
    sender,
    recipients: parseAddressList(toHeader),
    cc: parseAddressList(ccHeader),
    bcc: parseAddressList(bccHeader),
    timestamp: parseInt(msg.internalDate, 10),
    bodyPlain: extractPlainTextBody(msg),
    bodyHtml: extractHtmlBody(msg),
    labelIds: msg.labelIds ?? [],
    attachments: extractAttachments(msg).map((a) => ({
      ...a,
      attachmentId: "", // Gmail attachment IDs require a separate fetch - not needed for MVP
    })),
  };
}

// Convert a full Gmail thread detail response into our Thread model.
// Per Spec 01: derives participants, canonical subject, timestamps, message count, unread status.
export function convertGmailThread(detail: GmailThreadDetail): Thread {
  const messages = detail.messages.map(convertGmailMessage);
  const sortedMessages = [...messages].sort((a, b) => a.timestamp - b.timestamp);

  // Canonical subject from first message (Spec 01)
  const firstMessage = sortedMessages[0];
  const lastMessage = sortedMessages[sortedMessages.length - 1];
  const subject = firstMessage
    ? (extractHeader(detail.messages[0], "Subject") ?? "(no subject)")
    : "(no subject)";
  const snippet = detail.messages[detail.messages.length - 1]?.snippet ?? "";

  // Derive unique participants with basic enrichment
  const participantMap = new Map<string, ContactEnrichment>();
  for (const msg of messages) {
    const allAddresses = [msg.sender, ...msg.recipients, ...msg.cc, ...msg.bcc];
    for (const addr of allAddresses) {
      const email = extractEmailAddress(addr);
      if (email && !participantMap.has(email)) {
        participantMap.set(email, {
          displayName: extractDisplayName(addr),
          email,
          organization: null,
          vipFlag: false,
          relationshipScore: 0,
          responseHistory: { avgResponseTimeMs: 0, threadFrequency: 0 },
        });
      }
    }
  }

  // Collect all label IDs across messages
  const allLabels = new Set<string>();
  for (const msg of detail.messages) {
    for (const label of msg.labelIds ?? []) {
      allLabels.add(label);
    }
  }

  // Unread: any message with UNREAD label
  const unread = detail.messages.some((m) => m.labelIds?.includes("UNREAD"));

  const now = Date.now();
  const thread = createThread(detail.id, subject, snippet);

  // Override defaults with actual Gmail data
  thread.participants = [...participantMap.values()];
  thread.messages = sortedMessages;
  thread.messageCount = messages.length;
  thread.firstMessageTimestamp = firstMessage?.timestamp ?? now;
  thread.latestMessageTimestamp = lastMessage?.timestamp ?? now;
  thread.gmailLabels = [...allLabels];
  thread.unread = unread;

  // Compute initial scores
  thread.urgencyScore = computeUrgencyScore(thread, now);
  thread.valueScore = computeValueScore(thread);

  // Set neglect duration based on latest message
  thread.neglectDuration = now - thread.latestMessageTimestamp;

  return thread;
}

// --- Address parsing helpers ---

// Parse "Display Name <email@example.com>" or "email@example.com" into email
export function extractEmailAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  if (match) return match[1].toLowerCase();
  const trimmed = raw.trim().toLowerCase();
  return trimmed.includes("@") ? trimmed : "";
}

// Parse display name from "Display Name <email>" format
export function extractDisplayName(raw: string): string {
  const match = raw.match(/^(.+?)\s*<[^>]+>/);
  if (match) return match[1].trim().replace(/^"|"$/g, "");
  return raw.trim();
}

// Parse comma-separated address list
export function parseAddressList(header: string): string[] {
  if (!header.trim()) return [];
  return header
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// --- Fetch orchestration ---

// Injectable fetch functions for testing
let _fetchThreadList = fetchThreadList;
let _fetchThreadDetail = fetchThreadDetail;

export function _setFetchFns(
  listFn: typeof fetchThreadList,
  detailFn: typeof fetchThreadDetail,
): void {
  _fetchThreadList = listFn;
  _fetchThreadDetail = detailFn;
}

export function _resetFetchFns(): void {
  _fetchThreadList = fetchThreadList;
  _fetchThreadDetail = fetchThreadDetail;
}

export interface InitialLoadResult {
  threads: Thread[];
  historyId: string;
}

// Progressive callback: called as each thread is converted and ready for the map.
// Per Spec 10: "threads become available as each one finishes loading".
export type OnThreadLoaded = (thread: Thread) => void;

// Fetch all inbox threads within the lookback window.
// Per Spec 01: reverse chronological, configurable lookback, default 30 days.
// Per Spec 10: progressive loading - threads available as each finishes.
export async function performInitialLoad(
  lookbackDays: number = 30,
  onThreadLoaded?: OnThreadLoaded,
): Promise<InitialLoadResult> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
  const afterQuery = `in:inbox after:${formatDateForGmail(cutoffDate)}`;

  const allThreads: Thread[] = [];
  let latestHistoryId = "";
  let pageToken: string | undefined;

  // Fetch thread list pages
  do {
    const listResponse = await _fetchThreadList(50, pageToken, afterQuery);
    const entries: GmailThreadListEntry[] = listResponse.threads ?? [];

    // Fetch detail for each thread and convert progressively
    // Bounded concurrency (max 5 parallel) to avoid Gmail API rate limiting
    const pageThreads = await fetchWithConcurrencyLimit(entries, 5, async (entry) => {
      const detail = await _fetchThreadDetail(entry.id);
      const thread = convertGmailThread(detail);

      // Track the highest history ID (most recent)
      if (detail.historyId && detail.historyId > latestHistoryId) {
        latestHistoryId = detail.historyId;
      }

      // Notify caller immediately for progressive loading
      onThreadLoaded?.(thread);
      return thread;
    });
    allThreads.push(...pageThreads);

    pageToken = listResponse.nextPageToken;
  } while (pageToken);

  return {
    threads: allThreads,
    historyId: latestHistoryId,
  };
}

function formatDateForGmail(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}
