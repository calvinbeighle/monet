// Thread lifecycle state machine per Spec 09 and Spec 03
// Valid transitions:
//   New -> Active (user opens/reads OR sends reply)
//   New -> Handled (handled action applied without replying)
//   Active -> Waiting (user sends reply, no inbound since)
//   Waiting -> Active (inbound message arrives)
//   Waiting -> At-Risk (configured time threshold passes without other-party reply)
//   At-Risk -> Active (inbound message OR user reply)
//   At-Risk -> Drifting-Lost (neglect pushes thread toward lost zone)
//   Drifting-Lost -> Active (user action before fully entering lost zone)
//   Drifting-Lost -> Lost (actual position enters lost zone)
//   Lost -> Active (inbound message arrives - conversation resumes)
//   Any -> Handled (explicit user or agent action)
//   Handled -> Approaching-Archive (archive drift in progress)
//   Approaching-Archive -> Handled (reaches archive boundary)

import type { ThreadLifecycleState } from "../types";

const VALID_TRANSITIONS: Record<ThreadLifecycleState, ThreadLifecycleState[]> = {
  new: ["active", "handled"],
  active: ["waiting", "at-risk", "handled"],
  waiting: ["active", "at-risk", "handled"],
  "at-risk": ["active", "drifting-lost", "lost", "handled"],
  "drifting-lost": ["active", "lost", "handled"],
  lost: ["active", "handled"],
  handled: ["approaching-archive"],
  "approaching-archive": ["handled"],
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
  | "time-threshold-drifting-lost"
  | "time-threshold-lost"
  | "handled-action"
  | "archive-drift-start"
  | "archive-drift-complete";

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
      if (current === "drifting-lost") return "active";
      if (current === "lost") return "active";
      return null;

    case "inbound-message":
      if (current === "waiting") return "active";
      if (current === "at-risk") return "active";
      if (current === "drifting-lost") return "active";
      if (current === "lost") return "active";
      return null;

    case "time-threshold-waiting":
      if (current === "waiting") return "at-risk";
      if (current === "active") return "at-risk";
      return null;

    case "time-threshold-drifting-lost":
      if (current === "at-risk") return "drifting-lost";
      return null;

    case "time-threshold-lost":
      if (current === "at-risk") return "lost";
      if (current === "drifting-lost") return "lost";
      return null;

    case "handled-action":
      // Any state -> handled
      if (current !== "handled" && current !== "approaching-archive") return "handled";
      return null;

    case "archive-drift-start":
      if (current === "handled") return "approaching-archive";
      return null;

    case "archive-drift-complete":
      if (current === "approaching-archive") return "handled";
      return null;
  }
}
