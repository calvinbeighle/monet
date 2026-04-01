import { useState, useRef, useEffect } from "react";
import type { CardData } from "../lib/sse-client";
import { useFeedStore } from "../stores/feed-store";

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
      {/* Background */}
      {card.imageUrl ? (
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
      <div className="absolute right-4 bottom-32 flex flex-col items-center gap-6 z-20">
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

      {/* Left side content */}
      <div
        className="absolute z-10"
        style={{ bottom: 120, left: 16, right: 80 }}
      >
        <p className="text-white font-bold text-[16px] mb-1">
          @agent-{card.id.slice(0, 6)}
        </p>

        {card.instruction && (
          <p className="text-white text-[15px] leading-snug mb-2">
            {card.instruction}
          </p>
        )}

        {card.status === "done" && card.summary && (
          <p className="text-white/70 text-[13px] leading-relaxed line-clamp-3">
            {card.summary}
          </p>
        )}

        {card.status === "error" && card.summary && (
          <p className="text-red-300 text-[13px]">{card.summary}</p>
        )}

        {card.status === "idle" && !card.instruction && (
          <p className="text-white/40 text-[15px]">
            Waiting for instructions...
          </p>
        )}
      </div>

      {/* Compact output text at top */}
      {card.status === "working" && card.rawOutput && (
        <div
          ref={outputRef}
          className="absolute z-10 overflow-hidden scrollbar-hide"
          style={{ top: 16, left: 16, right: 80, maxHeight: 60 }}
        >
          <p className="text-white/80 text-[12px] leading-snug line-clamp-3 font-mono">
            {card.rawOutput.slice(-200)}
          </p>
        </div>
      )}

      {/* Bottom input bar */}
      <form
        onSubmit={handleSubmit}
        className="absolute z-20"
        style={{ bottom: 40, left: 32, right: 32 }}
      >
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
              padding: "16px 24px",
              color: "#fff",
              fontSize: 16,
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
              padding: "16px 32px",
              fontSize: 16,
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
  );
}
