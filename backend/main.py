"""
main.py - Monet backend entry point.

Manages headless Claude Code processes via stream-json pipes. Each agent is a real
`claude` process running on the user's machine, communicating via structured JSON
over stdin/stdout rather than a PTY.

Features:
- Rich event parsing: extracts currentStep, currentDetail, progress from Claude events
- Decision queue: detects permission_request events and queues them for user action
- Notification system: broadcasts agent lifecycle events (completion, error, decisions)
- SQLite persistence: agents survive server restarts

Endpoints:
- GET  /agents                        - list all agents
- POST /agents                        - create agent + spawn claude process
- DELETE /agents/{id}                 - kill process + remove agent
- POST /agents/{id}/start             - start or restart claude process
- POST /agents/{id}/stop              - stop claude process
- POST /agents/{id}/input             - send a user message to the claude process
- GET  /agents/{id}/output            - get buffered events (last 1000)
- WS   /agents/{id}/terminal          - live JSON event streaming WebSocket
- GET  /decisions                     - list all pending decisions
- POST /decisions/{id}/resolve        - resolve a decision (approve/reject/skip)
- GET  /notifications                 - get recent notifications (toast events)
- POST /config/workspace              - set default workspace directory
- GET  /config/workspace              - get current default workspace
"""
from __future__ import annotations

import asyncio
import json
import os
import signal
import sqlite3
import time
import logging
import uuid
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# --- SQLite Persistence ---

DB_PATH = os.path.join(os.path.dirname(__file__), "monet.db")

def _init_db():
    """Initialize the SQLite database with required tables."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS agents (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT '#8b5cf6',
            workspace TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS decisions (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            data TEXT NOT NULL DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'pending',
            created_at REAL NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            agent_name TEXT NOT NULL DEFAULT '',
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT '',
            created_at REAL NOT NULL,
            read INTEGER NOT NULL DEFAULT 0
        )
    """)
    conn.commit()
    conn.close()

def _save_agent(agent_id: str, name: str, color: str, workspace: str):
    """Persist an agent to SQLite."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO agents (id, name, color, workspace) VALUES (?, ?, ?, ?)",
        (agent_id, name, color, workspace)
    )
    conn.commit()
    conn.close()

def _delete_agent_db(agent_id: str):
    """Remove an agent from SQLite."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM agents WHERE id = ?", (agent_id,))
    conn.execute("DELETE FROM decisions WHERE agent_id = ?", (agent_id,))
    conn.commit()
    conn.close()

def _load_agents() -> list[dict]:
    """Load all agents from SQLite."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM agents").fetchall()
    conn.close()
    return [dict(r) for r in rows]

def _save_decision(decision: dict):
    """Persist a decision to SQLite."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO decisions (id, agent_id, title, summary, data, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (decision["id"], decision["agent_id"], decision["title"], decision["summary"],
         json.dumps(decision.get("data", {})), decision["status"], decision["created_at"])
    )
    conn.commit()
    conn.close()

def _load_pending_decisions() -> list[dict]:
    """Load all pending decisions from SQLite."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM decisions WHERE status = 'pending' ORDER BY created_at DESC").fetchall()
    conn.close()
    results = []
    for r in rows:
        d = dict(r)
        d["data"] = json.loads(d["data"]) if d["data"] else {}
        results.append(d)
    return results

def _resolve_decision_db(decision_id: str, resolution: str):
    """Update a decision status in SQLite."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE decisions SET status = ? WHERE id = ?", (resolution, decision_id))
    conn.commit()
    conn.close()

