/**
 * types/index.ts
 * Shared TypeScript type definitions for the Monet application.
 * All data structures for agents, connections, suggestions, and history.
 */

/** Represents a UI suggestion shown on the welcome screen */
export interface Suggestion {
  id: string;
  /** Service name: "gmail" | "github" | "calendar" | "notion" */
  icon: string;
  /** Hex color for the icon circle background */
  iconColor: string;
  title: string;
  description: string;
  /** Which view pattern to open when this suggestion is selected */
  uiPattern: 'chat' | 'tinder' | 'diff' | 'whiteboard';
}

/** Represents an AI agent managed by Monet */
export interface Agent {
  id: string;
  name: string;
  status: 'running' | 'idle' | 'error';
  /** Human-readable time since last run, e.g. "2hr ago" */
  lastRun?: string;
  /** Short summary of what the agent found or did */
  summary?: string;
}

/** Represents an external service connection */
export interface Connection {
  id: string;
  service: string;
  /** Service icon name for rendering */
  icon: string;
  connected: boolean;
}

/** Represents a single item in the history sidebar section */
export interface HistoryItem {
  id: string;
  title: string;
  timestamp: string;
  /** Date label used for grouping, e.g. "Today", "Yesterday" */
  date: string;
}

/** All possible view identifiers */
export type ActiveView = 'welcome' | 'chat' | 'tinder' | 'diff' | 'whiteboard';
