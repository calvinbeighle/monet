"""SQLite-backed store for user-created agent configurations.

User-created agents are a core SCOPE.md Feature 3 capability: users can create
agents through conversation (e.g., "Make me an agent that summarizes my emails
every morning"). This store persists their configurations so they survive
server restarts and appear in the See Agents dashboard alongside built-in agents.
"""

import json
import logging
import os
import sqlite3
import time
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

DEFAULT_DB_PATH = os.environ.get("MONET_DB_PATH", "monet.db")


@dataclass
class CustomAgentConfig:
    """Persisted configuration for a user-created agent."""

    name: str
    description: str
    system_prompt: str
    # Which built-in tool sets this agent can use: ["email", "code", "writing"]
    tool_sets: list[str] = field(default_factory=list)
    # Which specific tools require approval before execution
    approval_tools: list[str] = field(default_factory=list)
    # Default UI pattern: "chat", "tinder", "diff", "whiteboard"
    ui_pattern: str = "chat"
    # Follow-up suggestion chips
    suggestions: list[str] = field(default_factory=list)
    # Metadata
    created_at: float = 0.0
    updated_at: float = 0.0
    created_by: str = ""


class CustomAgentStore:
    """Persists user-created agent configurations in SQLite.

    Each custom agent has a name, description, system prompt, and optionally
    borrows tool sets from built-in agents (email tools, code tools, etc.).
    The runner loads these on startup and registers them alongside built-in agents.
    """

    def __init__(self, db_path: str = DEFAULT_DB_PATH) -> None:
        self.db_path = db_path
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS custom_agents (
                    name TEXT PRIMARY KEY,
                    description TEXT NOT NULL,
                    system_prompt TEXT NOT NULL,
                    tool_sets TEXT NOT NULL DEFAULT '[]',
                    approval_tools TEXT NOT NULL DEFAULT '[]',
                    ui_pattern TEXT NOT NULL DEFAULT 'chat',
                    suggestions TEXT NOT NULL DEFAULT '[]',
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    created_by TEXT NOT NULL DEFAULT ''
                )"""
            )
            conn.commit()

    def create(self, config: CustomAgentConfig) -> CustomAgentConfig:
        """Persist a new custom agent configuration. Raises ValueError if name exists."""
        now = time.time()
        config.created_at = now
        config.updated_at = now
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute(
                    """INSERT INTO custom_agents
                       (name, description, system_prompt, tool_sets, approval_tools,
                        ui_pattern, suggestions, created_at, updated_at, created_by)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        config.name,
                        config.description,
                        config.system_prompt,
                        json.dumps(config.tool_sets),
                        json.dumps(config.approval_tools),
                        config.ui_pattern,
                        json.dumps(config.suggestions),
                        config.created_at,
                        config.updated_at,
                        config.created_by,
                    ),
                )
                conn.commit()
        except sqlite3.IntegrityError:
            raise ValueError(f"Agent '{config.name}' already exists")
        return config

    def get(self, name: str) -> Optional[CustomAgentConfig]:
        """Load a custom agent config by name."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT * FROM custom_agents WHERE name = ?", (name,)
            ).fetchone()
            if row is None:
                return None
            return self._row_to_config(row)

    def list_all(self) -> list[CustomAgentConfig]:
        """List all custom agent configurations."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM custom_agents ORDER BY created_at DESC"
            ).fetchall()
            return [self._row_to_config(row) for row in rows]

    def update(self, config: CustomAgentConfig) -> Optional[CustomAgentConfig]:
        """Update an existing custom agent. Returns None if not found."""
        config.updated_at = time.time()
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                """UPDATE custom_agents
                   SET description = ?, system_prompt = ?, tool_sets = ?,
                       approval_tools = ?, ui_pattern = ?, suggestions = ?,
                       updated_at = ?
                   WHERE name = ?""",
                (
                    config.description,
                    config.system_prompt,
                    json.dumps(config.tool_sets),
                    json.dumps(config.approval_tools),
                    config.ui_pattern,
                    json.dumps(config.suggestions),
                    config.updated_at,
                    config.name,
                ),
            )
            conn.commit()
            if cursor.rowcount == 0:
                return None
            return config

    def delete(self, name: str) -> bool:
        """Delete a custom agent by name. Returns True if deleted."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("DELETE FROM custom_agents WHERE name = ?", (name,))
            conn.commit()
            return cursor.rowcount > 0

    def exists(self, name: str) -> bool:
        """Check if a custom agent with the given name exists."""
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT 1 FROM custom_agents WHERE name = ?", (name,)
            ).fetchone()
            return row is not None

    def _row_to_config(self, row: sqlite3.Row) -> CustomAgentConfig:
        return CustomAgentConfig(
            name=row["name"],
            description=row["description"],
            system_prompt=row["system_prompt"],
            tool_sets=json.loads(row["tool_sets"]),
            approval_tools=json.loads(row["approval_tools"]),
            ui_pattern=row["ui_pattern"],
            suggestions=json.loads(row["suggestions"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            created_by=row["created_by"],
        )
