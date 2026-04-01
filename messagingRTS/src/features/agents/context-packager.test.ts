import { describe, it, expect } from "vitest";
import {
  packageThreadContext,
  packageMultipleThreads,
  packageThreadSummaries,
} from "./context-packager";
import { createThread } from "../../lib/types";
import type { Thread } from "../../lib/types";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  const base = createThread("thread-1", "Test Subject", "Hello world");
  return {
    ...base,
    participants: [
      {
        displayName: "Alice",
        email: "alice@example.com",
        organization: "Acme Corp",
        vipFlag: false,
        relationshipScore: 75,
        responseHistory: { avgResponseTimeMs: 3600000, threadFrequency: 5 },
      },
      {
        displayName: "Bob",
        email: "bob@example.com",
        organization: null,
        vipFlag: true,
        relationshipScore: 90,
        responseHistory: { avgResponseTimeMs: 0, threadFrequency: 0 },
      },
    ],
    messages: [
      {
        id: "msg-1",
        sender: "alice@example.com",
        recipients: ["bob@example.com"],
        cc: [],
        bcc: [],
        timestamp: Date.now() - 86400000,
        bodyPlain: "Hi Bob, can we discuss the project?",
        bodyHtml: "",
        labelIds: ["INBOX"],
        attachments: [],
      },
      {
        id: "msg-2",
        sender: "bob@example.com",
        recipients: ["alice@example.com"],
        cc: ["carol@example.com"],
        timestamp: Date.now() - 43200000,
        bodyPlain: "Sure, let me check my schedule.",
        bodyHtml: "",
        labelIds: ["INBOX"],
        attachments: [],
        bcc: [],
      },
    ],
    messageCount: 2,
    ...overrides,
  };
}

describe("context-packager", () => {
  describe("packageThreadContext", () => {
    it("includes thread subject and metadata", () => {
      const thread = makeThread();
      const result = packageThreadContext(thread);

      expect(result.threadId).toBe("thread-1");
      expect(result.fullContext).toContain("Thread: Test Subject");
      expect(result.fullContext).toContain("ID: thread-1");
      expect(result.fullContext).toContain("Messages: 2");
    });

    it("includes lifecycle and risk info", () => {
      const thread = makeThread({ lifecycleState: "at-risk", riskTier: "critical" });
      const result = packageThreadContext(thread);

      expect(result.fullContext).toContain("Status: at-risk");
      expect(result.fullContext).toContain("Risk tier: critical");
    });

    it("includes participant info with VIP flag", () => {
      const thread = makeThread();
      const result = packageThreadContext(thread);

      expect(result.fullContext).toContain("Alice (Acme Corp)");
      expect(result.fullContext).toContain("Bob [VIP]");
      expect(result.fullContext).toContain("Relationship score: 75");
    });

    it("includes conversation messages", () => {
      const thread = makeThread();
      const result = packageThreadContext(thread);

      expect(result.fullContext).toContain("From: alice@example.com");
      expect(result.fullContext).toContain("Hi Bob, can we discuss the project?");
      expect(result.fullContext).toContain("From: bob@example.com");
      expect(result.fullContext).toContain("CC: carol@example.com");
    });

    it("includes neglect duration when present", () => {
      const thread = makeThread({ neglectDuration: 7200000 }); // 2 hours
      const result = packageThreadContext(thread);

      expect(result.fullContext).toContain("Neglect duration: 2.0h");
    });

    it("includes opportunity state when not none", () => {
      const thread = makeThread({ opportunityState: "ripe" });
      const result = packageThreadContext(thread);

      expect(result.fullContext).toContain("Opportunity: ripe");
    });

    it("omits opportunity when state is none", () => {
      const thread = makeThread({ opportunityState: "none" });
      const result = packageThreadContext(thread);

      expect(result.fullContext).not.toContain("Opportunity:");
    });

    it("includes labels", () => {
      const thread = makeThread({ gmailLabels: ["INBOX", "IMPORTANT"] });
      const result = packageThreadContext(thread);

      expect(result.fullContext).toContain("Labels: INBOX, IMPORTANT");
    });

    it("generates a brief summary", () => {
      const thread = makeThread();
      const result = packageThreadContext(thread);

      expect(result.summary).toContain('"Test Subject"');
      expect(result.summary).toContain("Alice");
      expect(result.summary).toContain("2 messages");
    });

    it("falls back to HTML body when plain text is empty", () => {
      const thread = makeThread();
      thread.messages = [
        {
          id: "msg-html",
          sender: "test@example.com",
          recipients: ["user@example.com"],
          cc: [],
          bcc: [],
          timestamp: Date.now(),
          bodyPlain: "",
          bodyHtml: "<p>Hello <b>world</b></p>",
          labelIds: [],
          attachments: [],
        },
      ];
      const result = packageThreadContext(thread);

      expect(result.fullContext).toContain("Hello world");
    });

    it("truncates long message bodies", () => {
      const longBody = "A".repeat(3000);
      const thread = makeThread();
      thread.messages = [
        {
          id: "msg-long",
          sender: "test@example.com",
          recipients: ["user@example.com"],
          cc: [],
          bcc: [],
          timestamp: Date.now(),
          bodyPlain: longBody,
          bodyHtml: "",
          labelIds: [],
          attachments: [],
        },
      ];
      const result = packageThreadContext(thread);

      expect(result.fullContext).toContain("... [truncated]");
      // Should not contain the full 3000 chars
      expect(result.fullContext.length).toBeLessThan(longBody.length);
    });
  });

  describe("packageMultipleThreads", () => {
    it("combines multiple thread contexts with separators", () => {
      const t1 = makeThread({ id: "t1", subject: "First" });
      const t2 = makeThread({ id: "t2", subject: "Second" });
      const result = packageMultipleThreads([t1, t2]);

      expect(result).toContain("Thread 1 of 2");
      expect(result).toContain("Thread 2 of 2");
      expect(result).toContain("Thread: First");
      expect(result).toContain("Thread: Second");
    });

    it("returns message for empty thread list", () => {
      expect(packageMultipleThreads([])).toBe("No threads provided.");
    });
  });

  describe("packageThreadSummaries", () => {
    it("generates numbered summary list", () => {
      const t1 = makeThread({ id: "t1", subject: "First" });
      const t2 = makeThread({ id: "t2", subject: "Second" });
      const result = packageThreadSummaries([t1, t2]);

      expect(result).toContain("1.");
      expect(result).toContain("2.");
      expect(result).toContain('"First"');
      expect(result).toContain('"Second"');
    });

    it("returns message for empty list", () => {
      expect(packageThreadSummaries([])).toBe("No threads provided.");
    });
  });
});