def _save_notification(notif: dict):
    """Persist a notification."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT INTO notifications (id, agent_id, agent_name, type, title, detail, created_at, read) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
        (notif["id"], notif["agent_id"], notif["agent_name"], notif["type"], notif["title"], notif.get("detail", ""), notif["created_at"])
    )
    conn.commit()
    conn.close()

def _load_recent_notifications(limit: int = 50) -> list[dict]:
    """Load recent notifications."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def _mark_notifications_read():
    """Mark all notifications as read."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE notifications SET read = 1 WHERE read = 0")
    conn.commit()
    conn.close()


# --- Tool name to readable label mapping ---

TOOL_LABELS = {
    "Read": "Reading file",
    "Write": "Writing file",
    "Edit": "Editing file",
    "MultiEdit": "Editing files",
    "Bash": "Running command",
    "TodoRead": "Checking tasks",
    "TodoWrite": "Updating tasks",
    "WebSearch": "Searching web",
    "WebFetch": "Fetching URL",
    "Glob": "Finding files",
    "Grep": "Searching code",
    "LS": "Listing directory",
    "Task": "Running subtask",
}


def _extract_tool_detail(tool_name: str, tool_input: dict | None) -> str:
    """Extract a human-readable detail string from a tool call."""
    if not tool_input:
        return ""
    if tool_name in ("Read", "Write", "Edit"):
        path = tool_input.get("file_path", tool_input.get("path", ""))
        if path:
            # Show just the filename
            return path.split("/")[-1]
    if tool_name == "Bash":
        cmd = tool_input.get("command", "")
        if cmd:
            return cmd[:60] + ("..." if len(cmd) > 60 else "")
    if tool_name in ("Grep", "Glob"):
        pattern = tool_input.get("pattern", tool_input.get("glob", ""))
        if pattern:
            return pattern[:40]
    return ""


# --- Agent Process Manager ---

class AgentProcess:
    """
    A headless Claude Code agent using one-shot `claude -p` invocations.

    Each user message spawns a new `claude -p` process. Conversation continuity
    is maintained via `--session-id` (first message creates a session on disk)
    and `--resume <session-id>` (subsequent messages continue that session).

    The agent transitions between three states:
      idle    -> user sends a message -> running
      running -> claude process exits  -> idle
      running -> claude process errors -> error
      error   -> user sends a message  -> running  (resets error)

    Rich status tracking extracts tool names, file paths, and progress from
    the claude stream-json output so the frontend can display what the agent
    is doing in real time.

    After each run, a lightweight LLM call (haiku) summarizes the activity into
    structured insights: task classification, files changed, thinking process,
    and a human-readable summary.
    """

    def __init__(self, agent_id: str, name: str, color: str, workspace: str):
        self.agent_id = agent_id
        self.name = name
        self.color = color
        self.workspace = workspace
        self.process: asyncio.subprocess.Process | None = None
        self.status = "idle"  # idle, running, error
        self.events: list[dict] = []  # all JSON events from this session, capped at 1000
        self.subscribers: list[asyncio.Queue] = []  # active WebSocket queues
        self._reader_task: asyncio.Task | None = None
        self._run_lock = asyncio.Lock()  # prevent concurrent sends

        # Session tracking - maintained across messages for conversation continuity
        self.session_id: str | None = None  # set from first claude response

        # Rich status tracking
        self.current_step: str | None = None
        self.current_detail: str | None = None
        self.tool_call_count: int = 0
        self.total_tool_calls: int = 0  # cumulative across all messages
        self.decision_count: int = 0
        self.started_at: float | None = None
        self.last_user_message: str | None = None
        self.last_completed_at: float | None = None
        self.last_error: str | None = None

        # Activity tracking for insights - accumulates during a run
        self._activity_log: list[dict] = []  # structured log of what happened
        self._files_touched: dict[str, str] = {}  # filepath -> action (read/write/edit)
        self._commands_run: list[str] = []  # bash commands executed
        self._thinking_blocks: list[str] = []  # assistant text blocks (thinking/reasoning)

        # Insights - produced by post-run summarization
        self.insights: dict | None = None  # latest structured insight
        self.insight_history: list[dict] = []  # all insights from this session

    def _process_event(self, event: dict):
        """
        Extract rich status information from a claude stream-json event.

        Updates currentStep, currentDetail, toolCallCount, and decisionCount
        based on the event type and content.
        Also builds the activity log for post-run summarization.
        """
        etype = event.get("type", "")

        # Capture session_id from system init or result events
        sid = event.get("session_id")
        if sid and not self.session_id:
            self.session_id = sid
            logger.info("Agent '%s' session_id: %s", self.name, sid)

        if etype == "assistant":
            message = event.get("message", {})
            content = message.get("content", [])
            for block in content:
                if block.get("type") == "tool_use":
                    tool_name = block.get("name", "Tool")
                    tool_input = block.get("input", {})
                    self.tool_call_count += 1
                    self.total_tool_calls += 1
                    self.current_step = TOOL_LABELS.get(tool_name, f"Using {tool_name}")
                    self.current_detail = _extract_tool_detail(tool_name, tool_input)

                    # Track for insights
                    activity_entry = {"tool": tool_name, "detail": self.current_detail or ""}
                    if tool_name in ("Read", "Write", "Edit", "MultiEdit"):
                        path = tool_input.get("file_path", tool_input.get("path", ""))
                        if path:
                            action = "read" if tool_name == "Read" else "write" if tool_name == "Write" else "edit"
                            self._files_touched[path] = action
                            activity_entry["file"] = path
                            activity_entry["action"] = action
                    elif tool_name == "Bash":
                        cmd = tool_input.get("command", "")
                        if cmd:
                            self._commands_run.append(cmd[:200])
                            activity_entry["command"] = cmd[:200]
                    elif tool_name in ("Grep", "Glob"):
                        pattern = tool_input.get("pattern", tool_input.get("glob", ""))
                        activity_entry["pattern"] = pattern[:100] if pattern else ""

                    self._activity_log.append(activity_entry)

                elif block.get("type") == "text":
                    text_content = block.get("text", "")
                    # Claude is producing text - update step to show it's responding
                    if self.current_step == "Thinking...":
                        self.current_step = "Responding..."
                        self.current_detail = None
                    # Track thinking for insights (cap to avoid huge payloads)
                    if text_content.strip():
                        self._thinking_blocks.append(text_content[:500])

        elif etype == "result":
            # Run completed - clear step info (status will be set to idle by send_message)
            self.current_step = None
            self.current_detail = None

    async def send_message(self, text: str):
        """
        Send a message by spawning a new claude -p process.

        Uses --session-id on first message to create a named session, then
        --resume on subsequent messages to continue the conversation.
        """
        # Serialize sends so we don't spawn overlapping processes
        async with self._run_lock:
            await self._run_message(text)

    def _build_activity_digest(self) -> str:
        """Build a compact text digest of recent activity for the summarizer."""
        parts = []
        parts.append(f"User message: {self.last_user_message or '(none)'}")
        parts.append(f"Tool calls: {self.tool_call_count}")
        parts.append(f"Duration: {int(time.time() - self.started_at) if self.started_at else 0}s")

        if self._files_touched:
            files_by_action: dict[str, list[str]] = {}
            for fp, action in self._files_touched.items():
                files_by_action.setdefault(action, []).append(fp.split("/")[-1])
            for action, files in files_by_action.items():
                parts.append(f"Files {action}: {', '.join(files[:10])}")

        if self._commands_run:
            parts.append(f"Commands: {'; '.join(self._commands_run[:5])}")

        # Include first and last thinking blocks for context
        if self._thinking_blocks:
            first = self._thinking_blocks[0][:300]
            parts.append(f"Initial thinking: {first}")
            if len(self._thinking_blocks) > 1:
                last = self._thinking_blocks[-1][:300]
                parts.append(f"Final response: {last}")

        # Include last few activity entries
        recent = self._activity_log[-8:]
        if recent:
            steps = []
            for a in recent:
                tool = a.get("tool", "?")
                detail = a.get("detail", "")
                if a.get("file"):
                    steps.append(f"{tool}({a['file'].split('/')[-1]})")
                elif a.get("command"):
                    steps.append(f"Bash({a['command'][:40]})")
                elif detail:
                    steps.append(f"{tool}({detail})")
                else:
                    steps.append(tool)
            parts.append(f"Steps: {' -> '.join(steps)}")

        return "\n".join(parts)

    async def _generate_insights(self):
        """
        Call a lightweight model (haiku) to generate structured insights
        about the agent's recent activity. Runs in the background after
        each message completes.
        """
        if not self._activity_log and not self._thinking_blocks:
            return

        digest = self._build_activity_digest()
        prompt = f"""Analyze this AI agent's activity and produce a JSON object with these fields:
