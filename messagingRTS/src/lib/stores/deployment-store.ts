// Deployment interaction store per Spec 06
// Manages drag-to-deploy state, deployment records, confirmation dialog, and batch deployment
// Batch deployment (Spec 06 Section 11): multi-cluster selection creates independent records per cluster

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
  // Batch deployment: links records from the same batch operation
  batchId: string | null;
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

// Per-cluster target within a batch deployment
export interface BatchTarget {
  clusterId: string;
  threadIds: string[];
  label: string;
}

export interface ConfirmationState {
  agentRole: AgentRole;
  clusterId: string;
  threadIds: string[];
  description: string;
  // Batch deployment targets (Spec 06 Section 11)
  // When present, this is a batch deployment across multiple clusters
  batchTargets?: BatchTarget[];
}

// Travel arc animation state per Spec 06
export interface TravelAnimation {
  agentRole: AgentRole;
  deploymentId: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startTime: number;
  duration: number; // ms
}

interface DeploymentStore {
  dragState: DragState | null;
  confirmation: ConfirmationState | null;
  deployments: DeploymentRecord[];
  activeDeploymentId: string | null;
  // Multi-cluster selection for batch deployment (Spec 06 Section 11)
  selectedClusterIds: string[];
  // Active travel arc animations per Spec 06
  travelAnimations: TravelAnimation[];

  // Drag actions
  startDrag: (role: AgentRole, screenX: number, screenY: number) => void;
  updateDrag: (screenX: number, screenY: number) => void;
  setDragTarget: (clusterId: string | null, zoneId: string | null, valid: boolean) => void;
  cancelDrag: () => void;

  // Cluster selection for batch deployment
  toggleClusterSelection: (clusterId: string) => void;
  clearClusterSelection: () => void;

  // Confirmation actions
  showConfirmation: (state: ConfirmationState) => void;
  cancelConfirmation: () => void;
  confirmDeployment: () => DeploymentRecord | null;
  // Batch deployment: creates one record per cluster, returns all records
  confirmBatchDeployment: () => DeploymentRecord[];

  // Deployment lifecycle
  startTravel: (deploymentId: string) => void;
  startWork: (deploymentId: string) => void;
  completeDeployment: (deploymentId: string) => void;
  recallDeployment: (deploymentId: string) => void;
  failDeployment: (deploymentId: string) => void;

  // Resolution
  resolveDeployment: (deploymentId: string) => void;

  // Travel animation per Spec 06
  addTravelAnimation: (animation: TravelAnimation) => void;
  removeTravelAnimation: (deploymentId: string) => void;
  getActiveTravelAnimations: () => TravelAnimation[];

  // Queries
  getActiveDeploymentForRole: (role: AgentRole) => DeploymentRecord | undefined;
  getActiveDeploymentsForRole: (role: AgentRole) => DeploymentRecord[];
  getCompletedDeploymentForRole: (role: AgentRole) => DeploymentRecord | undefined;
  getCompletedDeploymentsForRole: (role: AgentRole) => DeploymentRecord[];
  getDeploymentHistory: () => DeploymentRecord[];
  getBatchDeployments: (batchId: string) => DeploymentRecord[];
}

let deploymentCounter = 0;
let batchCounter = 0;

export const useDeploymentStore = create<DeploymentStore>((set, get) => ({
  dragState: null,
  confirmation: null,
  deployments: [],
  activeDeploymentId: null,
  selectedClusterIds: [],
  travelAnimations: [],

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

  // Cluster selection for batch deployment (Spec 06 Section 11)
  toggleClusterSelection: (clusterId) =>
    set((state) => {
      const exists = state.selectedClusterIds.includes(clusterId);
      return {
        selectedClusterIds: exists
          ? state.selectedClusterIds.filter((id) => id !== clusterId)
          : [...state.selectedClusterIds, clusterId],
      };
    }),

  clearClusterSelection: () => set({ selectedClusterIds: [] }),

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
      batchId: null,
    };

    set((state) => ({
      confirmation: null,
      deployments: [record, ...state.deployments],
      activeDeploymentId: record.id,
    }));

    return record;
  },

  // Batch deployment: creates one independent record per cluster (Spec 06 Section 11)
  confirmBatchDeployment: () => {
    const { confirmation } = get();
    if (!confirmation || !confirmation.batchTargets || confirmation.batchTargets.length === 0) {
      return [];
    }

    const bId = `batch-${++batchCounter}`;
    const now = Date.now();
    const records: DeploymentRecord[] = confirmation.batchTargets.map((target) => ({
      id: `deploy-${++deploymentCounter}`,
      agentRole: confirmation.agentRole,
      clusterId: target.clusterId,
      threadIds: target.threadIds,
      status: "confirming" as const,
      startedAt: now,
      completedAt: null,
      recalledAt: null,
      batchId: bId,
    }));

    set((state) => ({
      confirmation: null,
      selectedClusterIds: [],
      deployments: [...records, ...state.deployments],
      activeDeploymentId: records[0]?.id ?? null,
    }));

    return records;
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

  getActiveDeploymentsForRole: (role) => {
    return get().deployments.filter(
      (d) =>
        d.agentRole === role &&
        (d.status === "confirming" || d.status === "traveling" || d.status === "in-progress"),
    );
  },

  getCompletedDeploymentForRole: (role) => {
    return get().deployments.find((d) => d.agentRole === role && d.status === "completed");
  },

  getCompletedDeploymentsForRole: (role) => {
    return get().deployments.filter((d) => d.agentRole === role && d.status === "completed");
  },

  getDeploymentHistory: () => get().deployments,

  getBatchDeployments: (batchId) => {
    return get().deployments.filter((d) => d.batchId === batchId);
  },

  addTravelAnimation: (animation) =>
    set((state) => ({
      travelAnimations: [...state.travelAnimations, animation],
    })),

  removeTravelAnimation: (deploymentId) =>
    set((state) => ({
      travelAnimations: state.travelAnimations.filter((a) => a.deploymentId !== deploymentId),
    })),

  getActiveTravelAnimations: () => get().travelAnimations,
}));
