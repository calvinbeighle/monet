// Notification area per Spec 12 and Spec 07 (Map Alert Notifications)
// Stacks in bottom-left of map viewport, does not overlap minimap (bottom-right)
// Displays both shell notifications and active map alerts in a unified stack.
// Each item is individually dismissible/acknowledgeable with animated removal.
// Auto-dismisses oldest beyond MAX_VISIBLE_NOTIFICATIONS.

import { useAppStore } from "../lib/stores";
import type { ShellNotification } from "../lib/stores";
import type { MapAlert, MapAlertType } from "../lib/types/game-mechanics";

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

// Map alert types to severity for visual consistency per Spec 07
const alertTypeSeverity: Record<MapAlertType, string> = {
  "new-high-value": "warning",
  "about-to-be-lost": "critical",
  "agent-completed": "success",
  "streak-at-risk": "warning",
};

export function NotificationArea() {
  const notifications = useAppStore((s) => s.notifications);
  const dismissNotification = useAppStore((s) => s.dismissNotification);
  const mapAlerts = useAppStore((s) => s.mapAlerts);
  const acknowledgeMapAlert = useAppStore((s) => s.acknowledgeMapAlert);

  const visibleNotifications = notifications.filter((n: ShellNotification) => !n.dismissed);
  const activeAlerts = mapAlerts.filter((a: MapAlert) => !a.acknowledged && !a.autoResolved);

  if (visibleNotifications.length === 0 && activeAlerts.length === 0) return null;

  return (
    <div
      className="absolute bottom-2 left-2 z-20 flex max-h-52 w-64 flex-col-reverse gap-1 overflow-hidden"
      data-testid="notification-area"
      aria-live="polite"
    >
      {/* Map alerts first (higher priority) */}
      {activeAlerts.map((alert: MapAlert) => {
        const severity = alertTypeSeverity[alert.type];
        return (
          <div
            key={alert.id}
            className={`flex items-start gap-2 rounded border px-3 py-2 ${severityStyles[severity] || severityStyles.info}`}
            data-testid={`map-alert-${alert.id}`}
            role="alert"
          >
            <div
              className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${severityDotStyles[severity] || severityDotStyles.info}`}
            />
            <span className="flex-1 text-xs text-gray-300">{alert.message}</span>
            <button
              className="shrink-0 text-xs text-gray-500 hover:text-gray-300"
              onClick={() => acknowledgeMapAlert(alert.id)}
              data-testid={`map-alert-ack-${alert.id}`}
              aria-label="Acknowledge alert"
            >
              x
            </button>
          </div>
        );
      })}

      {/* Shell notifications */}
      {visibleNotifications.map((notification: ShellNotification) => (
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
