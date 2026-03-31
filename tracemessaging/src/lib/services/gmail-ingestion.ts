import { createActivity } from "@/lib/types/activity";
import type { ActivityRecord, Participant } from "@/lib/types/activity";
import { useActivityStore } from "@/lib/stores/activity-store";
import { useAppStore } from "@/lib/stores/app-store";
import { apiGet } from "./api-client";

// Dev fixture type shapes
interface GmailMessageListResponse {
  messages?: Array<{ id: string }>;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessagePart {
  mimeType?: string;
  body?: {
    data?: string;
    size?: number;
  };
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  historyId?: string;
  payload?: {
    headers?: GmailHeader[];
    body?: {
      data?: string;
      size?: number;
    };
    parts?: GmailMessagePart[];
  };
}

function getHeader(headers: GmailHeader[], name: string): string {
  const h = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function stripSubjectPrefixes(subject: string): string {
  return subject.replace(/^(Re:|Fwd?:|FW:)\s*/gi, "").trim();
}

interface ParsedAddress {
  email: string;
  displayName: string;
}

function parseAddressHeader(header: string): ParsedAddress[] {
  if (!header) return [];
  return header
    .split(",")
    .map((raw) => {
      raw = raw.trim();
      // Format: "Display Name <email@domain.com>"
      const match = raw.match(/^(.+?)\s*<([^>]+)>$/);
      if (match) {
        return {
          displayName: match[1].trim().replace(/^"|"$/g, ""),
          email: match[2].trim(),
        };
      }
      // Plain email
      return { displayName: raw, email: raw };
    })
    .filter((a) => a.email.includes("@"));
}

function decodeBase64Body(part: GmailMessagePart | undefined): string | null {
  if (!part) return null;
  if (part.body?.data) {
    try {
      return atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
    } catch {
      return null;
    }
  }
  if (part.parts) {
    for (const subPart of part.parts) {
      const text = decodeBase64Body(subPart);
      if (text) return text;
    }
  }
  return null;
}

function normalizeGmailMessage(msg: GmailMessage): ActivityRecord {
  const headers = msg.payload?.headers ?? [];
  const subject = getHeader(headers, "Subject");
  const from = parseAddressHeader(getHeader(headers, "From"));
  const to = parseAddressHeader(getHeader(headers, "To"));
  const cc = parseAddressHeader(getHeader(headers, "Cc"));
  const messageIdHeader = getHeader(headers, "Message-ID");

  const allAddresses = [...from, ...to, ...cc];
  const participants: Participant[] = allAddresses.map((a) => ({
    email: a.email,
    displayName: a.displayName || a.email,
    source: "gmail",
    lastSeenTimestamp: msg.internalDate
      ? parseInt(msg.internalDate, 10)
      : Date.now(),
  }));

  const timestamp = msg.internalDate
    ? parseInt(msg.internalDate, 10)
    : Date.now();
  const labelIds = msg.labelIds ?? [];
  const isUnread = labelIds.includes("UNREAD");

  const bodyText = decodeBase64Body(
    msg.payload as GmailMessagePart | undefined,
  );

  return createActivity("gmail", msg.id, {
    timestamp,
    title: stripSubjectPrefixes(subject) || "(no subject)",
    participants,
    preview: msg.snippet ?? "",
    body: bodyText,
    labels: labelIds,
    metadata: {
      threadId: msg.threadId ?? null,
      messageId: messageIdHeader || null,
      historyId: msg.historyId ?? null,
      isUnread,
    },
  });
}

let pollingTimer: ReturnType<typeof setInterval> | null = null;

export async function fetchGmailActivities(): Promise<ActivityRecord[]> {
  if (import.meta.env.VITE_DEV_MODE === "true") {
    try {
      const fixture = await import("@/lib/services/fixtures/gmail.json");
      const messages: GmailMessage[] = fixture.default ?? [];
      return messages.map(normalizeGmailMessage);
    } catch (err) {
      console.warn("[gmail-ingestion] dev fixture load failed:", err);
      return [];
    }
  }

  try {
    const list = await apiGet<GmailMessageListResponse>("/gmail/messages", {
      q: "in:inbox",
      maxResults: "100",
    });
    const msgRefs = list.messages ?? [];

    const messages = await Promise.all(
      msgRefs.map((ref) =>
        apiGet<GmailMessage>(`/gmail/messages/${ref.id}`).catch((err) => {
          console.error(
            `[gmail-ingestion] failed to fetch message ${ref.id}:`,
            err,
          );
          return null;
        }),
      ),
    );

    return messages
      .filter((m): m is GmailMessage => m !== null)
      .map(normalizeGmailMessage);
  } catch (err) {
    console.error("[gmail-ingestion] fetchGmailActivities failed:", err);
    return [];
  }
}

export function startGmailPolling(intervalMs: number): void {
  const run = async () => {
    const appStore = useAppStore.getState();
    appStore.updateSourceSync("gmail", { status: "syncing" });

    try {
      const activities = await fetchGmailActivities();
      useActivityStore.getState().addActivities(activities);
      appStore.updateSourceSync("gmail", {
        status: "connected",
        lastSyncAt: Date.now(),
        itemCount: activities.length,
        error: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[gmail-ingestion] polling error:", err);
      useAppStore.getState().updateSourceSync("gmail", {
        status: "error",
        error: msg,
      });
    }
  };

  void run();
  pollingTimer = setInterval(() => void run(), intervalMs);
}

export function stopGmailPolling(): void {
  if (pollingTimer !== null) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}
