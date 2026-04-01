import { useEffect, useRef, useCallback } from "react";
import { useFeedStore } from "../stores/feed-store";
import { Card } from "./Card";

export function Feed() {
  const { cards, activeIndex, setActiveIndex, addCard } = useFeedStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(addCard());
    }
    await Promise.all(promises);
    loadingRef.current = false;
  }, [addCard]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const index = Math.round(container.scrollTop / container.clientHeight);
      setActiveIndex(index);

      const totalCards = useFeedStore.getState().cards.length;
      if (index >= totalCards - 3) {
        loadMore();
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [setActiveIndex, loadMore]);

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

      {/* Minimal theme toggle */}
      <div className="fixed bottom-5 right-5 z-50">
        <span className="text-white/10 text-[10px]">dark</span>
      </div>

      {/* Add button */}
      <div className="fixed top-5 right-5 z-50">
        <button
          onClick={() => addCard()}
          className="text-white/20 text-2xl hover:text-white/50 transition"
        >
          +
        </button>
      </div>
    </div>
  );
}
