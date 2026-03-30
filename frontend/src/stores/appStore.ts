/**
 * stores/appStore.ts
 * Global Zustand store for the Monet application.
 * Manages active view, agents, decisions, loading state, and command bar position.
 * Command bar position is derived: bottom when any agent is running or has decisions.
 * No sidebar state - the app has no sidebar.
 */
import { create } from 'zustand';
import type { ActiveView, Agent, Connection, Decision, ActivityEvent, CommandBarPosition } from '../types';

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
  /** Submits a text intent, sets loading state, and resolves the target view */
  submitIntent: (text: string) => void;
}

/** Initial hardcoded demo agents with decision counts, view routing, and personality */
const INITIAL_AGENTS: Agent[] = [
  {
    id: 'email',
    name: 'Email Agent',
    status: 'running',
    summary: '5 emails ready',
    progress: 65,
    currentStep: 'drafting reply',
    decisionCount: 3,
    decisionView: 'tinder',
    emoji: '🤓',
    mood: 'Reading through 5 emails...',
  },
  {
    id: 'code',
    name: 'Code Agent',
    status: 'idle',
    lastRun: '2hr ago',
    decisionCount: 0,
    emoji: '😎',
    mood: 'All PRs look good',
  },
  {
    id: 'planning',
    name: 'Planning Agent',
    status: 'idle',
    lastRun: 'Yesterday',
    decisionCount: 0,
    emoji: '🧘',
    mood: 'Ready when you are',
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
    agentId: 'email',
    title: 'Reply to investor email',
    summary: 'Sarah Chen asking for Q2 metrics - agent drafted a reply',
    priority: 'urgent',
    accentColor: '#ea4335',
    primaryAction: 'Send Reply',
  },
  {
    id: 'd2',
    agentId: 'code',
    title: 'Merge PR #47',
    summary: 'Code agent reviewed and approved - 3 minor suggestions',
    priority: 'normal',
    accentColor: '#8b5cf6',
    primaryAction: 'Merge',
  },
  {
    id: 'd3',
    agentId: 'planning',
    title: 'Update sprint doc',
    summary: "Planning agent added 4 new tasks based on yesterday's standup",
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

export const useAppStore = create<AppState>((set) => ({
  activeView: 'home',
  agents: INITIAL_AGENTS,
  connections: INITIAL_CONNECTIONS,
  decisions: INITIAL_DECISIONS,
  activity: INITIAL_ACTIVITY,
  isLoading: false,
  commandBarPosition: deriveCommandBarPosition(INITIAL_AGENTS),

  setActiveView: (view) => set({ activeView: view }),

  setLoading: (loading) => set({ isLoading: loading }),

  /**
   * Handles a user text submission from the command bar.
   * Shows loader briefly while the agent "starts up", then navigates to target view.
   */
  submitIntent: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const targetView = resolveViewFromText(trimmed);
    set({ isLoading: true });
    // Simulate agent startup delay - real implementation would await agent response
    setTimeout(() => {
      set({ isLoading: false, activeView: targetView });
    }, 900);
  },
}));
