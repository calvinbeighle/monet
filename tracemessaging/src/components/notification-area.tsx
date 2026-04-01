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
    info: "border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.04)]",
    warning: "border-[rgba(180,130,0,0.3)] bg-[rgba(180,130,0,0.06)]",
    error: "border-[rgba(180,0,0,0.3)] bg-[rgba(180,0,0,0.06)]",
  };

  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {visible.map((n) => (
        <div
          key={n.id}
          className={`flex items-center gap-3 rounded-sm border px-4 py-2.5 text-[0.85rem] text-[var(--text-secondary)] shadow-lg ${typeStyles[n.type]}`}
          style={{ fontFamily: "var(--font-body)" }}
        >
          <span className="flex-1">{n.message}</span>
          {n.dismissable && (
            <button
              onClick={() => dismissNotification(n.id)}
              className="cursor-pointer border-none bg-transparent text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
            >
              x
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
