// Agent dock per Spec 06/12
// Shows all 6 agent types with real idle/deployed/working/cooldown status from agent store.
// Scrolls horizontally if entries overflow. Always visible when authenticated.

import { AGENT_DEFINITIONS, type AgentRole, type AgentStatus } from "../lib/types";
import { useAgentStore } from "../lib/stores/agent-store";

const agentRoles: AgentRole[] = [
  "closer",
  "researcher",
  "scheduler",
  "cleaner",
  "drafter",
  "escalation-bot",
];

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "idle",
  deployed: "deploying",
  working: "working",
  completed: "done",
  failed: "failed",
  cooldown: "cooldown",
};

const STATUS_STYLE: Record<AgentStatus, string> = {
  idle: "text-gray-600",
  deployed: "text-blue-400",
  working: "text-blue-400 animate-pulse",
  completed: "text-green-400",
  failed: "text-red-400",
  cooldown: "text-gray-500",
};

export function AgentDock() {
  const agents = useAgentStore((s) => s.agents);

  return (
    <div
      className="flex h-16 w-full items-center gap-3 overflow-x-auto border-t border-gray-800 bg-[#0e0e1a] px-4"
      data-testid="agent-dock"
    >
      {agentRoles.map((role) => {
        const def = AGENT_DEFINITIONS[role];
        const agent = agents.get(role);
        const status = agent?.status ?? "idle";
        const colorHex = `#${def.color.toString(16).padStart(6, "0")}`;

        // Dim the color dot when cooling down or deployed
        const dotOpacity = status === "cooldown" ? "opacity-40" : status === "idle" ? "" : "";

        return (
          <div
            key={role}
            className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
              status === "idle"
                ? "border-gray-700 bg-[#14142a] hover:border-gray-500"
                : status === "cooldown"
                  ? "border-gray-800 bg-[#10101e]"
                  : "border-blue-800/50 bg-[#14142a]"
            }`}
            data-testid={`agent-${role}`}
            title={def.description}
          >
            <div
              className={`h-3 w-3 rounded-full ${dotOpacity}`}
              style={{ backgroundColor: colorHex }}
            />
            <span className="text-xs text-gray-300">{def.name}</span>
            <span className={`text-xs ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
            {agent && agent.threadIds.length > 0 && (
              <span
                className="flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-900 px-1 text-[10px] text-blue-300"
                data-testid={`agent-${role}-count`}
              >
                {agent.threadIds.length}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
