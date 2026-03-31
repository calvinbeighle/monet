// Opportunity system per Spec 07
// States: none -> ripe (>50% window) -> fading (<50% window) -> expired / captured

import type { Thread, OpportunityState } from "../../lib/types";

// Default opportunity window duration (configurable per agent flag in future)
const DEFAULT_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours

// Evaluate opportunity state for a thread
export function evaluateOpportunity(
  thread: Thread,
  now: number = Date.now(),
): { state: OpportunityState; windowEnd: number | null } {
  // No opportunity flagged
  if (thread.opportunityState === "none" && thread.opportunityWindowEnd === null) {
    return { state: "none", windowEnd: null };
  }

  // Already captured or expired - terminal states
  if (thread.opportunityState === "captured") {
    return { state: "captured", windowEnd: thread.opportunityWindowEnd };
  }
  if (thread.opportunityState === "expired") {
    return { state: "expired", windowEnd: thread.opportunityWindowEnd };
  }

  // Active opportunity window
  const windowEnd = thread.opportunityWindowEnd;
  if (windowEnd === null) {
    return { state: "none", windowEnd: null };
  }

  // Check if window has elapsed
  if (now >= windowEnd) {
    return { state: "expired", windowEnd };
  }

  // Calculate position within window
  const windowStart = windowEnd - DEFAULT_WINDOW_MS;
  const elapsed = now - windowStart;
  const halfWindow = DEFAULT_WINDOW_MS / 2;

  if (elapsed < halfWindow) {
    return { state: "ripe", windowEnd };
  }
  return { state: "fading", windowEnd };
}

// Flag a thread as having an opportunity (set by agent layer)
export function flagOpportunity(
  thread: Thread,
  windowDurationMs: number = DEFAULT_WINDOW_MS,
  now: number = Date.now(),
): Thread {
  return {
    ...thread,
    opportunityState: "ripe",
    opportunityWindowEnd: now + windowDurationMs,
    lastModified: now,
  };
}

// Capture an opportunity (user replied while window open)
export function captureOpportunity(thread: Thread, now: number = Date.now()): Thread {
  if (thread.opportunityState !== "ripe" && thread.opportunityState !== "fading") {
    return thread; // can only capture active opportunities
  }

  return {
    ...thread,
    opportunityState: "captured",
    lastModified: now,
  };
}

// Update opportunity states for all threads (called each tick)
export function tickOpportunities(threads: Thread[], now: number = Date.now()): Thread[] {
  return threads.map((thread) => {
    if (
      thread.opportunityState === "none" ||
      thread.opportunityState === "captured" ||
      thread.opportunityState === "expired"
    ) {
      return thread;
    }

    const { state } = evaluateOpportunity(thread, now);
    if (state === thread.opportunityState) return thread;

    return {
      ...thread,
      opportunityState: state,
      lastModified: now,
    };
  });
}

export { DEFAULT_WINDOW_MS };
