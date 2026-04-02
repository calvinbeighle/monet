// Gmail API rate limiter
// Tracks quota usage per second and per day, enforces limits, and degrades gracefully.

export type ApiCallPriority = "user-action" | "background-sync";

// Approximate unit costs per Gmail API operation
const OPERATION_COSTS: Record<string, number> = {
  "threads.list": 10,
  "threads.get": 5,
  "messages.send": 100,
  "drafts.create": 10,
  "drafts.update": 15,
  "drafts.delete": 10,
  "threads.modify": 5,
  "history.list": 2,
};

const PER_SECOND_LIMIT = 250;
const DAILY_LIMIT = 10_000;
const WARNING_THRESHOLD = 0.8; // 80% of daily limit

// Sliding window size in ms for per-second tracking
const SECOND_WINDOW_MS = 1_000;

interface UsageEntry {
  timestamp: number;
  units: number;
}

export class RateLimiter {
  private _now: () => number = Date.now;

  // Sliding window of calls made in the last second
  private _secondWindow: UsageEntry[] = [];

  // Daily tracking - resets at midnight UTC
  private _dailyUsage = 0;
  private _dailyWindowStart = 0; // timestamp of start of current UTC day

  // Pause state (from 429 responses)
  private _pausedUntil = 0;

  // Degraded mode - entered when daily quota is exhausted
  private _degraded = false;

  constructor() {
    this._dailyWindowStart = this._startOfDay();
  }

  private _startOfDay(): number {
    const now = this._now();
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }

  private _maybeRollDay(): void {
    const start = this._startOfDay();
    if (start !== this._dailyWindowStart) {
      this._dailyWindowStart = start;
      this._dailyUsage = 0;
      this._degraded = false;
    }
  }

  private _pruneSecondWindow(): void {
    const cutoff = this._now() - SECOND_WINDOW_MS;
    this._secondWindow = this._secondWindow.filter((e) => e.timestamp > cutoff);
  }

  private _unitsInLastSecond(): number {
    this._pruneSecondWindow();
    return this._secondWindow.reduce((sum, e) => sum + e.units, 0);
  }

  private _costOf(operation: string): number {
    return OPERATION_COSTS[operation] ?? 10;
  }

  canProceed(
    operation: string,
    priority: ApiCallPriority,
  ): { allowed: boolean; waitMs: number; reason?: string } {
    this._maybeRollDay();

    const now = this._now();

    // Check pause from 429
    if (now < this._pausedUntil) {
      return {
        allowed: false,
        waitMs: this._pausedUntil - now,
        reason: "paused after 429",
      };
    }

    const cost = this._costOf(operation);
    const isWrite = this._isWriteOperation(operation);

    // In degraded mode (daily quota exhausted), only allow reads.
    // Per Spec 01: writes are disabled, reads still pass (subject to per-second check).
    if (this._degraded) {
      if (isWrite) {
        return {
          allowed: false,
          waitMs: this._msUntilDayReset(),
          reason: "daily quota exhausted - read-only mode",
        };
      }
      // Reads skip daily overflow and warning checks - go straight to per-second check
    } else {
      // Near daily quota exhaustion: reduce background sync frequency
      const dailyPercent = this._dailyUsage / DAILY_LIMIT;
      if (dailyPercent >= WARNING_THRESHOLD && priority === "background-sync") {
        return {
          allowed: false,
          waitMs: this._msUntilDayReset(),
          reason: `daily quota at ${Math.round(dailyPercent * 100)}% - background sync paused`,
        };
      }

      // Check predicted daily overflow
      if (this._dailyUsage + cost > DAILY_LIMIT) {
        return {
          allowed: false,
          waitMs: this._msUntilDayReset(),
          reason: "daily quota would be exceeded",
        };
      }
    }

    // Check predicted per-second overflow
    const currentSecondUnits = this._unitsInLastSecond();
    if (currentSecondUnits + cost > PER_SECOND_LIMIT) {
      // Estimate when enough of the window will have rolled off
      const waitMs = this._estimateWaitForSecondQuota(cost, currentSecondUnits);
      return {
        allowed: false,
        waitMs,
        reason: `per-second quota would be exceeded (${currentSecondUnits}/${PER_SECOND_LIMIT} units in window)`,
      };
    }

    return { allowed: true, waitMs: 0 };
  }

