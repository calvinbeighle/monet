import pg from "pg";
import Anthropic from "@anthropic-ai/sdk";

const DB_URL =
  process.env.DATABASE_URL || "postgres://localhost/activity_monitor";

export interface AgentSuggestion {
  instruction: string;
  reason: string;
  score: number;
  source: string;
  category: "code" | "email" | "research" | "automation" | "writing" | "other";
}

export interface SessionHistory {
  instruction: string;
  status: string;
  rawOutput: string;
}

async function queryDb<T = any>(sql: string): Promise<T[]> {
  const pool = new pg.Pool({
    connectionString: DB_URL,
    max: 1,
    connectionTimeoutMillis: 3000,
    query_timeout: 5000,
  });
  try {
    const result = await pool.query(sql);
    return result.rows as T[];
  } catch {
    return [];
  } finally {
    await pool.end().catch(() => {});
  }
}

async function getTraceContext(): Promise<string> {
  const sessions = await queryDb(`
    SELECT project_name, first_user_message, start_time,
           user_turns, tool_use_count, task_summary
    FROM ai_sessions
    WHERE start_time > NOW() - INTERVAL '14 days'
      AND source = 'claude_code'
      AND project_name IS NOT NULL
    ORDER BY start_time DESC
    LIMIT 25
  `);

  if (sessions.length === 0) return "";

  return (
    "TRACE DATA - Claude Code sessions (last 2 weeks):\n" +
    sessions
      .map((s: any) => {
        const msg = (s.first_user_message || "").slice(0, 120);
        const summary = (s.task_summary || "").slice(0, 80);
        return `- ${s.project_name} | ${s.user_turns} turns | ${s.start_time} | "${msg}" ${summary ? `[${summary}]` : ""}`;
      })
      .join("\n")
  );
}

function formatInAppHistory(history: SessionHistory[]): string {
  if (history.length === 0) return "";

  return (
    "IN-APP HISTORY - What the user has done in this session:\n" +
    history
      .map((h, i) => {
        const output = h.rawOutput.slice(0, 200);
        return `${i + 1}. [${h.status}] "${h.instruction}" -> ${output}`;
      })
      .join("\n")
  );
}

export async function getPredictions(
  inAppHistory: SessionHistory[] = [],
): Promise<AgentSuggestion[]> {
  try {
    const [traceContext] = await Promise.all([getTraceContext()]);
    const appContext = formatInAppHistory(inAppHistory);

    // Need at least some context to make predictions
    if (!traceContext && !appContext) return [];

    const contextSections = [traceContext, appContext]
      .filter(Boolean)
      .join("\n\n");

    const client = new Anthropic();

    const response = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: `You are the prediction engine for a super terminal - a TikTok-style feed of Claude Code agents. Each card is a coding agent the user can instruct. You decide what the NEXT card should suggest.

${contextSections}

Based on the combination of:
1. What the user has been doing in THIS session (in-app history) - highest signal
2. Their broader coding patterns from Trace data - background context

Predict what the user most likely wants to do NEXT. Return a JSON array of 3-5 suggestions for the next cards in the stack. Each:
{
  "instruction": "",
  "reason": "1-line context hint shown on the card - be specific and actionable",
  "score": 0-100,
  "category": "code"
}

Leave "instruction" empty - the user types their own. Your "reason" is a smart hint that helps them decide what to work on.

Rules:
- If they have in-app history, heavily weight what they've been doing and suggest logical next steps.
- If they only have trace data, suggest projects they'd likely want to continue.
- Be specific - reference actual project names, tasks, and context.
- Don't suggest things they've already done in this session.
- Think like a great assistant who knows what comes next.

Return ONLY the JSON array.`,
        },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const suggestions: AgentSuggestion[] = JSON.parse(jsonMatch[0]);

    return suggestions
      .filter((s) => s.reason)
      .map((s, i) => ({
        instruction: "",
        reason: s.reason,
        score: Math.max(0, Math.min(100, s.score || 100 - i * 10)),
        source: "llm",
        category: "code",
      }));
  } catch (err) {
    console.error("Prediction engine error:", err);
    return [];
  }
}
