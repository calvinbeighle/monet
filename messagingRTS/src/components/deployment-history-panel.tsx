// Deployment history panel per Spec 12
// Slides in from right, triggered from status bar or agent dock
// Replaces detail panel when both are triggered (only one right panel at a time)

import { useAppStore } from "../lib/stores";

export interface DeploymentRecord {
  id: string;
  agentRole: string;
  agentName: string;
  clusterId: string | null;
  threadCount: number;
  status: "traveling" | "in-progress" | "completed" | "failed" | "recalled";
  startedAt: number;
  completedAt: number | null;
  approvedCount: number;
  rejectedCount: number;
}

interface DeploymentHistoryPanelProps {
  deployments: DeploymentRecord[];
}

export function DeploymentHistoryPanel({ deployments }: DeploymentHistoryPanelProps) {
  const setActivePanel = useAppStore((s) => s.setActivePanel);

  return (
    <div
      className="flex h-full w-80 shrink-0 flex-col border-l border-gray-800 bg-[#0e0e1a]"
      data-testid="deployment-history-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <span className="text-sm font-medium text-gray-200">Deployment History</span>
        <button
          className="text-xs text-gray-500 hover:text-gray-300"
          onClick={() => setActivePanel("none")}
          data-testid="deployment-history-close"
        >
          Close
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {deployments.length === 0 ? (
          <div className="text-xs text-gray-600" data-testid="deployment-history-empty">
            No deployments yet
          </div>
        ) : (
          <div className="space-y-2" data-testid="deployment-history-list">
            {deployments.map((dep) => {
              const statusColor =
                dep.status === "completed"
                  ? "text-green-400"
                  : dep.status === "in-progress" || dep.status === "traveling"
                    ? "text-blue-400"
                    : dep.status === "failed"
                      ? "text-red-400"
                      : "text-gray-400";

              return (
                <div
                  key={dep.id}
                  className="rounded border border-gray-800 p-2"
                  data-testid={`deployment-${dep.id}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-300">{dep.agentName}</span>
                    <span className={`text-xs ${statusColor}`}>{dep.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {dep.threadCount} thread{dep.threadCount !== 1 ? "s" : ""}
                    {dep.approvedCount > 0 && ` | ${dep.approvedCount} approved`}
                    {dep.rejectedCount > 0 && ` | ${dep.rejectedCount} rejected`}
                  </div>
                  <div className="mt-1 text-xs text-gray-600">
                    {new Date(dep.startedAt).toLocaleTimeString()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
