// Auth store tests per Spec 01 - Email Integration (Nango-managed OAuth)
// Verifies: connection status check, connect session creation, auth flow,
// consent denied handling, sign out, and state transitions

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAuthStore } from "./auth-store";
import type { NangoConnection, NangoConnectSession } from "../../lib/nango-client";

const mockConnection: NangoConnection = {
  id: 1,
  connectionId: "gmail",
  providerConfigKey: "google-mail",
  provider: "google-mail",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const mockSession: NangoConnectSession = {
  token: "session-token-123",
  connectUrl: "https://connect.nango.dev/session-token-123",
  expiresAt: "2026-01-01T01:00:00Z",
};

function resetStore() {
  useAuthStore.setState({
    authState: "unauthenticated",
    connection: null,
    error: null,
  });
}

describe("AuthStore (Nango)", () => {
  beforeEach(resetStore);

  describe("checkConnection", () => {
    it("transitions to authenticated when Nango reports valid connection", async () => {
      useAuthStore.setState({
        _checkConnectionStatus: vi.fn(async () => mockConnection),
      });

      await useAuthStore.getState().checkConnection();

      expect(useAuthStore.getState().authState).toBe("authenticated");
      expect(useAuthStore.getState().connection).toEqual(mockConnection);
      expect(useAuthStore.getState().error).toBeNull();
    });

    it("stays unauthenticated when no Nango connection exists", async () => {
      useAuthStore.setState({
        _checkConnectionStatus: vi.fn(async () => null),
      });

      await useAuthStore.getState().checkConnection();

      expect(useAuthStore.getState().authState).toBe("unauthenticated");
      expect(useAuthStore.getState().connection).toBeNull();
    });

    it("stays unauthenticated on connection check failure", async () => {
      useAuthStore.setState({
        _checkConnectionStatus: vi.fn(async () => {
          throw new Error("Network error");
        }),
      });

      await useAuthStore.getState().checkConnection();

      expect(useAuthStore.getState().authState).toBe("unauthenticated");
      expect(useAuthStore.getState().connection).toBeNull();
    });
  });

  describe("startAuth", () => {
    it("creates connect session and redirects to connectUrl", async () => {
      const mockRedirect = vi.fn();
      useAuthStore.setState({
        _createConnectSession: vi.fn(async () => mockSession),
        _redirect: mockRedirect,
      });

      await useAuthStore.getState().startAuth();

      expect(mockRedirect).toHaveBeenCalledWith(mockSession.connectUrl);
    });

    it("transitions to authenticating before redirect", async () => {
      let stateAtRedirect: string | null = null;
      useAuthStore.setState({
        _createConnectSession: vi.fn(async () => mockSession),
        _redirect: vi.fn(() => {
          stateAtRedirect = useAuthStore.getState().authState;
        }),
      });

      await useAuthStore.getState().startAuth();

      expect(stateAtRedirect).toBe("authenticating");
    });

    it("falls back to unauthenticated on connect session failure", async () => {
      useAuthStore.setState({
        _createConnectSession: vi.fn(async () => {
          throw new Error("API error");
        }),
        _redirect: vi.fn(),
      });

      await useAuthStore.getState().startAuth();

      expect(useAuthStore.getState().authState).toBe("unauthenticated");
      expect(useAuthStore.getState().error).toContain("API error");
    });

    it("rejects invalid transition (authenticated -> authenticating)", async () => {
      useAuthStore.setState({
        authState: "authenticated",
        _createConnectSession: vi.fn(async () => mockSession),
        _redirect: vi.fn(),
      });

      await useAuthStore.getState().startAuth();

      // Should not have transitioned
      expect(useAuthStore.getState().authState).toBe("authenticated");
    });

    it("allows reauthentication-required -> authenticating", async () => {
      const mockRedirect = vi.fn();
      useAuthStore.setState({
        authState: "reauthentication-required",
        _createConnectSession: vi.fn(async () => mockSession),
        _redirect: mockRedirect,
      });

      await useAuthStore.getState().startAuth();

      expect(mockRedirect).toHaveBeenCalledWith(mockSession.connectUrl);
    });
  });

  describe("handleAuthComplete", () => {
    it("verifies connection and transitions to authenticated", async () => {
      useAuthStore.setState({
        authState: "authenticating",
        _checkConnectionStatus: vi.fn(async () => mockConnection),
      });

      await useAuthStore.getState().handleAuthComplete();

      expect(useAuthStore.getState().authState).toBe("authenticated");
      expect(useAuthStore.getState().connection).toEqual(mockConnection);
    });

    it("falls back to unauthenticated when connection check returns null after auth", async () => {
      useAuthStore.setState({
        authState: "authenticating",
        _checkConnectionStatus: vi.fn(async () => null),
      });

      await useAuthStore.getState().handleAuthComplete();

      expect(useAuthStore.getState().authState).toBe("unauthenticated");
      expect(useAuthStore.getState().error).toBeTruthy();
    });

    it("falls back to unauthenticated on verification failure", async () => {
      useAuthStore.setState({
        authState: "authenticating",
        _checkConnectionStatus: vi.fn(async () => {
          throw new Error("Verification failed");
        }),
      });

      await useAuthStore.getState().handleAuthComplete();

      expect(useAuthStore.getState().authState).toBe("unauthenticated");
      expect(useAuthStore.getState().error).toContain("Verification failed");
    });
  });

  describe("handleConsentDenied", () => {
    it("transitions to unauthenticated with descriptive error", () => {
      useAuthStore.setState({ authState: "authenticating" });

      useAuthStore.getState().handleConsentDenied();

      expect(useAuthStore.getState().authState).toBe("unauthenticated");
      expect(useAuthStore.getState().error).toContain("Email access is required");
    });
  });

  describe("signOut", () => {
    it("clears connection and transitions to unauthenticated", () => {
      useAuthStore.setState({
        authState: "authenticated",
        connection: mockConnection,
        error: null,
      });

      useAuthStore.getState().signOut();

      expect(useAuthStore.getState().authState).toBe("unauthenticated");
      expect(useAuthStore.getState().connection).toBeNull();
      expect(useAuthStore.getState().error).toBeNull();
    });
  });
});
