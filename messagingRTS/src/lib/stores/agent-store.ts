// Agent store per Spec 05 and Spec 06
// Manages agent instances for all 6 roles. One instance per role (singleton per dock slot).
// Integrates with agent-manager pure functions for state transitions.

import { create } from "zustand";
import type { AgentRole, AgentInstance } from "../types";
import {
  createAgentInstance,
  deployAgent,
  startWorking,
  completeAgent,
  failAgent,
  startCooldown,
  checkCooldown,
  recallAgent,
  resolveProposal,
  getCooldownRemaining,
} from "../../features/agents/agent-manager";
import { useThreadStore } from "./thread-store";
import { useAppStore } from "./app-store";
import { useDeploymentStore } from "./deployment-store";

const ALL_ROLES: AgentRole[] = [
  "closer",
  "researcher",
  "scheduler",
  "cleaner",
  "drafter",
  "escalation-bot",
];

interface AgentStore {
  agents: Map<AgentRole, AgentInstance>;

  // Actions
  deploy: (role: AgentRole, clusterId: string, threadIds: string[]) => void;
  startWork: (role: AgentRole) => void;
  complete: (
    role: AgentRole,
    proposals: Array<{ threadId: string; outputType: string; content: string }>,
    failedThreadIds?: string[],
  ) => void;
  fail: (role: AgentRole) => void;
  beginCooldown: (role: AgentRole) => void;
  tickCooldowns: (now?: number) => void;
  recall: (role: AgentRole) => void;
  resolve: (role: AgentRole, proposalId: string, resolution: "approved" | "rejected") => void;

  // Queries
  getAgent: (role: AgentRole) => AgentInstance;
  getCooldownMs: (role: AgentRole, now?: number) => number;
  canDeployRole: (role: AgentRole) => boolean;
  getDeployedCount: () => number;
}

function createInitialAgents(): Map<AgentRole, AgentInstance> {
  const map = new Map<AgentRole, AgentInstance>();
  for (const role of ALL_ROLES) {
    map.set(role, createAgentInstance(role));
  }
  return map;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: createInitialAgents(),

  deploy: (role, clusterId, threadIds) =>
    set((state) => {
      const agent = state.agents.get(role);
      if (!agent) return state;
      const updated = new Map(state.agents);
      updated.set(role, deployAgent(agent, clusterId, threadIds));
      return { agents: updated };
    }),

  startWork: (role) =>
    set((state) => {
      const agent = state.agents.get(role);
      if (!agent) return state;
      const updated = new Map(state.agents);
      updated.set(role, startWorking(agent));
      return { agents: updated };
    }),

  complete: (role, proposals, failedThreadIds = []) => {
    let agentSnapshot: AgentInstance | null = null;
    let originalClusterId: string | null = null;
    set((state) => {
      const agent = state.agents.get(role);
      if (!agent) return state;
      const completed = completeAgent(agent, proposals, failedThreadIds);
      agentSnapshot = completed;
      originalClusterId = agent.clusterId;
      const updated = new Map(state.agents);
      updated.set(role, completed);
      return { agents: updated };
    });
    // Escalation Bot side effects per Spec 05
    if (role === "escalation-bot" && agentSnapshot !== null && originalClusterId !== null) {
      const snap = agentSnapshot as AgentInstance;
      const clusterId = originalClusterId as string;
      const escalationProposals = snap.proposals.filter((p) => p.outputType === "escalation-flag");
      if (escalationProposals.length > 0) {
        useDeploymentStore.getState().addEscalatedCluster(clusterId);
        const threadStore = useThreadStore.getState();
        for (const p of escalationProposals) {
          const thread = threadStore.getThread(p.threadId);
          const subject = thread?.subject ?? p.threadId;
          useAppStore.getState().addNotification({
            message: `Escalation: ${subject} flagged as urgent by Escalation Bot`,
            severity: "critical",
          });
        }
      }
    }
  },

  fail: (role) =>
    set((state) => {
      const agent = state.agents.get(role);
      if (!agent) return state;
      const updated = new Map(state.agents);
      updated.set(role, failAgent(agent));
      return { agents: updated };
    }),

  beginCooldown: (role) =>
    set((state) => {
      const agent = state.agents.get(role);
      if (!agent) return state;
      const updated = new Map(state.agents);
      updated.set(role, startCooldown(agent));
      return { agents: updated };
    }),

  tickCooldowns: (now = Date.now()) =>
    set((state) => {
      let changed = false;
      const updated = new Map(state.agents);
      for (const [role, agent] of state.agents) {
        if (agent.status === "cooldown") {
          const checked = checkCooldown(agent, now);
          if (checked.status !== agent.status) {
            updated.set(role, checked);
            changed = true;
          }
        }
      }
      return changed ? { agents: updated } : state;
    }),

  recall: (role) =>
    set((state) => {
      const agent = state.agents.get(role);
      if (!agent) return state;
      // Clear agent-occupied visual state on recalled threads per Spec 02
      if (agent.threadIds.length > 0) {
        const ts = useThreadStore.getState();
        for (const tid of agent.threadIds) {
          const thread = ts.getThread(tid);
          if (thread && thread.visualState === "agent-occupied") {
            ts.updateThread(tid, { visualState: "idle" });
          }
        }
      }
      const updated = new Map(state.agents);
      updated.set(role, recallAgent(agent));
      return { agents: updated };
    }),

  resolve: (role, proposalId, resolution) =>
    set((state) => {
      const agent = state.agents.get(role);
      if (!agent) return state;
      const updated = new Map(state.agents);
      updated.set(role, resolveProposal(agent, proposalId, resolution));
      return { agents: updated };
    }),

  getAgent: (role) => {
    const agent = get().agents.get(role);
    if (!agent) throw new Error(`No agent for role ${role}`);
    return agent;
  },

  getCooldownMs: (role, now = Date.now()) => {
    const agent = get().agents.get(role);
    if (!agent) return 0;
    return getCooldownRemaining(agent, now);
  },

  canDeployRole: (role) => {
    const agent = get().agents.get(role);
    return agent?.status === "idle";
  },

  getDeployedCount: () => {
    let count = 0;
    for (const [, agent] of get().agents) {
      if (agent.status === "deployed" || agent.status === "working") count++;
    }
    return count;
  },
}));