- "taskLabel": A 2-4 word label classifying what the agent is doing (e.g. "Refactoring Auth Logic", "Writing Unit Tests", "Debugging API Error", "Setting Up Config")
- "summary": One sentence summarizing what the agent accomplished in this run
- "thinkingProcess": 2-3 bullet points describing the agent's reasoning/approach (each bullet max 15 words)
- "filesChanged": Array of objects with "file" (just filename), "action" (read/write/edit), "why" (5-8 word reason)
- "status": One of "completed", "in_progress", "investigating", "refactoring", "debugging", "testing"
- "complexity": One of "trivial", "simple", "moderate", "complex"

Activity log:
{digest}

Respond with ONLY valid JSON, no markdown fences."""

        try:
            proc = await asyncio.create_subprocess_exec(
                "claude", "-p",
                "--model", "haiku",
                "--output-format", "text",
                "--dangerously-skip-permissions",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self.workspace,
            )
            proc.stdin.write(prompt.encode())
            proc.stdin.close()

            stdout_bytes = await asyncio.wait_for(proc.stdout.read(), timeout=15.0)
            await proc.wait()

            raw = stdout_bytes.decode("utf-8", errors="replace").strip()
            # Strip markdown fences if present
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[-1]
            if raw.endswith("```"):
                raw = raw.rsplit("```", 1)[0]
            raw = raw.strip()

            insight = json.loads(raw)
            insight["generatedAt"] = time.time()
            insight["toolCallCount"] = self.tool_call_count
            insight["elapsedSeconds"] = int(time.time() - self.started_at) if self.started_at else 0
            insight["userMessage"] = (self.last_user_message or "")[:100]

            self.insights = insight
            self.insight_history.append(insight)
            if len(self.insight_history) > 20:
                self.insight_history = self.insight_history[-20:]

            logger.info("Generated insight for '%s': taskLabel=%s, status=%s",
                       self.name, insight.get("taskLabel"), insight.get("status"))

            # Broadcast insight to subscribers
            insight_event = {"type": "monet_insight", "insight": insight}
            for queue in self.subscribers:
                try:
                    queue.put_nowait(insight_event)
                except asyncio.QueueFull:
                    pass

        except asyncio.TimeoutError:
            logger.warning("Insight generation timed out for '%s'", self.name)
        except json.JSONDecodeError as e:
            logger.warning("Failed to parse insight JSON for '%s': %s (raw: %s)",
                          self.name, e, raw[:200] if raw else "empty")
        except Exception as e:
            logger.warning("Insight generation failed for '%s': %s", self.name, e)

    async def _run_message(self, text: str):
        """Internal: actually spawn and manage the claude process."""
        self.status = "running"
        self.started_at = time.time()
        self.tool_call_count = 0
        self.current_step = "Thinking..."
        self.current_detail = None
        self.last_error = None

        # Clear activity tracking for this run
        self._activity_log = []
        self._files_touched = {}
        self._commands_run = []
        self._thinking_blocks = []

        # Store the user message for task naming
        if not self.last_user_message:
            self.last_user_message = text

        try:
            cmd = [
                "claude", "-p",
                "--output-format", "stream-json",
                "--verbose",
                "--dangerously-skip-permissions",
            ]

            # Use --resume with session_id for subsequent messages (conversation continuity)
            if self.session_id:
                cmd.extend(["--resume", self.session_id])

            self.process = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self.workspace,
            )

            logger.info("Spawned claude for '%s' (pid=%s, session=%s)",
                       self.name, self.process.pid,
                       self.session_id or "new")

            # Write the message to stdin and close it (signals end of input for -p mode)
            self.process.stdin.write(text.encode())
            self.process.stdin.close()

            # Read all JSON events from stdout
            while True:
                line = await self.process.stdout.readline()
                if not line:
                    break

                line_text = line.decode("utf-8", errors="replace").strip()
                if not line_text:
                    continue

                try:
                    event = json.loads(line_text)
                except json.JSONDecodeError:
                    continue

                # Extract rich status from the event
                self._process_event(event)

                self.events.append(event)
                if len(self.events) > 1000:
                    self.events = self.events[-1000:]

                num_subs = len(self.subscribers)
                etype = event.get("type", "?")
                logger.debug("Agent '%s' event type=%s, subscribers=%d",
                            self.name, etype, num_subs)
                for queue in self.subscribers:
                    try:
                        queue.put_nowait(event)
                    except asyncio.QueueFull:
                        logger.warning("Queue full for agent '%s' — dropping event type=%s",
                                      self.name, etype)

            await self.process.wait()

            # Check for non-zero exit code
            if self.process.returncode and self.process.returncode != 0:
                stderr_bytes = await self.process.stderr.read()
                stderr_text = stderr_bytes.decode("utf-8", errors="replace").strip()
                if stderr_text:
                    logger.warning("claude stderr for '%s': %s", self.name, stderr_text[:200])

            self.last_completed_at = time.time()

        except Exception as e:
            logger.error("Error running claude for '%s': %s", self.name, e)
            self.status = "error"
            self.last_error = str(e)

            # Emit error notification
            notif = {
                "id": str(uuid.uuid4()),
                "agent_id": self.agent_id,
                "agent_name": self.name,
                "type": "error",
                "title": f"{self.name} encountered an error",
                "detail": str(e)[:200],
                "created_at": time.time(),
            }
            _save_notification(notif)
            _notifications_buffer.append(notif)

            # Broadcast error event
            error_event = {"type": "monet_notification", "notification": notif}
            for queue in self.subscribers:
                try:
                    queue.put_nowait(error_event)
                except asyncio.QueueFull:
                    pass
            self.process = None
            return

        # Transition back to idle
        self.status = "idle"
        self.current_step = None
        self.current_detail = None
        self.process = None

        # Generate instant heuristic insights (immediate, no LLM call)
        self._generate_instant_insights()

        # Then upgrade with richer LLM insights in background (non-blocking)
        asyncio.create_task(self._generate_insights())

    def _generate_instant_insights(self):
        """
        Produce instant structured insights from activity log heuristics.
        No LLM call - runs synchronously in <1ms.
        The LLM call will upgrade these later with richer data.
        """
        elapsed = int(time.time() - self.started_at) if self.started_at else 0

        # Classify the task based on tool usage patterns
        task_label = self._classify_task()

        # Build thinking process from activity log
        thinking = []
        for a in self._activity_log[:6]:
            tool = a.get("tool", "?")
            detail = a.get("detail", "")
            if a.get("file"):
                fname = a["file"].split("/")[-1]
                action = a.get("action", "used")
                thinking.append(f"{action.capitalize()} {fname}")
            elif a.get("command"):
                cmd = a["command"][:50]
                thinking.append(f"Ran: {cmd}")
            elif a.get("pattern"):
                thinking.append(f"Searched for: {a['pattern'][:30]}")
            elif detail:
                thinking.append(f"{TOOL_LABELS.get(tool, tool)}: {detail}")
            else:
                thinking.append(TOOL_LABELS.get(tool, f"Used {tool}"))

        # Build files changed list
        files_changed = []
        for fp, action in list(self._files_touched.items())[:10]:
            fname = fp.split("/")[-1]
            files_changed.append({"file": fname, "action": action, "path": fp})

        # Build summary from first response text
        summary = ""
        if self._thinking_blocks:
            first_text = self._thinking_blocks[0][:150]
            summary = first_text.split("\n")[0].strip()
            if len(summary) > 100:
                summary = summary[:97] + "..."

        # Determine complexity
        tc = self.tool_call_count
        complexity = "trivial" if tc == 0 else "simple" if tc <= 3 else "moderate" if tc <= 10 else "complex"

        # Determine status
        status = "completed"
        if self.last_error:
            status = "error"
        elif any(a.get("tool") in ("Grep", "Glob") for a in self._activity_log):
            if not any(a.get("action") in ("write", "edit") for a in self._activity_log):
                status = "investigating"

        self.insights = {
            "taskLabel": task_label,
            "summary": summary or f"Processed request with {tc} tool calls",
            "thinkingProcess": thinking[:4] if thinking else ["Processed user request"],
            "filesChanged": files_changed,
            "status": status,
            "complexity": complexity,
            "generatedAt": time.time(),
            "toolCallCount": tc,
            "elapsedSeconds": elapsed,
            "userMessage": (self.last_user_message or "")[:100],
            "_source": "heuristic",  # will be upgraded to "llm" by _generate_insights
        }

        logger.info("Instant insight for '%s': taskLabel=%s (%d tools, %ds)",
                    self.name, task_label, tc, elapsed)

    def _classify_task(self) -> str:
        """Classify the task into a short 2-4 word label based on activity patterns."""
        has_write = any(a.get("action") in ("write", "edit") for a in self._activity_log)
        has_read = any(a.get("action") == "read" for a in self._activity_log)
        has_bash = any(a.get("tool") == "Bash" for a in self._activity_log)
        has_search = any(a.get("tool") in ("Grep", "Glob") for a in self._activity_log)
        tc = self.tool_call_count

        # Check for specific file extensions in changed files
        extensions = set()
        for fp in self._files_touched:
            if "." in fp:
                extensions.add(fp.rsplit(".", 1)[-1].lower())

        test_related = any("test" in fp.split("/")[-1].lower() for fp in self._files_touched)
        config_related = any(ext in ("json", "yaml", "yml", "toml", "env", "cfg")
                           for ext in extensions)

        # Classify based on patterns
        if test_related and has_write:
            return "Writing Tests"
        if has_write and has_search:
            return "Refactoring Code"
        if has_write and len(self._files_touched) > 3:
            return "Editing Multiple Files"
        if has_write and config_related:
            return "Updating Config"
        if has_write:
            # Use the most recently written file for context
            written = [fp for fp, act in self._files_touched.items() if act in ("write", "edit")]
            if written:
                fname = written[-1].split("/")[-1]
                if len(fname) <= 20:
                    return f"Editing {fname}"
            return "Writing Code"
        if has_bash and not has_read:
            if self._commands_run:
                first_cmd = self._commands_run[0].split()[0] if self._commands_run[0].split() else ""
                if first_cmd in ("ls", "find", "du", "df", "tree"):
                    return "Exploring Files"
                if first_cmd in ("npm", "yarn", "pip", "cargo", "make"):
                    return "Running Build"
                if first_cmd in ("git",):
                    return "Git Operations"
                if first_cmd in ("pytest", "jest", "vitest", "cargo"):
                    return "Running Tests"
            return "Running Commands"
        if has_search:
            return "Searching Codebase"
        if has_read and not has_write:
            return "Reading Code"
        if has_bash:
            return "Terminal Session"
        if tc == 0:
            return "Quick Response"

        # Fallback: derive from user message
        msg = (self.last_user_message or "").lower()
        if any(w in msg for w in ("fix", "bug", "error", "issue")):
            return "Debugging"
        if any(w in msg for w in ("test", "spec")):
            return "Testing"
        if any(w in msg for w in ("refactor", "clean", "organize")):
            return "Refactoring"
        if any(w in msg for w in ("add", "create", "implement", "build")):
            return "Building Feature"
        if any(w in msg for w in ("explain", "what", "how", "why")):
            return "Code Review"

        return "Working"

    def kill(self):
        """
        Terminate the claude process.

        Sends SIGTERM. Safe to call if the process has already exited -
        silently ignores ProcessLookupError.
        """
        if self.process:
            try:
                self.process.terminate()
            except ProcessLookupError:
                pass
        self.status = "idle"
        self.current_step = None
        self.current_detail = None
        self.process = None

    def _derive_task_name(self) -> str | None:
        """Derive a short task name from the user's first message."""
        msg = self.last_user_message
        if not msg:
            return None
        # Take first meaningful words, cap at ~30 chars
        words = msg.strip().split()
        result = ""
        for w in words:
            if len(result) + len(w) + 1 > 30:
                break
            result = (result + " " + w) if result else w
        return result or None

    def to_dict(self) -> dict:
        """
        Serialize the agent to a plain dict for API JSON responses.

        Returns:
            Dict with id, name, status, color, workspace, pid, and rich display fields.
        """
        is_running = self.status == "running"

        # Derive a meaningful task name for the cabin
        task_name = None
        if is_running:
            task_name = self._derive_task_name() or self.current_step or "Working"

        # Calculate elapsed time
        elapsed_seconds = None
        if self.started_at and is_running:
            elapsed_seconds = int(time.time() - self.started_at)

        # Build mood string - reflects what the agent is actually doing right now
        if self.status == "error":
            mood = self.last_error[:50] if self.last_error else "Error"
        elif is_running:
            if self.current_detail:
                mood = f"{self.current_step or 'Working'}: {self.current_detail}"
            else:
                mood = self.current_step or "Thinking..."
        else:
            mood = "Ready"

        return {
            "id": self.agent_id,
            "name": self.name,
            "status": self.status,
            "color": self.color,
            "workspace": self.workspace,
            "pid": self.process.pid if self.process else None,
            "decisionCount": self.decision_count,
            "mood": mood,
            "currentStep": task_name,
            "currentDetail": self.current_detail,
            "toolCallCount": self.tool_call_count,
            "elapsedSeconds": elapsed_seconds,
            "emoji": "",
            # Insight fields
            "insights": self.insights,
            "activityLog": self._activity_log[-10:] if self._activity_log else [],
            "filesTouched": self._files_touched,
        }


