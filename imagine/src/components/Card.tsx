import { useState, useRef, useEffect } from "react";
import type { CardData } from "../lib/sse-client";
import { useFeedStore } from "../stores/feed-store";

function formatOutput(raw: string) {
  const cleaned = raw
    // Remove separator lines
    .replace(/---\s*New instruction:.*?---/g, "\n")
    // Remove empty tool calls like [Bash: ] or [Bash: null...]
    .replace(/\n?\[(\w+):\s*(null[^]*?)?\]\n?/g, (_, tool, arg) => {
      const a = (arg || "").trim();
      if (!a || a === "null" || a.startsWith("null")) return "\n";
      return `\n[${tool}: ${a}]\n`;
    })
    // Add newlines after sentences followed by capital letters
    .replace(/([.!?])(?=\s*[A-Z])/g, "$1\n")
    // Collapse multiple newlines
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned.split("\n").map((line, i) => {
    // Tool call lines - show as subtle indicator
    const toolMatch = line.match(/^\[(\w+):\s*(.*)\]$/);
    if (toolMatch) {
      const [, tool, arg] = toolMatch;
      if (!arg || arg === "null") return null;
      return (
        <div
          key={i}
          className="text-white/25 text-[11px] my-1 flex items-center gap-1.5"
        >
          <span className="inline-block w-1 h-1 rounded-full bg-white/20" />
          <span>{tool.toLowerCase()}</span>
          <span className="text-white/15">{arg}</span>
        </div>
      );
    }

    // Empty lines
    if (!line.trim()) return <div key={i} className="h-2" />;

    // Render markdown bold and bullet points
    const parts = line.split(/(\*\*.*?\*\*)/g);
    const rendered = parts.map((part, j) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={j} className="text-white font-semibold">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return <span key={j}>{part}</span>;
    });

    // Bullet points
    if (line.startsWith("- ")) {
      return (
        <div key={i} className="pl-3 text-white/70 my-0.5">
          <span className="text-white/30 mr-1.5">-</span>
          {parts.map((part, j) => {
            if (part.startsWith("**") && part.endsWith("**")) {
              return (
                <strong key={j} className="text-white/90 font-medium">
                  {part.slice(2, -2)}
                </strong>
              );
            }
            return <span key={j}>{part.replace(/^- /, "")}</span>;
          })}
        </div>
      );
    }

    return (
      <div key={i} className="text-white/80 my-0.5">
        {rendered}
      </div>
    );
  });
}

const IDLE_COLORS = [
  "from-violet-950 via-indigo-900 to-slate-950",
  "from-emerald-950 via-teal-900 to-slate-950",
  "from-rose-950 via-pink-900 to-slate-950",
  "from-amber-950 via-orange-900 to-slate-950",
  "from-cyan-950 via-sky-900 to-slate-950",
  "from-fuchsia-950 via-purple-900 to-slate-950",
];

export function Card({ card, index }: { card: CardData; index: number }) {
  const [input, setInput] = useState("");
  const [videoFailed, setVideoFailed] = useState(false);
  const sendInstruction = useFeedStore((s) => s.sendInstruction);
  const outputRef = useRef<HTMLDivElement>(null);
  const bgColor = IDLE_COLORS[index % IDLE_COLORS.length];

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [card.rawOutput]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendInstruction(card.id, input.trim());
    setInput("");
  };

  return (
    <div className="card-slide">
      {/* Background - video, image, or gradient */}
      {card.videoUrl && !videoFailed ? (
        <video
          src={card.videoUrl}
          autoPlay
          loop
          muted
          playsInline
          onError={() => setVideoFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : card.imageUrl ? (
        <img
          src={card.imageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-br ${bgColor}`} />
      )}

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/30" />

      {/* === TikTok-style layout === */}

      {/* Right side action column */}
      <div
        className="absolute right-4 flex flex-col items-center gap-6 z-20"
        style={{ bottom: 100 }}
      >
        {/* Status indicator */}
        <div className="flex flex-col items-center gap-1">
          {card.status === "idle" && (
            <>
              <div className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="rgba(255,255,255,0.6)"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v8M8 12h8" />
                </svg>
              </div>
              <span className="text-white/40 text-[10px]">Ready</span>
            </>
          )}
          {card.status === "working" && (
            <>
              <div className="w-11 h-11 rounded-full bg-amber-500/20 border-2 border-amber-400/50 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              </div>
              <span className="text-amber-300 text-[10px]">Working</span>
            </>
          )}
          {card.status === "done" && (
            <>
              <div className="w-11 h-11 rounded-full bg-emerald-500/20 border-2 border-emerald-400/50 flex items-center justify-center">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#34d399"
                  strokeWidth="2.5"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <span className="text-emerald-300 text-[10px]">Done</span>
            </>
          )}
          {card.status === "error" && (
            <>
              <div className="w-11 h-11 rounded-full bg-red-500/20 border-2 border-red-400/50 flex items-center justify-center">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#f87171"
                  strokeWidth="2.5"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </div>
              <span className="text-red-300 text-[10px]">Error</span>
            </>
          )}
        </div>

        {/* Agent avatar */}
        <div className="flex flex-col items-center gap-1">
          <div className="w-11 h-11 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white/70 text-sm font-bold">
            {index + 1}
          </div>
          <span className="text-white/40 text-[10px]">Agent</span>
        </div>
      </div>

      {/* Live output at top */}
      {(card.status === "working" || card.status === "done") &&
        card.rawOutput && (
          <div
            ref={outputRef}
            className="absolute z-10 overflow-y-auto scrollbar-hide"
            style={{
              top: 16,
              left: 24,
              right: 80,
              bottom: 160,
            }}
          >
            <div
              className="text-[13px]"
              style={{
                lineHeight: 1.7,
                fontFamily:
                  "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              }}
            >
              {formatOutput(card.rawOutput)}
            </div>
          </div>
        )}

      {/* Bottom section - text + input in a single flex column */}
      <div
        className="absolute z-20"
        style={{
          bottom: 32,
          left: 24,
          right: 24,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {/* Text info */}
        <div style={{ paddingRight: 56, paddingLeft: 22 }}>
          <p className="text-white font-bold text-[16px] mb-1">
            @agent-{card.id.slice(0, 6)}
          </p>
          {card.instruction && (
            <p className="text-white text-[14px] leading-snug">
              {card.instruction}
            </p>
          )}
          {/* Summary shown at top, not here */}
          {card.status === "error" && card.summary && (
            <p className="text-red-300 text-[13px]">{card.summary}</p>
          )}
          {card.status === "idle" && !card.instruction && (
            <p className="text-white/30 text-[14px]">Ask anything.</p>
          )}
        </div>

        {/* Input bar */}
        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Add an instruction..."
              style={{
                flex: 1,
                minWidth: 0,
                background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 9999,
                padding: "14px 22px",
                color: "#fff",
                fontSize: 15,
                outline: "none",
                backdropFilter: "blur(12px)",
              }}
            />
            <button
              type="submit"
              style={{
                background: "#fff",
                color: "#000",
                borderRadius: 9999,
                padding: "14px 28px",
                fontSize: 15,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
