import { useEffect, useRef, useState, useCallback } from "react";

function getChatWsUrl(sessionId: string): string {
  const loc = window.location;
  const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${loc.host}/api/chat/sessions/${sessionId}/ws`;
}

type ToolCallEntry = {
  type: "tool_call";
  tool: string;
  summary: string;
};

type ToolResultEntry = {
  type: "tool_result";
  tool: string;
  result: string;
};

type TextEntry = {
  type: "text";
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
};

type FeedEntry = ToolCallEntry | ToolResultEntry | TextEntry;

export function Chat({ sessionId }: { sessionId: string }) {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ws = new WebSocket(getChatWsUrl(sessionId));
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "tool_call") {
          setEntries((prev) => [
            ...prev,
            { type: "tool_call", tool: msg.tool, summary: msg.summary },
          ]);
        } else if (msg.type === "tool_result") {
          setEntries((prev) => [
            ...prev,
            { type: "tool_result", tool: msg.tool, result: msg.result },
          ]);
        } else if (msg.type === "delta") {
          // Streaming text - append to last text entry or create new
          setEntries((prev) => {
            const last = prev[prev.length - 1];
            if (
              last &&
              last.type === "text" &&
              last.role === "assistant" &&
              last.streaming
            ) {
              return [
                ...prev.slice(0, -1),
                { ...last, content: last.content + msg.content },
              ];
            }
            return [
              ...prev,
              {
                type: "text",
                role: "assistant",
                content: msg.content,
                streaming: true,
              },
            ];
          });
        } else if (msg.type === "done") {
          setEntries((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.type === "text" && last.role === "assistant") {
              return [
                ...prev.slice(0, -1),
                { type: "text", role: "assistant", content: msg.content },
              ];
            }
            // If no streaming text was shown, add the final message
            if (msg.content) {
              return [
                ...prev,
                { type: "text", role: "assistant", content: msg.content },
              ];
            }
            return prev;
          });
          setStreaming(false);
        } else if (msg.type === "error") {
          setEntries((prev) => [
            ...prev,
            {
              type: "text",
              role: "assistant",
              content: `Error: ${msg.content}`,
            },
          ]);
          setStreaming(false);
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = () => setStreaming(false);
    return () => ws.close();
  }, [sessionId]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || streaming || !wsRef.current) return;
    if (wsRef.current.readyState !== WebSocket.OPEN) return;

    setEntries((prev) => [
      ...prev,
      { type: "text", role: "user", content: text },
    ]);
    setInput("");
    setStreaming(true);
    wsRef.current.send(JSON.stringify({ type: "message", content: text }));
  }, [input, streaming]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--color-bg)",
      }}
    >
      {/* Feed */}
      <div
        style={{
          flex: 1,
          overflowY: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          padding: "24px 32px",
        }}
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {entries.length === 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: "24px",
                color: "var(--color-ink)",
              }}
            >
              Ask anything.
            </span>
          </div>
        )}

        {entries.map((entry, i) => {
          if (entry.type === "tool_call") {
            return (
              <div
                key={i}
                style={{
                  marginBottom: 6,
                  padding: "6px 10px",
                  borderLeft: "2px solid var(--color-rule)",
                  background: "var(--color-tint)",
                  borderRadius: 2,
                }}
              >
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: "15px",
                    color: "var(--color-soft)",
                  }}
                >
                  {entry.summary}
                </span>
              </div>
            );
          }

          if (entry.type === "tool_result") {
            return (
              <div
                key={i}
                style={{
                  marginBottom: 12,
                  paddingLeft: 12,
                  borderLeft: "2px solid var(--color-rule)",
                }}
              >
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: "14px",
                    color: "var(--color-muted)",
                  }}
                >
                  {entry.result.length > 120
                    ? entry.result.slice(0, 117) + "..."
                    : entry.result}
                </span>
              </div>
            );
          }

          // Text entry
          return (
            <div key={i} style={{ marginBottom: 16 }}>
              {entry.role === "user" && (
                <div
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "14px",
                    color: "var(--color-faint)",
                    marginBottom: 4,
                    textTransform: "uppercase",
                    letterSpacing: "1.2px",
                  }}
                >
                  you
                </div>
              )}
              <div
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "18px",
                  lineHeight: 1.7,
                  color: "var(--color-text)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {entry.content}
                {entry.streaming && (
                  <span
                    style={{
                      display: "inline-block",
                      width: 6,
                      height: 14,
                      marginLeft: 2,
                      background: "var(--color-muted)",
                      animation: "blink 1s infinite",
                      verticalAlign: "text-bottom",
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Input */}
      <div
        style={{
          borderTop: "1px solid var(--color-rule)",
          padding: "12px 32px 16px",
          background: "var(--color-bg)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 12,
            border: "1px solid var(--color-input-border)",
            borderRadius: 2,
            padding: "10px 14px",
            background: "var(--color-input-bg)",
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={streaming ? "Working..." : "Message Claude..."}
            disabled={streaming}
            rows={1}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              resize: "none",
              fontFamily: "var(--font-body)",
              fontSize: "18px",
              lineHeight: 1.7,
              color: "var(--color-text)",
              minHeight: 24,
              maxHeight: 120,
              overflow: "auto",
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 120) + "px";
            }}
          />
          <button
            onClick={send}
            disabled={streaming || !input.trim()}
            style={{
              background: "transparent",
              border: "none",
              cursor: streaming || !input.trim() ? "default" : "pointer",
              fontFamily: "var(--font-body)",
              fontSize: "15px",
              color:
                streaming || !input.trim()
                  ? "var(--color-ghost)"
                  : "var(--color-muted)",
              padding: "2px 0",
            }}
          >
            send
          </button>
        </div>
      </div>
    </div>
  );
}
