// Auth types tests per Spec 01 - Email Integration (Nango-managed OAuth)
// Verifies: 4-state machine transitions (all valid paths, reject invalid)

import { describe, it, expect } from "vitest";
import { isValidAuthTransition, AUTH_TRANSITIONS } from "./auth-types";
import type { AuthState } from "./auth-types";

describe("Auth state machine (Nango)", () => {
  it("has exactly 4 states", () => {
    const states = Object.keys(AUTH_TRANSITIONS);
    expect(states).toHaveLength(4);
    expect(states).toContain("unauthenticated");
    expect(states).toContain("authenticating");
    expect(states).toContain("authenticated");
    expect(states).toContain("reauthentication-required");
  });

  it("does not have token-expired state (Nango handles refresh)", () => {
    expect(Object.keys(AUTH_TRANSITIONS)).not.toContain("token-expired");
  });

  // Valid transitions per Spec 01
  const validTransitions: [AuthState, AuthState][] = [
    ["unauthenticated", "authenticating"],
    ["authenticating", "authenticated"],
    ["authenticating", "unauthenticated"],
    ["authenticated", "reauthentication-required"],
    ["reauthentication-required", "authenticating"],
  ];

  for (const [from, to] of validTransitions) {
    it(`allows ${from} -> ${to}`, () => {
      expect(isValidAuthTransition(from, to)).toBe(true);
    });
  }

  // Invalid transitions
  const invalidTransitions: [AuthState, AuthState][] = [
    ["unauthenticated", "authenticated"],
    ["unauthenticated", "reauthentication-required"],
    ["authenticating", "reauthentication-required"],
    ["authenticated", "unauthenticated"],
    ["authenticated", "authenticating"],
    ["reauthentication-required", "authenticated"],
    ["reauthentication-required", "unauthenticated"],
  ];

  for (const [from, to] of invalidTransitions) {
    it(`rejects ${from} -> ${to}`, () => {
      expect(isValidAuthTransition(from, to)).toBe(false);
    });
  }
});
