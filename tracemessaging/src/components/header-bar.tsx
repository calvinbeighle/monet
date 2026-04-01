import { useCallback, useState } from "react";
import { useTerminalStore } from "@/lib/stores/terminal-store";

export function HeaderBar() {
  const sessions = useTerminalStore((s) => s.sessions);
  const createSession = useTerminalStore((s) => s.createSession);
  const [creating, setCreating] = useState(false);

  const sessionCount = sessions.size;

  const handleNew = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      await createSession({ title: "Claude Code" });
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  }, [creating, createSession]);

  return (
    <header
      className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.06)] bg-[#000000]"
      style={{ paddingLeft: 24, paddingRight: 24 }}
    >
      <span
        style={{
          fontFamily: '"Playfair Display", Georgia, serif',
          fontSize: "1.3rem",
          fontStyle: "italic",
          color: "rgba(255,255,255,0.7)",
          letterSpacing: "-0.02em",
        }}
      >
        trace<span style={{ color: "rgba(255,255,255,0.2)" }}>.</span>
      </span>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {sessionCount > 0 && (
          <span
            style={{
              fontFamily: '"Crimson Text", serif',
              fontSize: "0.85rem",
              color: "rgba(255,255,255,0.2)",
            }}
          >
            {sessionCount}
          </span>
        )}
        <button
          onClick={handleNew}
          disabled={creating}
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 2,
            padding: "4px 12px",
            cursor: creating ? "default" : "pointer",
            fontFamily: '"Crimson Text", serif',
            fontSize: "0.8rem",
            color: creating
              ? "rgba(255,255,255,0.15)"
              : "rgba(255,255,255,0.4)",
            transition: "all 0.2s",
          }}
        >
          {creating ? "..." : "+ new"}
        </button>
      </div>
    </header>
  );
}
