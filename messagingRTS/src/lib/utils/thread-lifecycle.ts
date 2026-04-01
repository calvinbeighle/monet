// Thread lifecycle state machine per Spec 09
// Valid transitions:
//   New -> Active (user opens/reads OR sends reply)
//   New -> Handled (handled action applied without replying)
//   Active -> Waiting (user sends reply, no inbound since)
//   Waiting -> Active (inbound message arrives)
//   Waiting -> At-Risk (configured time threshold passes without other-party reply)
//   At-Risk -> Active (inbound message OR user reply)
//   At-Risk -> Lost (threshold exceeded, no engagement)
//   Lost -> Active (inbound message arrives - conversation resumes)
//   Any -> Handled (explicit user or agent action)

import type { ThreadLifecycleState } from "../types";

const VALID_TRANSITIONS: Record<ThreadLifecycleState, ThreadLifecycleState[]> = {
  new: ["active", "handled"],
  active: ["waiting", "at-risk", "handled"],
  waiting: ["active", "at-risk", "handled"],
  "at-risk": ["active", "lost", "handled"],
  lost: ["active", "handled"],
  handled: [], // terminal state - no transitions out in current spec
};

export function isValidTransition(from: ThreadLifecycleState, to: ThreadLifecycleState): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function getValidTransitions(from: ThreadLifecycleState): ThreadLifecycleState[] {
  return [...VALID_TRANSITIONS[from]];
}

// Determine the appropriate transition based on an event
export type LifecycleEvent =
  | "user-opened"
  | "user-replied"
  | "inbound-message"
  | "time-threshold-waiting"
  | "time-threshold-lost"
  | "handled-action";

export function resolveTransition(
  current: ThreadLifecycleState,
  event: LifecycleEvent,
): ThreadLifecycleState | null {
  switch (event) {
    case "user-opened":
      if (current === "new") return "active";
      return null;

    case "user-replied":
      if (current === "new") return "active";
      if (current === "active") return "waiting";
      if (current === "at-risk") return "active";
      if (current === "lost") return "active";
      return null;

    case "inbound-message":
      if (current === "waiting") return "active";
      if (current === "at-risk") return "active";
      if (current === "lost") return "active";
      return null;

    case "time-threshold-waiting":
      if (current === "waiting") return "at-risk";
      if (current === "active") return "at-risk";
      return null;

    case "time-threshold-lost":
      if (current === "at-risk") return "lost";
      return null;

    case "handled-action":
      // Any state -> handled
      if (current !== "handled") return "handled";
      return null;
  }
}
