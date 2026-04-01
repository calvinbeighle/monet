import { describe, it, expect } from "vitest";
import { getPromptConfig, buildUserMessage } from "./prompt-templates";
import type { AgentRole } from "../../lib/types";

const ALL_ROLES: AgentRole[] = [
  "closer",
  "researcher",
  "scheduler",
  "cleaner",
  "drafter",
  "escalation-bot",
];

describe("prompt-templates", () => {
  describe("getPromptConfig", () => {
    it("returns config for all 6 agent roles", () => {
      for (const role of ALL_ROLES) {
        const config = getPromptConfig(role);
        expect(config.system).toBeTruthy();
        expect(config.tools.length).toBeGreaterThan(0);
        expect(config.userPromptPrefix).toBeTruthy();
      }
    });

    it("closer config has submit_proposal tool", () => {
      const config = getPromptConfig("closer");
      expect(config.tools[0].name).toBe("submit_proposal");
      const schema = config.tools[0].input_schema as { properties: Record<string, unknown> };
      expect(schema.properties).toHaveProperty("thread_id");
      expect(schema.properties).toHaveProperty("output_type");
      expect(schema.properties).toHaveProperty("content");
    });

    it("cleaner config has submit_batch_proposal tool for bulk actions", () => {
      const config = getPromptConfig("cleaner");
      expect(config.tools[0].name).toBe("submit_batch_proposal");
      const schema = config.tools[0].input_schema as { properties: Record<string, unknown> };
      expect(schema.properties).toHaveProperty("thread_ids");
      expect(schema.properties).toHaveProperty("batch_label");
    });

    it("drafter config supports tone variants", () => {
      const config = getPromptConfig("drafter");
      const schema = config.tools[0].input_schema as { properties: Record<string, unknown> };
      expect(schema.properties).toHaveProperty("tone_label");
    });

    it("escalation-bot config supports urgency levels", () => {
      const config = getPromptConfig("escalation-bot");
      const schema = config.tools[0].input_schema as { properties: Record<string, unknown> };
      expect(schema.properties).toHaveProperty("urgency_level");
    });

    it("system prompts contain role-specific instructions", () => {
      expect(getPromptConfig("closer").system).toContain("Closer");
      expect(getPromptConfig("researcher").system).toContain("Researcher");
      expect(getPromptConfig("scheduler").system).toContain("Scheduler");
      expect(getPromptConfig("cleaner").system).toContain("Cleaner");
      expect(getPromptConfig("drafter").system).toContain("Drafter");
      expect(getPromptConfig("escalation-bot").system).toContain("Escalation Bot");
    });

    it("closer output types include reply-draft and follow-up-draft", () => {
      const config = getPromptConfig("closer");
      const schema = config.tools[0].input_schema as {
        properties: { output_type: { enum: string[] } };
      };
      expect(schema.properties.output_type.enum).toContain("reply-draft");
      expect(schema.properties.output_type.enum).toContain("follow-up-draft");
    });
  });

  describe("buildUserMessage", () => {
    it("prepends role-specific prefix to thread context", () => {
      const context = "Thread: Test\nMessages: 3";
      const message = buildUserMessage("closer", context);

      expect(message).toContain("Analyze the following email thread");
      expect(message).toContain(context);
    });

    it("uses different prefixes for different roles", () => {
      const context = "Thread data";
      const closerMsg = buildUserMessage("closer", context);
      const cleanerMsg = buildUserMessage("cleaner", context);

      expect(closerMsg).not.toBe(cleanerMsg);
    });
  });
});
