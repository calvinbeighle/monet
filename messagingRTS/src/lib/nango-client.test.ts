// Nango client tests per Spec 01 - Email Integration
// Verifies: connection status check, connect session creation, proxy call construction

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  checkConnectionStatus,
  createConnectSession,
  nangoProxy,
  getNangoConfig,
} from "./nango-client";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("Nango client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getNangoConfig", () => {
    it("returns default configuration", () => {
      const config = getNangoConfig();
      expect(config.host).toBe("https://api.nango.dev");
      expect(config.connectionId).toBe("gmail");
      expect(config.providerConfigKey).toBe("google-mail");
    });
  });

  describe("checkConnectionStatus", () => {
    it("returns connection object when Nango reports valid connection", async () => {
      const mockConn = {
        id: 1,
        connectionId: "gmail",
        providerConfigKey: "google-mail",
        provider: "google-mail",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockConn,
      });

      const result = await checkConnectionStatus();

      expect(result).toEqual(mockConn);
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("/connection/gmail");
      expect(opts.headers.Authorization).toMatch(/^Bearer /);
    });

    it("returns null when connection does not exist (404)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await checkConnectionStatus();
      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await checkConnectionStatus();
      expect(result).toBeNull();
    });

    it("returns null on non-404 error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await checkConnectionStatus();
      expect(result).toBeNull();
    });
  });

  describe("createConnectSession", () => {
    it("creates connect session with correct payload", async () => {
      const mockSession = {
        token: "tok-123",
        connectUrl: "https://connect.nango.dev/tok-123",
        expiresAt: "2026-01-01T01:00:00Z",
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSession,
      });

      const result = await createConnectSession();

      expect(result).toEqual(mockSession);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("/connect-sessions");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.allowed_integrations).toEqual(["google-mail"]);
      expect(body.end_user.id).toBe("default-user");
    });

    it("throws on failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "Bad request",
      });

      await expect(createConnectSession()).rejects.toThrow("Failed to create connect session");
    });
  });

  describe("nangoProxy", () => {
    it("constructs correct proxy URL with Gmail API path", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await nangoProxy("/threads?maxResults=50");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("/proxy/gmail/v1/users/me/threads?maxResults=50");
      expect(opts.headers["Connection-Id"]).toBe("gmail");
      expect(opts.headers["Provider-Config-Key"]).toBe("google-mail");
      expect(opts.headers.Authorization).toMatch(/^Bearer /);
    });

    it("forwards custom method and body", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await nangoProxy("/messages/send", {
        method: "POST",
        body: JSON.stringify({ raw: "encoded-message" }),
      });

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.method).toBe("POST");
      expect(opts.body).toContain("encoded-message");
    });

    it("returns raw Response for caller to handle", async () => {
      const mockResponse = { ok: true, status: 200 };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const result = await nangoProxy("/threads");
      expect(result).toBe(mockResponse);
    });
  });
});
