import { describe, it, expect, beforeEach } from "vitest";
import { rateLimiter, getOperationName } from "@/lib/utils/rate-limiter";

const BASE_TIME = 1_000_000;

beforeEach(() => {
  rateLimiter._setNow(() => BASE_TIME);
  rateLimiter._reset();
});

// ---------------------------------------------------------------------------
// canProceed - per-second bucket
// ---------------------------------------------------------------------------

describe("canProceed - per-second limit", () => {
  it("allows calls within the per-second limit", () => {
    const result = rateLimiter.canProceed("threads.get", "user-action");
    expect(result.allowed).toBe(true);
    expect(result.waitMs).toBe(0);
  });

  it("blocks when per-second limit is exceeded and returns waitMs > 0", () => {
    // Saturate the per-second bucket by recording enough usage
    // threads.list costs 10, so 25 calls = 250 units = PER_SECOND_LIMIT
    for (let i = 0; i < 25; i++) {
      rateLimiter.recordUsage("threads.list");
    }

    const result = rateLimiter.canProceed("threads.get", "user-action");
    expect(result.allowed).toBe(false);
    expect(result.waitMs).toBeGreaterThan(0);
    expect(result.waitMs).toBeLessThanOrEqual(1000);
  });

  it("allows calls after per-second bucket resets (clock advances 1 second)", () => {
    // Fill the per-second bucket
    for (let i = 0; i < 25; i++) {
      rateLimiter.recordUsage("threads.list");
    }

    // Confirm blocked
    expect(rateLimiter.canProceed("threads.get", "user-action").allowed).toBe(false);

    // Advance clock by 1 second
    rateLimiter._setNow(() => BASE_TIME + 1001);

    const result = rateLimiter.canProceed("threads.get", "user-action");
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// canProceed - daily quota exhaustion
// ---------------------------------------------------------------------------

describe("canProceed - daily quota", () => {
  it("blocks write operations when daily quota is exhausted", () => {
    // Exhaust daily quota: messages.send costs 100, so 100 calls = 10000 units
    for (let i = 0; i < 100; i++) {
      // Spread across seconds so per-second limit doesn't interfere
      rateLimiter._setNow(() => BASE_TIME + i * 2000);
      rateLimiter.recordUsage("messages.send");
    }

    rateLimiter._setNow(() => BASE_TIME + 210_000);
    const result = rateLimiter.canProceed("messages.send", "user-action");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("allows read operations in degraded read-only mode when daily quota is exhausted", () => {
    // Exhaust daily quota
    for (let i = 0; i < 100; i++) {
      rateLimiter._setNow(() => BASE_TIME + i * 2000);
      rateLimiter.recordUsage("messages.send");
    }

    rateLimiter._setNow(() => BASE_TIME + 210_000);
    // threads.get is a read operation - should still be allowed
    const result = rateLimiter.canProceed("threads.get", "user-action");
    expect(result.allowed).toBe(true);
  });

  it("allows calls after daily bucket resets (clock advances 24 hours)", () => {
    // Exhaust daily quota
    for (let i = 0; i < 100; i++) {
      rateLimiter._setNow(() => BASE_TIME + i * 2000);
      rateLimiter.recordUsage("messages.send");
    }

    // Advance clock past 24 hours
    const oneDayMs = 24 * 60 * 60 * 1000;
    rateLimiter._setNow(() => BASE_TIME + oneDayMs + 1000);

    const result = rateLimiter.canProceed("messages.send", "user-action");
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pauseFor
// ---------------------------------------------------------------------------

describe("pauseFor", () => {
  it("blocks all calls during pause duration", () => {
    rateLimiter.pauseFor(5000);

    const result = rateLimiter.canProceed("threads.get", "user-action");
    expect(result.allowed).toBe(false);
    expect(result.waitMs).toBeGreaterThan(0);
  });

  it("allows calls after pause duration expires", () => {
    rateLimiter.pauseFor(5000);

    // Confirm blocked
    expect(rateLimiter.canProceed("threads.get", "user-action").allowed).toBe(false);

    // Advance past the pause
    rateLimiter._setNow(() => BASE_TIME + 6000);

    const result = rateLimiter.canProceed("threads.get", "user-action");
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Background sync throttling at 80% daily usage
// ---------------------------------------------------------------------------

describe("background sync throttling", () => {
  it("throttles background-sync reads when daily usage exceeds 80%", () => {
    // Reach 81% of daily limit: 10000 * 0.81 = 8100 units
    // history.list costs 2, so 4050 calls = 8100 units
    for (let i = 0; i < 4050; i++) {
      rateLimiter._setNow(() => BASE_TIME + i * 1000);
      rateLimiter.recordUsage("history.list");
    }

    rateLimiter._setNow(() => BASE_TIME + 4_200_000);
    const result = rateLimiter.canProceed("history.list", "background-sync");
    expect(result.allowed).toBe(false);
  });

  it("does not throttle user-action writes at 80% daily usage (only exhaustion blocks writes)", () => {
    // Reach ~81% of daily limit
    for (let i = 0; i < 4050; i++) {
      rateLimiter._setNow(() => BASE_TIME + i * 1000);
      rateLimiter.recordUsage("history.list");
    }

    rateLimiter._setNow(() => BASE_TIME + 4_200_000);
    // user-action priority write should still be allowed at 81% (not exhausted)
    const result = rateLimiter.canProceed("messages.send", "user-action");
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// recordUsage
// ---------------------------------------------------------------------------

describe("recordUsage", () => {
  it("accumulates units correctly and is reflected in getStatus", () => {
    // Record 3 calls: threads.list=10, threads.get=5, drafts.create=10 -> 25 units total
    rateLimiter._setNow(() => BASE_TIME + 2000);
    rateLimiter.recordUsage("threads.list");
    rateLimiter._setNow(() => BASE_TIME + 3000);
    rateLimiter.recordUsage("threads.get");
    rateLimiter._setNow(() => BASE_TIME + 4000);
    rateLimiter.recordUsage("drafts.create");

    const status = rateLimiter.getStatus();
    // 25 / 10000 = 0.25%
    expect(status.dailyUsagePercent).toBeCloseTo(0.25, 1);
  });
});

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------

describe("getStatus", () => {
  it("reports correct dailyUsagePercent", () => {
    // 50 messages.send calls at 100 units each = 5000 units = 50%
    for (let i = 0; i < 50; i++) {
      rateLimiter._setNow(() => BASE_TIME + i * 2000);
      rateLimiter.recordUsage("messages.send");
    }

    const status = rateLimiter.getStatus();
    expect(status.dailyUsagePercent).toBeCloseTo(50, 0);
  });

  it("reports isExhausted as false below daily limit and true at/above it", () => {
    const statusBefore = rateLimiter.getStatus();
    expect(statusBefore.isExhausted).toBe(false);

    // Exhaust the daily limit
    for (let i = 0; i < 100; i++) {
      rateLimiter._setNow(() => BASE_TIME + i * 2000);
      rateLimiter.recordUsage("messages.send");
    }

    rateLimiter._setNow(() => BASE_TIME + 210_000);
    const statusAfter = rateLimiter.getStatus();
    expect(statusAfter.isExhausted).toBe(true);
  });

  it("reports isPaused as false when not paused and true while paused", () => {
    expect(rateLimiter.getStatus().isPaused).toBe(false);

    rateLimiter.pauseFor(10_000);
    expect(rateLimiter.getStatus().isPaused).toBe(true);

    rateLimiter._setNow(() => BASE_TIME + 11_000);
    expect(rateLimiter.getStatus().isPaused).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getOperationName
// ---------------------------------------------------------------------------

describe("getOperationName", () => {
  it.each([
    ["/gmail/v1/users/me/threads", "GET", "threads.list"],
    ["/gmail/v1/users/me/threads/abc123", "GET", "threads.get"],
    ["/gmail/v1/users/me/messages/send", "POST", "messages.send"],
    ["/gmail/v1/users/me/drafts", "POST", "drafts.create"],
    ["/gmail/v1/users/me/drafts/draft1", "PUT", "drafts.update"],
    ["/gmail/v1/users/me/drafts/draft1", "DELETE", "drafts.delete"],
    ["/gmail/v1/users/me/threads/abc123/modify", "POST", "threads.modify"],
    ["/gmail/v1/users/me/history", "GET", "history.list"],
  ])("maps path %s + method %s to operation %s", (path, method, expected) => {
    expect(getOperationName(path, method)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// _reset
// ---------------------------------------------------------------------------

describe("_reset", () => {
  it("clears all accumulated state including daily usage, pause, and per-second bucket", () => {
    // Accumulate state
    for (let i = 0; i < 50; i++) {
      rateLimiter._setNow(() => BASE_TIME + i * 2000);
      rateLimiter.recordUsage("messages.send");
    }
    rateLimiter.pauseFor(60_000);

    // Verify state is set
    const before = rateLimiter.getStatus();
    expect(before.dailyUsagePercent).toBeGreaterThan(0);
    expect(before.isPaused).toBe(true);

    // Reset
    rateLimiter._reset();
    rateLimiter._setNow(() => BASE_TIME);

    const after = rateLimiter.getStatus();
    expect(after.dailyUsagePercent).toBe(0);
    expect(after.isExhausted).toBe(false);
    expect(after.isPaused).toBe(false);

    // Should allow calls again
    expect(rateLimiter.canProceed("threads.get", "user-action").allowed).toBe(true);
  });
});
