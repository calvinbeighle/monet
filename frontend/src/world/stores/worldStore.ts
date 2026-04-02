/**
 * src/world/stores/worldStore.ts
 * Zustand store for the Monet World 2D view.
 * Manages agent state (polled from backend), selected agent, chat panel,
 * notifications, and the command bar message dispatch.
 */

import { create } from 'zustand';
import type { Agent, MonetNotification } from '@/types';
import { BACKEND_URL } from '@/types';

/**
 * Normalizes a raw backend agent response object to the frontend Agent type.
 * Handles missing or malformed fields gracefully with safe defaults.
 */
function normalizeAgent(raw: Record<string, unknown>): Agent {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    status: (raw.status as Agent['status']) ?? 'idle',
    lastRun: raw.lastRun ? String(raw.lastRun) : undefined,
    summary: raw.summary ? String(raw.summary) : undefined,
    decisionCount: Number(raw.decisionCount ?? 0),
    decisionView: (raw.decisionView as Agent['decisionView']) ?? 'tinder',
    emoji: String(raw.emoji ?? ''),
    mood: String(raw.mood ?? ''),
    currentStep: raw.currentStep ? String(raw.currentStep) : undefined,
    currentDetail: raw.currentDetail ? String(raw.currentDetail) : undefined,
    progress:
      raw.progress !== undefined && raw.progress !== null
        ? Number(raw.progress)
        : undefined,
    toolCallCount: raw.toolCallCount !== undefined ? Number(raw.toolCallCount) : undefined,
    elapsedSeconds: raw.elapsedSeconds !== undefined ? Number(raw.elapsedSeconds) : undefined,
    insights: raw.insights ? (raw.insights as Agent['insights']) : null,
    activityLog: Array.isArray(raw.activityLog) ? raw.activityLog as Agent['activityLog'] : [],
    filesTouched: raw.filesTouched ? (raw.filesTouched as Record<string, string>) : {},
  };
}

interface WorldState {
  agents: Agent[];
  selectedAgentId: string | null;
  isChatOpen: boolean;
  isChatStreaming: boolean;
  notifications: MonetNotification[];
  overlayView: 'tinder' | 'diff' | 'whiteboard' | null;

  /** Fetch the latest agent list from the backend */
  refreshAgents: () => Promise<void>;
  /** Select an agent and open the terminal panel */
  selectAgent: (id: string) => void;
  /** Close the terminal panel */
  closeChat: () => void;
  /** Start a 5-second polling interval - returns a cleanup function */
  startPolling: () => () => void;
  /** Create a new agent (awaits backend creation to prevent WS race conditions) */
  createAgent: (name: string, color: string) => Promise<void>;
  /** Delete an agent */
  deleteAgent: (agentId: string) => void;
  /** Start the Claude Code session for the given agent */
  startAgent: (agentId: string) => Promise<void>;
  /** Stop the Claude Code session for the given agent */
  stopAgent: (agentId: string) => Promise<void>;
  /** Send a message to the currently selected agent (for WorldCommandBar) */
  sendMessage: (text: string) => void;
  /** Set streaming state */
  setStreaming: (streaming: boolean) => void;
  /** Add a notification */
  addNotification: (notif: MonetNotification) => void;
  /** Dismiss a notification */
  dismissNotification: (id: string) => void;
  /** Set the overlay view */
  setOverlayView: (view: 'tinder' | 'diff' | 'whiteboard' | null) => void;
}

