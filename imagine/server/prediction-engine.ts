import pg from "pg";
import Anthropic from "@anthropic-ai/sdk";

const DB_URL =
  process.env.DATABASE_URL || "postgres://localhost/activity_monitor";
const QUERY_TIMEOUT_MS = 3000;

export interface AgentSuggestion {
  instruction: string;
  reason: string;
  score: number;
  source: string;
  category: "code" | "email" | "research" | "automation" | "writing" | "other";
}

async function queryDb<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const pool = new pg.Pool({
    connectionString: DB_URL,
    max: 1,
    connectionTimeoutMillis: QUERY_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
  });
  try {
    const result = await pool.query(sql, params);
    return result.rows as T[];
  } catch {
    return [];
  } finally {
    await pool.end().catch(() => {});
  }
}

// Gather raw context from all data sources in parallel
async function gatherContext(): Promise<string> {
  const [appActivity, sessions, automations, browser, patterns] =
    await Promise.all([
      queryDb(`
      SELECT app_name, window_title, duration_secs, timestamp
      FROM app_activity
      WHERE timestamp > NOW() - INTERVAL '60 minutes'
      ORDER BY timestamp DESC LIMIT 15
    `).catch(() => []),

      queryDb(`
      SELECT project_name, first_user_message, start_time, user_turns, tool_use_count, model
      FROM ai_sessions
      WHERE start_time > NOW() - INTERVAL '24 hours' AND source = 'claude_code'
      ORDER BY start_time DESC LIMIT 10
    `).catch(() => []),

      queryDb(`
      SELECT task_title, task_description, priority_score, task_type, claude_code_prompt
      FROM ai_automations
      WHERE status != 'dismissed' AND priority_score >= 4
      ORDER BY priority_score DESC LIMIT 8
    `).catch(() => []),

      queryDb(`
      SELECT url, title, timestamp
      FROM browser_history
      WHERE timestamp > NOW() - INTERVAL '2 hours'
      ORDER BY timestamp DESC LIMIT 10
    `).catch(() => []),

      queryDb(`
      SELECT title, description, confidence, category, frequency
      FROM patterns
      WHERE status != 'dismissed' AND confidence >= 0.6
      ORDER BY confidence DESC LIMIT 5
    `).catch(() => []),
    ]);

  const sections: string[] = [];

  if (appActivity.length > 0) {
    sections.push(
      "RECENT APP ACTIVITY (last 60 min):\n" +
        appActivity
          .map(
            (a: any) =>
              `- ${a.app_name}: "${a.window_title}" (${a.duration_secs}s)`,
          )
          .join("\n"),
    );
  }

  if (sessions.length > 0) {
    sections.push(
      "CLAUDE CODE SESSIONS (last 24h):\n" +
        sessions
          .map(
            (s: any) =>
              `- Project: ${s.project_name}, Turns: ${s.user_turns}, First prompt: "${(s.first_user_message || "").slice(0, 120)}"`,
          )
          .join("\n"),
    );
  }

  if (automations.length > 0) {
    sections.push(
      "DETECTED AUTOMATION OPPORTUNITIES:\n" +
        automations
          .map(
            (a: any) =>
              `- [Priority ${a.priority_score}/10] ${a.task_title}: ${(a.task_description || "").slice(0, 120)}`,
          )
          .join("\n"),
    );
  }

  if (browser.length > 0) {
    sections.push(
      "RECENT BROWSER HISTORY:\n" +
        browser.map((b: any) => `- ${b.title} (${b.url})`).join("\n"),
    );
  }

  if (patterns.length > 0) {
    sections.push(
      "DETECTED BEHAVIORAL PATTERNS:\n" +
        patterns
          .map(
            (p: any) =>
              `- [${Math.round(p.confidence * 100)}% confidence] ${p.title}: ${(p.description || "").slice(0, 120)}`,
          )
          .join("\n"),
    );
  }

  if (sections.length === 0) {
    return "No activity data available.";
  }

  return sections.join("\n\n");
}

export async function getPredictions(): Promise<AgentSuggestion[]> {
  try {
    const context = await gatherContext();

    if (context === "No activity data available.") {
      return [];
    }

    const client = new Anthropic();

    const response = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: `You are a prediction engine for a TikTok-style agent feed. Based on the user's real activity data below, determine the most important tasks they should tackle next. Each task will become an AI agent card that the user swipes through.

Think about:
- What is the user currently focused on? (recent app activity)
- What projects need continuation? (Claude Code sessions)
- What high-value automations could save them time? (detected automations)
- What research are they doing? (browser history)
- What patterns could become automated workflows? (detected patterns)

${context}

Return a JSON array of 5-10 agent suggestions, ordered by what the user most likely wants to do next. Each item:
{
  "instruction": "The exact instruction to give a Claude Code agent to do this task",
  "reason": "Short 1-line explanation shown to user for why this is suggested (be specific, reference their actual data)",
  "score": 0-100,
  "category": "code" | "email" | "research" | "automation" | "writing" | "other"
}

IMPORTANT:
- Be specific. Reference actual project names, URLs, window titles from their data.
- The instruction should be actionable - something Claude Code can actually execute.
- Score based on urgency and relevance to what they're doing RIGHT NOW.
- The first item should be what they most likely want to do next.

Return ONLY the JSON array, no other text.`,
        },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    // Parse JSON from response - handle markdown code blocks
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const suggestions: AgentSuggestion[] = JSON.parse(jsonMatch[0]);

    // Validate and normalize
    return suggestions
      .filter((s) => s.instruction && s.reason)
      .map((s, i) => ({
        instruction: s.instruction,
        reason: s.reason,
        score: Math.max(0, Math.min(100, s.score || 100 - i * 10)),
        source: "llm",
        category: s.category || "other",
      }));
  } catch (err) {
    console.error("Prediction engine error:", err);
    return [];
  }
}
