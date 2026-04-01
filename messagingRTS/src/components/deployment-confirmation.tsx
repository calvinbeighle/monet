// Deployment confirmation dialog per Spec 06
// Shows agent role, description, thread count. Confirm deploys, cancel snaps agent back.
// Batch mode (Spec 06 Section 11): shows list of target clusters and total thread count.
// On confirm: deploys agent, travel animation, then AI backend processes threads.
// Batch confirm creates one independent deployment record per cluster.

import { AGENT_DEFINITIONS, type AgentRole } from "../lib/types";
import { useDeploymentStore } from "../lib/stores/deployment-store";
import { useAgentStore } from "../lib/stores/agent-store";
import { useThreadStore } from "../lib/stores/thread-store";
import { useAppStore } from "../lib/stores";
import { processAgentWork } from "../features/agents/ai-backend";
import { createAgentCompletedAlert } from "../features/game-mechanics/map-alerts";

// Shared logic: after travel delay, start AI work and complete/fail deployment records
function startAgentWorkPhase(
  agentRole: AgentRole,
  allThreadIds: string[],
  deploymentIds: string[],
) {
  const { startWork, completeDeployment, failDeployment } = useDeploymentStore.getState();

  // Check agent is still deployed (not recalled during travel)
  const currentAgent = useAgentStore.getState().getAgent(agentRole);
  if (currentAgent.status !== "deployed") return;

  useAgentStore.getState().startWork(agentRole);
  for (const did of deploymentIds) {
    startWork(did);
  }

  // Mark threads as agent-occupied per Spec 02 (gold ring indicator)
  const threadStore = useThreadStore.getState();
  for (const tid of allThreadIds) {
    threadStore.updateThread(tid, { visualState: "agent-occupied" });
  }

  // Resolve thread objects for AI context
  const threads = allThreadIds
    .map((id) => threadStore.getThread(id))
    .filter((t) => t !== undefined);

  // Process via AI backend (falls back to simulation if no API key)
  processAgentWork(agentRole, allThreadIds, threads)
    .then((result) => {
      const workingAgent = useAgentStore.getState().getAgent(agentRole);
      if (workingAgent.status !== "working") return;

      if (result.errors.length > 0) {
        console.warn(`[DeploymentConfirmation] ${agentRole} errors:`, result.errors);
      }
      if (result.source === "simulated") {
        console.info(`[DeploymentConfirmation] ${agentRole} used simulated proposals`);
      }

      useAgentStore.getState().complete(agentRole, result.proposals, result.failedThreadIds);
      for (const did of deploymentIds) {
        completeDeployment(did);
      }

      // Fire agent-completed map alert per Spec 07 Section 12
      const appState = useAppStore.getState();
      const alert = createAgentCompletedAlert(agentRole, allThreadIds.length);
      appState.setMapAlerts([...appState.mapAlerts, alert]);
    })
    .catch((err) => {
      console.error(`[DeploymentConfirmation] ${agentRole} fatal error:`, err);
      useAgentStore.getState().fail(agentRole);
      for (const did of deploymentIds) {
        failDeployment(did);
      }
    })
    .finally(() => {
      // Clear agent-occupied visual state per Spec 02
      const ts = useThreadStore.getState();
      for (const tid of allThreadIds) {
        const thread = ts.getThread(tid);
        if (thread && thread.visualState === "agent-occupied") {
          ts.updateThread(tid, { visualState: "idle" });
        }
      }
    });
}

