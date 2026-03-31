import { createActivity } from "@/lib/types/activity";
import type { ActivityRecord, Participant } from "@/lib/types/activity";
import { apiGet } from "./api-client";

interface GitCommit {
  hash: string;
  message: string;
  author?: string;
  email?: string;
  timestamp?: string; // ISO datetime string
  branch?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
}

interface GitCommitsResponse {
  commits?: GitCommit[];
}

function parseIsoToEpochMs(iso: string | undefined): number {
  if (!iso) return Date.now();
  const ms = Date.parse(iso);
  return isNaN(ms) ? Date.now() : ms;
}

function normalizeGitCommit(commit: GitCommit): ActivityRecord {
  const timestamp = parseIsoToEpochMs(commit.timestamp);
  const filesChanged = commit.filesChanged ?? [];

  const participants: Participant[] = commit.email
    ? [
        {
          email: commit.email,
          displayName: commit.author ?? commit.email,
          source: "git",
          lastSeenTimestamp: timestamp,
        },
      ]
    : [];

  const firstLine = (commit.message ?? "").split("\n")[0].trim();

  const labels: string[] = [];
  if (commit.branch) labels.push(commit.branch);

  const bodyText = filesChanged.length > 0 ? filesChanged.join("\n") : null;

  return createActivity("git", commit.hash, {
    timestamp,
    title: firstLine || commit.hash,
    participants,
    preview: `${filesChanged.length} file${filesChanged.length !== 1 ? "s" : ""} changed`,
    body: bodyText,
    labels,
    metadata: {
      hash: commit.hash,
      branch: commit.branch ?? null,
      filesChanged,
      insertions: commit.insertions ?? 0,
      deletions: commit.deletions ?? 0,
    },
  });
}

export async function fetchGitActivities(): Promise<ActivityRecord[]> {
  if (import.meta.env.VITE_DEV_MODE === "true") {
    try {
      const fixture = await import("@/lib/services/fixtures/git.json");
      const commits: GitCommit[] = fixture.default ?? [];
      return commits.map(normalizeGitCommit);
    } catch (err) {
      console.warn("[git-ingestion] dev fixture load failed:", err);
      return [];
    }
  }

  try {
    const res = await apiGet<GitCommitsResponse>("/git/commits");
    const commits = res.commits ?? [];
    return commits.map(normalizeGitCommit);
  } catch (err) {
    console.error("[git-ingestion] fetchGitActivities failed:", err);
    return [];
  }
}
