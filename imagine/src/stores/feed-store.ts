import { create } from "zustand";
import type { CardData } from "../lib/sse-client";
import { connectSSE } from "../lib/sse-client";

interface FeedState {
  cards: CardData[];
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  init: () => void;
  sendInstruction: (id: string, instruction: string) => Promise<void>;
  addCard: () => Promise<void>;
  removeCard: (id: string) => Promise<void>;
}

export const useFeedStore = create<FeedState>((set) => ({
  cards: [],
  activeIndex: 0,

  setActiveIndex: (i) => set({ activeIndex: i }),

  init: () => {
    connectSSE(
      (cards) => set({ cards }),
      (card) =>
        set((s) => ({
          cards: s.cards.map((c) => (c.id === card.id ? card : c)),
        })),
      (id) =>
        set((s) => ({
          cards: s.cards.filter((c) => c.id !== id),
        })),
    );
  },

  sendInstruction: async (id, instruction) => {
    await fetch(`/api/cards/${id}/instruct`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction }),
    });
  },

  addCard: async () => {
    const res = await fetch("/api/cards", { method: "POST" });
    const card = await res.json();
    set((s) => ({ cards: [...s.cards, card] }));
  },

  removeCard: async (id) => {
    await fetch(`/api/cards/${id}`, { method: "DELETE" });
  },
}));
