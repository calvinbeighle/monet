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
    // Add 10 cards in batch
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(addCard());
    }
    await Promise.all(promises);
    loadingRef.current = false;
  }, [addCard]);

  // ESC to interrupt the current agent
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const state = useFeedStore.getState();
        const current = state.cards[state.activeIndex];
        if (current && current.status === "working") {
          state.interruptCard(current.id);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const index = Math.round(container.scrollTop / container.clientHeight);
      setActiveIndex(index);

      // When within 3 cards of the end, load 10 more
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
