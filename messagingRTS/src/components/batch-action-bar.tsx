// Batch action bar per Spec 09 Section "Batch Operations"
// Why: When multiple threads are selected (via Shift+click), the user needs
// accessible controls to apply batch actions. This bar appears above the map
// viewport and provides: mark handled, move to zone, apply label, assign agent.
//
// The bar is visible only when selectedThreadIds.size > 0.
// After any batch action completes, selection is cleared automatically.

import { useState } from "react";
import { useAppStore } from "../lib/stores/app-store";
import { useThreadStore } from "../lib/stores/thread-store";
import {
  batchMarkHandled,
  batchMoveToZone,
  batchApplyLabel,
  batchAssignAgent,
} from "../features/sync/batch-operations";
import type { ZoneId, AgentRole } from "../lib/types";

const ZONE_OPTIONS: { id: ZoneId; label: string }[] = [
  { id: "active-front", label: "Active Front" },
  { id: "opportunities", label: "Opportunities" },
  { id: "at-risk", label: "At Risk" },
  { id: "noise", label: "Noise" },
  { id: "base-handled", label: "Handled" },
];

const AGENT_OPTIONS: { role: AgentRole; label: string }[] = [
  { role: "closer", label: "Closer" },
  { role: "researcher", label: "Researcher" },
  { role: "scheduler", label: "Scheduler" },
  { role: "cleaner", label: "Cleaner" },
  { role: "drafter", label: "Drafter" },
  { role: "escalation-bot", label: "Escalation" },
];

export function BatchActionBar() {
  const selectedThreadIds = useThreadStore((s) => s.selectedThreadIds);
  const clearBatchSelection = useThreadStore((s) => s.clearBatchSelection);
  const quotaExhausted = useAppStore((s) => s.quotaExhausted);
  const [showZoneMenu, setShowZoneMenu] = useState(false);
  const [showAgentMenu, setShowAgentMenu] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  const [showLabelInput, setShowLabelInput] = useState(false);

  const count = selectedThreadIds.size;
  if (count === 0) return null;

  const ids = [...selectedThreadIds];

  const handleMarkHandled = () => {
    batchMarkHandled(ids);
  };

  const handleMoveToZone = (zone: ZoneId) => {
    batchMoveToZone(ids, zone);
    setShowZoneMenu(false);
  };

  const handleApplyLabel = () => {
    if (labelInput.trim()) {
      batchApplyLabel(ids, labelInput.trim());
      setLabelInput("");
      setShowLabelInput(false);
    }
  };

  const handleAssignAgent = (role: AgentRole) => {
    batchAssignAgent(ids, role);
    setShowAgentMenu(false);
  };

  const handleClearSelection = () => {
    clearBatchSelection();
    setShowZoneMenu(false);
    setShowAgentMenu(false);
    setShowLabelInput(false);
  };

  return (
    <div
      className="flex items-center gap-2 bg-[#1a1a2e] border-b border-gray-700 px-3 py-1.5 text-xs text-gray-300"
      data-testid="batch-action-bar"
      role="toolbar"
      aria-label={`Batch actions for ${count} selected threads`}
    >
      <span className="font-medium text-gray-200" data-testid="batch-count">
        {count} selected
      </span>

      <div className="mx-1 h-3 w-px bg-gray-600" />

      {/* Quota exhaustion indicator per Spec 01 */}
      {quotaExhausted && (
        <span className="text-[10px] text-yellow-500" data-testid="batch-quota-warning">
          Quota exhausted
        </span>
      )}

      {/* Mark as Handled */}
      <button
        onClick={handleMarkHandled}
        disabled={quotaExhausted}
        className="rounded px-2 py-0.5 hover:bg-gray-700 transition-colors disabled:opacity-40"
        data-testid="batch-mark-handled"
        aria-label="Mark selected threads as handled"
        title={quotaExhausted ? "Daily Gmail quota exhausted" : undefined}
      >
        Mark Handled
      </button>

      {/* Move to Zone */}
      <div className="relative">
        <button
          onClick={() => {
            setShowZoneMenu(!showZoneMenu);
            setShowAgentMenu(false);
            setShowLabelInput(false);
          }}
          className="rounded px-2 py-0.5 hover:bg-gray-700 transition-colors"
          data-testid="batch-move-zone"
          aria-label="Move selected threads to zone"
          aria-expanded={showZoneMenu}
        >
          Move to Zone
        </button>
        {showZoneMenu && (
          <div
            className="absolute top-full left-0 z-50 mt-1 rounded bg-[#2a2a3e] border border-gray-600 shadow-lg"
            role="menu"
            data-testid="zone-menu"
          >
            {ZONE_OPTIONS.map((z) => (
              <button
                key={z.id}
                onClick={() => handleMoveToZone(z.id)}
                className="block w-full px-3 py-1 text-left hover:bg-gray-600 text-xs"
                role="menuitem"
              >
                {z.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Apply Label */}
      <div className="relative">
        <button
          onClick={() => {
            setShowLabelInput(!showLabelInput);
            setShowZoneMenu(false);
            setShowAgentMenu(false);
          }}
          disabled={quotaExhausted}
          className="rounded px-2 py-0.5 hover:bg-gray-700 transition-colors disabled:opacity-40"
          data-testid="batch-apply-label"
          aria-label="Apply label to selected threads"
          title={quotaExhausted ? "Daily Gmail quota exhausted" : undefined}
        >
          Apply Label
        </button>
        {showLabelInput && (
          <div className="absolute top-full left-0 z-50 mt-1 flex gap-1 rounded bg-[#2a2a3e] border border-gray-600 p-1 shadow-lg">
            <input
              type="text"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleApplyLabel();
                if (e.key === "Escape") setShowLabelInput(false);
              }}
              placeholder="Label name"
              className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-200 outline-none focus:ring-1 focus:ring-gray-500 w-28"
              data-testid="label-input"
              autoFocus
            />
            <button
              onClick={handleApplyLabel}
              className="rounded bg-gray-600 px-2 py-0.5 text-xs hover:bg-gray-500"
              data-testid="label-submit"
            >
              Apply
            </button>
          </div>
        )}
      </div>

      {/* Assign Agent */}
      <div className="relative">
        <button
          onClick={() => {
            setShowAgentMenu(!showAgentMenu);
            setShowZoneMenu(false);
            setShowLabelInput(false);
          }}
          className="rounded px-2 py-0.5 hover:bg-gray-700 transition-colors"
          data-testid="batch-assign-agent"
          aria-label="Assign agent to selected threads"
          aria-expanded={showAgentMenu}
        >
          Assign Agent
        </button>
        {showAgentMenu && (
          <div
            className="absolute top-full left-0 z-50 mt-1 rounded bg-[#2a2a3e] border border-gray-600 shadow-lg"
            role="menu"
            data-testid="agent-menu"
          >
            {AGENT_OPTIONS.map((a) => (
              <button
                key={a.role}
                onClick={() => handleAssignAgent(a.role)}
                className="block w-full px-3 py-1 text-left hover:bg-gray-600 text-xs"
                role="menuitem"
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Clear selection */}
      <button
        onClick={handleClearSelection}
        className="rounded px-2 py-0.5 text-gray-500 hover:text-gray-300 hover:bg-gray-700 transition-colors"
        data-testid="batch-clear"
        aria-label="Clear selection"
      >
        Clear
      </button>
    </div>
  );
}