# --- App State ---

_agents: dict[str, AgentProcess] = {}  # agent_id -> AgentProcess
_default_workspace: str = os.path.expanduser("~")
_notifications_buffer: list[dict] = []  # in-memory ring buffer for quick access


# --- App ---

app = FastAPI(title="Monet", lifespan=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Startup: init DB and restore agents ---

@app.on_event("startup")
async def startup():
    _init_db()
    # Restore agents from SQLite
    for row in _load_agents():
        agent = AgentProcess(row["id"], row["name"], row["color"], row["workspace"])
        _agents[row["id"]] = agent
    logger.info("Restored %d agents from database", len(_agents))
    # Load recent notifications into buffer
    _notifications_buffer.extend(_load_recent_notifications(50))


# --- Agent Endpoints ---

@app.get("/agents")
async def list_agents():
    """
    List all agents and their current process status.

    Returns:
        Dict with 'agents' list of serialized AgentProcess objects.
    """
    return {"agents": [a.to_dict() for a in _agents.values()]}


@app.post("/agents")
async def create_agent(request: Request):
    """
    Create a new agent and spawn a headless claude process with stream-json.

    Body fields:
        id (str, optional): Agent ID - defaults to 'agent-{timestamp}'.
        name (str): Display name for the agent.
        color (str): Hex color string for UI rendering.
        workspace (str): Absolute path to working directory.
        autoStart (bool): Whether to spawn the process immediately (default: True).

    Returns:
        Dict with 'agent' key containing the serialized agent.
    """
    body = await request.json()
    agent_id = body.get("id", f"agent-{int(time.time() * 1000)}")
    name = body.get("name", "Agent")
    color = body.get("color", "#8b5cf6")
    workspace = body.get("workspace", _default_workspace)
    auto_start = body.get("autoStart", True)

    agent = AgentProcess(agent_id, name, color, workspace)
    _agents[agent_id] = agent

    # Persist to SQLite
    _save_agent(agent_id, name, color, workspace)

    return {"agent": agent.to_dict()}


@app.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str):
    """
    Kill the agent's claude process and remove it from state.

    Args:
        agent_id: The unique agent identifier.

    Returns:
        Dict with 'deleted' key containing the removed agent ID.
    """
    agent = _agents.pop(agent_id, None)
    if agent:
        agent.kill()
    _delete_agent_db(agent_id)
    return {"deleted": agent_id}