export function DeploymentConfirmation() {
  const confirmation = useDeploymentStore((s) => s.confirmation);
  const confirmDeployment = useDeploymentStore((s) => s.confirmDeployment);
  const confirmBatchDeployment = useDeploymentStore((s) => s.confirmBatchDeployment);
  const cancelConfirmation = useDeploymentStore((s) => s.cancelConfirmation);
  const startTravel = useDeploymentStore((s) => s.startTravel);

  if (!confirmation) return null;

  const def = AGENT_DEFINITIONS[confirmation.agentRole];
  const colorHex = `#${def.color.toString(16).padStart(6, "0")}`;
  const isBatch = confirmation.batchTargets && confirmation.batchTargets.length > 0;
  const totalThreads = confirmation.threadIds.length;

  const handleConfirm = () => {
    if (isBatch) {
      // Batch deployment: create one record per cluster (Spec 06 Section 11)
      const records = confirmBatchDeployment();
      if (records.length === 0) return;

      // Deploy agent with all threadIds across all clusters
      const allThreadIds = records.flatMap((r) => r.threadIds);
      const agentStore = useAgentStore.getState();
      agentStore.deploy(records[0].agentRole, records[0].clusterId, allThreadIds);

      // Track agent deployment in session stats per Spec 07
      const appState = useAppStore.getState();
      appState.updateSessionStats({
        agentsDeployed: appState.sessionStats.agentsDeployed + 1,
      });

      // Staggered travel: each record starts travel with 300ms offset
      const deploymentIds = records.map((r) => r.id);
      records.forEach((record, i) => {
        setTimeout(() => {
          startTravel(record.id);
        }, i * 300);
      });

      // After all travel animations complete, start work phase
      const travelDuration = 1500 + (records.length - 1) * 300;
      setTimeout(() => {
        startAgentWorkPhase(records[0].agentRole, allThreadIds, deploymentIds);
      }, travelDuration);
    } else {
      // Single deployment (existing behavior)
      const record = confirmDeployment();
      if (!record) return;

      const agentStore = useAgentStore.getState();
      agentStore.deploy(record.agentRole, record.clusterId, record.threadIds);

      // Track agent deployment in session stats per Spec 07
      const appState = useAppStore.getState();
      appState.updateSessionStats({
        agentsDeployed: appState.sessionStats.agentsDeployed + 1,
      });

      startTravel(record.id);
      setTimeout(() => {
        startAgentWorkPhase(record.agentRole, record.threadIds, [record.id]);
      }, 1500);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
      data-testid="deployment-confirmation-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) cancelConfirmation();
      }}
    >
      <div
        className="w-80 rounded-lg border border-gray-700 bg-[#14142a] p-5 shadow-xl"
        data-testid="deployment-confirmation"
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="h-4 w-4 rounded-full" style={{ backgroundColor: colorHex }} />
          <h3 className="text-sm font-medium text-gray-200">Deploy {def.name}</h3>
          {isBatch && (
            <span
              className="rounded bg-blue-900/50 px-1.5 py-0.5 text-[10px] text-blue-300"
              data-testid="batch-badge"
            >
              Batch
            </span>
          )}
        </div>

        <p className="mb-3 text-xs text-gray-400">{confirmation.description}</p>

        {/* Batch target list per Spec 06 Section 11 */}
        {isBatch && confirmation.batchTargets && (
          <div className="mb-3 space-y-1" data-testid="batch-target-list">
            {confirmation.batchTargets.map((target) => (
              <div
                key={target.clusterId}
                className="flex items-center justify-between rounded bg-[#0e0e1a] px-2 py-1 text-xs"
                data-testid={`batch-target-${target.clusterId}`}
              >
                <span className="text-gray-400">{target.label}</span>
                <span className="text-gray-500">
                  {target.threadIds.length} thread{target.threadIds.length !== 1 ? "s" : ""}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mb-4 flex items-center gap-4 text-xs text-gray-500">
          <span>
            {totalThreads} thread{totalThreads !== 1 ? "s" : ""} total
          </span>
          {isBatch && (
            <span>
              {confirmation.batchTargets!.length} cluster
              {confirmation.batchTargets!.length !== 1 ? "s" : ""}
            </span>
          )}
          <span>Capacity: {def.capacity}</span>
        </div>

        <div className="flex gap-2">
          <button
            className="flex-1 rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 transition-colors"
            onClick={handleConfirm}
            data-testid="confirm-deploy"
          >
            Deploy Now
          </button>
          <button
            className="flex-1 rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors"
            onClick={cancelConfirmation}
            data-testid="cancel-deploy"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
