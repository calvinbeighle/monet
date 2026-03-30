"""SQLite-backed session store for persisting agent conversation history."""

import json
import logging
import os
import sqlite3
from typing import Optional

logger = logging.getLogger(__name__)

DEFAULT_DB_PATH = os.environ.get("MONET_DB_PATH", "monet.db")


class SessionStore:
    """Persists session message history to SQLite.

    Each session is a conversation between a user and the agent backend.
    Messages are stored as JSON and loaded on session resume, so the agent
    can pick up where it left off after a server restart.
    """

    def __init__(self, db_path: str = DEFAULT_DB_PATH) -> None:
        self.db_path = db_path
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )"""
            )
            conn.execute(
                """CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
                )"""
            )
            conn.execute(
                """CREATE INDEX IF NOT EXISTS idx_messages_session
                   ON messages(session_id)"""
            )
            conn.commit()

    def create_session(self, session_id: str) -> None:
        """Create a new session record."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT OR IGNORE INTO sessions (session_id) VALUES (?)",
                (session_id,),
            )
            conn.commit()

    def session_exists(self, session_id: str) -> bool:
        """Check if a session exists."""
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT 1 FROM sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
            return row is not None

    def get_messages(self, session_id: str) -> list[dict]:
        """Load all messages for a session, ordered by insertion."""
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id",
                (session_id,),
            ).fetchall()
            return [
                {"role": role, "content": json.loads(content)} for role, content in rows
            ]

    def append_message(self, session_id: str, role: str, content) -> None:
        """Append a message to a session. Content is JSON-serialized."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
                (session_id, role, json.dumps(content, default=str)),
            )
            conn.execute(
                "UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE session_id = ?",
                (session_id,),
            )
            conn.commit()

    def list_sessions(self) -> list[dict]:
        """List all sessions with metadata."""
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                """SELECT session_id, created_at, updated_at,
                          (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.session_id)
                   FROM sessions s ORDER BY updated_at DESC"""
            ).fetchall()
            return [
                {
                    "session_id": row[0],
                    "created_at": row[1],
                    "updated_at": row[2],
                    "message_count": row[3],
                }
                for row in rows
            ]

    def delete_session(self, session_id: str) -> bool:
        """Delete a session and all its messages. Returns True if session existed."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
            result = conn.execute(
                "DELETE FROM sessions WHERE session_id = ?", (session_id,)
            )
            conn.commit()
            return result.rowcount > 0
