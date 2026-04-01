import { useState, useRef, useEffect } from "react";
import type { CardData } from "../lib/sse-client";
import { useFeedStore } from "../stores/feed-store";

function formatOutput(raw: string) {
  const cleaned = raw
    .replace(/---\s*New instruction:.*?---/g, "\n")
    .replace(/\n?\[(\w+):\s*(null[^]*?)?\]\n?/g, (_, tool, arg) => {
      const a = (arg || "").trim();
      if (!a || a === "null" || a.startsWith("null")) return "\n";
      return `\n[${tool}: ${a}]\n`;
    })
    .replace(/([.!?])(?=\s*[A-Z])/g, "$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned.split("\n").map((line, i) => {
    const toolMatch = line.match(/^\[(\w+):\s*(.*)\]$/);
    if (toolMatch) {
      const [, tool, arg] = toolMatch;
      if (!arg || arg === "null") return null;
      return (
        <div key={i} className="text-white/20 text-[11px] my-0.5">
          <span className="text-white/30">{tool.toLowerCase()}</span> {arg}
        </div>
      );
    }

    if (!line.trim()) return <div key={i} className="h-1.5" />;

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

    if (line.startsWith("- ")) {
      return (
        <div key={i} className="pl-3 text-white/70 my-0.5">
          {rendered}
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
  "from-slate-950 via-slate-900 to-slate-950",
  "from-zinc-950 via-zinc-900 to-zinc-950",
  "from-neutral-950 via-neutral-900 to-neutral-950",
  "from-stone-950 via-stone-900 to-stone-950",
  "from-gray-950 via-gray-900 to-gray-950",
  "from-slate-950 via-gray-900 to-neutral-950",
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

  const statusLabel =
    card.status === "working"
      ? "active"
      : card.status === "done"
        ? "done"
        : card.status === "error"
          ? "error"
          : "";

  const statusColor =
    card.status === "working"
      ? "text-amber-400"
      : card.status === "done"
        ? "text-emerald-400"
        : card.status === "error"
          ? "text-red-400"
          : "";

  return (
    <div className="card-slide">
      {/* Background */}
      {card.videoUrl ? (
        <video
          src={card.videoUrl}
          autoPlay
          loop
          muted
          playsInline
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

      {/* Subtle gradient for readability */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/50" />

      {/* Header - agent name + status */}
      <div
        className="absolute z-10 flex items-center justify-between"
        style={{ top: 20, left: 28, right: 28 }}
      >
        <div className="flex items-center gap-3">
          <span className="text-white/90 text-[15px] font-semibold">
            Claude Code
          </span>
          {statusLabel && (
            <span className={`${statusColor} text-[12px]`}>{statusLabel}</span>
          )}
        </div>
        <span className="text-white/30 text-[12px] font-mono">
          {card.id.slice(0, 8)}
        </span>
      </div>

      {/* Output area */}
      {(card.status === "working" || card.status === "done") &&
      card.rawOutput ? (
        <div
          ref={outputRef}
          className="absolute z-10 overflow-y-auto scrollbar-hide"
          style={{ top: 52, left: 28, right: 28, bottom: 130 }}
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
      ) : (
        /* Idle state */
        <div className="absolute inset-0 flex items-center justify-center z-10 px-16">
          {card.suggestion ? (
            <p className="text-white/40 text-[15px] text-center leading-relaxed">
              {card.suggestion.reason}
            </p>
          ) : (
            <p className="text-white/20 text-[15px]">Ask anything.</p>
          )}
        </div>
      )}

      {/* Bottom input */}
      <form
        onSubmit={handleSubmit}
        className="absolute z-20"
        style={{ bottom: 32, left: 28, right: 28 }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message Claude..."
            style={{
              flex: 1,
              minWidth: 0,
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 12,
              padding: "14px 18px",
              color: "#fff",
              fontSize: 14,
              outline: "none",
              backdropFilter: "blur(12px)",
            }}
          />
          <button
            type="submit"
            style={{
              background: "rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.7)",
              borderRadius: 12,
              padding: "14px 20px",
              fontSize: 13,
              fontWeight: 500,
              border: "1px solid rgba(255,255,255,0.12)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            send
          </button>
        </div>
      </form>
    </div>
  );
}
