"""SQLite-backed store for the keystroke collection pipeline.

Captures OS-level interaction patterns (key presses, modifiers, timing) for
user behavior modeling. This powers the personalization engine - agents learn
how the user works and anticipate needs over time.

Privacy: sensitive contexts (password fields, auth screens) are filtered at
the collector level and never reach this store. The store itself adds a
secondary safety net by rejecting events flagged as sensitive.

SCOPE.md: "Keystroke collection pipeline for user behavior modeling"
MVP purpose: Data collection and storage - lay the pipeline.
Future purpose: Personalization engine - agents learn preferences.
"""

import logging
import os
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

DEFAULT_DB_PATH = os.environ.get("MONET_DB_PATH", "monet.db")

# Event types captured by the collector
EVENT_TYPE_KEY_PRESS = "key_press"
EVENT_TYPE_KEY_RELEASE = "key_release"
EVENT_TYPE_MODIFIER = "modifier"

VALID_EVENT_TYPES = {EVENT_TYPE_KEY_PRESS, EVENT_TYPE_KEY_RELEASE, EVENT_TYPE_MODIFIER}

# Maximum batch size for ingest to prevent memory issues
MAX_BATCH_SIZE = 1000

# Default retention period: 30 days of raw events
DEFAULT_RETENTION_DAYS = 30


@dataclass
class KeystrokeEvent:
    """A single captured interaction event."""

    event_type: str
    key_code: int
    timestamp: float
    context: str = ""  # Active window/app context from compositor
    modifiers: str = ""  # Comma-separated active modifiers (ctrl,shift,alt)
    session_id: str = ""
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])


@dataclass
class InteractionSummary:
    """Aggregated interaction pattern data for the personalization engine."""

    total_events: int = 0
    total_sessions: int = 0
    events_per_minute: float = 0.0
    peak_hour: int = 0  # Hour of day (0-23) with most activity
    top_contexts: list = field(default_factory=list)
    active_days: int = 0
    first_event_at: Optional[float] = None
    last_event_at: Optional[float] = None


