import { useAppStore } from "../../lib/stores";
import type { SourceType } from "../../lib/types";

const SOURCES: { key: SourceType; label: string; description: string }[] = [
  {
    key: "gmail",
    label: "Gmail",
    description: "Email threads and messages",
  },
  {
    key: "arc-browser",
    label: "Arc Browser",
    description: "Current tabs, archived tabs, browsing history",
  },
  {
    key: "google-calendar",
    label: "Google Calendar",
    description: "Events and meetings",
  },
  { key: "git", label: "Git", description: "Commits and branches" },
  {
    key: "claude-code",
    label: "Claude Code",
    description: "AI coding sessions",
  },
  {
    key: "hubspot",
    label: "HubSpot",
    description: "Contacts and deals from CRM",
  },
];

export function SettingsPanel() {
  const navigate = useAppStore((s) => s.navigate);
  const sourceSyncStates = useAppStore((s) => s.sourceSyncStates);

  return (
    <div className="mx-auto max-w-[800px] px-8 py-6">
      <button
        onClick={() => navigate({ view: "timeline" })}
        className="mb-4 cursor-pointer border-none bg-transparent font-mono text-[0.75rem] text-[rgba(255,255,255,0.3)] transition-colors hover:text-[rgba(255,255,255,0.55)]"
      >
        &lt;- back to timeline
      </button>

      <h1 className="mb-6 font-serif text-[1.5rem] font-normal text-[rgba(255,255,255,0.92)]">
        Settings
      </h1>

      <div className="mb-3 flex items-center gap-2.5">
        <span className="text-[0.65rem] font-medium uppercase tracking-[0.12em] text-[rgba(255,255,255,0.3)]">
          Data Sources
        </span>
        <div className="h-px flex-1 bg-[rgba(255,255,255,0.06)]" />
      </div>

      {SOURCES.map((source) => {
        const state = sourceSyncStates.get(source.key);
        const connected = state?.status === "connected";

        return (
          <div
            key={source.key}
            className="mb-2 flex items-center justify-between rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#111113] p-4"
          >
            <div>
              <div className="font-mono text-[0.85rem] text-[rgba(255,255,255,0.7)]">
                {source.label}
              </div>
              <div className="mt-0.5 font-mono text-[0.72rem] text-[rgba(255,255,255,0.3)]">
                {source.description}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {state?.itemCount !== undefined && state.itemCount > 0 && (
                <span className="font-mono text-[0.65rem] text-[rgba(255,255,255,0.25)]">
                  {state.itemCount} items
                </span>
              )}
              <span
                className={`font-mono text-[0.7rem] ${connected ? "text-[#c8f06a]" : "text-[rgba(255,255,255,0.3)]"}`}
              >
                {connected ? "connected" : "not connected"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