  private _estimateWaitForSecondQuota(cost: number, currentUnits: number): number {
    // Find the earliest entry whose removal would free enough units
    const needed = currentUnits + cost - PER_SECOND_LIMIT;
    let freed = 0;
    for (const entry of this._secondWindow) {
      freed += entry.units;
      if (freed >= needed) {
        const expiry = entry.timestamp + SECOND_WINDOW_MS;
        return Math.max(1, expiry - this._now());
      }
    }
    return SECOND_WINDOW_MS;
  }

  private _msUntilDayReset(): number {
    const nextDay = this._dailyWindowStart + 24 * 60 * 60 * 1_000;
    return Math.max(0, nextDay - this._now());
  }

  private _isWriteOperation(operation: string): boolean {
    return (
      operation === "messages.send" ||
      operation === "drafts.create" ||
      operation === "drafts.update" ||
      operation === "drafts.delete" ||
      operation === "threads.modify"
    );
  }

  recordUsage(operation: string): void {
    this._maybeRollDay();

    const cost = this._costOf(operation);
    const now = this._now();

    this._secondWindow.push({ timestamp: now, units: cost });
    this._dailyUsage += cost;

    if (this._dailyUsage >= DAILY_LIMIT) {
      this._degraded = true;
    }
  }

  pauseFor(durationMs: number): void {
    const until = this._now() + durationMs;
    if (until > this._pausedUntil) {
      this._pausedUntil = until;
    }
  }

  getStatus(): {
    dailyUsagePercent: number;
    isExhausted: boolean;
    isNearExhaustion: boolean;
    isPaused: boolean;
  } {
    this._maybeRollDay();
    const dailyUsagePercent = (this._dailyUsage / DAILY_LIMIT) * 100;
    return {
      dailyUsagePercent,
      isExhausted: this._degraded,
      isNearExhaustion: dailyUsagePercent >= WARNING_THRESHOLD * 100,
      isPaused: this._now() < this._pausedUntil,
    };
  }

  // Test helpers

  _reset(): void {
    this._secondWindow = [];
    this._dailyUsage = 0;
    this._dailyWindowStart = this._startOfDay();
    this._pausedUntil = 0;
    this._degraded = false;
  }

  _setNow(fn: () => number): void {
    this._now = fn;
    // Do not re-anchor daily window here; let _maybeRollDay handle day transitions.
    // Call _reset after _setNow to properly anchor the daily window to the injected clock.
  }
}

export const rateLimiter = new RateLimiter();

// Maps a Gmail REST API path + HTTP method to a named operation.
export function getOperationName(path: string, method: string): string {
  const m = method.toUpperCase();

  if (m === "GET" && /\/threads(\?|$)/.test(path)) return "threads.list";
  if (m === "GET" && /\/threads\/[^/]+$/.test(path)) return "threads.get";
  if (m === "POST" && /\/messages\/send/.test(path)) return "messages.send";
  if (m === "POST" && /\/drafts(\?|$)/.test(path)) return "drafts.create";
  if ((m === "PUT" || m === "PATCH") && /\/drafts\/[^/]+/.test(path)) return "drafts.update";
  if (m === "DELETE" && /\/drafts\/[^/]+/.test(path)) return "drafts.delete";
  if (m === "POST" && /\/threads\/[^/]+\/modify/.test(path)) return "threads.modify";
  if (m === "GET" && /\/history(\?|$)/.test(path)) return "history.list";

  return "unknown";
}
