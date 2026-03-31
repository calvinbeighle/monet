// Deployment interaction store per Spec 06
// Manages drag-to-deploy state, deployment records, and confirmation dialog

import { create } from "zustand";
import type { AgentRole } from "../types";

export type DeploymentStatus =
  | "confirming"
  | "traveling"
  | "in-progress"
  | "completed"
  | "resolved"
  | "recalled"
  | "failed";

export interface DeploymentRecord {
  id: string;
  agentRole: AgentRole;
  clusterId: string;
  threadIds: string[];
  status: DeploymentStatus;
  startedAt: number;
  completedAt: number | null;
  recalledAt: number | null;
}

export interface DragState {
  draggingRole: AgentRole;
  // Current mouse position in screen coordinates
  screenX: number;
  screenY: number;
  // Drop target validation
  hoverClusterId: string | null;
  hoverZoneId: string | null;
  dropValid: boolean;
}

export interface ConfirmationState {
  agentRole: AgentRole;
  clusterId: string;
  threadIds: string[];
  description: string;
}

interface DeploymentStore {
  dragState: DragState | null;
  confirmation: ConfirmationState | null;
  deployments: DeploymentRecord[];
  activeDeploymentId: string | null;

  // Drag actions
  startDrag: (role: AgentRole, screenX: number, screenY: number) => void;
  updateDrag: (screenX: number, screenY: number) => void;
  setDragTarget: (clusterId: string | null, zoneId: string | null, valid: boolean) => void;
  cancelDrag: () => void;

  // Confirmation actions
  showConfirmation: (state: ConfirmationState) => void;
  cancelConfirmation: () => void;
  confirmDeployment: () => DeploymentRecord | null;

  // Deployment lifecycle
  startTravel: (deploymentId: string) => void;
  startWork: (deploymentId: string) => void;
  completeDeployment: (deploymentId: string) => void;
  recallDeployment: (deploymentId: string) => void;
  failDeployment: (deploymentId: string) => void;

  // Resolution
  resolveDeployment: (deploymentId: string) => void;

  // Queries
  getActiveDeploymentForRole: (role: AgentRole) => DeploymentRecord | undefined;
  getCompletedDeploymentForRole: (role: AgentRole) => DeploymentRecord | undefined;
  getDeploymentHistory: () => DeploymentRecord[];
}

let deploymentCounter = 0;

export const useDeploymentStore = create<DeploymentStore>((set, get) => ({
  dragState: null,
  confirmation: null,
  deployments: [],
  activeDeploymentId: null,

  startDrag: (role, screenX, screenY) =>
    set({
      dragState: {
        draggingRole: role,
        screenX,
        screenY,
        hoverClusterId: null,
        hoverZoneId: null,
        dropValid: false,
      },
    }),

  updateDrag: (screenX, screenY) =>
    set((state) => {
      if (!state.dragState) return state;
      return { dragState: { ...state.dragState, screenX, screenY } };
    }),

  setDragTarget: (clusterId, zoneId, valid) =>
    set((state) => {
      if (!state.dragState) return state;
      return {
        dragState: {
          ...state.dragState,
          hoverClusterId: clusterId,
          hoverZoneId: zoneId,
          dropValid: valid,
        },
      };
    }),

  cancelDrag: () => set({ dragState: null }),

  showConfirmation: (confirmation) => set({ confirmation, dragState: null }),

  cancelConfirmation: () => set({ confirmation: null }),

  confirmDeployment: () => {
    const { confirmation } = get();
    if (!confirmation) return null;

    const record: DeploymentRecord = {
      id: `deploy-${++deploymentCounter}`,
      agentRole: confirmation.agentRole,
      clusterId: confirmation.clusterId,
      threadIds: confirmation.threadIds,
      status: "confirming",
      startedAt: Date.now(),
      completedAt: null,
      recalledAt: null,
    };

    set((state) => ({
      confirmation: null,
      deployments: [record, ...state.deployments],
      activeDeploymentId: record.id,
    }));

    return record;
  },

  startTravel: (deploymentId) =>
    set((state) => ({
      deployments: state.deployments.map((d) =>
        d.id === deploymentId ? { ...d, status: "traveling" as const } : d,
      ),
    })),

  startWork: (deploymentId) =>
    set((state) => ({
      deployments: state.deployments.map((d) =>
        d.id === deploymentId ? { ...d, status: "in-progress" as const } : d,
      ),
    })),

  completeDeployment: (deploymentId) =>
    set((state) => ({
      deployments: state.deployments.map((d) =>
        d.id === deploymentId ? { ...d, status: "completed" as const, completedAt: Date.now() } : d,
      ),
      activeDeploymentId:
        state.activeDeploymentId === deploymentId ? null : state.activeDeploymentId,
    })),

  recallDeployment: (deploymentId) =>
    set((state) => ({
      deployments: state.deployments.map((d) =>
        d.id === deploymentId ? { ...d, status: "recalled" as const, recalledAt: Date.now() } : d,
      ),
      activeDeploymentId:
        state.activeDeploymentId === deploymentId ? null : state.activeDeploymentId,
    })),

  failDeployment: (deploymentId) =>
    set((state) => ({
      deployments: state.deployments.map((d) =>
        d.id === deploymentId ? { ...d, status: "failed" as const, completedAt: Date.now() } : d,
      ),
      activeDeploymentId:
        state.activeDeploymentId === deploymentId ? null : state.activeDeploymentId,
    })),

  resolveDeployment: (deploymentId) =>
    set((state) => ({
      deployments: state.deployments.map((d) =>
        d.id === deploymentId
          ? { ...d, status: "resolved" as const, completedAt: d.completedAt ?? Date.now() }
          : d,
      ),
    })),

  getActiveDeploymentForRole: (role) => {
    return get().deployments.find(
      (d) =>
        d.agentRole === role &&
        (d.status === "confirming" || d.status === "traveling" || d.status === "in-progress"),
    );
  },

  getCompletedDeploymentForRole: (role) => {
    return get().deployments.find((d) => d.agentRole === role && d.status === "completed");
  },

  getDeploymentHistory: () => get().deployments,
}));
