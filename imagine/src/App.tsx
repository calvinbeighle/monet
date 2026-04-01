import { useEffect } from "react";
import { useFeedStore } from "./stores/feed-store";
import { Feed } from "./components/Feed";

export default function App() {
  const init = useFeedStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  return <Feed />;
}
