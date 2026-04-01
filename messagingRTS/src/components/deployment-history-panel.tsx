// Deployment history panel per Spec 12 and Spec 06
// Slides in from right, triggered from status bar or agent dock
// Replaces detail panel when both are triggered (only one right panel at a time)
// Reads deployment records from deployment store, agent data from agent store
// Includes filter controls per Spec 06: filter by agent role, filter by status

import { useState } from "react";
import { useAppStore } from "../lib/stores";
import { useDeploymentStore } from "../lib/stores/deployment-store";
import { useAgentStore } from "../lib/stores/agent-store";
import { AGENT_DEFINITIONS } from "../lib/types";
import type { AgentRole } from "../lib/types";
import type { DeploymentStatus } from "../lib/stores/deployment-store";

// Re-export for backward compatibility with tests
export interface DeploymentRecord {
  id: string;
  agentRole: string;
  agentName: string;
  clusterId: string | null;
  threadCount: number;
  status: "traveling" | "in-progress" | "completed" | "resolved" | "failed" | "recalled";
  startedAt: number;
  completedAt: number | null;
  approvedCount: number;
  rejectedCount: number;
  outcomeSummary: string | null;
}

const DISPLAYABLE_STATUSES: DeploymentRecord["status"][] = [
  "traveling",
  "in-progress",
  "completed",
  "resolved",
  "failed",
  "recalled",
];

const AGENT_ROLE_OPTIONS: { role: AgentRole; label: string }[] = [
  { role: "closer", label: "Closer" },
  { role: "researcher", label: "Researcher" },
  { role: "scheduler", label: "Scheduler" },
  { role: "cleaner", label: "Cleaner" },
  { role: "drafter", label: "Drafter" },
  { role: "escalation-bot", label: "Escalation" },
];

export function DeploymentHistoryPanel() {
  const setActivePanel = useAppStore((s) => s.setActivePanel);
  const storeDeployments = useDeploymentStore((s) => s.deployments);
  const recallDeployment = useDeploymentStore((s) => s.recallDeployment);
  const agents = useAgentStore((s) => s.agents);
  const recallAgent = useAgentStore((s) => s.recall);

  // Filter state per Spec 06
  const [roleFilter, setRoleFilter] = useState<AgentRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<DeploymentStatus | "all">("all");

  // Map store deployment records to display format
  const deployments: DeploymentRecord[] = storeDeployments
    .filter((d) => d.status !== "confirming")
    .map((d) => {
      const def = AGENT_DEFINITIONS[d.agentRole];
      const agent = agents.get(d.agentRole);
      return {
        id: d.id,
        agentRole: d.agentRole,
        agentName: def?.name ?? d.agentRole,
        clusterId: d.clusterId,
        threadCount: d.threadIds.length,
        status: d.status as DeploymentRecord["status"],
        startedAt: d.startedAt,
        completedAt: d.completedAt,
        approvedCount: agent?.approvedCount ?? 0,
        rejectedCount: agent?.rejectedCount ?? 0,
        outcomeSummary: d.outcomeSummary,
      };
    });

  // Apply filters
  const filteredDeployments = deployments.filter((d) => {
    if (roleFilter !== "all" && d.agentRole !== roleFilter) return false;
    if (statusFilter !== "all" && d.status !== statusFilter) return false;
    return true;
  });

  // Outcome summary per Spec 06
  const totalApproved = filteredDeployments.reduce((sum, d) => sum + d.approvedCount, 0);
  const totalRejected = filteredDeployments.reduce((sum, d) => sum + d.rejectedCount, 0);

  const handleRecall = (dep: DeploymentRecord) => {
    recallDeployment(dep.id);
    recallAgent(dep.agentRole as import("../lib/types").AgentRole);
  };

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

      {/* Filter controls per Spec 06 */}
      <div
        className="flex gap-2 border-b border-gray-800 px-4 py-2"
        data-testid="deployment-filters"
      >
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as AgentRole | "all")}
          className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300 outline-none"
          data-testid="filter-role"
          aria-label="Filter by agent role"
        >
          <option value="all">All Agents</option>
          {AGENT_ROLE_OPTIONS.map((opt) => (
            <option key={opt.role} value={opt.role}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as DeploymentStatus | "all")}
          className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300 outline-none"
          data-testid="filter-status"
          aria-label="Filter by status"
        >
          <option value="all">All Statuses</option>
          {DISPLAYABLE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* Outcome summary per Spec 06 */}
      {filteredDeployments.length > 0 && (
        <div
          className="flex gap-3 border-b border-gray-800 px-4 py-2 text-xs text-gray-400"
          data-testid="deployment-summary"
        >
          <span>
            {filteredDeployments.length} deployment{filteredDeployments.length !== 1 ? "s" : ""}
          </span>
          {totalApproved > 0 && (
            <span className="text-green-400" data-testid="summary-approved">
              {totalApproved} approved
            </span>
          )}
          {totalRejected > 0 && (
            <span className="text-red-400" data-testid="summary-rejected">
              {totalRejected} rejected
            </span>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {filteredDeployments.length === 0 ? (
          <div className="text-xs text-gray-600" data-testid="deployment-history-empty">
            {deployments.length === 0 ? "No deployments yet" : "No deployments match filters"}
          </div>
        ) : (
          <div className="space-y-2" data-testid="deployment-history-list">
            {filteredDeployments.map((dep) => {
              const statusColor =
                dep.status === "completed" || dep.status === "resolved"
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
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${statusColor}`}>{dep.status}</span>
                      {(dep.status === "traveling" || dep.status === "in-progress") && (
                        <button
                          className="rounded bg-gray-700 px-1.5 py-0.5 text-xs text-yellow-400 hover:bg-gray-600"
                          data-testid={`recall-${dep.id}`}
                          onClick={() => handleRecall(dep)}
                        >
                          Recall
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {dep.threadCount} thread{dep.threadCount !== 1 ? "s" : ""}
                    {dep.approvedCount > 0 && ` | ${dep.approvedCount} approved`}
                    {dep.rejectedCount > 0 && ` | ${dep.rejectedCount} rejected`}
                  </div>
                  {dep.outcomeSummary && (
                    <div
                      className="mt-1 text-xs text-gray-400"
                      data-testid={`deployment-${dep.id}-outcome`}
                    >
                      {dep.outcomeSummary}
                    </div>
                  )}
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
