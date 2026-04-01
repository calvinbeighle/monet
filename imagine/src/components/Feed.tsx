import { useEffect, useRef } from "react";
import { useFeedStore } from "../stores/feed-store";
import { Card } from "./Card";

export function Feed() {
  const { cards, activeIndex, setActiveIndex, addCard, removeCard } =
    useFeedStore();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const index = Math.round(container.scrollTop / container.clientHeight);
      setActiveIndex(index);
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [setActiveIndex]);

  return (
    <div
      style={{
        height: "100dvh",
        width: "100vw",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div ref={containerRef} className="feed-container">
        {cards.map((card, i) => (
          <Card key={card.id} card={card} index={i} />
        ))}
      </div>

      {/* Add button - top right */}
      <div className="fixed top-5 right-5 z-50">
        <button
          onClick={() => addCard()}
          className="w-10 h-10 rounded-full bg-white/15 backdrop-blur-md text-white text-2xl flex items-center justify-center hover:bg-white/25 transition"
        >
          +
        </button>
      </div>
    </div>
  );
}
