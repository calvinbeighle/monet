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
    <div className="mx-auto max-w-[800px] bg-[var(--bg-root)] px-8 py-6">
      <button
        onClick={() => navigate({ view: "timeline" })}
        className="mb-4 cursor-pointer border-none bg-transparent text-[0.85rem] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
        style={{ fontFamily: "var(--font-body)" }}
      >
        &lt;- back to timeline
      </button>

      <h1
        className="mb-6 font-normal text-[var(--text-primary)]"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "1.5rem",
          fontStyle: "italic",
        }}
      >
        Settings
      </h1>

      <div className="mb-3 flex items-center gap-2.5">
        <span
          className="text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          Data Sources
        </span>
        <div className="bi-separator" />
      </div>

      {SOURCES.map((source) => {
        const state = sourceSyncStates.get(source.key);
        const connected = state?.status === "connected";

        return (
          <div
            key={source.key}
            className="mb-2 flex items-center justify-between rounded-sm border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4"
          >
            <div>
              <div
                className="text-[0.95rem] text-[var(--text-secondary)]"
                style={{ fontFamily: "var(--font-body)" }}
              >
                {source.label}
              </div>
              <div
                className="mt-0.5 text-[0.82rem] text-[var(--text-tertiary)]"
                style={{ fontFamily: "var(--font-body)" }}
              >
                {source.description}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {state?.itemCount !== undefined && state.itemCount > 0 && (
                <span
                  className="text-[0.75rem] text-[var(--text-muted)]"
                  style={{ fontFamily: "var(--font-body)" }}
                >
                  {state.itemCount} items
                </span>
              )}
              <span
                className={`text-[0.8rem] ${connected ? "text-[var(--urgency-low)]" : "text-[var(--text-tertiary)]"}`}
                style={{ fontFamily: "var(--font-body)" }}
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
