// Terminal detail view - full terminal (xterm.js) for a session

import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "@/lib/stores";
import { useTerminalStore } from "@/lib/stores/terminal-store";
import { Terminal } from "@/components/terminal";

export function WorkstreamDetail({ workstreamId }: { workstreamId: string }) {
  const navigate = useAppStore((s) => s.navigate);
  const session = useTerminalStore((s) => s.sessions.get(workstreamId));
  const killSession = useTerminalStore((s) => s.killSession);
  const fetchSessions = useTerminalStore((s) => s.fetchSessions);
  const createSession = useTerminalStore((s) => s.createSession);
  const [launching, setLaunching] = useState(false);

  // If session not found, try fetching. If still not found after fetch, show create options.
  useEffect(() => {
    if (!session) {
      fetchSessions();
    }
  }, [session, fetchSessions]);

  const goBack = useCallback(() => {
    navigate({ view: "timeline" });
  }, [navigate]);

  const handleKill = useCallback(async () => {
    await killSession(workstreamId);
    navigate({ view: "timeline" });
  }, [killSession, workstreamId, navigate]);

  const handleLaunch = useCallback(
    async (command?: string, title?: string) => {
      setLaunching(true);
      try {
        const s = await createSession({
          command,
          title: title ?? "Terminal",
        });
        navigate({ view: "detail", workstreamId: s.id });
      } catch {
        navigate({ view: "timeline" });
      } finally {
        setLaunching(false);
      }
    },
    [createSession, navigate],
  );

  if (!session) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#000000]">
        <p
          className="text-[0.95rem]"
          style={{
            fontFamily: '"Playfair Display", Georgia, serif',
            fontStyle: "italic",
            color: "rgba(255,255,255,0.4)",
          }}
        >
          No active session.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={() => handleLaunch("claude", "Claude Code")}
            disabled={launching}
            className="cursor-pointer rounded-sm border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-6 py-3 text-left transition-all hover:border-[rgba(255,255,255,0.15)] hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-30"
          >
            <span
              className="text-[0.85rem]"
              style={{
                fontFamily: '"Crimson Text", serif',
                color: "rgba(255,255,255,0.7)",
              }}
            >
              {launching ? "Launching..." : "Launch Claude Code"}
            </span>
            <span
              className="ml-3 text-[0.75rem]"
              style={{
                fontFamily: '"Crimson Text", serif',
                color: "rgba(255,255,255,0.2)",
              }}
            >
              -&gt;
            </span>
          </button>
          <button
            onClick={() => handleLaunch(undefined, "Terminal")}
            disabled={launching}
            className="cursor-pointer rounded-sm border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-6 py-3 text-left transition-all hover:border-[rgba(255,255,255,0.15)] hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-30"
          >
            <span
              className="text-[0.85rem]"
              style={{
                fontFamily: '"Crimson Text", serif',
                color: "rgba(255,255,255,0.7)",
              }}
            >
              Launch terminal
            </span>
            <span
              className="ml-3 text-[0.75rem]"
              style={{
                fontFamily: '"Crimson Text", serif',
                color: "rgba(255,255,255,0.2)",
              }}
            >
              -&gt;
            </span>
          </button>
          <button
            onClick={goBack}
            className="mt-2 cursor-pointer border-none bg-transparent text-[0.8rem] transition-colors hover:text-[rgba(255,255,255,0.5)]"
            style={{
              fontFamily: '"Crimson Text", serif',
              color: "rgba(255,255,255,0.2)",
            }}
          >
            back to feed
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#000000]">
      {/* Minimal header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.08)] px-4 py-2">
        <div className="flex items-center gap-4">
          <button
            onClick={goBack}
            className="cursor-pointer border-none bg-transparent text-[0.85rem] transition-colors hover:text-[rgba(255,255,255,0.6)]"
            style={{
              fontFamily: '"Crimson Text", serif',
              color: "rgba(255,255,255,0.3)",
            }}
          >
            &lt;-
          </button>
          <span
            style={{
              fontFamily: '"Playfair Display", Georgia, serif',
              fontStyle: "italic",
              fontSize: "0.95rem",
              color: "rgba(255,255,255,0.7)",
            }}
          >
            {session.title}
          </span>
          <span
            className="text-[0.7rem]"
            style={{
              fontFamily: '"Crimson Text", serif',
              color:
                session.status === "running"
                  ? "rgba(0,120,0,0.8)"
                  : "rgba(255,255,255,0.2)",
            }}
          >
            {session.status}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="text-[0.7rem]"
            style={{
              fontFamily: '"Crimson Text", serif',
              color: "rgba(255,255,255,0.15)",
            }}
          >
            {session.id}
          </span>
          {session.status === "running" && (
            <button
              onClick={handleKill}
              className="cursor-pointer rounded-sm border border-[rgba(180,0,0,0.3)] bg-transparent px-2.5 py-0.5 text-[0.7rem] transition-all hover:border-[rgba(180,0,0,0.5)] hover:bg-[rgba(180,0,0,0.08)]"
              style={{
                fontFamily: '"Crimson Text", serif',
                color: "rgba(180,0,0,0.8)",
              }}
            >
              kill
            </button>
          )}
        </div>
      </div>

      {/* Terminal */}
      <div className="flex-1 overflow-hidden">
        <Terminal sessionId={workstreamId} />
      </div>
    </div>
  );
}
