"""Scheduled agent execution - enables agents to run autonomously in the background.

SCOPE.md Feature 3 specifies that agents should "run autonomously in the background"
and users can create agents like "summarize my emails every morning." This module
provides the scheduling infrastructure: SQLite-backed schedule persistence, a
background thread that checks for due schedules, and execution via the agent runner.

Why this matters: without scheduling, agents are purely reactive (user types intent,
agent responds). With scheduling, agents become proactive - they can monitor inboxes,
summarize daily, check PRs periodically. This is the difference between a chatbot
and an autonomous OS.
"""

import json
import logging
import os
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)

# How often the scheduler thread checks for due schedules (seconds).
SCHEDULER_POLL_INTERVAL = int(os.environ.get("MONET_SCHEDULER_POLL_INTERVAL", "30"))


class ScheduleType(str, Enum):
    """Supported schedule types."""

    INTERVAL = "interval"  # Every N minutes
    DAILY = "daily"  # Once per day at HH:MM


@dataclass
class ScheduleConfig:
    """Persistent configuration for a scheduled agent run."""

    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    agent_name: str = ""
    intent: str = ""
    schedule_type: str = "interval"  # "interval" or "daily"
    interval_minutes: int = 60  # For interval type
    daily_time: str = "09:00"  # For daily type (HH:MM, 24h)
    enabled: bool = True
    last_run_at: float = 0.0
    next_run_at: float = 0.0
    created_at: float = 0.0
    updated_at: float = 0.0
    created_by: str = ""