@app.post("/agents/{agent_id}/start")
async def start_agent(agent_id: str):
    """
    Start (or restart) the claude process for an existing agent.

    If already running, kills the current process first and waits briefly
    before spawning a new one.

    Args:
        agent_id: The unique agent identifier.

    Returns:
        Dict with 'agent' key, or 404 JSON if agent not found.
    """
    agent = _agents.get(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)

    # Reset the agent for a fresh session
    agent.kill()  # Kill any running process
    agent.session_id = None  # Clear session so next message starts fresh
    agent.events = []
    agent.current_step = None
    agent.current_detail = None
    agent.tool_call_count = 0
    agent.total_tool_calls = 0
    agent.last_user_message = None
    agent.last_error = None

    return {"agent": agent.to_dict()}


@app.post("/agents/{agent_id}/stop")
async def stop_agent(agent_id: str):
    """
    Stop the claude process for an agent (SIGTERM).

    Args:
        agent_id: The unique agent identifier.

    Returns:
        Dict with 'agent' key, or 404 JSON if agent not found.
    """
    agent = _agents.get(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)

    agent.kill()
    return {"agent": agent.to_dict()}


@app.post("/agents/{agent_id}/input")
async def send_input(agent_id: str, request: Request):
    """
    Send a user message to an agent's claude process.

    Wraps the text as a stream-json user message and writes it to stdin.

    Body fields:
        text (str): The message text to send.

    Args:
        agent_id: The unique agent identifier.

    Returns:
        Dict with 'status': 'sent', or error JSON.
    """
    agent = _agents.get(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)

    body = await request.json()
    text = body.get("text", "")

    if agent.status == "running":
        return JSONResponse(
            {"error": "Agent is busy", "status": "busy"},
            status_code=409,
        )

    # send_message spawns a new process, runs it, and collects events
    # Run in background so the HTTP response returns immediately
    asyncio.create_task(agent.send_message(text))

    return {"status": "sent"}


