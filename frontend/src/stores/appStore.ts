/**
 * stores/appStore.ts
 * Global Zustand store for the Monet application.
 * Manages sidebar state, active view, suggestions, agents, connections, and history.
 */
import { create } from 'zustand';
import type { ActiveView, Agent, Connection, HistoryItem, Suggestion } from '../types';

interface AppState {
  sidebarOpen: boolean;
  activeView: ActiveView;
  suggestions: Suggestion[];
  agents: Agent[];
  connections: Connection[];
  history: HistoryItem[];
  /** Currently selected suggestion (used to pass context to views) */
  activeSuggestion: Suggestion | null;

  toggleSidebar: () => void;
  setActiveView: (view: ActiveView) => void;
  setSuggestions: (items: Suggestion[]) => void;
  setActiveSuggestion: (suggestion: Suggestion | null) => void;
}

/** Initial hardcoded data for the demo state */
const INITIAL_SUGGESTIONS: Suggestion[] = [
  {
    id: '1',
    icon: 'gmail',
    iconColor: '#ea4335',
    title: 'Review the Composio security alert for your Google Account',
    description: 'myaccount.google.com',
    uiPattern: 'tinder',
  },
  {
    id: '2',
    icon: 'gmail',
    iconColor: '#ea4335',
    title: '3 emails need replies',
    description: 'gmail.com',
    uiPattern: 'tinder',
  },
  {
    id: '3',
    icon: 'github',
    iconColor: '#8b5cf6',
    title: 'PR #47 ready for review',
    description: 'github.com/calvinbeighle/monet',
    uiPattern: 'diff',
  },
  {
    id: '4',
    icon: 'notion',
    iconColor: '#e6e6e6',
    title: 'Read about Custom Agent templates',
    description: 'notion.so',
    uiPattern: 'whiteboard',
  },
];

const INITIAL_AGENTS: Agent[] = [
  { id: 'email', name: 'Email Agent', status: 'running', summary: '5 emails ready' },
  { id: 'code', name: 'Code Agent', status: 'idle', lastRun: '2hr ago' },
  { id: 'planning', name: 'Planning Agent', status: 'idle' },
];

const INITIAL_CONNECTIONS: Connection[] = [
  { id: 'gmail', service: 'Gmail', icon: 'gmail', connected: true },
  { id: 'github', service: 'GitHub', icon: 'github', connected: false },
];

const INITIAL_HISTORY: HistoryItem[] = [
  { id: 'h1', title: 'Triaged inbox', timestamp: '10:32 AM', date: 'Today' },
  { id: 'h2', title: 'Reviewed PR feedback', timestamp: '9:15 AM', date: 'Today' },
  { id: 'h3', title: 'Updated sprint planning doc', timestamp: '8:45 AM', date: 'Today' },
  { id: 'h4', title: 'Summarized investor emails', timestamp: 'Yesterday', date: 'Yesterday' },
  { id: 'h5', title: 'Drafted reply to design team', timestamp: 'Yesterday', date: 'Yesterday' },
];

export const useAppStore = create<AppState>((set) => ({
  sidebarOpen: true,
  activeView: 'welcome',
  suggestions: INITIAL_SUGGESTIONS,
  agents: INITIAL_AGENTS,
  connections: INITIAL_CONNECTIONS,
  history: INITIAL_HISTORY,
  activeSuggestion: null,

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setActiveView: (view) => set({ activeView: view }),

  setSuggestions: (items) => set({ suggestions: items }),

  setActiveSuggestion: (suggestion) => set({ activeSuggestion: suggestion }),
}));