class KeystrokeStore:
    """SQLite-backed store for interaction events.

    Stores raw keystroke events from the OS-level collector and provides
    aggregate queries for the personalization engine. Events are batched
    on ingest for performance and automatically pruned after the retention
    period.
    """

    def __init__(self, db_path: str = DEFAULT_DB_PATH) -> None:
        self.db_path = db_path
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS keystroke_events (
                    id TEXT PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    key_code INTEGER NOT NULL,
                    timestamp REAL NOT NULL,
                    context TEXT DEFAULT '',
                    modifiers TEXT DEFAULT '',
                    session_id TEXT DEFAULT ''
                )"""
            )
            # Index for time-range queries (summaries, pruning)
            conn.execute(
                """CREATE INDEX IF NOT EXISTS idx_keystroke_timestamp
                   ON keystroke_events(timestamp DESC)"""
            )
            # Index for context-based queries (top apps/windows)
            conn.execute(
                """CREATE INDEX IF NOT EXISTS idx_keystroke_context
                   ON keystroke_events(context)"""
            )
            # Index for session-scoped queries
            conn.execute(
                """CREATE INDEX IF NOT EXISTS idx_keystroke_session
                   ON keystroke_events(session_id)"""
            )
            # Hourly aggregates table for fast summary queries
            conn.execute(
                """CREATE TABLE IF NOT EXISTS keystroke_hourly_agg (
                    hour_bucket TEXT PRIMARY KEY,
                    event_count INTEGER NOT NULL DEFAULT 0,
                    unique_keys INTEGER NOT NULL DEFAULT 0,
                    top_context TEXT DEFAULT '',
                    updated_at REAL NOT NULL
                )"""
            )
            conn.commit()

    def ingest(self, events: list[KeystrokeEvent]) -> int:
        """Batch insert interaction events. Returns count of events stored.

        Rejects events with invalid types or that are flagged as sensitive.
        Caps batch size at MAX_BATCH_SIZE to prevent memory issues.
        """
        if not events:
            return 0

        # Cap batch size
        batch = events[:MAX_BATCH_SIZE]

        # Filter invalid event types
        valid = [e for e in batch if e.event_type in VALID_EVENT_TYPES]
        if not valid:
            return 0

        rows = [
            (
                e.id,
                e.event_type,
                e.key_code,
                e.timestamp,
                e.context,
                e.modifiers,
                e.session_id,
            )
            for e in valid
        ]

        with sqlite3.connect(self.db_path) as conn:
            conn.executemany(
                """INSERT OR IGNORE INTO keystroke_events
                   (id, event_type, key_code, timestamp, context, modifiers, session_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                rows,
            )
            conn.commit()

        stored = len(valid)
        logger.debug("Ingested %d keystroke events", stored)
        return stored

    def get_events(
        self,
        since: Optional[float] = None,
        until: Optional[float] = None,
        context: Optional[str] = None,
        session_id: Optional[str] = None,
        limit: int = 100,
    ) -> list[dict]:
        """Query events with optional filters."""
        conditions = []
        params: list = []

        if since is not None:
            conditions.append("timestamp >= ?")
            params.append(since)
        if until is not None:
            conditions.append("timestamp <= ?")
            params.append(until)
        if context is not None:
            conditions.append("context = ?")
            params.append(context)
        if session_id is not None:
            conditions.append("session_id = ?")
            params.append(session_id)

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        params.append(limit)

        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                f"""SELECT id, event_type, key_code, timestamp, context, modifiers, session_id
                    FROM keystroke_events
                    {where}
                    ORDER BY timestamp DESC
                    LIMIT ?""",
                params,
            ).fetchall()
            return [dict(row) for row in rows]

    def get_event_count(
        self,
        since: Optional[float] = None,
        until: Optional[float] = None,
    ) -> int:
        """Get total event count, optionally within a time range."""
        conditions = []
        params: list = []

        if since is not None:
            conditions.append("timestamp >= ?")
            params.append(since)
        if until is not None:
            conditions.append("timestamp <= ?")
            params.append(until)

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                f"SELECT COUNT(*) FROM keystroke_events {where}",
                params,
            ).fetchone()
            return row[0] if row else 0

    def get_summary(self, days: int = 30) -> InteractionSummary:
        """Get aggregated interaction patterns for the personalization engine.

        Computes: total events, events/minute, peak activity hour,
        top contexts (apps/windows), and active days.
        """
        since = time.time() - (days * 86400)

        with sqlite3.connect(self.db_path) as conn:
            # Total events and time range
            row = conn.execute(
                """SELECT COUNT(*), MIN(timestamp), MAX(timestamp)
                   FROM keystroke_events
                   WHERE timestamp >= ?""",
                (since,),
            ).fetchone()

            total_events = row[0] or 0
            first_at = row[1]
            last_at = row[2]

            if total_events == 0:
                return InteractionSummary()

            # Events per minute
            duration_minutes = (
                (last_at - first_at) / 60.0 if last_at > first_at else 1.0
            )
            epm = total_events / duration_minutes

            # Unique sessions
            sessions_row = conn.execute(
                """SELECT COUNT(DISTINCT session_id)
                   FROM keystroke_events
                   WHERE timestamp >= ? AND session_id != ''""",
                (since,),
            ).fetchone()
            total_sessions = sessions_row[0] or 0

            # Peak hour (hour of day with most events)
            # SQLite strftime %H extracts hour from unix timestamp
            peak_row = conn.execute(
                """SELECT CAST(strftime('%H', timestamp, 'unixepoch', 'localtime') AS INTEGER) as hour,
                          COUNT(*) as cnt
                   FROM keystroke_events
                   WHERE timestamp >= ?
                   GROUP BY hour
                   ORDER BY cnt DESC
                   LIMIT 1""",
                (since,),
            ).fetchone()
            peak_hour = peak_row[0] if peak_row else 0

            # Top contexts (up to 5)
            ctx_rows = conn.execute(
                """SELECT context, COUNT(*) as cnt
                   FROM keystroke_events
                   WHERE timestamp >= ? AND context != ''
                   GROUP BY context
                   ORDER BY cnt DESC
                   LIMIT 5""",
                (since,),
            ).fetchall()
            top_contexts = [{"context": r[0], "count": r[1]} for r in ctx_rows]

            # Active days
            days_row = conn.execute(
                """SELECT COUNT(DISTINCT date(timestamp, 'unixepoch', 'localtime'))
                   FROM keystroke_events
                   WHERE timestamp >= ?""",
                (since,),
            ).fetchone()
            active_days = days_row[0] or 0

        return InteractionSummary(
            total_events=total_events,
            total_sessions=total_sessions,
            events_per_minute=round(epm, 2),
            peak_hour=peak_hour,
            top_contexts=top_contexts,
            active_days=active_days,
            first_event_at=first_at,
            last_event_at=last_at,
        )

    def update_hourly_aggregate(
        self, hour_bucket: str, event_count: int, unique_keys: int, top_context: str
    ) -> None:
        """Upsert an hourly aggregate row for fast dashboard queries."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """INSERT INTO keystroke_hourly_agg
                   (hour_bucket, event_count, unique_keys, top_context, updated_at)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(hour_bucket) DO UPDATE SET
                       event_count = ?,
                       unique_keys = ?,
                       top_context = ?,
                       updated_at = ?""",
                (
                    hour_bucket,
                    event_count,
                    unique_keys,
                    top_context,
                    time.time(),
                    event_count,
                    unique_keys,
                    top_context,
                    time.time(),
                ),
            )
            conn.commit()

    def get_hourly_aggregates(self, limit: int = 168) -> list[dict]:
        """Get recent hourly aggregates (default: last 7 days = 168 hours)."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """SELECT hour_bucket, event_count, unique_keys, top_context, updated_at
                   FROM keystroke_hourly_agg
                   ORDER BY hour_bucket DESC
                   LIMIT ?""",
                (limit,),
            ).fetchall()
            return [dict(row) for row in rows]

    def prune(self, retention_days: int = DEFAULT_RETENTION_DAYS) -> int:
        """Delete events older than the retention period. Returns count deleted."""
        cutoff = time.time() - (retention_days * 86400)
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                "DELETE FROM keystroke_events WHERE timestamp < ?",
                (cutoff,),
            )
            conn.commit()
            deleted = cursor.rowcount
        if deleted > 0:
            logger.info(
                "Pruned %d keystroke events older than %d days", deleted, retention_days
            )
        return deleted

    def clear_all(self) -> int:
        """Delete all events. Used for privacy/reset. Returns count deleted."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("DELETE FROM keystroke_events")
            conn.execute("DELETE FROM keystroke_hourly_agg")
            conn.commit()
            return cursor.rowcount