class ScheduleStore:
    """SQLite-backed persistence for agent schedules.

    Stores schedule configurations so they survive restarts. Each schedule
    ties an agent + intent to a timing rule (interval or daily). The scheduler
    thread reads from this store to decide what to execute.
    """

    def __init__(self, db_path: str = "monet_schedules.db") -> None:
        self._db_path = db_path
        self._init_db()

    def _init_db(self) -> None:
        conn = sqlite3.connect(self._db_path)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS agent_schedules (
                id TEXT PRIMARY KEY,
                agent_name TEXT NOT NULL,
                intent TEXT NOT NULL,
                schedule_type TEXT NOT NULL DEFAULT 'interval',
                interval_minutes INTEGER NOT NULL DEFAULT 60,
                daily_time TEXT NOT NULL DEFAULT '09:00',
                enabled INTEGER NOT NULL DEFAULT 1,
                last_run_at REAL NOT NULL DEFAULT 0,
                next_run_at REAL NOT NULL DEFAULT 0,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                created_by TEXT NOT NULL DEFAULT ''
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_schedules_agent
            ON agent_schedules(agent_name)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_schedules_enabled
            ON agent_schedules(enabled)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_schedules_next_run
            ON agent_schedules(next_run_at)
        """)
        conn.commit()
        conn.close()

    def create(self, config: ScheduleConfig) -> ScheduleConfig:
        """Persist a new schedule. Computes next_run_at from the schedule type."""
        now = time.time()
        config.created_at = now
        config.updated_at = now
        if config.next_run_at == 0:
            config.next_run_at = self._compute_next_run(config, now)

        conn = sqlite3.connect(self._db_path)
        try:
            conn.execute(
                """INSERT INTO agent_schedules
                   (id, agent_name, intent, schedule_type, interval_minutes,
                    daily_time, enabled, last_run_at, next_run_at,
                    created_at, updated_at, created_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    config.id,
                    config.agent_name,
                    config.intent,
                    config.schedule_type,
                    config.interval_minutes,
                    config.daily_time,
                    1 if config.enabled else 0,
                    config.last_run_at,
                    config.next_run_at,
                    config.created_at,
                    config.updated_at,
                    config.created_by,
                ),
            )
            conn.commit()
        finally:
            conn.close()
        return config

    def get(self, schedule_id: str) -> Optional[ScheduleConfig]:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        try:
            row = conn.execute(
                "SELECT * FROM agent_schedules WHERE id = ?", (schedule_id,)
            ).fetchone()
            return self._row_to_config(row) if row else None
        finally:
            conn.close()

    def list_all(self) -> list[ScheduleConfig]:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                "SELECT * FROM agent_schedules ORDER BY created_at DESC"
            ).fetchall()
            return [self._row_to_config(r) for r in rows]
        finally:
            conn.close()

    def list_for_agent(self, agent_name: str) -> list[ScheduleConfig]:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                "SELECT * FROM agent_schedules WHERE agent_name = ? ORDER BY created_at DESC",
                (agent_name,),
            ).fetchall()
            return [self._row_to_config(r) for r in rows]
        finally:
            conn.close()

    def list_due(self, now: Optional[float] = None) -> list[ScheduleConfig]:
        """Return all enabled schedules whose next_run_at <= now."""
        if now is None:
            now = time.time()
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                "SELECT * FROM agent_schedules WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at ASC",
                (now,),
            ).fetchall()
            return [self._row_to_config(r) for r in rows]
        finally:
            conn.close()

    def update(self, config: ScheduleConfig) -> Optional[ScheduleConfig]:
        config.updated_at = time.time()
        conn = sqlite3.connect(self._db_path)
        try:
            cursor = conn.execute(
                """UPDATE agent_schedules SET
                   agent_name = ?, intent = ?, schedule_type = ?,
                   interval_minutes = ?, daily_time = ?, enabled = ?,
                   last_run_at = ?, next_run_at = ?, updated_at = ?,
                   created_by = ?
                   WHERE id = ?""",
                (
                    config.agent_name,
                    config.intent,
                    config.schedule_type,
                    config.interval_minutes,
                    config.daily_time,
                    1 if config.enabled else 0,
                    config.last_run_at,
                    config.next_run_at,
                    config.updated_at,
                    config.created_by,
                    config.id,
                ),
            )
            conn.commit()
            if cursor.rowcount == 0:
                return None
        finally:
            conn.close()
        return config

    def delete(self, schedule_id: str) -> bool:
        conn = sqlite3.connect(self._db_path)
        try:
            cursor = conn.execute(
                "DELETE FROM agent_schedules WHERE id = ?", (schedule_id,)
            )
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()

    def record_run(
        self, schedule_id: str, now: Optional[float] = None
    ) -> Optional[ScheduleConfig]:
        """Mark a schedule as just-run: update last_run_at and compute next_run_at."""
        if now is None:
            now = time.time()
        config = self.get(schedule_id)
        if config is None:
            return None
        config.last_run_at = now
        config.next_run_at = self._compute_next_run(config, now)
        return self.update(config)

    def _compute_next_run(self, config: ScheduleConfig, now: float) -> float:
        """Compute the next run time based on schedule type."""
        if config.schedule_type == ScheduleType.INTERVAL:
            return now + (config.interval_minutes * 60)
        elif config.schedule_type == ScheduleType.DAILY:
            return self._next_daily_time(config.daily_time, now)
        # Fallback: 1 hour from now
        return now + 3600

    @staticmethod
    def _next_daily_time(time_str: str, now: float) -> float:
        """Compute the next occurrence of HH:MM from now."""
        import datetime

        try:
            parts = time_str.split(":")
            hour = int(parts[0])
            minute = int(parts[1]) if len(parts) > 1 else 0
        except (ValueError, IndexError):
            hour, minute = 9, 0

        now_dt = datetime.datetime.fromtimestamp(now)
        target = now_dt.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if target <= now_dt:
            target += datetime.timedelta(days=1)
        return target.timestamp()

    def _row_to_config(self, row: sqlite3.Row) -> ScheduleConfig:
        return ScheduleConfig(
            id=row["id"],
            agent_name=row["agent_name"],
            intent=row["intent"],
            schedule_type=row["schedule_type"],
            interval_minutes=row["interval_minutes"],
            daily_time=row["daily_time"],
            enabled=bool(row["enabled"]),
            last_run_at=row["last_run_at"],
            next_run_at=row["next_run_at"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            created_by=row["created_by"],
        )


class AgentScheduler:
    """Background scheduler that executes agents on their configured schedules.

    Runs a daemon thread that polls the ScheduleStore for due schedules and
    dispatches them to the AgentRunner. Results are recorded in the ActivityStore
    via the runner's normal execution path.

    The scheduler is intentionally simple - a polling thread with SQLite storage.
    No external dependencies (no APScheduler, no Celery). This keeps the OS
    lightweight and the codebase minimal.
    """

    def __init__(self, schedule_store: ScheduleStore, runner: object = None) -> None:
        self._store = schedule_store
        self._runner = runner  # Set later to avoid circular init
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._running = False
        self._execution_log: list[dict] = []  # Recent execution results
        self._max_log_size = 100

    @property
    def store(self) -> ScheduleStore:
        return self._store

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def execution_log(self) -> list[dict]:
        return list(self._execution_log)

    def set_runner(self, runner: object) -> None:
        """Set the AgentRunner after initialization (breaks circular dependency)."""
        self._runner = runner

    def start(self) -> None:
        """Start the background scheduler thread."""
        if self._running:
            logger.warning("Scheduler already running")
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run_loop,
            name="monet-scheduler",
            daemon=True,
        )
        self._running = True
        self._thread.start()
        logger.info(
            "Agent scheduler started (poll interval: %ds)", SCHEDULER_POLL_INTERVAL
        )

    def stop(self) -> None:
        """Stop the background scheduler thread."""
        if not self._running:
            return
        self._stop_event.set()
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)
        self._thread = None
        logger.info("Agent scheduler stopped")

    def _run_loop(self) -> None:
        """Main scheduler loop - checks for due schedules and executes them."""
        while not self._stop_event.is_set():
            try:
                self._check_and_execute()
            except Exception:
                logger.exception("Scheduler loop error")
            self._stop_event.wait(timeout=SCHEDULER_POLL_INTERVAL)

    def _check_and_execute(self) -> None:
        """Check for due schedules and execute them."""
        now = time.time()
        due = self._store.list_due(now)
        for schedule in due:
            try:
                self._execute_schedule(schedule, now)
            except Exception:
                logger.exception("Failed to execute schedule %s", schedule.id)
                self._log_execution(schedule, success=False, error="Execution failed")

    def _execute_schedule(self, schedule: ScheduleConfig, now: float) -> None:
        """Execute a single scheduled agent run."""
        if self._runner is None:
            logger.warning("No runner configured, skipping schedule %s", schedule.id)
            return

        logger.info(
            "Executing scheduled agent: %s (intent: %s, schedule: %s)",
            schedule.agent_name,
            schedule.intent,
            schedule.id,
        )

        # Update the schedule timing before execution (prevents re-execution on crash)
        self._store.record_run(schedule.id, now)

        try:
            # Execute via the runner's sync path
            result = self._runner.run_sync(schedule.intent)
            self._log_execution(
                schedule,
                success=True,
                outputs=[o.content for o in result.outputs] if result.outputs else [],
            )
            logger.info(
                "Scheduled run complete: %s -> %s (%d outputs)",
                schedule.agent_name,
                result.agent,
                len(result.outputs),
            )
        except Exception as e:
            logger.exception("Scheduled agent execution failed: %s", schedule.id)
            self._log_execution(schedule, success=False, error=str(e))

    def _log_execution(
        self,
        schedule: ScheduleConfig,
        success: bool,
        outputs: list = None,
        error: str = "",
    ) -> None:
        """Record an execution result in the in-memory log."""
        entry = {
            "schedule_id": schedule.id,
            "agent_name": schedule.agent_name,
            "intent": schedule.intent,
            "success": success,
            "timestamp": time.time(),
            "outputs": outputs or [],
            "error": error,
        }
        self._execution_log.append(entry)
        if len(self._execution_log) > self._max_log_size:
            self._execution_log = self._execution_log[-self._max_log_size :]

    def get_status(self) -> dict:
        """Return scheduler status for API consumption."""
        schedules = self._store.list_all()
        enabled_count = sum(1 for s in schedules if s.enabled)
        return {
            "running": self._running,
            "total_schedules": len(schedules),
            "enabled_schedules": enabled_count,
            "recent_executions": self._execution_log[-10:],
        }
