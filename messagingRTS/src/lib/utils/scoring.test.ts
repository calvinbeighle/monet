import { describe, it, expect } from "vitest";
import {
  computeUrgencyScore,
  computeValueScore,
  computeRiskTier,
  computeRiskScore,
  getLatencyThresholds,
  detectDeadline,
} from "./scoring";
import { createThread } from "../types";
import type { ContactEnrichment } from "../types";

function makeContact(overrides: Partial<ContactEnrichment> = {}): ContactEnrichment {
  return {
    displayName: "Test User",
    email: "test@example.com",
    organization: null,
    vipFlag: false,
    relationshipScore: 50,
    responseHistory: { avgResponseTimeMs: 0, threadFrequency: 0 },
    ...overrides,
  };
}

describe("computeUrgencyScore", () => {
  it("returns moderate urgency for a fresh thread with no reply", () => {
    const thread = createThread("t1", "Subject", "snippet");
    const score = computeUrgencyScore(thread);
    // Fresh thread: unread (0.15) + recent activity (0.1) + minimal neglect
    expect(score).toBeGreaterThan(0.2);
    expect(score).toBeLessThan(0.6);
  });

  it("increases urgency with neglect time", () => {
    const thread = createThread("t1", "Subject", "snippet");
    const now = Date.now();

    // 1 hour ago
    thread.firstMessageTimestamp = now - 1 * 60 * 60 * 1000;
    thread.latestMessageTimestamp = now - 1 * 60 * 60 * 1000;
    const score1h = computeUrgencyScore(thread, now);

    // 24 hours ago
    thread.firstMessageTimestamp = now - 24 * 60 * 60 * 1000;
    thread.latestMessageTimestamp = now - 24 * 60 * 60 * 1000;
    const score24h = computeUrgencyScore(thread, now);

    expect(score24h).toBeGreaterThan(score1h);
  });

  it("boosts urgency for VIP participants", () => {
    const thread = createThread("t1", "Subject", "snippet");
    const scoreNoVip = computeUrgencyScore(thread);

    thread.participants = [makeContact({ vipFlag: true })];
    const scoreVip = computeUrgencyScore(thread);

    expect(scoreVip).toBeGreaterThan(scoreNoVip);
  });

  it("boosts urgency for unread threads", () => {
    const thread = createThread("t1", "Subject", "snippet");
    thread.unread = true;
    const scoreUnread = computeUrgencyScore(thread);

    thread.unread = false;
    const scoreRead = computeUrgencyScore(thread);

    expect(scoreUnread).toBeGreaterThan(scoreRead);
  });

  it("boosts urgency when message body contains deadline phrases", () => {
    const now = Date.now();
    const thread = createThread("t1", "Regular subject", "snippet");
    thread.unread = false;
    thread.firstMessageTimestamp = now - 1000;
    thread.latestMessageTimestamp = now - 1000;
    const scoreNoDeadline = computeUrgencyScore(thread, now);

    thread.messages = [
      {
        id: "m1",
        sender: "a@b.com",
        recipients: [],
        cc: [],
        bcc: [],
        timestamp: now,
        bodyPlain: "Please submit the report by Friday EOD",
        bodyHtml: "",
        labelIds: [],
        attachments: [],
      },
    ];
    const scoreWithDeadline = computeUrgencyScore(thread, now);
    expect(scoreWithDeadline).toBeGreaterThan(scoreNoDeadline);
  });

  it("detects deadline in subject line", () => {
    const now = Date.now();
    const thread = createThread("t1", "ASAP: Need your review", "snippet");
    thread.unread = false;
    thread.firstMessageTimestamp = now - 1000;
    thread.latestMessageTimestamp = now - 1000;
    const score = computeUrgencyScore(thread, now);

    const thread2 = createThread("t2", "Regular email", "snippet");
    thread2.unread = false;
    thread2.firstMessageTimestamp = now - 1000;
    thread2.latestMessageTimestamp = now - 1000;
    const scoreNoDeadline = computeUrgencyScore(thread2, now);

    expect(score).toBeGreaterThan(scoreNoDeadline);
  });

  it("caps urgency at 1.0", () => {
    const thread = createThread("t1", "Subject", "snippet");
    const now = Date.now();
    // Extreme neglect
    thread.firstMessageTimestamp = now - 100 * 24 * 60 * 60 * 1000;
    thread.latestMessageTimestamp = now - 100 * 24 * 60 * 60 * 1000;
    thread.participants = [makeContact({ vipFlag: true })];
    thread.unread = true;

    expect(computeUrgencyScore(thread, now)).toBeLessThanOrEqual(1.0);
  });

  it("returns low urgency after recent reply", () => {
    const thread = createThread("t1", "Subject", "snippet");
    const now = Date.now();
    thread.lastUserReplyTimestamp = now - 5 * 60 * 1000; // 5 min ago
    thread.latestMessageTimestamp = now - 5 * 60 * 1000;
    thread.unread = false;

    const score = computeUrgencyScore(thread, now);
    expect(score).toBeLessThan(0.2);
  });
});