@app.get("/agents/{agent_id}/output")
async def get_output(agent_id: str):
    """
    Get the buffered JSON events for an agent (last 1000).

    Args:
        agent_id: The unique agent identifier.

    Returns:
        Dict with 'events' list of raw event dicts, or 404 JSON.
    """
    agent = _agents.get(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)
    return {"events": agent.events}


@app.get("/agents/{agent_id}/insights")
async def get_insights(agent_id: str):
    """
    Get structured insights for an agent's activity.

    Returns the latest insight plus the insight history and raw activity log.
    """
    agent = _agents.get(agent_id)
    if not agent:
        return JSONResponse({"error": "Agent not found"}, status_code=404)
    return {
        "latest": agent.insights,
        "history": agent.insight_history,
        "activityLog": agent._activity_log[-20:],
        "filesTouched": agent._files_touched,
        "commandsRun": agent._commands_run[-10:],
    }


# --- Decision Endpoints ---

@app.get("/decisions")
async def list_decisions(agent_id: str | None = None):
    """
    List all pending decisions, optionally filtered by agent_id.

    Returns:
        Dict with 'decisions' list of decision objects.
    """
    decisions = _load_pending_decisions()
    if agent_id:
        decisions = [d for d in decisions if d["agent_id"] == agent_id]
    return {"decisions": decisions}


