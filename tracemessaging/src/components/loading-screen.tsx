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
    <div className="flex h-screen flex-col items-center justify-center bg-[#0a0a0b]">
      <div className="mb-8 font-serif text-[2rem] font-normal tracking-tight text-[rgba(255,255,255,0.92)]">
        trace<span className="text-[#c8f06a]">.</span>
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
              className="flex items-center gap-3 font-mono text-[0.75rem]"
            >
              <span className="w-4 text-center">
                {done ? (
                  <span className="text-[#c8f06a]">ok</span>
                ) : failed ? (
                  <span className="text-[#ff6b6b]">--</span>
                ) : loading ? (
                  <span className="animate-pulse text-[rgba(255,255,255,0.3)]">
                    ..
                  </span>
                ) : (
                  <span className="text-[rgba(255,255,255,0.15)]">--</span>
                )}
              </span>
              <span
                className={
                  done
                    ? "text-[rgba(255,255,255,0.55)]"
                    : "text-[rgba(255,255,255,0.3)]"
                }
              >
                {SOURCE_LABELS[source]}
              </span>
              {state?.itemCount !== undefined && state.itemCount > 0 && (
                <span className="text-[rgba(255,255,255,0.2)]">
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
