/**
 * types/index.ts
 * Shared TypeScript type definitions and shared constants for the Monet application.
 * All data structures for agents, connections, decisions, and activity events.
 */

/** Base URL for the Monet backend. Override via VITE_BACKEND_URL env var. */
export const BACKEND_URL: string =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_BACKEND_URL) ||
  'http://localhost:8000';

/** Represents an AI agent managed by Monet */
export interface Agent {
  id: string;
  name: string;
  status: 'running' | 'idle' | 'error';
  /** Human-readable time since last run, e.g. "2hr ago" */
  lastRun?: string;
  /** Short summary of what the agent found or did */
  summary?: string;
  /** Progress percentage 0-100 for running agents */
  progress?: number;
  /** Current step label shown while running, e.g. "reading inbox" */
  currentStep?: string;
  /** Number of pending decisions this agent has generated */
  decisionCount?: number;
  /** Which decision view to open when clicking this agent */
  decisionView?: 'tinder' | 'diff' | 'whiteboard' | 'chat';
  /** Emoji avatar that reflects the agent's current mood */
  emoji: string;
  /** Short mood phrase shown as speech bubble text */
  mood: string;
}

/** Represents an external service connection */
export interface Connection {
  id: string;
  service: string;
  /** Service icon name for rendering */
  icon: string;
  connected: boolean;
}

/** Represents a pending decision requiring user action */
export interface Decision {
  id: string;
  agentId: string;
  title: string;
  summary: string;
  priority: 'urgent' | 'normal';
  /** Hex color for the left border accent */
  accentColor: string;
  /** Primary action label */
  primaryAction: string;
}

/** Represents a single activity event in the timeline */
export interface ActivityEvent {
  id: string;
  agentId: string;
  agentName: string;
  label: string;
  timestamp: string;
  /** Dot color for the timeline */
  color: string;
  status: 'running' | 'completed' | 'error';
}

/** All possible view identifiers */
export type ActiveView = 'home' | 'monitor' | 'chat' | 'tinder' | 'diff' | 'whiteboard';

/** Where the command bar is anchored */
export type CommandBarPosition = 'center' | 'bottom';
