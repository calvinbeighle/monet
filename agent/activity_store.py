"""SQLite-backed store for tracking agent activity - runs, status, and history."""

import logging
import os
import sqlite3
import time
import uuid
from typing import Optional

logger = logging.getLogger(__name__)

DEFAULT_DB_PATH = os.environ.get("MONET_DB_PATH", "monet.db")


class ActivityStore:
    """Tracks agent runs - when they start, finish, what they did, and their status.

    This powers the "See Agents" dashboard (SCOPE.md Feature 3) by recording
    every agent invocation so the user can see what agents are doing and have done.
    """

    def __init__(self, db_path: str = DEFAULT_DB_PATH) -> None:
        self.db_path = db_path
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS agent_activity (
                    id TEXT PRIMARY KEY,
                    agent_name TEXT NOT NULL,
                    intent TEXT NOT NULL,
                    session_id TEXT,
                    ui_pattern TEXT,
                    status TEXT NOT NULL DEFAULT 'running',
                    started_at REAL NOT NULL,
                    finished_at REAL,
                    error_message TEXT,
                    tool_calls_count INTEGER DEFAULT 0,
                    approvals_count INTEGER DEFAULT 0,
                    summary TEXT
                )"""
            )
            conn.execute(
                """CREATE INDEX IF NOT EXISTS idx_activity_agent
                   ON agent_activity(agent_name)"""
            )
            conn.execute(
                """CREATE INDEX IF NOT EXISTS idx_activity_status
                   ON agent_activity(status)"""
            )
            conn.execute(
                """CREATE INDEX IF NOT EXISTS idx_activity_started
                   ON agent_activity(started_at DESC)"""
            )
            conn.commit()

    def record_start(
        self,
        agent_name: str,
        intent: str,
        session_id: Optional[str] = None,
        ui_pattern: Optional[str] = None,
    ) -> str:
        """Record the start of an agent run. Returns the activity ID."""
        activity_id = uuid.uuid4().hex[:12]
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """INSERT INTO agent_activity
                   (id, agent_name, intent, session_id, ui_pattern, status, started_at)
                   VALUES (?, ?, ?, ?, ?, 'running', ?)""",
                (activity_id, agent_name, intent, session_id, ui_pattern, time.time()),
            )
            conn.commit()
        return activity_id

    def record_tool_call(self, activity_id: str) -> None:
        """Increment the tool call counter for a running activity."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "UPDATE agent_activity SET tool_calls_count = tool_calls_count + 1 WHERE id = ?",
                (activity_id,),
            )
            conn.commit()

    def record_approval(self, activity_id: str) -> None:
        """Increment the approval counter for a running activity."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "UPDATE agent_activity SET approvals_count = approvals_count + 1 WHERE id = ?",
                (activity_id,),
            )
            conn.commit()

    def record_finish(
        self,
        activity_id: str,
        summary: Optional[str] = None,
    ) -> None:
        """Record successful completion of an agent run."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """UPDATE agent_activity
                   SET status = 'completed', finished_at = ?, summary = ?
                   WHERE id = ?""",
                (time.time(), summary, activity_id),
            )
            conn.commit()

    def record_error(
        self,
        activity_id: str,
        error_message: str,
    ) -> None:
        """Record that an agent run failed."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """UPDATE agent_activity
                   SET status = 'error', finished_at = ?, error_message = ?
                   WHERE id = ?""",
                (time.time(), error_message, activity_id),
            )
            conn.commit()

    def get_agent_activity(
        self,
        agent_name: str,
        limit: int = 20,
    ) -> list[dict]:
        """Get recent activity for a specific agent."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """SELECT id, agent_name, intent, session_id, ui_pattern,
                          status, started_at, finished_at, error_message,
                          tool_calls_count, approvals_count, summary
                   FROM agent_activity
                   WHERE agent_name = ?
                   ORDER BY started_at DESC
                   LIMIT ?""",
                (agent_name, limit),
            ).fetchall()
            return [dict(row) for row in rows]

    def get_all_activity(self, limit: int = 50) -> list[dict]:
        """Get recent activity across all agents."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """SELECT id, agent_name, intent, session_id, ui_pattern,
                          status, started_at, finished_at, error_message,
                          tool_calls_count, approvals_count, summary
                   FROM agent_activity
                   ORDER BY started_at DESC
                   LIMIT ?""",
                (limit,),
            ).fetchall()
            return [dict(row) for row in rows]

    def get_running(self) -> list[dict]:
        """Get all currently running agent activities."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """SELECT id, agent_name, intent, session_id, ui_pattern,
                          status, started_at, tool_calls_count, approvals_count
                   FROM agent_activity
                   WHERE status = 'running'
                   ORDER BY started_at DESC""",
            ).fetchall()
            return [dict(row) for row in rows]

    def get_agent_stats(self, agent_name: str) -> dict:
        """Get aggregate stats for a specific agent."""
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                """SELECT
                       COUNT(*) as total_runs,
                       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                       SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
                       SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
                       SUM(tool_calls_count) as total_tool_calls,
                       SUM(approvals_count) as total_approvals,
                       MAX(started_at) as last_run_at
                   FROM agent_activity
                   WHERE agent_name = ?""",
                (agent_name,),
            ).fetchone()
            return {
                "total_runs": row[0] or 0,
                "completed": row[1] or 0,
                "errors": row[2] or 0,
                "running": row[3] or 0,
                "total_tool_calls": row[4] or 0,
                "total_approvals": row[5] or 0,
                "last_run_at": row[6],
            }
