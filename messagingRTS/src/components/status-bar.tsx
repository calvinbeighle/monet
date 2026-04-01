// Status bar per Spec 12
// Shows: sync indicator, front health score, streak counters, alert badges
// Contains triggers for session summary, deployment history, filter panel, and alert list

import { useAppStore } from "../lib/stores";
import { useFilterStore, isFilterActive } from "../lib/stores/filter-store";

interface StatusBarProps {
  onSummaryClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onHistoryClick?: () => void;
  onFilterClick?: () => void;
  onAlertClick?: () => void;
}

export function StatusBar({
  onSummaryClick,
  onHistoryClick,
  onFilterClick,
  onAlertClick,
}: StatusBarProps = {}) {
  const syncStatus = useAppStore((s) => s.syncStatus);
  const frontHealthScore = useAppStore((s) => s.frontHealthScore);
  const streakInboxZero = useAppStore((s) => s.streakInboxZero);
  const streakZeroLost = useAppStore((s) => s.streakZeroLost);
  const unreadAlertCount = useAppStore((s) => s.unreadAlertCount);
  const lostThreadCount = useAppStore((s) => s.sessionStats.lostThreadCount);
  const filter = useFilterStore((s) => s.filter);
  const filterActive = isFilterActive(filter);

  const healthColor =
    frontHealthScore >= 75
      ? "text-green-400"
      : frontHealthScore >= 50
        ? "text-yellow-400"
        : frontHealthScore >= 25
          ? "text-orange-400"
          : "text-red-400";

  const syncIndicator =
    syncStatus === "connected"
      ? "bg-green-500"
      : syncStatus === "syncing"
        ? "bg-blue-500"
        : syncStatus === "error"
          ? "bg-red-500"
          : "bg-gray-500";

  return (
    <div
      className="flex h-10 w-full items-center justify-between border-b border-gray-800 bg-[#0e0e1a] px-4"
      data-testid="status-bar"
    >
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${syncIndicator}`} data-testid="sync-indicator" />
          <span className="text-xs text-gray-400">{syncStatus}</span>
        </div>

        {onHistoryClick && (
          <button
            className="text-xs text-gray-500 hover:text-gray-300"
            onClick={onHistoryClick}
            data-testid="history-trigger"
          >
            Deployments
          </button>
        )}

        {onFilterClick && (
          <button
            className={`text-xs hover:text-gray-300 ${filterActive ? "text-blue-400" : "text-gray-500"}`}
            onClick={onFilterClick}
            data-testid="filter-trigger"
            aria-label={filterActive ? "Filters active" : "Open filters"}
          >
            {filterActive ? "Filtered" : "Filter"}
          </button>
        )}
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Health</span>
          <span className={`text-sm font-mono ${healthColor}`} data-testid="health-score">
            {frontHealthScore}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Inbox Zero</span>
          <span className="text-sm font-mono text-gray-300">{streakInboxZero}d</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Zero Lost</span>
          <span className="text-sm font-mono text-gray-300">{streakZeroLost}d</span>
        </div>

        {lostThreadCount > 0 && (
          <div className="flex items-center gap-2" data-testid="lost-tally">
            <span className="text-xs text-gray-500">Lost</span>
            <span className="text-sm font-mono text-red-400">{lostThreadCount}</span>
          </div>
        )}

        {onSummaryClick && (
          <button
            className="text-xs text-gray-500 hover:text-gray-300"
            onClick={onSummaryClick}
            data-testid="summary-trigger"
          >
            Summary
          </button>
        )}

        {unreadAlertCount > 0 && (
          <button
            className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs text-white hover:bg-red-500 cursor-pointer"
            data-testid="alert-badge"
            onClick={onAlertClick}
            aria-label={`${unreadAlertCount} unread alerts`}
          >
            {unreadAlertCount}
          </button>
        )}
      </div>
    </div>
  );
}