describe("computeValueScore", () => {
  it("returns moderate value for default thread", () => {
    const thread = createThread("t1", "Subject", "snippet");
    thread.participants = [makeContact({ relationshipScore: 50 })];
    const score = computeValueScore(thread);
    expect(score).toBeGreaterThan(0.1);
    expect(score).toBeLessThan(0.5);
  });

  it("increases value with high relationship score", () => {
    const thread = createThread("t1", "Subject", "snippet");
    thread.participants = [makeContact({ relationshipScore: 20 })];
    const scoreLow = computeValueScore(thread);

    thread.participants = [makeContact({ relationshipScore: 90 })];
    const scoreHigh = computeValueScore(thread);

    expect(scoreHigh).toBeGreaterThan(scoreLow);
  });

  it("boosts value for VIP participants", () => {
    const thread = createThread("t1", "Subject", "snippet");
    thread.participants = [makeContact({ vipFlag: false })];
    const scoreNoVip = computeValueScore(thread);

    thread.participants = [makeContact({ vipFlag: true })];
    const scoreVip = computeValueScore(thread);

    expect(scoreVip).toBeGreaterThan(scoreNoVip);
  });

  it("boosts value for engagement depth", () => {
    const thread = createThread("t1", "Subject", "snippet");
    thread.participants = [makeContact()];
    thread.messageCount = 1;
    const scoreShort = computeValueScore(thread);

    thread.messageCount = 10;
    const scoreDeep = computeValueScore(thread);

    expect(scoreDeep).toBeGreaterThan(scoreShort);
  });

  it("boosts value for IMPORTANT label", () => {
    const thread = createThread("t1", "Subject", "snippet");
    thread.participants = [makeContact()];
    const scoreNoLabel = computeValueScore(thread);

    thread.gmailLabels = ["IMPORTANT"];
    const scoreLabeled = computeValueScore(thread);

    expect(scoreLabeled).toBeGreaterThan(scoreNoLabel);
  });

  it("boosts value for valuable keywords in subject", () => {
    const thread = createThread("t1", "Regular email", "snippet");
    thread.participants = [makeContact()];
    const scoreRegular = computeValueScore(thread);

    const thread2 = createThread("t2", "New partnership proposal", "snippet");
    thread2.participants = [makeContact()];
    const scoreValuable = computeValueScore(thread2);

    expect(scoreValuable).toBeGreaterThan(scoreRegular);
  });

  it("boosts value for valuable keywords in message body (Spec 03)", () => {
    const thread = createThread("t1", "Regular email", "snippet");
    thread.participants = [makeContact()];
    const scoreNoBody = computeValueScore(thread);

    thread.messages = [
      {
        id: "m1",
        sender: "a@b.com",
        recipients: [],
        cc: [],
        bcc: [],
        timestamp: Date.now(),
        bodyPlain: "We would like to discuss a partnership proposal with your team",
        bodyHtml: "",
        labelIds: [],
        attachments: [],
      },
    ];
    const scoreWithBody = computeValueScore(thread);
    expect(scoreWithBody).toBeGreaterThan(scoreNoBody);
  });

  it("caps value at 1.0", () => {
    const thread = createThread("t1", "Deal proposal meeting schedule", "snippet");
    thread.participants = [
      makeContact({ vipFlag: true, relationshipScore: 100 }),
      makeContact({ vipFlag: true, relationshipScore: 100 }),
    ];
    thread.messageCount = 20;
    thread.gmailLabels = ["IMPORTANT", "STARRED"];

    expect(computeValueScore(thread)).toBeLessThanOrEqual(1.0);
  });
});

