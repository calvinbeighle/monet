// Agent dock per Spec 06/12
// Shows all 6 agent types with idle/deployed/cooldown status
// Scrolls horizontally if entries overflow

import { AGENT_DEFINITIONS, type AgentRole } from "../lib/types";

const agentRoles: AgentRole[] = [
  "closer",
  "researcher",
  "scheduler",
  "cleaner",
  "drafter",
  "escalation-bot",
];

export function AgentDock() {
  return (
    <div
      className="flex h-16 w-full items-center gap-3 overflow-x-auto border-t border-gray-800 bg-[#0e0e1a] px-4"
      data-testid="agent-dock"
    >
      {agentRoles.map((role) => {
        const def = AGENT_DEFINITIONS[role];
        const colorHex = `#${def.color.toString(16).padStart(6, "0")}`;
        return (
          <div
            key={role}
            className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-gray-700 bg-[#14142a] px-3 py-2 transition-colors hover:border-gray-500"
            data-testid={`agent-${role}`}
            title={def.description}
          >
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: colorHex }} />
            <span className="text-xs text-gray-300">{def.name}</span>
            <span className="text-xs text-gray-600">idle</span>
          </div>
        );
      })}
    </div>
  );
}
