// Session summary modal per Spec 12
// Full-screen overlay, dims content beneath, disables all interactions
// Opens from session summary trigger in status bar
// Closes on Escape, close button, or click on dimmed backdrop

import { useEffect, useRef } from "react";
import { useAppStore } from "../lib/stores";

export interface SessionSummaryData {
  threadsHandled: number;
  opportunitiesCaptured: number;
  opportunitiesMissed: number;
  risksMitigated: number;
  agentsDeployed: number;
  netHealthChange: number;
  sessionDurationMs: number;
}

interface SessionSummaryModalProps {
  data: SessionSummaryData;
  triggeredFrom: HTMLElement | null;
}

export function SessionSummaryModal({ data, triggeredFrom }: SessionSummaryModalProps) {
  const setActivePanel = useAppStore((s) => s.setActivePanel);
  const modalRef = useRef<HTMLDivElement>(null);

  const handleClose = () => {
    setActivePanel("none");
    triggeredFrom?.focus();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
      // Trap focus within modal
      if (e.key === "Tab") {
        const focusable = modalRef.current?.querySelectorAll(
          'button, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable && focusable.length > 0) {
          const first = focusable[0] as HTMLElement;
          const last = focusable[focusable.length - 1] as HTMLElement;
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    // Focus modal on open
    modalRef.current?.focus();
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const durationMinutes = Math.round(data.sessionDurationMs / 60000);
  const healthSign = data.netHealthChange >= 0 ? "+" : "";
  const healthColor = data.netHealthChange >= 0 ? "text-green-400" : "text-red-400";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      data-testid="session-summary-backdrop"
    >
      <div
        ref={modalRef}
        className="w-96 rounded-lg border border-gray-700 bg-[#0e0e1a] p-6 shadow-xl"
        tabIndex={-1}
        data-testid="session-summary-modal"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-200">Session Summary</h2>
          <button
            className="text-xs text-gray-500 hover:text-gray-300"
            onClick={handleClose}
            data-testid="session-summary-close"
          >
            Close
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Duration</span>
            <span className="text-sm font-mono text-gray-300">{durationMinutes}m</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Threads Handled</span>
            <span className="text-sm font-mono text-gray-300">{data.threadsHandled}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Opportunities Captured</span>
            <span className="text-sm font-mono text-green-400">{data.opportunitiesCaptured}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Opportunities Missed</span>
            <span className="text-sm font-mono text-red-400">{data.opportunitiesMissed}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Risks Mitigated</span>
            <span className="text-sm font-mono text-gray-300">{data.risksMitigated}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Agents Deployed</span>
            <span className="text-sm font-mono text-gray-300">{data.agentsDeployed}</span>
          </div>

          <div className="border-t border-gray-800 pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Net Health Change</span>
              <span className={`text-sm font-mono ${healthColor}`}>
                {healthSign}
                {data.netHealthChange}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
