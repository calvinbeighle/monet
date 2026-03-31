# 05 - Claude Code Session Ingestion

## Topic Statement

The system reads Claude Code session history to understand AI-assisted development context, providing task and conversation signals for workstream detection.

## Scope

**In-scope:** Reading Claude Code session files, extracting task context and project associations, normalizing into activity records.

**Boundaries:** Interacting with Claude Code or modifying sessions is out of scope. Workstream assignment is out of scope (see 07-workstream-detection).

## Data Contracts

### Claude Code Session (input)

- Session ID (UUID)
- JSONL file with conversation turns
- Associated project directory (from `~/.claude/projects/` path structure)
- Timestamps per turn

### Normalized Activity Record (output)

- Source: "claude-code"
- Source ID: session ID
- Timestamp: session start time (first turn timestamp)
- Title: first user message (truncated to 100 chars) or project directory name
- Participants: []
- Preview: summary of session scope (first user message)
- Body: null (session content is not fully ingested for privacy/size reasons)
- Labels: [project directory name]
- Metadata: { sessionId, projectPath, turnCount, duration, lastActiveTimestamp }

## Behaviors (execution order)

1. **Session discovery**: Scan `~/.claude/sessions/` for JSONL session files. Each file represents one session.

2. **Project association**: Map sessions to projects using the `~/.claude/projects/` directory structure. Project directory names encode the filesystem path (hyphens replace slashes).

3. **Lightweight parsing**: For each session, read only the first and last few lines to extract: first user message (as title/preview), timestamps (for duration), and turn count. Do not parse full conversation content.

4. **Time window**: Only ingest sessions from the past 14 days. Older sessions are ignored.

5. **Refresh**: Re-scan session directory every 5 minutes to detect new or updated sessions.

## Acceptance Criteria

- Discovers Claude Code sessions from `~/.claude/sessions/`
- Associates sessions with project directories
- Extracts session title from first user message
- Calculates session duration and turn count
- Only ingests sessions from past 14 days
- Refreshes every 5 minutes