describe("computeRiskTier", () => {
  const HOUR = 60 * 60 * 1000;

  it("returns safe when within elevated threshold", () => {
    const thread = createThread("t1", "Subject", "snippet");
    thread.threadType = "existing-relationship";
    const now = Date.now();
    thread.riskTimerStart = now - 1 * HOUR; // 1h, threshold is 24h

    expect(computeRiskTier(thread, now)).toBe("safe");
  });

  it("returns elevated when past elevated threshold", () => {
    const thread = createThread("t1", "Subject", "snippet");
    thread.threadType = "existing-relationship";
    const now = Date.now();
    thread.riskTimerStart = now - 25 * HOUR; // 25h, elevated at 24h

    expect(computeRiskTier(thread, now)).toBe("elevated");
  });

  it("returns critical when past critical threshold", () => {
    const thread = createThread("t1", "Subject", "snippet");
    thread.threadType = "existing-relationship";
    const now = Date.now();
    thread.riskTimerStart = now - 50 * HOUR; // 50h, critical at 48h

    expect(computeRiskTier(thread, now)).toBe("critical");
  });

  it("returns lost when past lost threshold", () => {
    const thread = createThread("t1", "Subject", "snippet");
    thread.threadType = "existing-relationship";
    const now = Date.now();
    thread.riskTimerStart = now - 100 * HOUR; // 100h, lost at 96h

    expect(computeRiskTier(thread, now)).toBe("lost");
  });

  it("monotonically increases risk with time", () => {
    const thread = createThread("t1", "Subject", "snippet");
    thread.threadType = "warm-intro";
    const now = Date.now();

    const tiers = ["safe", "elevated", "critical", "lost"];
    const times = [1, 7, 13, 25]; // hours

    let lastTierIndex = -1;
    for (const hours of times) {
      thread.riskTimerStart = now - hours * HOUR;
      const tier = computeRiskTier(thread, now);
      const tierIndex = tiers.indexOf(tier);
      expect(tierIndex).toBeGreaterThanOrEqual(lastTierIndex);
      lastTierIndex = tierIndex;
    }
  });

  it("uses correct thresholds per thread type", () => {
    // Internal threads have tighter thresholds (4h/8h/16h)
    const thread = createThread("t1", "Subject", "snippet");
    thread.threadType = "internal";
    const now = Date.now();
    thread.riskTimerStart = now - 5 * HOUR; // 5h

    expect(computeRiskTier(thread, now)).toBe("elevated");

    // Same time, but transactional has looser thresholds (48h/96h/168h)
    thread.threadType = "transactional";
    expect(computeRiskTier(thread, now)).toBe("safe");
  });
});

