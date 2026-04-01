import { describe, it, expect } from "vitest";
import { isValidTransition, getValidTransitions, resolveTransition } from "./thread-lifecycle";
import type { ThreadLifecycleState } from "../types";

describe("Thread lifecycle state machine", () => {
  describe("isValidTransition", () => {
    // Valid transitions per Spec 09
    const validPaths: [ThreadLifecycleState, ThreadLifecycleState][] = [
      ["new", "active"],
      ["new", "handled"],
      ["active", "waiting"],
      ["active", "handled"],
      ["waiting", "active"],
      ["waiting", "at-risk"],
      ["waiting", "handled"],
      ["at-risk", "active"],
      ["at-risk", "lost"],
      ["at-risk", "handled"],
      ["lost", "active"],
      ["lost", "handled"],
    ];

    it.each(validPaths)("allows %s -> %s", (from, to) => {
      expect(isValidTransition(from, to)).toBe(true);
    });

    // Invalid transitions
    const invalidPaths: [ThreadLifecycleState, ThreadLifecycleState][] = [
      ["new", "waiting"],
      ["new", "at-risk"],
      ["new", "lost"],
      ["active", "new"],
      ["active", "lost"],
      ["waiting", "new"],
      ["waiting", "lost"],
      ["at-risk", "new"],
      ["at-risk", "waiting"],
      ["lost", "new"],
      ["lost", "waiting"],
      ["lost", "at-risk"],
      ["handled", "new"],
      ["handled", "active"],
      ["handled", "waiting"],
      ["handled", "at-risk"],
      ["handled", "lost"],
    ];

    it.each(invalidPaths)("rejects %s -> %s", (from, to) => {
      expect(isValidTransition(from, to)).toBe(false);
    });
  });

  describe("getValidTransitions", () => {
    it("returns correct transitions for new", () => {
      expect(getValidTransitions("new")).toEqual(["active", "handled"]);
    });

    it("returns empty for handled (terminal)", () => {
      expect(getValidTransitions("handled")).toEqual([]);
    });

    it("returns three options for waiting", () => {
      const transitions = getValidTransitions("waiting");
      expect(transitions).toContain("active");
      expect(transitions).toContain("at-risk");
      expect(transitions).toContain("handled");
    });
  });

  describe("resolveTransition", () => {
    it("user-opened: new -> active", () => {
      expect(resolveTransition("new", "user-opened")).toBe("active");
    });

    it("user-opened: no-op on active", () => {
      expect(resolveTransition("active", "user-opened")).toBeNull();
    });

    it("user-replied: new -> active", () => {
      expect(resolveTransition("new", "user-replied")).toBe("active");
    });

    it("user-replied: active -> waiting", () => {
      expect(resolveTransition("active", "user-replied")).toBe("waiting");
    });

    it("user-replied: at-risk -> active (risk reset)", () => {
      expect(resolveTransition("at-risk", "user-replied")).toBe("active");
    });

    it("user-replied: lost -> active (re-engagement)", () => {
      expect(resolveTransition("lost", "user-replied")).toBe("active");
    });

    it("inbound-message: waiting -> active", () => {
      expect(resolveTransition("waiting", "inbound-message")).toBe("active");
    });

    it("inbound-message: at-risk -> active", () => {
      expect(resolveTransition("at-risk", "inbound-message")).toBe("active");
    });

    it("inbound-message: lost -> active (conversation resumes)", () => {
      expect(resolveTransition("lost", "inbound-message")).toBe("active");
    });

    it("time-threshold-waiting: waiting -> at-risk", () => {
      expect(resolveTransition("waiting", "time-threshold-waiting")).toBe("at-risk");
    });

    it("time-threshold-waiting: active -> at-risk (Spec 09)", () => {
      expect(resolveTransition("active", "time-threshold-waiting")).toBe("at-risk");
    });

    it("time-threshold-lost: at-risk -> lost", () => {
      expect(resolveTransition("at-risk", "time-threshold-lost")).toBe("lost");
    });

    it("handled-action: any non-handled state -> handled", () => {
      const states: ThreadLifecycleState[] = ["new", "active", "waiting", "at-risk", "lost"];
      for (const state of states) {
        expect(resolveTransition(state, "handled-action")).toBe("handled");
      }
    });

    it("handled-action: no-op when already handled", () => {
      expect(resolveTransition("handled", "handled-action")).toBeNull();
    });
  });
});
