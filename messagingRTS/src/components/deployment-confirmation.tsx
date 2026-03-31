// Deployment confirmation dialog per Spec 06
// Shows agent role, description, thread count. Confirm deploys, cancel snaps agent back.
// On confirm: deploys agent, simulates travel + work, generates proposals via work simulator.

import { AGENT_DEFINITIONS } from "../lib/types";
import { useDeploymentStore } from "../lib/stores/deployment-store";
import { useAgentStore } from "../lib/stores/agent-store";
import {
  generateSimulatedProposals,
  SIMULATED_WORK_DURATION_MS,
} from "../features/agents/work-simulator";

export function DeploymentConfirmation() {
  const confirmation = useDeploymentStore((s) => s.confirmation);
  const confirmDeployment = useDeploymentStore((s) => s.confirmDeployment);
  const cancelConfirmation = useDeploymentStore((s) => s.cancelConfirmation);
  const startTravel = useDeploymentStore((s) => s.startTravel);
  const startWork = useDeploymentStore((s) => s.startWork);
  const completeDeployment = useDeploymentStore((s) => s.completeDeployment);

  if (!confirmation) return null;

  const def = AGENT_DEFINITIONS[confirmation.agentRole];
  const colorHex = `#${def.color.toString(16).padStart(6, "0")}`;

  const handleConfirm = () => {
    const record = confirmDeployment();
    if (!record) return;

    const agentStore = useAgentStore.getState();
    agentStore.deploy(record.agentRole, record.clusterId, record.threadIds);

    // Travel phase (1.5s), then work phase (simulated duration)
    startTravel(record.id);
    setTimeout(() => {
      // Check agent is still deployed (not recalled during travel)
      const currentAgent = useAgentStore.getState().getAgent(record.agentRole);
      if (currentAgent.status !== "deployed") return;

      useAgentStore.getState().startWork(record.agentRole);
      startWork(record.id);

      // Simulate work completion after duration
      setTimeout(() => {
        const workingAgent = useAgentStore.getState().getAgent(record.agentRole);
        if (workingAgent.status !== "working") return;

        const proposals = generateSimulatedProposals(record.agentRole, record.threadIds);
        useAgentStore.getState().complete(record.agentRole, proposals);
        completeDeployment(record.id);
      }, SIMULATED_WORK_DURATION_MS);
    }, 1500);
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
        </div>

        <p className="mb-3 text-xs text-gray-400">{confirmation.description}</p>

        <div className="mb-4 flex items-center gap-4 text-xs text-gray-500">
          <span>
            {confirmation.threadIds.length} thread{confirmation.threadIds.length !== 1 ? "s" : ""}
          </span>
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
