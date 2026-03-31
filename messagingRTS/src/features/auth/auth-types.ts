// Auth types per Spec 01 - Email Integration (Nango-managed OAuth)
// Four-state auth machine. Token management is handled entirely by Nango -
// the app never touches raw tokens. No token-expired state because Nango
// handles refresh transparently through its proxy.

export type AuthState =
  | "unauthenticated"
  | "authenticating"
  | "authenticated"
  | "reauthentication-required";

// Valid auth state transitions per Spec 01:
// unauthenticated -> authenticating: user initiates sign-in
// authenticating -> authenticated: Nango OAuth flow completes
// authenticating -> unauthenticated: user denies consent or flow fails
// authenticated -> reauthentication-required: Nango reports connection broken
// reauthentication-required -> authenticating: user initiates reconnection
export const AUTH_TRANSITIONS: Record<AuthState, AuthState[]> = {
  unauthenticated: ["authenticating"],
  authenticating: ["authenticated", "unauthenticated"],
  authenticated: ["reauthentication-required"],
  "reauthentication-required": ["authenticating"],
};

export function isValidAuthTransition(from: AuthState, to: AuthState): boolean {
  return AUTH_TRANSITIONS[from].includes(to);
}
