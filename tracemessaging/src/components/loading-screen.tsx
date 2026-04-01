import { useAppStore } from "../lib/stores";
import type { SourceType } from "../lib/types";

const SOURCE_LABELS: Record<SourceType, string> = {
  gmail: "Gmail",
  "arc-browser": "Arc Browser",
  "google-calendar": "Calendar",
  git: "Git",
  "local-project": "Local Projects",
  "claude-code": "Claude Code",
  hubspot: "HubSpot",
};

export function LoadingScreen() {
  const sourceSyncStates = useAppStore((s) => s.sourceSyncStates);

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-[var(--bg-root)]">
      <div
        className="mb-8 font-normal tracking-tight text-[var(--text-primary)]"
        style={{ fontFamily: "var(--font-display)", fontSize: "2rem" }}
      >
        trace<span style={{ color: "var(--text-tertiary)" }}>.</span>
      </div>
      <div className="flex flex-col gap-2">
        {(Object.keys(SOURCE_LABELS) as SourceType[]).map((source) => {
          const state = sourceSyncStates.get(source);
          const done = state?.status === "connected" && state.itemCount > 0;
          const loading = state?.status === "syncing";
          const failed = state?.status === "error";

          return (
            <div
              key={source}
              className="flex items-center gap-3 text-[0.85rem]"
              style={{ fontFamily: "var(--font-body)" }}
            >
              <span className="w-4 text-center">
                {done ? (
                  <span className="text-[var(--urgency-low)]">ok</span>
                ) : failed ? (
                  <span className="text-[var(--urgency-high)]">--</span>
                ) : loading ? (
                  <span className="animate-pulse text-[var(--text-tertiary)]">
                    ..
                  </span>
                ) : (
                  <span className="text-[var(--text-muted)]">--</span>
                )}
              </span>
              <span
                className={
                  done
                    ? "text-[var(--text-secondary)]"
                    : "text-[var(--text-tertiary)]"
                }
              >
                {SOURCE_LABELS[source]}
              </span>
              {state?.itemCount !== undefined && state.itemCount > 0 && (
                <span className="text-[var(--text-muted)]">
                  {state.itemCount}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
