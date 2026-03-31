// Nango API client per Spec 01 - Email Integration
// Handles connection status checks, connect session creation, and Gmail API proxy calls.
// All OAuth token management is handled by Nango - the app never touches raw tokens.

const NANGO_HOST = import.meta.env.VITE_NANGO_HOST || "https://api.nango.dev";
const NANGO_SECRET_KEY = import.meta.env.VITE_NANGO_SECRET_KEY || "";
const NANGO_CONNECTION_ID = import.meta.env.VITE_NANGO_GMAIL_CONNECTION_ID || "gmail";
const NANGO_PROVIDER_CONFIG_KEY = "google-mail";

export interface NangoConnection {
  id: number;
  connectionId: string;
  providerConfigKey: string;
  provider: string;
  createdAt: string;
  updatedAt: string;
}

export interface NangoConnectSession {
  token: string;
  connectUrl: string;
  expiresAt: string;
}

// Check if a valid Nango connection exists for the configured connection ID.
// Returns the connection object if active, null if no connection or broken.
export async function checkConnectionStatus(): Promise<NangoConnection | null> {
  try {
    const resp = await fetch(
      `${NANGO_HOST}/connection/${encodeURIComponent(NANGO_CONNECTION_ID)}`,
      {
        headers: {
          Authorization: `Bearer ${NANGO_SECRET_KEY}`,
        },
      },
    );
    if (!resp.ok) {
      if (resp.status === 404) return null;
      throw new Error(`Connection check failed: ${resp.status}`);
    }
    return resp.json();
  } catch (err) {
    console.error("[Nango] Connection status check failed:", err);
    return null;
  }
}

// Create a Nango connect session to initiate the OAuth flow.
// Returns a session with a connectUrl that the user should be redirected to.
export async function createConnectSession(): Promise<NangoConnectSession> {
  const resp = await fetch(`${NANGO_HOST}/connect-sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NANGO_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      allowed_integrations: [NANGO_PROVIDER_CONFIG_KEY],
      end_user: { id: "default-user" },
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Failed to create connect session: ${resp.status} ${body}`);
  }
  return resp.json();
}

// Proxy a request to the Gmail API through Nango.
// Nango handles token injection and refresh transparently.
// The path should start with / and is appended to the Gmail API users/me base.
export async function nangoProxy(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${NANGO_HOST}/proxy/gmail/v1/users/me${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${NANGO_SECRET_KEY}`,
      "Connection-Id": NANGO_CONNECTION_ID,
      "Provider-Config-Key": NANGO_PROVIDER_CONFIG_KEY,
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    },
  });
}

// Return current Nango configuration (useful for testing/debugging)
export function getNangoConfig() {
  return {
    host: NANGO_HOST,
    secretKey: NANGO_SECRET_KEY,
    connectionId: NANGO_CONNECTION_ID,
    providerConfigKey: NANGO_PROVIDER_CONFIG_KEY,
  };
}
