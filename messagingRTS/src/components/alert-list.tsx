// Alert list panel per Spec 07 - shows map alerts with dismiss/acknowledge
// Triggered by clicking the alert badge in the status bar

import { useRef, useEffect, useCallback } from "react";
import { useAppStore } from "../lib/stores";

const ALERT_TYPE_LABELS: Record<string, string> = {
  "about-to-be-lost": "Thread about to be lost",
  "new-high-value": "New high-value thread",
  "streak-at-risk": "Streak at risk",
  "agent-completed": "Agent task completed",
};

const ALERT_SEVERITY_COLORS: Record<string, string> = {
  "about-to-be-lost": "border-l-red-500 bg-red-900/10",
  "new-high-value": "border-l-yellow-500 bg-yellow-900/10",
  "streak-at-risk": "border-l-yellow-500 bg-yellow-900/10",
  "agent-completed": "border-l-green-500 bg-green-900/10",
};

interface AlertListProps {
  onClose: () => void;
}

export function AlertList({ onClose }: AlertListProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus panel on mount per Spec 12 Section 12
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Trap focus within panel and handle Escape per Spec 12
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab") {
        e.preventDefault();
        const focusable = panelRef.current?.querySelectorAll(
          'input, button, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable && focusable.length > 0) {
          const elements = Array.from(focusable) as HTMLElement[];
          const currentIdx = elements.indexOf(document.activeElement as HTMLElement);
          const direction = e.shiftKey ? -1 : 1;
          const nextIdx = (currentIdx + direction + elements.length) % elements.length;
          elements[nextIdx].focus();
        }
      }
    },
    [onClose],
  );

  const mapAlerts = useAppStore((s) => s.mapAlerts);
  const acknowledgeMapAlert = useAppStore((s) => s.acknowledgeMapAlert);

  const activeAlerts = mapAlerts.filter((a) => !a.autoResolved);
  const unacknowledged = activeAlerts.filter((a) => !a.acknowledged);
  const acknowledged = activeAlerts.filter((a) => a.acknowledged);

  return (
    <div
      ref={panelRef}
      className="w-80 rounded-lg border border-gray-700 bg-[#14142a] p-4 shadow-xl"
      data-testid="alert-list"
      role="dialog"
      aria-modal="true"
      aria-label="Map alerts"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-200">
          Alerts{unacknowledged.length > 0 && ` (${unacknowledged.length})`}
        </h3>
        <button
          className="text-gray-500 hover:text-gray-300 text-xs"
          onClick={onClose}
          aria-label="Close alerts"
          data-testid="close-alert-list"
        >
          x
        </button>
      </div>

      {activeAlerts.length === 0 && (
        <p className="text-xs text-gray-600" data-testid="no-alerts">
          No active alerts
        </p>
      )}

      {/* Unacknowledged alerts first */}
      {unacknowledged.length > 0 && (
        <div className="space-y-1.5" data-testid="unacknowledged-alerts">
          {unacknowledged.map((alert) => (
            <div
              key={alert.id}
              className={`flex items-start justify-between rounded border-l-2 px-2.5 py-1.5 ${ALERT_SEVERITY_COLORS[alert.type] ?? "border-l-gray-500 bg-gray-900/10"}`}
              data-testid={`alert-item-${alert.id}`}
            >
              <div className="flex-1 min-w-0">
                <span className="block text-[10px] uppercase tracking-wider text-gray-500">
                  {ALERT_TYPE_LABELS[alert.type] ?? alert.type}
                </span>
                <span className="block text-xs text-gray-300 truncate">
                  {alert.threadId ?? "System alert"}
                </span>
              </div>
              <button
                className="ml-2 shrink-0 rounded bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400 hover:bg-gray-600 hover:text-gray-200"
                onClick={() => acknowledgeMapAlert(alert.id)}
                data-testid={`acknowledge-alert-${alert.id}`}
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Acknowledged alerts */}
      {acknowledged.length > 0 && (
        <div className="mt-2 space-y-1" data-testid="acknowledged-alerts">
          <span className="text-[9px] uppercase tracking-wider text-gray-600">Dismissed</span>
          {acknowledged.map((alert) => (
            <div
              key={alert.id}
              className="flex items-center rounded border-l-2 border-l-gray-700 bg-gray-900/20 px-2.5 py-1 opacity-50"
              data-testid={`alert-item-${alert.id}`}
            >
              <div className="flex-1 min-w-0">
                <span className="text-[10px] text-gray-500">
                  {ALERT_TYPE_LABELS[alert.type] ?? alert.type}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
