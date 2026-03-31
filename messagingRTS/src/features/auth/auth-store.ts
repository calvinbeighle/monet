// Auth store per Spec 01 - Email Integration (Nango-managed OAuth)
// Manages the four-state auth machine using Nango for all token operations.
// On app load, checks Nango connection status. If valid, silently authenticates.
// If no connection, shows auth prompt. All Gmail calls go through Nango proxy.

import { create } from "zustand";
import type { AuthState } from "./auth-types";
import { isValidAuthTransition } from "./auth-types";
import {
  checkConnectionStatus,
  createConnectSession,
  type NangoConnection,
} from "../../lib/nango-client";

interface AuthStore {
  authState: AuthState;
  connection: NangoConnection | null;
  error: string | null;

  // Actions
  checkConnection: () => Promise<void>;
  startAuth: () => Promise<void>;
  handleAuthComplete: () => Promise<void>;
  handleConsentDenied: () => void;
  signOut: () => void;

  // Injectable for testing
  _checkConnectionStatus: typeof checkConnectionStatus;
  _createConnectSession: typeof createConnectSession;
  _redirect: (url: string) => void;
}

function transitionTo(current: AuthState, target: AuthState): AuthState {
  if (!isValidAuthTransition(current, target)) {
    console.warn(`[Auth] Invalid transition: ${current} -> ${target}`);
    return current;
  }
  return target;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  authState: "unauthenticated",
  connection: null,
  error: null,
  _checkConnectionStatus: checkConnectionStatus,
  _createConnectSession: createConnectSession,
  _redirect: (url: string) => {
    window.location.href = url;
  },

  // Check Nango connection status on app load.
  // If a valid connection exists, transition to authenticated silently.
  // If no connection or broken, remain unauthenticated.
  checkConnection: async () => {
    const { _checkConnectionStatus } = get();
    try {
      const conn = await _checkConnectionStatus();
      if (conn) {
        set({ authState: "authenticated", connection: conn, error: null });
      } else {
        set({ authState: "unauthenticated", connection: null });
      }
    } catch (err) {
      console.error("[Auth] Connection check failed:", err);
      set({ authState: "unauthenticated", connection: null });
    }
  },

  // Initiate the Nango OAuth flow by creating a connect session and redirecting.
  startAuth: async () => {
    const { authState, _createConnectSession, _redirect } = get();
    const newState = transitionTo(authState, "authenticating");
    if (newState === authState) return;

    set({ authState: newState, error: null });

    try {
      const session = await _createConnectSession();
      _redirect(session.connectUrl);
    } catch (err) {
      set({
        authState: transitionTo(get().authState, "unauthenticated"),
        error: err instanceof Error ? err.message : "Failed to start authentication",
      });
    }
  },

  // Called after the Nango OAuth flow completes (e.g., on redirect back).
  // Verifies the connection is now active.
  handleAuthComplete: async () => {
    const { _checkConnectionStatus } = get();
    try {
      const conn = await _checkConnectionStatus();
      if (conn) {
        set({ authState: "authenticated", connection: conn, error: null });
      } else {
        set({
          authState: "unauthenticated",
          connection: null,
          error: "Authentication completed but no active connection found.",
        });
      }
    } catch (err) {
      set({
        authState: "unauthenticated",
        connection: null,
        error: err instanceof Error ? err.message : "Failed to verify connection",
      });
    }
  },

  handleConsentDenied: () => {
    set({
      authState: transitionTo(get().authState, "unauthenticated"),
      error: "Email access is required. Please authorize to use this application.",
    });
  },

  signOut: () => {
    set({
      authState: "unauthenticated",
      connection: null,
      error: null,
    });
  },
}));
