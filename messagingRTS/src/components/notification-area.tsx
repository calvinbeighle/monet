// Notification area per Spec 12
// Stacks in bottom-left of map viewport, does not overlap minimap (bottom-right)
// Each notification is individually dismissible with animated removal
// Auto-dismisses oldest beyond MAX_VISIBLE_NOTIFICATIONS

import { useAppStore } from "../lib/stores";
import type { ShellNotification } from "../lib/stores";

const severityStyles: Record<string, string> = {
  info: "border-blue-800 bg-blue-950/80",
  warning: "border-yellow-800 bg-yellow-950/80",
  critical: "border-red-800 bg-red-950/80",
  success: "border-green-800 bg-green-950/80",
};

const severityDotStyles: Record<string, string> = {
  info: "bg-blue-400",
  warning: "bg-yellow-400",
  critical: "bg-red-400",
  success: "bg-green-400",
};

export function NotificationArea() {
  const notifications = useAppStore((s) => s.notifications);
  const dismissNotification = useAppStore((s) => s.dismissNotification);

  const visible = notifications.filter((n: ShellNotification) => !n.dismissed);

  if (visible.length === 0) return null;

  return (
    <div
      className="absolute bottom-2 left-2 z-20 flex flex-col-reverse gap-1"
      data-testid="notification-area"
    >
      {visible.map((notification: ShellNotification) => (
        <div
          key={notification.id}
          className={`flex items-start gap-2 rounded border px-3 py-2 ${severityStyles[notification.severity] || severityStyles.info}`}
          data-testid={`notification-${notification.id}`}
        >
          <div
            className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${severityDotStyles[notification.severity] || severityDotStyles.info}`}
          />
          <span className="flex-1 text-xs text-gray-300">{notification.message}</span>
          <button
            className="shrink-0 text-xs text-gray-500 hover:text-gray-300"
            onClick={() => dismissNotification(notification.id)}
            data-testid={`notification-dismiss-${notification.id}`}
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}
