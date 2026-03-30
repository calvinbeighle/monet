/**
 * stores/appStore.ts
 * Global Zustand store for the Monet application.
 * Manages sidebar state, active view, agents, connections, decisions, and activity.
 */
import { create } from 'zustand';
import type { ActiveView, Agent, Connection, Decision, ActivityEvent } from '../types';

interface AppState {
  activeView: ActiveView;
  sidebarOpen: boolean;
  agents: Agent[];
  connections: Connection[];
  decisions: Decision[];
  activity: ActivityEvent[];
  setActiveView: (view: ActiveView) => void;
  toggleSidebar: () => void;
}

/** Initial hardcoded demo agents */
const INITIAL_AGENTS: Agent[] = [
  {
    id: 'email',
    name: 'Email Agent',
    status: 'running',
    summary: '5 emails ready',
    progress: 65,
  },
  {
    id: 'code',
    name: 'Code Agent',
    status: 'idle',
    lastRun: '2hr ago',
  },
  {
    id: 'planning',
    name: 'Planning Agent',
    status: 'idle',
    lastRun: 'Yesterday',
  },
];

/** Initial hardcoded demo connections */
const INITIAL_CONNECTIONS: Connection[] = [
  { id: 'gmail', service: 'Gmail', icon: 'gmail', connected: true },
  { id: 'github', service: 'GitHub', icon: 'github', connected: false },
  { id: 'notion', service: 'Notion', icon: 'notion', connected: true },
  { id: 'slack', service: 'Slack', icon: 'slack', connected: false },
];

/** Initial hardcoded pending decisions */
const INITIAL_DECISIONS: Decision[] = [
  {
    id: 'd1',
    title: 'Reply to investor email',
    summary: 'Sarah Chen asking for Q2 metrics - agent drafted a reply',
    priority: 'urgent',
    accentColor: '#ea4335',
    primaryAction: 'Send Reply',
  },
  {
    id: 'd2',
    title: 'Merge PR #47',
    summary: 'Code agent reviewed and approved - 3 minor suggestions',
    priority: 'normal',
    accentColor: '#8b5cf6',
    primaryAction: 'Merge',
  },
  {
    id: 'd3',
    title: 'Update sprint doc',
    summary: 'Planning agent added 4 new tasks based on yesterday\'s standup',
    priority: 'normal',
    accentColor: '#22c55e',
    primaryAction: 'Approve',
  },
];

/** Initial hardcoded activity timeline */
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
    agentId: 'email',
    agentName: 'Email Agent',
    label: 'Drafted reply',
    timestamp: '10:34 AM',
    color: '#ea4335',
    status: 'running',
  },
  {
    id: 'a3',
    agentId: 'code',
    agentName: 'Code Agent',
    label: 'Reviewed PR #47',
    timestamp: '9:15 AM',
    color: '#8b5cf6',
    status: 'completed',
  },
  {
    id: 'a4',
    agentId: 'planning',
    agentName: 'Planning Agent',
    label: 'Updated sprint doc',
    timestamp: '8:45 AM',
    color: '#22c55e',
    status: 'completed',
  },
  {
    id: 'a5',
    agentId: 'email',
    agentName: 'Email Agent',
    label: 'Summarized thread',
    timestamp: 'Yesterday',
    color: '#ea4335',
    status: 'completed',
  },
];

export const useAppStore = create<AppState>((set) => ({
  activeView: 'home',
  sidebarOpen: false,
  agents: INITIAL_AGENTS,
  connections: INITIAL_CONNECTIONS,
  decisions: INITIAL_DECISIONS,
  activity: INITIAL_ACTIVITY,

  setActiveView: (view) => set({ activeView: view }),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}));