@app.post("/decisions/{decision_id}/resolve")
async def resolve_decision(decision_id: str, request: Request):
    """
    Resolve a pending decision.

    Body fields:
        resolution (str): 'approved', 'rejected', or 'skipped'

    Returns:
        Dict with 'status': 'resolved'.
    """
    body = await request.json()
    resolution = body.get("resolution", "skipped")
    _resolve_decision_db(decision_id, resolution)
    return {"status": "resolved", "decision_id": decision_id, "resolution": resolution}


# --- Notification Endpoints ---

@app.get("/notifications")
async def list_notifications(limit: int = 50):
    """
    Get recent notifications (toast events).

    Returns:
        Dict with 'notifications' list.
    """
    return {"notifications": _load_recent_notifications(limit)}


@app.post("/notifications/read")
async def mark_read():
    """Mark all notifications as read."""
    _mark_notifications_read()
    return {"status": "ok"}


# --- WebSocket for live JSON event streaming ---

@app.websocket("/agents/{agent_id}/terminal")
async def agent_terminal_ws(ws: WebSocket, agent_id: str):
    """
    WebSocket endpoint for live JSON event streaming to the browser.

    On connect: replays all buffered events so the browser catches up, then
    streams new events in real time.

    Client -> Server messages (JSON):
        {"type": "user_message", "text": "..."}  - sends a message to claude

    Server -> Client messages (JSON):
        Raw claude stream-json event objects, one per message.
        Examples: system/init, assistant text, tool_use, result, etc.
        Also monet_notification events for completion/error/decision alerts.

    Args:
        agent_id: The unique agent identifier.
    """
    agent = _agents.get(agent_id)
    if not agent:
        await ws.close(code=4004, reason="Agent not found")
        return

    await ws.accept()
    logger.info("WS connected for agent '%s' (%s)", agent.name, agent_id)

    # Subscribe this WebSocket to the agent's event stream
    queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=1000)
    agent.subscribers.append(queue)
    logger.info("Agent '%s' now has %d subscriber(s)", agent.name, len(agent.subscribers))

    # Replay buffered events so the browser catches up immediately
    replay_count = len(agent.events)
    for event in list(agent.events):  # snapshot to avoid mutation during iteration
        await ws.send_text(json.dumps(event))
    logger.info("Replayed %d buffered events for agent '%s'", replay_count, agent.name)

    try:
        async def send_events():
            """Forward queued JSON events to the WebSocket client."""
            while True:
                event = await queue.get()
                logger.debug("WS sending event type=%s to agent '%s'",
                            event.get("type", "?"), agent.name)
                await ws.send_text(json.dumps(event))

        async def receive_input():
            """Read user_message messages from the WebSocket client and forward to claude."""
            while True:
                raw = await ws.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    logger.warning("WS received non-JSON message for '%s': %s",
                                  agent.name, raw[:100])
                    continue
                if msg.get("type") == "user_message":
                    text = msg.get("text", "").strip()
                    if not text:
                        continue
                    # Refuse if agent is already busy (same guard as HTTP endpoint)
                    if agent.status == "running":
                        logger.info("WS ignoring user_message for busy agent '%s'", agent.name)
                        try:
                            await ws.send_text(json.dumps({
                                "type": "monet_error",
                                "error": "Agent is busy",
                            }))
                        except Exception:
                            pass
                        continue
                    logger.info("WS received user_message for agent '%s': %s",
                               agent.name, text[:80])
                    asyncio.create_task(agent.send_message(text))

        # Run both coroutines; if either raises, cancel the other
        send_task = asyncio.create_task(send_events())
        receive_task = asyncio.create_task(receive_input())
        try:
            done, pending = await asyncio.wait(
                [send_task, receive_task],
                return_when=asyncio.FIRST_EXCEPTION,
            )
            for task in pending:
                task.cancel()
            # Re-raise any exceptions from completed tasks
            for task in done:
                if task.exception():
                    raise task.exception()
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("WebSocket error for '%s': %s", agent_id, e)
    finally:
        if queue in agent.subscribers:
            agent.subscribers.remove(queue)


# --- Workspace config ---

@app.post("/config/workspace")
async def set_workspace(request: Request):
    """
    Set the default workspace directory for newly created agents.

    Body fields:
        workspace (str): Absolute path to the workspace directory.

    Returns:
        Dict with the updated 'workspace' path.
    """
    global _default_workspace
    body = await request.json()
    _default_workspace = body.get("workspace", os.getcwd())
    return {"workspace": _default_workspace}


@app.get("/config/workspace")
async def get_workspace():
    """
    Get the current default workspace directory.

    Returns:
        Dict with the current 'workspace' path.
    """
    return {"workspace": _default_workspace}
