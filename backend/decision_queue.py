"""
decision_queue.py - Thread-safe in-memory decision queue for Monet.

Decisions are the core output of background agents. Each agent run produces
zero or more Decision objects representing actions the user must review.
Decisions sit in the queue until the user approves or skips them.

The queue is in-memory intentionally - a production deployment would persist
to a database (Postgres, Redis, etc.) but in-memory is sufficient for dev.

Singleton pattern: import `decision_queue` directly to use the shared instance.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class Decision:
    """
    A single pending decision produced by a background agent.

    Represents one item the user must act on - e.g. an email reply to approve,
    a PR review to merge, or a planning task to confirm.
    """

    id: str
    """Unique decision ID. Convention: '{agent_id}_{source_id}' e.g. 'email_abc123'."""

    agent_id: str
    """Which agent produced this decision: 'email', 'code', or 'planning'."""

    type: str
    """Decision category: 'email_reply', 'pr_review', 'task_plan'."""

    priority: str
    """User-facing urgency: 'urgent', 'normal', or 'low'."""

    title: str
    """Short label for the decision card header."""

    summary: str
    """One-line description of what needs to be decided."""

    data: dict[str, Any] = field(default_factory=dict)
    """Agent-specific payload (email object, PR details, draft text, etc.)."""

    ui_pattern: str = "tinder"
    """Frontend render pattern: 'tinder' (swipe), 'diff' (code diff), 'whiteboard'."""

    created_at: datetime = field(default_factory=datetime.utcnow)
    """When this decision was created by the agent."""

    resolved: bool = False
    """True once the user has approved or skipped this decision."""

    resolution: str | None = None
    """How it was resolved: 'approved' or 'skipped'."""


class DecisionQueue:
    """
    Thread-safe in-memory store for pending agent decisions.

    Supports add, query, resolve, and dedup operations. All public methods
    acquire a lock to ensure safe concurrent access from the asyncio event
    loop and any threads.
    """

    def __init__(self) -> None:
        """Initializes an empty decision queue with a threading lock."""
        self._decisions: list[Decision] = []
        self._lock = threading.Lock()

    def add(self, decision: Decision) -> None:
        """
        Appends a decision to the queue.

        Silently ignores the addition if a decision with the same ID already
        exists and is not yet resolved (dedup guard).

        Args:
            decision: The Decision object to add.
        """
        with self._lock:
            existing_ids = {d.id for d in self._decisions if not d.resolved}
            if decision.id in existing_ids:
                return
            self._decisions.append(decision)

    def get_pending(self, agent_id: str | None = None) -> list[Decision]:
        """
        Returns all unresolved decisions, optionally filtered by agent.

        Args:
            agent_id: If provided, only returns decisions from this agent.

        Returns:
            List of unresolved Decision objects, newest first.
        """
        with self._lock:
            pending = [d for d in self._decisions if not d.resolved]
            if agent_id:
                pending = [d for d in pending if d.agent_id == agent_id]
            # Return newest first so the frontend shows the most recent work
            return list(reversed(pending))

    def get_pending_count(self, agent_id: str) -> int:
        """
        Returns the count of unresolved decisions for a specific agent.

        Args:
            agent_id: The agent to count decisions for.

        Returns:
            Integer count of pending decisions.
        """
        return len(self.get_pending(agent_id))

    def resolve(self, decision_id: str, resolution: str) -> bool:
        """
        Marks a decision as resolved with the given resolution string.

        Args:
            decision_id: The ID of the decision to resolve.
            resolution: Either 'approved' or 'skipped'.

        Returns:
            True if the decision was found and resolved, False otherwise.
        """
        with self._lock:
            for d in self._decisions:
                if d.id == decision_id:
                    d.resolved = True
                    d.resolution = resolution
                    return True
            return False

    def has_pending_for_source(self, source_id: str) -> bool:
        """
        Checks whether an unresolved decision already exists for a source ID.

        Used to avoid creating duplicate decisions for the same email or PR.
        Checks if any unresolved decision's id ends with the source_id suffix.

        Args:
            source_id: The external resource ID (email message ID, PR number, etc.).

        Returns:
            True if a matching unresolved decision exists.
        """
        with self._lock:
            return any(
                d.id.endswith(f"_{source_id}") and not d.resolved
                for d in self._decisions
            )

    def to_list(self) -> list[dict[str, Any]]:
        """
        Serializes all unresolved decisions to a list of plain dicts.

        Used by the API endpoint to return JSON-serializable data.

        Returns:
            List of dicts representing pending decisions.
        """
        with self._lock:
            return [
                {
                    "id": d.id,
                    "agentId": d.agent_id,
                    "type": d.type,
                    "priority": d.priority,
                    "title": d.title,
                    "summary": d.summary,
                    "data": d.data,
                    "uiPattern": d.ui_pattern,
                    "createdAt": d.created_at.isoformat(),
                    "resolved": d.resolved,
                }
                for d in self._decisions
                if not d.resolved
            ]


# Module-level singleton - import this directly rather than instantiating DecisionQueue
decision_queue = DecisionQueue()