describe("computeRiskScore", () => {
  const HOUR = 60 * 60 * 1000;

  it("returns 0 when risk timer just started", () => {
    const thread = createThread("t1", "Subject", "snippet");
    const now = Date.now();
    thread.riskTimerStart = now;
    expect(computeRiskScore(thread, now)).toBe(0);
  });

  it("returns 100 at or beyond the lost threshold", () => {
    const thread = createThread("t1", "Subject", "snippet");
    const now = Date.now();
    thread.riskTimerStart = now - 100 * HOUR; // existing-relationship lost = 96h
    expect(computeRiskScore(thread, now)).toBe(100);
  });

  it("returns ~33 at the elevated threshold", () => {
    const thread = createThread("t1", "Subject", "snippet");
    const now = Date.now();
    // existing-relationship elevated = 24h
    thread.riskTimerStart = now - 24 * HOUR;
    const score = computeRiskScore(thread, now);
    expect(score).toBeCloseTo(33, 0);
  });

  it("returns ~66 at the critical threshold", () => {
    const thread = createThread("t1", "Subject", "snippet");
    const now = Date.now();
    // existing-relationship critical = 48h
    thread.riskTimerStart = now - 48 * HOUR;
    const score = computeRiskScore(thread, now);
    expect(score).toBeCloseTo(66, 0);
  });

  it("rises continuously (not in discrete jumps)", () => {
    const thread = createThread("t1", "Subject", "snippet");
    const now = Date.now();
    const scores: number[] = [];
    for (let h = 0; h <= 96; h += 4) {
      thread.riskTimerStart = now - h * HOUR;
      scores.push(computeRiskScore(thread, now));
    }
    // Each score should be >= the previous one (monotonically increasing)
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
    // There should be no large jumps (continuous)
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i] - scores[i - 1]).toBeLessThan(10);
    }
  });
});

describe("detectDeadline", () => {
  it("detects 'by Monday' style phrases", () => {
    expect(detectDeadline("Please send this by Monday")).toBe(true);
  });

  it("detects 'deadline' keyword", () => {
    expect(detectDeadline("The deadline for this project is next week")).toBe(true);
  });

  it("detects 'EOD' abbreviation", () => {
    expect(detectDeadline("I need this EOD")).toBe(true);
  });

  it("detects 'ASAP' abbreviation", () => {
    expect(detectDeadline("Please respond ASAP")).toBe(true);
  });

  it("detects 'end of week' phrases", () => {
    expect(detectDeadline("Submit by end of week")).toBe(true);
  });

  it("detects 'due by' phrases", () => {
    expect(detectDeadline("This is due by next Friday")).toBe(true);
  });

  it("detects date patterns", () => {
    expect(detectDeadline("Complete before 3/15/2026")).toBe(true);
    expect(detectDeadline("Due 2026-04-01")).toBe(true);
  });

  it("detects 'time-sensitive'", () => {
    expect(detectDeadline("This is a time-sensitive matter")).toBe(true);
  });

  it("detects 'no later than'", () => {
    expect(detectDeadline("Submit no later than 5pm")).toBe(true);
  });

  it("returns false for non-deadline text", () => {
    expect(detectDeadline("Hey just checking in, how are things going?")).toBe(false);
  });

  it("detects 'by Jan 15' style month phrases", () => {
    expect(detectDeadline("Please review by Jan 15")).toBe(true);
  });

  it("detects 'expires on' phrases", () => {
    expect(detectDeadline("Your offer expires on March 1st")).toBe(true);
  });
});

describe("getLatencyThresholds", () => {
  it("returns correct millisecond values for cold-outreach", () => {
    const HOUR = 60 * 60 * 1000;
    const t = getLatencyThresholds("cold-outreach");
    expect(t.elevated).toBe(12 * HOUR);
    expect(t.critical).toBe(24 * HOUR);
    expect(t.lost).toBe(48 * HOUR);
  });

  it("internal has tightest thresholds", () => {
    const internal = getLatencyThresholds("internal");
    const transactional = getLatencyThresholds("transactional");
    expect(internal.elevated).toBeLessThan(transactional.elevated);
    expect(internal.critical).toBeLessThan(transactional.critical);
    expect(internal.lost).toBeLessThan(transactional.lost);
  });
});