export const useWorldStore = create<WorldState>((set, get) => ({
  agents: [],
  selectedAgentId: null,
  isChatOpen: false,
  isChatStreaming: false,
  notifications: [],
  overlayView: null,

  /**
   * Fetches /agents from the backend and replaces the agent list.
   * Silently no-ops when the backend is unreachable to preserve fallback data.
   */
  refreshAgents: async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/agents`);
      if (!res.ok) return;
      const data = await res.json();
      const rawAgents: Record<string, unknown>[] = data.agents ?? [];
      const agents = rawAgents.map(normalizeAgent);
      set({ agents });
    } catch {
      // Backend offline - keep existing agents
    }
  },

  /**
   * Marks an agent as selected and opens the terminal panel.
   */
  selectAgent: (id) => {
    set({ selectedAgentId: id, isChatOpen: true });
  },

  /**
   * Closes the terminal panel and clears selection.
   */
  closeChat: () => {
    set({
      selectedAgentId: null,
      isChatOpen: false,
    });
  },

  /**
   * Starts polling /agents every 2 seconds (faster for real-time feel).
   * Returns a cleanup function that clears the interval.
   */
  startPolling: () => {
    const { refreshAgents } = get();
    refreshAgents();

    const interval = setInterval(() => {
      refreshAgents();
    }, 2000);

    return () => clearInterval(interval);
  },

  /**
   * Creates a new agent locally and persists it to the backend.
   * Awaits the backend POST so the agent exists on the server before
   * the UI allows interaction (prevents WebSocket 4004 race conditions).
   */
  createAgent: async (name, color) => {
    const id = `agent-${Date.now()}`;
    const agent: Agent = {
      id,
      name,
      status: 'idle',
      decisionCount: 0,
      emoji: '',
      mood: 'Ready to help',
      decisionView: 'chat',
    };

    try {
      // Create on backend FIRST so WebSocket connections won't 4004
      await fetch(`${BACKEND_URL}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name, color }),
      });
    } catch {
      // Backend offline - still add locally for optimistic UI
    }

    set(state => ({ agents: [...state.agents, agent] }));
  },

  /**
   * Removes an agent locally and deletes it from the backend.
   */
  deleteAgent: (agentId) => {
    set(state => ({
      agents: state.agents.filter(a => a.id !== agentId),
      selectedAgentId: state.selectedAgentId === agentId ? null : state.selectedAgentId,
      isChatOpen: state.selectedAgentId === agentId ? false : state.isChatOpen,
    }));
    fetch(`${BACKEND_URL}/agents/${agentId}`, { method: 'DELETE' }).catch(() => {});
  },

  /**
   * Posts to /agents/{agentId}/start to spawn a Claude Code PTY session.
   * Refreshes the agent list after to reflect the updated status.
   */
  startAgent: async (agentId) => {
    try {
      await fetch(`${BACKEND_URL}/agents/${agentId}/start`, { method: 'POST' });
      get().refreshAgents();
    } catch {
      // Backend offline - ignore
    }
  },

  /**
   * Posts to /agents/{agentId}/stop to terminate the Claude Code PTY session.
   * Refreshes the agent list after to reflect the updated status.
   */
  stopAgent: async (agentId) => {
    try {
      await fetch(`${BACKEND_URL}/agents/${agentId}/stop`, { method: 'POST' });
      get().refreshAgents();
    } catch {
      // Backend offline - ignore
    }
  },

  /**
   * Sends a message to the selected agent via HTTP POST.
   * Checks that the target agent is idle before sending.
   */
  sendMessage: (text) => {
    const { selectedAgentId, agents, selectAgent } = get();
    let targetId = selectedAgentId;

    // If no agent is selected, pick the first idle one (or the first agent)
    if (!targetId && agents.length > 0) {
      const idleAgent = agents.find(a => a.status === 'idle') || agents[0];
      targetId = idleAgent.id;
      selectAgent(targetId);
    }

    if (!targetId) return;

    // Don't send if the target agent is already running
    const targetAgent = agents.find(a => a.id === targetId);
    if (targetAgent && targetAgent.status === 'running') {
      console.log('[worldStore] Agent is busy, not sending');
      return;
    }

    // Send via HTTP POST (fire-and-forget) since the ChatPanel handles WS display
    fetch(`${BACKEND_URL}/agents/${targetId}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch(() => {});
  },

  setStreaming: (streaming) => set({ isChatStreaming: streaming }),

  addNotification: (notif) => {
    set(state => ({
      notifications: [notif, ...state.notifications].slice(0, 50),
    }));
    // Auto-dismiss after 6 seconds
    setTimeout(() => {
      get().dismissNotification(notif.id);
    }, 6000);
  },

  dismissNotification: (id) => {
    set(state => ({
      notifications: state.notifications.filter(n => n.id !== id),
    }));
  },

  setOverlayView: (view) => set({ overlayView: view }),
}));
