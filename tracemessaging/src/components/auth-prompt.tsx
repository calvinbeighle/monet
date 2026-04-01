import { useAppStore } from "../lib/stores";

export function AuthPrompt() {
  const setAuthState = useAppStore((s) => s.setAuthState);

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-[var(--bg-root)]">
      <div
        className="mb-6 font-normal tracking-tight text-[var(--text-primary)]"
        style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem" }}
      >
        trace<span style={{ color: "var(--text-tertiary)" }}>.</span>
      </div>
      <p
        className="mb-8 max-w-md text-center text-[0.95rem] text-[var(--text-tertiary)]"
        style={{ fontFamily: "var(--font-body)" }}
      >
        Connect your data sources to organize your work by context, not by app.
      </p>
      <button
        onClick={() => setAuthState("authenticating")}
        className="cursor-pointer rounded-sm border border-[var(--border-subtle)] bg-[var(--bg-card)] px-6 py-2.5 text-[0.9rem] text-[var(--text-secondary)] transition-all hover:border-[var(--border-hover)] hover:bg-[var(--bg-card-hover)]"
        style={{ fontFamily: "var(--font-body)" }}
      >
        Connect Gmail to get started
      </button>
    </div>
  );
}
