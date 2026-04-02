// Agent dock per Spec 06/12
// Shows all 6 agent types with real idle/deployed/working/cooldown status from agent store.
// Supports drag-to-deploy: drag an idle agent from the dock to deploy on the map.
// Scrolls horizontally if entries overflow. Always visible when authenticated.

import { useCallback, useRef, useState, useEffect } from "react";
import { AGENT_DEFINITIONS, type AgentRole, type AgentStatus } from "../lib/types";
import { useAgentStore } from "../lib/stores/agent-store";
import { useDeploymentStore } from "../lib/stores/deployment-store";

// Live cooldown countdown per Spec 06 Section 1
function CooldownTimer({ role }: { role: AgentRole }) {
  const getCooldownMs = useAgentStore((s) => s.getCooldownMs);
  const [remaining, setRemaining] = useState(() => getCooldownMs(role));

  useEffect(() => {
    const id = setInterval(() => {
      const ms = getCooldownMs(role);
      setRemaining(ms);
    }, 500);
    return () => clearInterval(id);
  }, [role, getCooldownMs]);

  if (remaining <= 0) return null;
  const secs = Math.ceil(remaining / 1000);
  const display = secs >= 60 ? `${Math.ceil(secs / 60)}m` : `${secs}s`;
  return (
    <span className="text-[10px] text-gray-500" data-testid={`cooldown-timer-${role}`}>
      {display}
    </span>
  );
}

function RecallButton({ role }: { role: AgentRole }) {
  const recall = useAgentStore((s) => s.recall);
  const recallDeployment = useDeploymentStore((s) => s.recallDeployment);

  const handleRecall = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Recall agent (returns to idle without cooldown per Spec 06)
    recall(role);
    // Update deployment record if one exists
    const deployment = useDeploymentStore.getState().getActiveDeploymentForRole(role);
    if (deployment) {
      recallDeployment(deployment.id);
    }
  };

  return (
    <button
      className="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-900/30 transition-colors"
      onClick={handleRecall}
      data-testid={`recall-${role}`}
      title="Recall agent"
    >
      recall
    </button>
  );
}

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

interface AgentDockProps {
  isCompact?: boolean;
  onHistoryClick?: () => void;
}

