import { createActivity } from "@/lib/types/activity";
import type { ActivityRecord } from "@/lib/types/activity";
import { apiGet } from "./api-client";

interface ClaudeSession {
  sessionId: string;
  startedAt: number; // unix epoch ms from backend
  projectPath?: string;
  turnCount?: number;
  title?: string; // first user message if available
}

interface ClaudeSessionsResponse {
  sessions?: ClaudeSession[];
}

function basenameOf(path: string | undefined): string {
  if (!path) return "";
  // Handle both unix and windows paths
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

function normalizeClaudeSession(session: ClaudeSession): ActivityRecord {
  const labels: string[] = [];
  const baseName = basenameOf(session.projectPath);
  if (baseName) labels.push(baseName);

  const turnCount = session.turnCount ?? 0;

  return createActivity("claude-code", session.sessionId, {
    timestamp: session.startedAt,
    title: session.title || "Claude Code session",
    participants: [],
    preview: `${turnCount} turn${turnCount !== 1 ? "s" : ""}`,
    body: null,
    labels,
    metadata: {
      sessionId: session.sessionId,
      projectPath: session.projectPath ?? null,
      turnCount,
    },
  });
}

export async function fetchClaudeSessionActivities(): Promise<
  ActivityRecord[]
> {
  if (import.meta.env.VITE_DEV_MODE === "true") {
    try {
      const fixture =
        await import("@/lib/services/fixtures/claude-sessions.json");
      const sessions: ClaudeSession[] = fixture.default ?? [];
      return sessions.map(normalizeClaudeSession);
    } catch (err) {
      console.warn("[claude-sessions-ingestion] dev fixture load failed:", err);
      return [];
    }
  }

  try {
    const res = await apiGet<ClaudeSessionsResponse>("/claude-sessions");
    const sessions = res.sessions ?? [];
    return sessions.map(normalizeClaudeSession);
  } catch (err) {
    console.error(
      "[claude-sessions-ingestion] fetchClaudeSessionActivities failed:",
      err,
    );
    return [];
  }
}
