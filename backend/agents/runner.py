"""
agents/runner.py - Background agent scheduler and result store for Monet.

Manages periodic agent runs using asyncio tasks, stores suggestions in memory,
and tracks agent runtime state. Designed for a single-process dev environment;
a production deployment would use a task queue (Celery, ARQ, etc.).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Optional

from agents.base import BaseAgent
from agents.email_agent import EmailAgent
from agents.code_agent import CodeAgent
from integrations.composio_client import ComposioClient
from models import Agent, AgentStatus, HistoryEntry, Suggestion

logger = logging.getLogger(__name__)


class AgentRunner:
    """
    Manages background agent execution, suggestion storage, and scheduling.

    All state is in-memory. Suggestions and history are reset on restart.
    Agents run as asyncio background tasks triggered by `schedule_agent`.
    """

    def __init__(self, composio: ComposioClient) -> None:
        """
        Initializes the runner with a shared Composio client.

        Args:
            composio: Composio integration client (stub or live).
        """
        self._composio = composio
        self._suggestions: list[Suggestion] = []
        self._history: list[HistoryEntry] = []
        self._scheduled_tasks: dict[str, asyncio.Task] = {}
        self._agent_state: dict[str, Agent] = {
            "email": Agent(id="email", name="Email Triage", status=AgentStatus.idle),
            "code": Agent(id="code", name="Code Review", status=AgentStatus.idle),
        }

    # --- Public API ---

    async def run_agent(self, agent_type: str) -> list[Suggestion]:
        """
        Runs a single agent by type and stores the resulting suggestions.

        Updates agent status during the run. Appends new suggestions to
        the shared suggestions store, deduplicating by ID.

        Args:
            agent_type: One of 'email' or 'code'.

        Returns:
            List of new Suggestion objects produced by this run.

        Raises:
            ValueError: If agent_type is unknown.
        """
        agent = self._build_agent(agent_type)
        state = self._agent_state.get(agent_type)

        if state:
            state.status = AgentStatus.running

        session_id = f"{agent_type}-{datetime.utcnow().isoformat()}"

        try:
            new_suggestions = await agent.run(session_id)
            self._merge_suggestions(new_suggestions)

            if state:
                state.status = AgentStatus.idle
                state.last_run = datetime.utcnow()
                state.summary = f"Found {len(new_suggestions)} item(s) needing attention."

            logger.info(
                "Agent '%s' completed - %d suggestions", agent_type, len(new_suggestions)
            )
            return new_suggestions

        except Exception as exc:
            if state:
                state.status = AgentStatus.error
                state.summary = f"Error: {exc}"
            logger.exception("Agent '%s' failed: %s", agent_type, exc)
            raise

    def schedule_agent(self, agent_type: str, interval_minutes: float = 15.0) -> None:
        """
        Schedules a recurring background agent run at a fixed interval.

        If an existing scheduled task for this agent type is running,
        it is cancelled and replaced.

        Args:
            agent_type: One of 'email' or 'code'.
            interval_minutes: How often to run the agent, in minutes.
        """
        self._cancel_scheduled(agent_type)
        task = asyncio.create_task(
            self._run_loop(agent_type, interval_minutes),
            name=f"agent-loop-{agent_type}",
        )
        self._scheduled_tasks[agent_type] = task
        logger.info(
            "Scheduled agent '%s' every %.1f minutes", agent_type, interval_minutes
        )

    def get_suggestions(self) -> list[Suggestion]:
        """
        Returns all currently stored suggestions.

        Returns:
            List of Suggestion objects, most recent first.
        """
        return list(reversed(self._suggestions))

    def remove_suggestion(self, suggestion_id: str) -> Optional[Suggestion]:
        """
        Removes and returns a suggestion by ID.

        Used when the user approves or rejects an action.

        Args:
            suggestion_id: The ID of the suggestion to remove.

        Returns:
            The removed Suggestion, or None if not found.
        """
        for i, s in enumerate(self._suggestions):
            if s.id == suggestion_id:
                return self._suggestions.pop(i)
        return None

    def get_agents(self) -> list[Agent]:
        """
        Returns the current runtime state of all registered agents.

        Returns:
            List of Agent state objects.
        """
        return list(self._agent_state.values())

    def add_history(self, entry: HistoryEntry) -> None:
        """
        Appends an entry to the action history log.

        Args:
            entry: The HistoryEntry to record.
        """
        self._history.append(entry)

    def get_history(self, limit: int = 50) -> list[HistoryEntry]:
        """
        Returns recent action history, newest first.

        Args:
            limit: Maximum number of entries to return.

        Returns:
            List of HistoryEntry objects.
        """
        return list(reversed(self._history[-limit:]))

    def stop_all(self) -> None:
        """
        Cancels all scheduled background agent tasks.
        """
        for agent_type in list(self._scheduled_tasks.keys()):
            self._cancel_scheduled(agent_type)
        logger.info("All scheduled agents stopped.")

    # --- Internal Helpers ---

    async def _run_loop(self, agent_type: str, interval_minutes: float) -> None:
        """
        Infinite loop that runs an agent at the given interval.

        Catches and logs exceptions without killing the task.

        Args:
            agent_type: The agent to run on each interval.
            interval_minutes: Seconds between each run (converted internally).
        """
        interval_seconds = interval_minutes * 60
        while True:
            try:
                await self.run_agent(agent_type)
            except Exception:
                logger.exception("Scheduled run of '%s' encountered an error.", agent_type)
            await asyncio.sleep(interval_seconds)

    def _build_agent(self, agent_type: str) -> BaseAgent:
        """
        Constructs an agent instance by type.

        Args:
            agent_type: One of 'email' or 'code'.

        Returns:
            Initialized BaseAgent subclass instance.

        Raises:
            ValueError: If agent_type is not recognized.
        """
        if agent_type == "email":
            return EmailAgent(self._composio)
        if agent_type == "code":
            return CodeAgent(self._composio)
        raise ValueError(f"Unknown agent type: '{agent_type}'")

    def _merge_suggestions(self, new_suggestions: list[Suggestion]) -> None:
        """
        Appends new suggestions, skipping any with duplicate IDs.

        Args:
            new_suggestions: Suggestions produced by the latest agent run.
        """
        existing_ids = {s.id for s in self._suggestions}
        for s in new_suggestions:
            if s.id not in existing_ids:
                self._suggestions.append(s)
                existing_ids.add(s.id)

    def _cancel_scheduled(self, agent_type: str) -> None:
        """
        Cancels the scheduled task for a given agent type if it exists.

        Args:
            agent_type: The agent type whose task should be cancelled.
        """
        task = self._scheduled_tasks.pop(agent_type, None)
        if task and not task.done():
            task.cancel()