export function AgentDock({ isCompact = false, onHistoryClick }: AgentDockProps) {
  const agents = useAgentStore((s) => s.agents);
  const dragState = useDeploymentStore((s) => s.dragState);
  const startDrag = useDeploymentStore((s) => s.startDrag);
  // Subscribe to deployments array so badge re-renders on deployment changes
  const deployments = useDeploymentStore((s) => s.deployments);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragThresholdRef = useRef(false);

  const handleMouseDown = useCallback(
    (role: AgentRole, e: React.MouseEvent) => {
      const agent = useAgentStore.getState().agents.get(role);
      if (!agent || agent.status !== "idle") return;

      dragStartRef.current = { x: e.clientX, y: e.clientY };
      dragThresholdRef.current = false;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragStartRef.current) return;
        const dist =
          Math.abs(moveEvent.clientX - dragStartRef.current.x) +
          Math.abs(moveEvent.clientY - dragStartRef.current.y);

        if (!dragThresholdRef.current && dist > 8) {
          dragThresholdRef.current = true;
          startDrag(role, moveEvent.clientX, moveEvent.clientY);
        }

        if (dragThresholdRef.current) {
          useDeploymentStore.getState().updateDrag(moveEvent.clientX, moveEvent.clientY);
        }
      };

      const handleMouseUp = () => {
        dragStartRef.current = null;
        dragThresholdRef.current = false;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [startDrag],
  );

  return (
    <div
      className={`flex w-full items-center gap-3 overflow-x-auto border-t border-gray-800 bg-[#0e0e1a] px-4 ${isCompact ? "h-10" : "h-16"}`}
      data-testid="agent-dock"
    >
      {agentRoles.map((role) => {
        const def = AGENT_DEFINITIONS[role];
        const agent = agents.get(role);
        const status = agent?.status ?? "idle";
        const colorHex = `#${def.color.toString(16).padStart(6, "0")}`;
        const isDragging = dragState?.draggingRole === role;
        const canDrag = status === "idle";

        // Deployment count badge per Spec 06 Section 1: badge shows active deployment count per role
        const deploymentCount = deployments.filter(
          (d) =>
            d.agentRole === role &&
            (d.status === "confirming" || d.status === "traveling" || d.status === "in-progress"),
        ).length;

        // Dim the color dot when cooling down
        const dotOpacity = status === "cooldown" ? "opacity-40" : "";

        // Compact form per Spec 12 Section 11: reduced visual detail, still interactive
        if (isCompact) {
          return (
            <div
              key={role}
              className={`flex shrink-0 items-center gap-1 rounded border px-2 py-1 transition-colors select-none ${
                isDragging
                  ? "border-dashed border-gray-600 bg-[#0a0a16] opacity-40"
                  : status === "idle"
                    ? "border-gray-700 bg-[#14142a] hover:border-gray-500 cursor-grab"
                    : status === "cooldown"
                      ? "border-gray-800 bg-[#10101e] cursor-not-allowed"
                      : "border-blue-800/50 bg-[#14142a] cursor-default"
              }`}
              data-testid={`agent-${role}`}
              title={`${def.name} - ${STATUS_LABEL[status]}${canDrag ? " - drag to deploy" : ""}`}
              onMouseDown={canDrag ? (e) => handleMouseDown(role, e) : undefined}
            >
              <div
                className={`h-2.5 w-2.5 rounded-full ${dotOpacity}`}
                style={{ backgroundColor: colorHex }}
              />
              {deploymentCount > 0 && (
                <span className="text-[9px] text-blue-300" data-testid={`agent-${role}-count`}>
                  {deploymentCount}
                </span>
              )}
              {status === "cooldown" && <CooldownTimer role={role} />}
              {(status === "deployed" || status === "working") && <RecallButton role={role} />}
            </div>
          );
        }

        return (
          <div
            key={role}
            className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 transition-colors select-none ${
              isDragging
                ? "border-dashed border-gray-600 bg-[#0a0a16] opacity-40"
                : status === "idle"
                  ? "border-gray-700 bg-[#14142a] hover:border-gray-500 cursor-grab"
                  : status === "cooldown"
                    ? "border-gray-800 bg-[#10101e] cursor-not-allowed"
                    : "border-blue-800/50 bg-[#14142a] cursor-default"
            }`}
            data-testid={`agent-${role}`}
            title={canDrag ? `${def.description} - drag to deploy` : def.description}
            onMouseDown={canDrag ? (e) => handleMouseDown(role, e) : undefined}
          >
            <div
              className={`h-3 w-3 rounded-full ${dotOpacity}`}
              style={{ backgroundColor: colorHex }}
            />
            <span className="text-xs text-gray-300">{def.name}</span>
            <span className={`text-xs ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
            {deploymentCount > 0 && (
              <span
                className="flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-900 px-1 text-[10px] text-blue-300"
                data-testid={`agent-${role}-count`}
              >
                {deploymentCount}
              </span>
            )}
            {status === "cooldown" && <CooldownTimer role={role} />}
            {(status === "deployed" || status === "working") && <RecallButton role={role} />}
          </div>
        );
      })}

      {/* Deployment history trigger per Spec 12 Section 9 */}
      {onHistoryClick && (
        <button
          className="ml-auto shrink-0 rounded border border-gray-700 bg-[#14142a] px-2 py-1 text-xs text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors"
          onClick={onHistoryClick}
          data-testid="dock-history-trigger"
          title="View deployment history"
        >
          history
        </button>
      )}

      {/* Drag ghost indicator - follows cursor when dragging */}
      {dragState && (
        <div
          className="pointer-events-none fixed z-50 flex items-center gap-2 rounded-lg border border-blue-500/50 bg-[#14142a]/90 px-3 py-2"
          style={{
            left: dragState.screenX - 40,
            top: dragState.screenY - 20,
          }}
          data-testid="drag-ghost"
        >
          <div
            className="h-3 w-3 rounded-full"
            style={{
              backgroundColor: `#${AGENT_DEFINITIONS[dragState.draggingRole].color.toString(16).padStart(6, "0")}`,
            }}
          />
          <span className="text-xs text-gray-300">
            {AGENT_DEFINITIONS[dragState.draggingRole].name}
          </span>
        </div>
      )}
    </div>
  );
}
