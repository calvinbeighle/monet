import { createActivity } from "@/lib/types/activity";
import type { ActivityRecord } from "@/lib/types/activity";
import { apiGet } from "./api-client";

// Simple djb2 hash producing a hex string
function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return hash.toString(16);
}

interface ArcTab {
  id?: string;
  url: string;
  title?: string;
  spaceName?: string;
  isPinned?: boolean;
  timeLastActiveAt?: number; // unix epoch ms from backend
  visitTime?: number; // unix epoch ms from backend
  visitCount?: number;
}

interface ArcSidebarResponse {
  tabs?: ArcTab[];
}

interface ArcArchiveResponse {
  tabs?: ArcTab[];
}

interface ArcHistoryResponse {
  visits?: ArcTab[];
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function normalizeTab(
  tab: ArcTab,
  dataSource: "sidebar" | "archive" | "history",
): ActivityRecord {
  const spaceName = tab.spaceName ?? "";
  const key = tab.url + spaceName;
  const id = hashString(key);
  const timestamp = tab.timeLastActiveAt ?? tab.visitTime ?? Date.now();
  const labels = spaceName ? [spaceName] : [];

  return createActivity("arc-browser", id, {
    timestamp,
    title: tab.title || tab.url,
    participants: [],
    preview: tab.url,
    body: null,
    labels,
    metadata: {
      url: tab.url,
      domain: extractDomain(tab.url),
      spaceName: spaceName || null,
      isPinned: tab.isPinned ?? false,
      visitCount: tab.visitCount ?? null,
      dataSource,
    },
  });
}

export async function fetchArcActivities(): Promise<ActivityRecord[]> {
  if (import.meta.env.VITE_DEV_MODE === "true") {
    try {
      const fixture = await import("@/lib/services/fixtures/arc.json");
      const data = fixture.default as {
        sidebar?: ArcTab[];
        archive?: ArcTab[];
        history?: ArcTab[];
      };
      const sidebarRecords = (data.sidebar ?? []).map((t) =>
        normalizeTab(t, "sidebar"),
      );
      const archiveRecords = (data.archive ?? []).map((t) =>
        normalizeTab(t, "archive"),
      );
      const historyRecords = (data.history ?? []).map((t) =>
        normalizeTab(t, "history"),
      );
      return deduplicateByUrlSpace(
        sidebarRecords,
        archiveRecords,
        historyRecords,
      );
    } catch (err) {
      console.warn("[arc-ingestion] dev fixture load failed:", err);
      return [];
    }
  }

  try {
    const [sidebarRes, archiveRes, historyRes] = await Promise.all([
      apiGet<ArcSidebarResponse>("/arc/sidebar"),
      apiGet<ArcArchiveResponse>("/arc/archive"),
      apiGet<ArcHistoryResponse>("/arc/history"),
    ]);

    const sidebarRecords = (sidebarRes.tabs ?? []).map((t) =>
      normalizeTab(t, "sidebar"),
    );
    const archiveRecords = (archiveRes.tabs ?? []).map((t) =>
      normalizeTab(t, "archive"),
    );
    const historyRecords = (historyRes.visits ?? []).map((t) =>
      normalizeTab(t, "history"),
    );

    return deduplicateByUrlSpace(
      sidebarRecords,
      archiveRecords,
      historyRecords,
    );
  } catch (err) {
    console.error("[arc-ingestion] fetchArcActivities failed:", err);
    return [];
  }
}

// Deduplicate by URL+space with priority: sidebar > archive > history
function deduplicateByUrlSpace(
  sidebar: ActivityRecord[],
  archive: ActivityRecord[],
  history: ActivityRecord[],
): ActivityRecord[] {
  const seen = new Map<string, ActivityRecord>();

  // Insert in reverse priority order so higher-priority sources overwrite
  for (const record of [...history, ...archive, ...sidebar]) {
    const url = String(record.metadata["url"] ?? "");
    const space = String(record.metadata["spaceName"] ?? "");
    seen.set(url + "|" + space, record);
  }

  return [...seen.values()];
}
