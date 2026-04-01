export type CardData = {
  id: string;
  status: "idle" | "working" | "done" | "error";
  instruction: string | null;
  summary: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  rawOutput: string;
};

export function connectSSE(
  onInit: (cards: CardData[]) => void,
  onUpdate: (card: CardData) => void,
  onRemove: (id: string) => void,
): EventSource {
  const es = new EventSource("/api/events");

  es.addEventListener("init", (e) => {
    onInit(JSON.parse((e as MessageEvent).data));
  });

  es.addEventListener("update", (e) => {
    onUpdate(JSON.parse((e as MessageEvent).data));
  });

  es.addEventListener("remove", (e) => {
    const { id } = JSON.parse((e as MessageEvent).data);
    onRemove(id);
  });

  return es;
}
