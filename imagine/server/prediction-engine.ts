import pg from "pg";

const TRACE_API_URL = process.env.TRACE_API_URL || "http://localhost:3001";
const DB_CONFIG = {
  host: process.env.TRACE_DB_HOST || "localhost",
  port: parseInt(process.env.TRACE_DB_PORT || "5432"),
  database: process.env.TRACE_DB_NAME || "activity_monitor",
  user: process.env.TRACE_DB_USER || process.env.USER || "postgres",
};

const QUERY_TIMEOUT_MS = 3000;

export interface AgentSuggestion {
  instruction: string;
  reason: string;
  score: number;
  source: string;
  category: "code" | "email" | "research" | "automation" | "writing" | "other";
}

// --- Helpers ---

async function fetchWithTimeout(url: string): Promise<any | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function queryDb<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const pool = new pg.Pool({
    ...DB_CONFIG,
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

// --- Scoring utilities ---

function recencyScore(
  timestamp: Date | string,
  maxMinutes: number = 30,
): number {
  const ageMs = Date.now() - new Date(timestamp).getTime();
  const ageMinutes = ageMs / 60000;
  if (ageMinutes < 0) return 0;
  // Exponential decay: full score at 0 min, ~37% at maxMinutes, near 0 at 2*maxMinutes
  const score = Math.exp(-ageMinutes / maxMinutes) * 40;
  return Math.max(0, Math.min(40, score));
}

function categorizeApp(appName: string): AgentSuggestion["category"] {
  const lower = appName.toLowerCase();
  if (
    lower.includes("mail") ||
    lower.includes("gmail") ||
    lower.includes("outlook")
  )
    return "email";
  if (
    lower.includes("code") ||
    lower.includes("terminal") ||
    lower.includes("iterm") ||
    lower.includes("warp")
  )
    return "code";
  if (
    lower.includes("chrome") ||
    lower.includes("arc") ||
    lower.includes("safari") ||
    lower.includes("firefox")
  )
    return "research";
  if (
    lower.includes("notion") ||
    lower.includes("docs") ||
    lower.includes("pages") ||
    lower.includes("word")
  )
    return "writing";
  return "other";
}

// --- Data source queries ---

async function getRecentActivity(): Promise<AgentSuggestion[]> {
  const rows = await queryDb<{
    app_name: string;
    window_title: string;
    timestamp: string;
    duration_secs: number;
  }>(
    `SELECT app_name, window_title, timestamp, duration_secs
     FROM app_activity
     WHERE timestamp > NOW() - INTERVAL '30 minutes'
     ORDER BY timestamp DESC
     LIMIT 20`,
  );

  if (rows.length === 0) return [];

  // Group by app to find dominant current context
  const appTime = new Map<
    string,
    { total: number; titles: string[]; latest: string }
  >();
  for (const row of rows) {
    const existing = appTime.get(row.app_name);
    if (existing) {
      existing.total += row.duration_secs;
      if (!existing.titles.includes(row.window_title)) {
        existing.titles.push(row.window_title);
      }
    } else {
      appTime.set(row.app_name, {
        total: row.duration_secs,
        titles: [row.window_title],
        latest: row.timestamp,
      });
    }
  }

  const suggestions: AgentSuggestion[] = [];

  for (const [app, data] of appTime) {
    const category = categorizeApp(app);
    const recency = recencyScore(data.latest);
    const frequencyBonus = Math.min(20, (data.total / 60) * 2); // 2 points per minute, max 20

    if (category === "email") {
      suggestions.push({
        instruction: `Check my recent emails and draft replies to any that need a response. Context: I was just using ${app}.`,
        reason: `You were active in ${app} for ${Math.round(data.total / 60)} minutes`,
        score: recency + frequencyBonus + 15,
        source: "app_activity",
        category: "email",
      });
    } else if (category === "code") {
      const projectHint = data.titles[0] || "";
      suggestions.push({
        instruction: `Continue working on the code I had open. Window context: ${projectHint}`,
        reason: `You were coding in ${app} - "${projectHint}"`,
        score: recency + frequencyBonus + 10,
        source: "app_activity",
        category: "code",
      });
    } else if (category === "research") {
      const topTitle = data.titles[0] || "";
      suggestions.push({
        instruction: `Research and summarize what I was looking at: "${topTitle}". Find related resources and create a brief.`,
        reason: `You were browsing: "${topTitle}"`,
        score: recency + frequencyBonus + 5,
        source: "app_activity",
        category: "research",
      });
    } else if (category === "writing") {
      suggestions.push({
        instruction: `Help me continue writing. I was working in ${app} on: "${data.titles[0] || "a document"}"`,
        reason: `You were writing in ${app}`,
        score: recency + frequencyBonus + 8,
        source: "app_activity",
        category: "writing",
      });
    }
  }

  return suggestions;
}

async function getRecentSessions(): Promise<AgentSuggestion[]> {
  const rows = await queryDb<{
    project_name: string;
    first_user_message: string;
    start_time: string;
    end_time: string | null;
    user_turns: number;
    tool_use_count: number;
  }>(
    `SELECT project_name, first_user_message, start_time, end_time, user_turns, tool_use_count
     FROM ai_sessions
     WHERE start_time > NOW() - INTERVAL '24 hours'
       AND source = 'claude_code'
     ORDER BY start_time DESC
     LIMIT 10`,
  );

  return rows
    .filter((r) => r.project_name)
    .map((row) => {
      const recency = recencyScore(row.start_time, 120); // 2-hour window for sessions
      const effortBonus = Math.min(15, (row.user_turns || 0) * 1.5);
      const prompt = row.first_user_message || "";
      const shortPrompt =
        prompt.length > 100 ? prompt.slice(0, 100) + "..." : prompt;

      return {
        instruction: `Continue working on the "${row.project_name}" project. Last task: ${shortPrompt || "general development"}`,
        reason: `Active Claude Code session on "${row.project_name}" (${row.user_turns} turns)`,
        score: recency + effortBonus + 10,
        source: "ai_sessions",
        category: "code" as const,
      };
    });
}

async function getHighPriorityAutomations(): Promise<AgentSuggestion[]> {
  // Try database first, then API
  let automations = await queryDb<{
    id: number;
    task_title: string;
    task_description: string;
    priority_score: number;
    task_type: string;
  }>(
    `SELECT id, task_title, task_description, priority_score, task_type
     FROM ai_automations
     WHERE priority_score >= 5 AND status != 'dismissed'
     ORDER BY priority_score DESC
     LIMIT 5`,
  );

  if (automations.length === 0) {
    const apiData = await fetchWithTimeout(`${TRACE_API_URL}/api/automations`);
    if (apiData && Array.isArray(apiData)) {
      automations = apiData
        .filter((a: any) => (a.priority_score || 0) >= 5)
        .slice(0, 5);
    }
  }

  return automations.map((a) => {
    const priorityScore = ((a.priority_score || 5) / 10) * 30;

    let category: AgentSuggestion["category"] = "automation";
    const catLower = (a.task_type || "").toLowerCase();
    if (catLower.includes("email")) category = "email";
    else if (catLower.includes("code")) category = "code";
    else if (catLower.includes("research")) category = "research";
    else if (catLower.includes("writing")) category = "writing";

    return {
      instruction: `${a.task_title}: ${a.task_description || "Implement this automation."}`,
      reason: `High-priority automation (score: ${a.priority_score}/10)`,
      score: priorityScore + 20,
      source: "ai_automations",
      category,
    };
  });
}

async function getBrowserContext(): Promise<AgentSuggestion[]> {
  const rows = await queryDb<{
    url: string;
    title: string;
    timestamp: string;
  }>(
    `SELECT url, title, timestamp
     FROM browser_history
     WHERE timestamp > NOW() - INTERVAL '1 hour'
     ORDER BY timestamp DESC
     LIMIT 15`,
  );

  if (rows.length === 0) return [];

  // Group by domain to find research themes
  const domains = new Map<
    string,
    { titles: string[]; count: number; latest: string }
  >();
  for (const row of rows) {
    let domain: string;
    try {
      domain = new URL(row.url).hostname.replace("www.", "");
    } catch {
      continue;
    }

    // Skip noise domains
    if (
      ["google.com", "localhost", "127.0.0.1", "new-tab"].some((d) =>
        domain.includes(d),
      )
    )
      continue;

    const existing = domains.get(domain);
    if (existing) {
      existing.count++;
      if (!existing.titles.includes(row.title)) existing.titles.push(row.title);
    } else {
      domains.set(domain, {
        titles: [row.title],
        count: 1,
        latest: row.timestamp,
      });
    }
  }

  const suggestions: AgentSuggestion[] = [];

  for (const [domain, data] of domains) {
    if (data.count < 2) continue; // Only suggest for repeated visits
    const recency = recencyScore(data.latest, 60);
    const frequencyBonus = Math.min(15, data.count * 5);
    const topicHint = data.titles.slice(0, 3).join(", ");

    suggestions.push({
      instruction: `Research and summarize what I was reading about on ${domain}: ${topicHint}. Compile key findings.`,
      reason: `You visited ${domain} ${data.count} times recently: "${data.titles[0]}"`,
      score: recency + frequencyBonus,
      source: "browser_history",
      category: "research",
    });
  }

  return suggestions;
}

async function getDetectedPatterns(): Promise<AgentSuggestion[]> {
  // Try database first, then API
  let patterns = await queryDb<{
    id: number;
    title: string;
    description: string;
    confidence: number;
    category: string;
  }>(
    `SELECT id, title, description, confidence, category
     FROM patterns
     WHERE confidence >= 0.6 AND status != 'dismissed'
     ORDER BY confidence DESC
     LIMIT 5`,
  );

  if (patterns.length === 0) {
    const apiData = await fetchWithTimeout(
      `${TRACE_API_URL}/api/dashboard/patterns`,
    );
    if (apiData && Array.isArray(apiData)) {
      patterns = apiData
        .filter((p: any) => (p.confidence || 0) >= 0.6)
        .slice(0, 5);
    }
  }

  return patterns.map((p) => ({
    instruction: `Automate this detected pattern: ${p.title} - ${p.description || ""}`,
    reason: `Detected pattern with ${Math.round((p.confidence || 0) * 100)}% confidence`,
    score: (p.confidence || 0.6) * 25 + 10,
    source: "patterns",
    category: "automation" as const,
  }));
}

async function getCalendarSuggestions(): Promise<AgentSuggestion[]> {
  // Check if calendar-related apps were recently active
  const rows = await queryDb<{
    app_name: string;
    window_title: string;
    timestamp: string;
  }>(
    `SELECT app_name, window_title, timestamp
     FROM app_activity
     WHERE timestamp > NOW() - INTERVAL '30 minutes'
       AND (LOWER(app_name) LIKE '%calendar%' OR LOWER(window_title) LIKE '%calendar%'
            OR LOWER(window_title) LIKE '%meeting%' OR LOWER(window_title) LIKE '%zoom%'
            OR LOWER(window_title) LIKE '%google meet%')
     ORDER BY timestamp DESC
     LIMIT 5`,
  );

  if (rows.length === 0) return [];

  return [
    {
      instruction:
        "Check my upcoming meetings and prepare briefing notes for each one. Include attendee backgrounds and agenda items.",
      reason: `You were looking at calendar/meeting content: "${rows[0].window_title}"`,
      score: recencyScore(rows[0].timestamp) + 25,
      source: "app_activity",
      category: "other",
    },
  ];
}

// --- Main prediction function ---

export async function getPredictions(): Promise<AgentSuggestion[]> {
  try {
    // Run all data source queries in parallel with individual error handling
    const [
      activitySuggestions,
      sessionSuggestions,
      automationSuggestions,
      browserSuggestions,
      patternSuggestions,
      calendarSuggestions,
    ] = await Promise.all([
      getRecentActivity().catch(() => [] as AgentSuggestion[]),
      getRecentSessions().catch(() => [] as AgentSuggestion[]),
      getHighPriorityAutomations().catch(() => [] as AgentSuggestion[]),
      getBrowserContext().catch(() => [] as AgentSuggestion[]),
      getDetectedPatterns().catch(() => [] as AgentSuggestion[]),
      getCalendarSuggestions().catch(() => [] as AgentSuggestion[]),
    ]);

    const all = [
      ...activitySuggestions,
      ...sessionSuggestions,
      ...automationSuggestions,
      ...browserSuggestions,
      ...patternSuggestions,
      ...calendarSuggestions,
    ];

    // Deduplicate by category - keep highest scored per category, then fill with rest
    const byCategory = new Map<string, AgentSuggestion[]>();
    for (const s of all) {
      const existing = byCategory.get(s.category) || [];
      existing.push(s);
      byCategory.set(s.category, existing);
    }

    // Sort within each category, then interleave to get diversity
    const sorted: AgentSuggestion[] = [];
    for (const [, items] of byCategory) {
      items.sort((a, b) => b.score - a.score);
    }

    // Round-robin pick top item from each category, then repeat
    let added = true;
    let round = 0;
    while (added) {
      added = false;
      for (const [, items] of byCategory) {
        if (round < items.length) {
          sorted.push(items[round]);
          added = true;
        }
      }
      round++;
    }

    // Final sort by score, clamp scores to 0-100
    return sorted
      .map((s) => ({
        ...s,
        score: Math.max(0, Math.min(100, Math.round(s.score))),
      }))
      .sort((a, b) => b.score - a.score);
  } catch {
    return [];
  }
}
