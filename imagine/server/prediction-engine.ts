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

async function gatherCodingSessions(): Promise<string> {
  const sessions = await queryDb(`
    SELECT project_name, first_user_message, start_time, end_time,
           user_turns, tool_use_count, model, task_summary,
           estimated_cost_usd
    FROM ai_sessions
    WHERE start_time > NOW() - INTERVAL '14 days'
      AND source = 'claude_code'
      AND project_name IS NOT NULL
    ORDER BY start_time DESC
    LIMIT 30
  `);

  if (sessions.length === 0) return "No recent Claude Code sessions found.";

  return (
    "CLAUDE CODE SESSIONS (last 2 weeks):\n" +
    sessions
      .map((s: any) => {
        const msg = (s.first_user_message || "").slice(0, 150);
        const summary = (s.task_summary || "").slice(0, 100);
        const cost = s.estimated_cost_usd
          ? `$${Number(s.estimated_cost_usd).toFixed(2)}`
          : "";
        return `- ${s.project_name} | ${s.user_turns} turns | ${s.start_time} | "${msg}" ${summary ? `| Summary: ${summary}` : ""} ${cost}`;
      })
      .join("\n")
  );
}

export async function getPredictions(): Promise<AgentSuggestion[]> {
  try {
    const context = await gatherCodingSessions();

    if (context.includes("No recent")) return [];

    const client = new Anthropic();

    const response = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: `You are deciding the order of a TikTok-style coding agent feed. The user swipes through cards, each one is a Claude Code agent they can instruct.

Based on their recent Claude Code session history below, decide which PROJECTS the user most likely wants to work on next, and in what order.

${context}

Return a JSON array of 5-10 suggestions, ordered by what the user most likely wants to work on next. Each item:
{
  "instruction": "",
  "reason": "1-line explanation of why this project should be next - reference specific session data",
  "score": 0-100,
  "category": "code"
}

Leave "instruction" empty - the user will type their own. You are only deciding the ORDER and providing context about WHY each project matters.

Think about:
- Which projects have the most momentum (recent sessions, many turns)?
- Which projects were worked on most recently?
- Which ones look like they have unfinished work?
- Deduplicate - group sessions by project, don't repeat the same project.

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
