import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { useTerminalStore } from "@/lib/stores/terminal-store";
import { useThemeStore } from "@/lib/stores/theme-store";
import { Chat } from "@/components/chat";

let _booted = false;

export function WorkstreamTimeline() {
  const sessions = useTerminalStore((s) => s.sessions);
  const createSession = useTerminalStore((s) => s.createSession);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);

  const containerRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const [booted, setBooted] = useState(_booted);

  const sortedSessions = useMemo(
    () => [...sessions.values()].sort((a, b) => a.createdAt - b.createdAt),
    [sessions],
  );

  // Boot: fetch existing sessions, create up to 5
  useEffect(() => {
    if (_booted) return;
    _booted = true;
    (async () => {
      await useTerminalStore.getState().fetchSessions();
      const existing = useTerminalStore.getState().sessions.size;
      const needed = Math.max(0, 5 - existing);
      for (let i = 0; i < needed; i++) {
        await useTerminalStore
          .getState()
          .createSession({ title: "Claude Code" });
      }
      setBooted(true);
    })();
  }, []);

  // Infinite scroll: load more when near bottom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const total = useTerminalStore.getState().sessions.size;
      const index = Math.round(container.scrollTop / container.clientHeight);
      if (index >= total - 2 && !loadingRef.current) {
        loadingRef.current = true;
        Promise.all([
          createSession({ title: "Claude Code" }),
          createSession({ title: "Claude Code" }),
          createSession({ title: "Claude Code" }),
        ]).finally(() => setTimeout(() => (loadingRef.current = false), 3000));
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [createSession]);

  // Don't render until booted + sessions exist
  if (!booted || sortedSessions.length === 0) {
    return (
      <div
        style={{
          height: "100dvh",
          width: "100vw",
          background: "var(--color-bg)",
        }}
      />
    );
  }

  return (
    <div
      style={{
        height: "100dvh",
        width: "100vw",
        overflow: "hidden",
        position: "relative",
        background: "var(--color-bg)",
      }}
    >
      <div ref={containerRef} className="feed-container">
        {sortedSessions.map((session) => (
          <div key={session.id} className="card-slide">
            {/* Header bar */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                zIndex: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 24px",
                background:
                  "linear-gradient(to bottom, var(--color-bg) 0%, transparent 100%)",
                pointerEvents: "none",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontStyle: "italic",
                  fontSize: "18px",
                  color: "var(--color-ink)",
                }}
              >
                {session.title}
              </span>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "14px",
                    color: "var(--color-faint)",
                  }}
                >
                  {session.id}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "14px",
                    fontWeight: 600,
                    letterSpacing: "0.5px",
                    color:
                      session.status === "active"
                        ? "var(--color-green)"
                        : "var(--color-muted)",
                  }}
                >
                  {session.status === "active" ? "active" : "closed"}
                </span>
              </div>
            </div>

            <div style={{ width: "100%", height: "100%" }}>
              <Chat sessionId={session.id} />
            </div>
          </div>
        ))}
      </div>

      {/* Side controls */}
      <div
        style={{
          position: "fixed",
          right: 16,
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <button
          onClick={toggleTheme}
          style={{
            width: 36,
            height: 36,
            borderRadius: 2,
            background:
              theme === "light" ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)",
            border: `1px solid ${theme === "light" ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.15)"}`,
            cursor: "pointer",
            fontFamily: "var(--font-body)",
            fontSize: "14px",
            fontWeight: 600,
            color:
              theme === "light" ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.5)",
          }}
          title={
            theme === "light" ? "Switch to dark mode" : "Switch to light mode"
          }
        >
          {theme === "light" ? "dark" : "light"}
        </button>
        <button
          onClick={() => createSession({ title: "Claude Code" })}
          style={{
            width: 36,
            height: 36,
            borderRadius: 2,
            background:
              theme === "light" ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)",
            border: `1px solid ${theme === "light" ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.15)"}`,
            cursor: "pointer",
            fontFamily: "var(--font-body)",
            fontSize: "18px",
            color:
              theme === "light" ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.5)",
          }}
          title="New session"
        >
          +
        </button>
      </div>
    </div>
  );
}
