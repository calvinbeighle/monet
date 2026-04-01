// Chat session store - manages Claude chat sessions via backend API

import { create } from "zustand";

const CHAT_BASE =
  import.meta.env.VITE_CHAT_BASE ?? "http://localhost:9001/api/chat";

export type TerminalSessionStatus = "active" | "closed";

export type TerminalSession = {
  id: string;
  title: string;
  status: TerminalSessionStatus;
  createdAt: number;
  lastActivity: number;
  messageCount: number;
  recentOutput: string[];
  command: string;
  cwd: string;
  exitCode: number | null;
  cols: number;
  rows: number;
};

type TerminalStore = {
  sessions: Map<string, TerminalSession>;
  activeSessionId: string | null;

  setSessions: (sessions: TerminalSession[]) => void;
  setSession: (session: TerminalSession) => void;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;
  updateRecentOutput: (id: string, line: string) => void;
  updateSessionStatus: (
    id: string,
    status: TerminalSessionStatus,
    exitCode?: number | null,
  ) => void;

  fetchSessions: () => Promise<void>;
  createSession: (opts?: {
    command?: string;
    cwd?: string;
    title?: string;
  }) => Promise<TerminalSession>;
  killSession: (id: string) => Promise<void>;
};

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  sessions: new Map(),
  activeSessionId: null,

  setSessions: (sessions) => {
    const map = new Map<string, TerminalSession>();
    for (const s of sessions) map.set(s.id, s);
    set({ sessions: map });
  },

  setSession: (session) =>
    set((state) => {
      const next = new Map(state.sessions);
      next.set(session.id, session);
      return { sessions: next };
    }),

  removeSession: (id) =>
    set((state) => {
      const next = new Map(state.sessions);
      next.delete(id);
      return {
        sessions: next,
        activeSessionId:
          state.activeSessionId === id ? null : state.activeSessionId,
      };
    }),

  setActiveSession: (id) => set({ activeSessionId: id }),

  updateRecentOutput: (id, line) =>
    set((state) => {
      const session = state.sessions.get(id);
      if (!session) return state;
      const recent = [...session.recentOutput, line].slice(-5);
      const next = new Map(state.sessions);
      next.set(id, {
        ...session,
        recentOutput: recent,
        lastActivity: Date.now() / 1000,
      });
      return { sessions: next };
    }),

  updateSessionStatus: (id, status, exitCode = null) =>
    set((state) => {
      const session = state.sessions.get(id);
      if (!session) return state;
      const next = new Map(state.sessions);
      next.set(id, { ...session, status, exitCode });
      return { sessions: next };
    }),

  fetchSessions: async () => {
    try {
      const res = await fetch(`${CHAT_BASE}/sessions`);
      if (!res.ok) return;
      const data = await res.json();
      const sessions: TerminalSession[] = data.map(
        (s: Record<string, unknown>) => ({
          id: s.id,
          title: s.title,
          status: s.status,
          createdAt: s.created_at,
          lastActivity: s.last_activity,
          messageCount: s.message_count ?? 0,
          recentOutput: [],
          command: "",
          cwd: "",
          exitCode: null,
          cols: 0,
          rows: 0,
        }),
      );
      get().setSessions(sessions);
    } catch {
      // Backend not running
    }
  },

  createSession: async (opts) => {
    const res = await fetch(`${CHAT_BASE}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: opts?.title ?? "Claude Code" }),
    });
    if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
    const data = await res.json();
    const session: TerminalSession = {
      id: data.id,
      title: data.title,
      status: "active",
      createdAt: data.created_at,
      lastActivity: data.created_at,
      messageCount: 0,
      recentOutput: [],
      command: "",
      cwd: "",
      exitCode: null,
      cols: 0,
      rows: 0,
    };
    get().setSession(session);
    return session;
  },

  killSession: async (id) => {
    try {
      await fetch(`${CHAT_BASE}/sessions/${id}`, { method: "DELETE" });
    } catch {
      // ignore
    }
    get().removeSession(id);
  },
}));

export function getWebSocketUrl(sessionId: string): string {
  return `ws://localhost:9001/api/chat/sessions/${sessionId}/ws`;
}
