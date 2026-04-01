import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useTerminalStore } from "@/lib/stores/terminal-store";
import { useThemeStore } from "@/lib/stores/theme-store";
import { Chat } from "@/components/chat";

let _booted = false;

export function WorkstreamTimeline() {
  const sessions = useTerminalStore((s) => s.sessions);
  const createSession = useTerminalStore((s) => s.createSession);
  const fetchSessions = useTerminalStore((s) => s.fetchSessions);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);

  const containerRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [booted, setBooted] = useState(false);

  // No polling - sessions are created locally via boot + scroll

  const sortedSessions = useMemo(
    () => [...sessions.values()].sort((a, b) => a.createdAt - b.createdAt),
    [sessions],
  );

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      for (let i = 0; i < 3; i++) {
        await createSession({ title: "Claude Code" });
      }
    } catch (err) {
      console.error("[Feed] Failed to create sessions:", err);
    } finally {
      // Prevent rapid re-triggering
      setTimeout(() => {
        loadingRef.current = false;
      }, 3000);
    }
  }, [createSession]);

  const addCard = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      await createSession({ title: "Claude Code" });
    } catch (err) {
      console.error("[Feed] Failed to create session:", err);
    } finally {
      loadingRef.current = false;
    }
  }, [createSession]);

  useEffect(() => {
    if (!booted) return;
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const index = Math.round(container.scrollTop / container.clientHeight);
      setActiveIndex(index);

      const totalSessions = useTerminalStore.getState().sessions.size;
      if (index >= totalSessions - 2) {
        loadMore();
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [booted, loadMore]);

  // Boot with 5 sessions (module-level guard survives HMR)
  useEffect(() => {
    if (_booted) {
      setBooted(true);
      return;
    }
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

  // Empty / loading state
  if (sortedSessions.length === 0) {
    return (
      <div
        style={{
          height: "100dvh",
          width: "100vw",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--color-bg)",
        }}
      >
        <motion.div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: "1.4rem",
              color: "var(--color-ghost)",
            }}
          >
            trace.
          </span>
          <div className="bi-separator" style={{ marginTop: 16 }} />
          <span
            style={{
              marginTop: 16,
              fontFamily: "var(--font-body)",
              fontSize: "0.85rem",
              color: "var(--color-faint)",
            }}
          >
            launching...
          </span>
        </motion.div>
      </div>
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
            {/* Overlay header */}
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
                background: `linear-gradient(to bottom, var(--color-bg) 0%, transparent 100%)`,
                pointerEvents: "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontStyle: "italic",
                    fontSize: "0.9rem",
                    color: "var(--color-muted)",
                  }}
                >
                  {session.title}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "0.7rem",
                    color:
                      session.status === "active"
                        ? "var(--color-green)"
                        : "var(--color-faint)",
                  }}
                >
                  {session.status === "active" ? "active" : "closed"}
                </span>
              </div>
              <span
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "0.7rem",
                  color: "var(--color-ghost)",
                }}
              >
                {session.id}
              </span>
            </div>

            <div style={{ width: "100%", height: "100%" }}>
              <Chat sessionId={session.id} />
            </div>
          </div>
        ))}

        {/* Empty spacer so last real card can snap */}
      </div>

      {/* Right side controls */}
      <div
        style={{
          position: "fixed",
          right: 16,
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        {/* Theme toggle */}
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
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-body)",
            fontSize: "0.7rem",
            fontWeight: 600,
            color:
              theme === "light" ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.5)",
            transition: "all 0.2s",
          }}
          title={
            theme === "light" ? "Switch to dark mode" : "Switch to light mode"
          }
        >
          {theme === "light" ? "dark" : "light"}
        </button>

        {/* Add session */}
        <button
          onClick={addCard}
          style={{
            width: 36,
            height: 36,
            borderRadius: 2,
            background:
              theme === "light" ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)",
            border: `1px solid ${theme === "light" ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.15)"}`,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-body)",
            fontSize: "1.1rem",
            color:
              theme === "light" ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.5)",
            transition: "all 0.2s",
          }}
          title="New session"
        >
          +
        </button>
      </div>
    </div>
  );
}
