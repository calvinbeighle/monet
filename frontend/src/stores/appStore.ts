/**
 * stores/appStore.ts
 * Global Zustand store for the Monet application.
 *
 * Manages active view, agents, decisions, loading state, and command bar position.
 * On mount, fetches real agent status and decision counts from the backend.
 * Polls /agents every 10 seconds to keep status live without websocket complexity.
 *
 * Command bar position is derived: 'bottom' when any agent is running or has decisions.
 */
import { create } from 'zustand';
import type { ActiveView, Agent, Connection, Decision, ActivityEvent, CommandBarPosition } from '../types';
import { BACKEND_URL } from '../types';

interface AppState {
  activeView: ActiveView;
  agents: Agent[];
  connections: Connection[];
  decisions: Decision[];
  activity: ActivityEvent[];
  isLoading: boolean;
  /** Derived from agents - 'bottom' if any agent is running or has decisions */
  commandBarPosition: CommandBarPosition;
  setActiveView: (view: ActiveView) => void;
  setLoading: (loading: boolean) => void;
  /** Submits a text intent to the backend orchestrator, then navigates to target view */
  submitIntent: (text: string) => void;
  /** Fetches real agent status from the backend and updates the store */
  refreshAgents: () => Promise<void>;
  /** Fetches pending decisions from the backend */
  refreshDecisions: () => Promise<void>;
  /** Starts the background polling interval - call once on app mount */
  startPolling: () => () => void;
}

/**
 * Fallback agents shown while the backend loads or when offline.
 * These are intentionally minimal - real data comes from the API.
 */
const FALLBACK_AGENTS: Agent[] = [
  {
    id: 'email',
    name: 'Email Agent',
    status: 'idle',
    decisionCount: 0,
    decisionView: 'tinder',
    emoji: '😌',
    mood: 'Connecting...',
  },
  {
    id: 'code',
    name: 'Code Agent',
    status: 'idle',
    decisionCount: 0,
    emoji: '😎',
    mood: 'Connecting...',
  },
  {
    id: 'planning',
    name: 'Planning Agent',
    status: 'idle',
    decisionCount: 0,
    emoji: '🧘',
    mood: 'Connecting...',
  },
];

/** Hardcoded connections - these come from Composio, not the decisions system */
const INITIAL_CONNECTIONS: Connection[] = [
  { id: 'gmail', service: 'Gmail', icon: 'gmail', connected: true },
  { id: 'github', service: 'GitHub', icon: 'github', connected: false },
  { id: 'notion', service: 'Notion', icon: 'notion', connected: true },
  { id: 'slack', service: 'Slack', icon: 'slack', connected: false },
];

/** Initial activity timeline - static for now */
const INITIAL_ACTIVITY: ActivityEvent[] = [
  {
    id: 'a1',
    agentId: 'email',
    agentName: 'Email Agent',
    label: 'Triaged inbox',
    timestamp: '10:32 AM',
    color: '#ea4335',
    status: 'completed',
  },
  {
    id: 'a2',
    agentId: 'code',
    agentName: 'Code Agent',
    label: 'Reviewed PRs',
    timestamp: '9:15 AM',
    color: '#8b5cf6',
    status: 'completed',
  },
  {
    id: 'a3',
    agentId: 'planning',
    agentName: 'Planning Agent',
    label: 'Updated sprint doc',
    timestamp: '8:45 AM',
    color: '#22c55e',
    status: 'completed',
  },
];

/**
 * Derives the command bar position from agent states.
 * Returns 'bottom' if any agent is running or has pending decisions.
 */
function deriveCommandBarPosition(agents: Agent[]): CommandBarPosition {
  const hasActiveAgents = agents.some(
    (a) => a.status === 'running' || (a.decisionCount && a.decisionCount > 0)
  );
  return hasActiveAgents ? 'bottom' : 'center';
}

/**
 * Determines the appropriate decision view to open based on query text.
 * Email/inbox keywords - tinder, code/PR keywords - diff,
 * plan keywords - whiteboard, everything else - chat.
 */
