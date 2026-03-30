"""
activity.py - Real-time activity log for Monet background agents.

Tracks step-by-step progress of each agent as it works. The log is
thread-safe and bounded to prevent unbounded memory growth. It is used
by both the scheduler (to emit steps) and the API (to expose live status
on agent cards and in the orchestrator chat system prompt).
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class ActivityStep:
    """
    A single step emitted by an agent as it works.

    Fields:
        agent_id:    Which agent emitted this step ('email', 'code', 'planning').
        step:        Current step number (1-indexed).
        total_steps: Total steps in this run.
        label:       Short action label shown on the agent card, e.g. "reading inbox".
        detail:      Specific detail about what is happening, e.g. "Reading email from Sarah Chen".
        icon:        Lucide icon name for the UI, e.g. "mail", "edit", "git-pull-request".
        timestamp:   UTC datetime when this step was emitted.
    """

    agent_id: str
    step: int
    total_steps: int
    label: str
    detail: str
    icon: str
    timestamp: datetime = field(default_factory=datetime.utcnow)


class ActivityLog:
    """
    Thread-safe bounded ring buffer for agent activity steps.

    Keeps up to max_entries recent steps across all agents. Older entries
    are evicted when the limit is exceeded. Reading and writing are both
    protected by a single reentrant lock.
    """

    def __init__(self, max_entries: int = 50) -> None:
        """
        Args:
            max_entries: Maximum number of ActivityStep entries to retain.
        """
        self._entries: list[ActivityStep] = []
        self._lock = threading.Lock()
        self._max = max_entries

    def add(self, step: ActivityStep) -> None:
        """
        Appends a new step to the log, evicting the oldest entry if needed.

        Args:
            step: The ActivityStep to record.
        """
        with self._lock:
            self._entries.append(step)
            if len(self._entries) > self._max:
                self._entries = self._entries[-self._max:]

    def get_recent(self, agent_id: str | None = None, limit: int = 10) -> list[dict[str, Any]]:
        """
        Returns recent activity steps, optionally filtered by agent.

        Args:
            agent_id: If provided, only return steps for this agent.
            limit:    Maximum number of steps to return.

        Returns:
            List of step dicts, most recent last.
        """
        with self._lock:
            entries = self._entries
            if agent_id:
                entries = [e for e in entries if e.agent_id == agent_id]
            return [
                {
                    "agent_id": e.agent_id,
                    "step": e.step,
                    "total_steps": e.total_steps,
                    "label": e.label,
                    "detail": e.detail,
                    "icon": e.icon,
                    "timestamp": e.timestamp.isoformat(),
                }
                for e in entries[-limit:]
            ]

    def get_current(self, agent_id: str) -> dict[str, Any] | None:
        """
        Returns the most recent step for a specific agent, or None if not found.

        Used to enrich agent card responses with live progress details.

        Args:
            agent_id: The agent to look up.

        Returns:
            Dict with label, detail, step, total_steps, and progress (0-100),
            or None if no steps exist for this agent.
        """
        with self._lock:
            for e in reversed(self._entries):
                if e.agent_id == agent_id:
                    progress = int((e.step / e.total_steps) * 100) if e.total_steps > 0 else 0
                    return {
                        "label": e.label,
                        "detail": e.detail,
                        "step": e.step,
                        "total_steps": e.total_steps,
                        "progress": progress,
                    }
            return None


# Singleton instance shared across scheduler and API
activity_log = ActivityLog()
