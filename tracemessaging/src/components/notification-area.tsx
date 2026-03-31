import { useEffect } from "react";
import { useAppStore, MAX_VISIBLE_NOTIFICATIONS } from "../lib/stores";

export function NotificationArea() {
  const notifications = useAppStore((s) => s.notifications);
  const dismissNotification = useAppStore((s) => s.dismissNotification);

  const visible = notifications.slice(0, MAX_VISIBLE_NOTIFICATIONS);

  // Auto-dismiss timers
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const n of visible) {
      if (n.autoDismissMs !== null) {
        const timer = setTimeout(
          () => dismissNotification(n.id),
          n.autoDismissMs,
        );
        timers.push(timer);
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [visible, dismissNotification]);

  if (visible.length === 0) return null;

  const typeStyles = {
    info: "border-[rgba(107,197,255,0.3)] bg-[rgba(107,197,255,0.08)]",
    warning: "border-[rgba(255,184,108,0.3)] bg-[rgba(255,184,108,0.08)]",
    error: "border-[rgba(255,107,107,0.3)] bg-[rgba(255,107,107,0.08)]",
  };

  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {visible.map((n) => (
        <div
          key={n.id}
          className={`flex items-center gap-3 rounded-md border px-4 py-2.5 font-mono text-[0.78rem] text-[rgba(255,255,255,0.7)] shadow-lg ${typeStyles[n.type]}`}
        >
          <span className="flex-1">{n.message}</span>
          {n.dismissable && (
            <button
              onClick={() => dismissNotification(n.id)}
              className="cursor-pointer border-none bg-transparent text-[rgba(255,255,255,0.3)] transition-colors hover:text-[rgba(255,255,255,0.7)]"
            >
              x
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