function resolveViewFromText(query: string): ActiveView {
  const q = query.toLowerCase();
  if (q.includes('email') || q.includes('inbox') || q.includes('triage')) return 'tinder';
  if (q.includes('code') || q.includes('pr') || q.includes('diff') || q.includes('review')) return 'diff';
  if (q.includes('plan') || q.includes('sprint') || q.includes('board') || q.includes('whiteboard')) return 'whiteboard';
  return 'chat';
}

/**
 * Normalizes a backend agent response to match the frontend Agent type.
 * Maps lastRun string, adds default emoji/mood if missing.
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
    emoji: String(raw.emoji ?? '🤖'),
    mood: String(raw.mood ?? ''),
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  activeView: 'home',
  agents: FALLBACK_AGENTS,
  connections: INITIAL_CONNECTIONS,
  decisions: [],
  activity: INITIAL_ACTIVITY,
  isLoading: false,
  commandBarPosition: 'center',

  setActiveView: (view) => set({ activeView: view }),

  setLoading: (loading) => set({ isLoading: loading }),

  /**
   * Fetches live agent status from GET /agents and updates the store.
   * Silently ignores network errors so the UI stays responsive when offline.
   */
  refreshAgents: async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/agents`);
      if (!res.ok) return;
      const data = await res.json();
      const rawAgents: Record<string, unknown>[] = data.agents ?? [];
      const agents = rawAgents.map(normalizeAgent);
      set({
        agents,
        commandBarPosition: deriveCommandBarPosition(agents),
      });
    } catch {
      // Backend offline - keep showing fallback agents without throwing
    }
  },

  /**
   * Fetches pending decisions from GET /decisions and updates the store.
   * Decisions are used to populate the monitor view and feed into TinderView.
   */
  refreshDecisions: async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/decisions`);
      if (!res.ok) return;
      const data = await res.json();
      const rawDecisions = data.decisions ?? [];
      // Map backend decisions to the frontend Decision shape
      const decisions: Decision[] = rawDecisions.map((d: Record<string, unknown>) => ({
        id: String(d.id ?? ''),
        agentId: String(d.agentId ?? ''),
        title: String(d.title ?? ''),
        summary: String(d.summary ?? ''),
        priority: (d.priority as Decision['priority']) ?? 'normal',
        accentColor: d.agentId === 'email' ? '#ea4335' : d.agentId === 'code' ? '#8b5cf6' : '#22c55e',
        primaryAction: d.type === 'email_reply' ? 'Send Reply' : d.type === 'pr_review' ? 'Merge' : 'Approve',
      }));
      set({ decisions });
    } catch {
      // Backend offline - keep showing existing decisions
    }
  },

  /**
   * Starts background polling of /agents every 10 seconds.
   * Returns a cleanup function that cancels the interval.
   * Call once on app mount via useEffect.
   */
  startPolling: () => {
    const { refreshAgents, refreshDecisions } = get();

    // Fetch immediately on start
    refreshAgents();
    refreshDecisions();

    const interval = setInterval(() => {
      refreshAgents();
      refreshDecisions();
    }, 10_000);

    return () => clearInterval(interval);
  },

  /**
   * Handles a user text submission from the command bar.
   *
   * Posts to POST /intent which goes through the orchestrator (Claude Sonnet
   * for smart routing). While waiting, shows a loader then navigates to the
   * view that matches the classified intent. Falls back to local routing
   * heuristics if the backend is offline.
   */
  submitIntent: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    set({ isLoading: true });

    const fallback = () => {
      const targetView = resolveViewFromText(trimmed);
      setTimeout(() => {
        set({ isLoading: false, activeView: targetView });
      }, 900);
    };

    fetch(`${BACKEND_URL}/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Intent failed: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        // Map agentType from backend to the view we should open
        const agentTypeToView: Record<string, ActiveView> = {
          email: 'tinder',
          code: 'diff',
          planning: 'whiteboard',
          general: 'chat',
        };
        const targetView = agentTypeToView[data.agentType] ?? resolveViewFromText(trimmed);
        set({ isLoading: false, activeView: targetView });
      })
      .catch(() => {
        // Backend offline or intent failed - fall back to local routing
        fallback();
      });
  },
}));
