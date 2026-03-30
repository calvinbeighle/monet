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
import type { ActiveView, OverlayView, Agent, Connection, Decision, ActivityEvent, CommandBarPosition } from '../types';
import { BACKEND_URL } from '../types';

/** A single inline chat message rendered on the home screen */
export interface InlineChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** True while the assistant is still streaming this message */
  isStreaming: boolean;
}

interface AppState {
  activeView: ActiveView;
  /** The decision overlay currently open - null means no overlay */
  overlayView: OverlayView | null;
  agents: Agent[];
  connections: Connection[];
  decisions: Decision[];
  activity: ActivityEvent[];
  isLoading: boolean;
  /** Derived from agents - 'bottom' if any agent is running or has decisions */
  commandBarPosition: CommandBarPosition;
  /** The initial message text to send when ChatView mounts */
  pendingChatMessage: string | null;
  /** Inline chat messages shown below the command bar on the home screen */
  inlineChatMessages: InlineChatMessage[];
  /** True while the inline chat assistant is streaming */
  isChatStreaming: boolean;
  setActiveView: (view: ActiveView) => void;
  /** Opens a decision view as a modal overlay without leaving the home screen */
  setOverlayView: (view: OverlayView | null) => void;
  setLoading: (loading: boolean) => void;
  setPendingChatMessage: (msg: string | null) => void;
  /** Appends a user message and initiates streaming for inline chat */
  sendInlineChatMessage: (text: string) => void;
  /** Clears all inline chat messages */
  clearInlineChat: () => void;
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
 * Also maps live activity fields: currentStep, currentDetail, progress.
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
    currentStep: raw.currentStep ? String(raw.currentStep) : undefined,
    currentDetail: raw.currentDetail ? String(raw.currentDetail) : undefined,
    progress: raw.progress !== undefined && raw.progress !== null ? Number(raw.progress) : undefined,
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  activeView: 'home',
  overlayView: null,
  agents: FALLBACK_AGENTS,
  connections: INITIAL_CONNECTIONS,
  decisions: [],
  activity: INITIAL_ACTIVITY,
  isLoading: false,
  commandBarPosition: 'center',
  pendingChatMessage: null,
  inlineChatMessages: [],
  isChatStreaming: false,

  setActiveView: (view) => set({ activeView: view }),

  setOverlayView: (view) => set({ overlayView: view }),

  setLoading: (loading) => set({ isLoading: loading }),

  setPendingChatMessage: (msg) => set({ pendingChatMessage: msg }),

  clearInlineChat: () => set({ inlineChatMessages: [], isChatStreaming: false }),

  /**
   * Appends a user message to the inline chat and streams the assistant response.
   * Uses SSE via POST /chat. Builds history from all prior completed messages for
   * multi-turn context. Updates the assistant message token by token in the store.
   *
   * @param text - The user's message text
   */
  sendInlineChatMessage: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const { inlineChatMessages } = get();

    const userId = `u-${Date.now()}`;
    const assistantId = `a-${Date.now()}`;

    const userMsg: InlineChatMessage = { id: userId, role: 'user', text: trimmed, isStreaming: false };
    const assistantMsg: InlineChatMessage = { id: assistantId, role: 'assistant', text: '', isStreaming: true };

    set({
      inlineChatMessages: [...inlineChatMessages, userMsg, assistantMsg],
      isChatStreaming: true,
    });

    // Build history from all prior completed messages
    const history = inlineChatMessages
      .filter((m) => !m.isStreaming)
      .map((m) => ({ role: m.role, content: m.text }));

    (async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: trimmed, history }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!res.body) throw new Error('No response body');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';

          for (const part of parts) {
            const lines = part.split('\n');
            let eventName = '';
            let dataLine = '';

            for (const line of lines) {
              if (line.startsWith('event:')) eventName = line.slice(6).trim();
              if (line.startsWith('data:')) dataLine = line.slice(5).trim();
            }

            if (eventName === 'text' && dataLine) {
              try {
                const parsed = JSON.parse(dataLine);
                if (parsed.text) {
                  set((state) => ({
                    inlineChatMessages: state.inlineChatMessages.map((m) =>
                      m.id === assistantId ? { ...m, text: m.text + parsed.text } : m
                    ),
                  }));
                }
              } catch {
                // Ignore malformed JSON chunks
              }
            } else if (eventName === 'done') {
              set((state) => ({
                isChatStreaming: false,
                inlineChatMessages: state.inlineChatMessages.map((m) =>
                  m.id === assistantId ? { ...m, isStreaming: false } : m
                ),
              }));
              return;
            } else if (eventName === 'error' && dataLine) {
              let errText = 'Stream error';
              try { errText = JSON.parse(dataLine).error ?? errText; } catch { /* ignore */ }
              set((state) => ({
                isChatStreaming: false,
                inlineChatMessages: state.inlineChatMessages.map((m) =>
                  m.id === assistantId ? { ...m, text: `Error: ${errText}`, isStreaming: false } : m
                ),
              }));
              return;
            }
          }
        }

        // Stream ended without done event - mark complete
        set((state) => ({
          isChatStreaming: false,
          inlineChatMessages: state.inlineChatMessages.map((m) =>
            m.id === assistantId ? { ...m, isStreaming: false } : m
          ),
        }));
      } catch (err: unknown) {
        const msg = (err as Error).message ?? 'Connection failed';
        set((state) => ({
          isChatStreaming: false,
          inlineChatMessages: state.inlineChatMessages.map((m) =>
            m.id === assistantId ? { ...m, text: `Error: ${msg}`, isStreaming: false } : m
          ),
        }));
      }
    })();
  },

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
   * for smart routing). Chat intents now trigger inline chat on the home screen
   * instead of navigating away. Decision intents open as modal overlays.
   * Falls back to local routing heuristics if the backend is offline.
   */
  submitIntent: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const resolvedView = resolveViewFromText(trimmed);

    // Chat is handled inline - no loading spinner, send immediately
    if (resolvedView === 'chat') {
      get().sendInlineChatMessage(trimmed);
      return;
    }

    // For decision views, try to classify via backend then open overlay
    set({ isLoading: true });

    const fallback = () => {
      const targetView = resolveViewFromText(trimmed);
      setTimeout(() => {
        if (targetView === 'chat') {
          set({ isLoading: false });
          get().sendInlineChatMessage(trimmed);
        } else {
          set({ isLoading: false, overlayView: targetView as OverlayView });
        }
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
        const agentTypeToView: Record<string, ActiveView> = {
          email: 'tinder',
          code: 'diff',
          planning: 'whiteboard',
          general: 'chat',
        };
        const targetView = agentTypeToView[data.agentType] ?? resolveViewFromText(trimmed);
        if (targetView === 'chat') {
          set({ isLoading: false });
          get().sendInlineChatMessage(trimmed);
        } else {
          set({ isLoading: false, overlayView: targetView as OverlayView });
        }
      })
      .catch(() => {
        fallback();
      });
  },
}));
