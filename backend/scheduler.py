"""
scheduler.py - Background agent scheduler for Monet.

Runs email and code agents on a fixed schedule using asyncio tasks.
Each agent run fetches real data (or stub data in dev), generates drafts
via Claude Haiku, and pushes Decision objects into the decision_queue.

This is the mechanism that ensures Monet has pre-staged decisions waiting
for the user when they open the app - agents run silently in the background
and surface results only when human input is needed.

Schedule:
  - Email Agent: every 15 minutes
  - Code Agent: every 30 minutes
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger("monet.scheduler")


class AgentScheduler:
    """
    Manages recurring background agent runs using asyncio tasks.

    Each agent runs in its own infinite loop, sleeping between runs.
    Errors within a single run are caught and logged without killing the loop.
    Call start() once during app startup and stop() during shutdown.
    """

    # Intervals in seconds - these match the product spec
    _SCHEDULES: dict[str, int] = {
        "email": 15 * 60,  # 15 minutes
        "code": 30 * 60,   # 30 minutes
    }

    def __init__(self) -> None:
        """Initializes the scheduler with empty task and run-time tracking dicts."""
        self._tasks: dict[str, asyncio.Task] = {}
        self._last_run: dict[str, datetime] = {}
        self._is_running: dict[str, bool] = {k: False for k in self._SCHEDULES}

    async def start(self) -> None:
        """
        Starts all scheduled agent loops as asyncio background tasks.

        Each agent gets its own task so they run independently and failures
        in one do not affect the other.
        """
        for agent_id, interval in self._SCHEDULES.items():
            self._tasks[agent_id] = asyncio.create_task(
                self._run_loop(agent_id, interval),
                name=f"scheduler-{agent_id}",
            )
            logger.info("Scheduler: started '%s' agent (interval=%ds)", agent_id, interval)

    async def stop(self) -> None:
        """
        Cancels all running scheduler tasks gracefully.

        Called during app shutdown to clean up asyncio tasks.
        """
        for agent_id, task in self._tasks.items():
            if not task.done():
                task.cancel()
                logger.info("Scheduler: cancelled '%s' agent task", agent_id)
        self._tasks.clear()

    def is_running(self, agent_id: str) -> bool:
        """
        Returns whether the named agent is actively executing right now.

        Args:
            agent_id: The agent identifier ('email' or 'code').

        Returns:
            True if the agent is mid-run, False if sleeping or not started.
        """
        return self._is_running.get(agent_id, False)

    def get_last_run(self, agent_id: str) -> datetime | None:
        """
        Returns the last time the named agent successfully completed a run.

        Args:
            agent_id: The agent identifier.

        Returns:
            Datetime of last successful run, or None if never run.
        """
        return self._last_run.get(agent_id)

    # --- Internal ---

    async def _run_loop(self, agent_id: str, interval: int) -> None:
        """
        Infinite loop that runs an agent, sleeps, then repeats.

        Exceptions within a single run are caught, logged, and swallowed -
        they do not terminate the loop. The next run will still happen on
        schedule.

        Args:
            agent_id: Which agent to run on each iteration.
            interval: Seconds to sleep between runs.
        """
        while True:
            try:
                self._is_running[agent_id] = True
                await self._dispatch(agent_id)
                self._last_run[agent_id] = datetime.utcnow()
            except asyncio.CancelledError:
                # Task was cancelled during shutdown - propagate to stop the loop
                raise
            except Exception as exc:
                logger.error("Scheduler: agent '%s' run failed: %s", agent_id, exc, exc_info=True)
            finally:
                self._is_running[agent_id] = False

            await asyncio.sleep(interval)

    async def _dispatch(self, agent_id: str) -> None:
        """
        Dispatches a single agent run by agent ID.

        Args:
            agent_id: One of 'email' or 'code'.
        """
        if agent_id == "email":
            await _run_email_agent()
        elif agent_id == "code":
            await _run_code_agent()
        else:
            logger.warning("Scheduler: unknown agent_id '%s', skipping", agent_id)


# --- Agent Run Functions ---

async def _run_email_agent() -> None:
    """
    Fetches recent emails and drafts a reply for each, pushing Decisions to the queue.

    Steps:
    1. Fetch 5 most recent emails via Composio/Gmail
    2. For each email not already in the queue, draft a reply using Claude Haiku
    3. Push a Decision to decision_queue for each email

    Skips emails that already have an unresolved decision to avoid duplicates.
    """
    import anthropic
    import config
    from decision_queue import decision_queue, Decision
    from integrations.composio_client import ComposioClient

    composio = ComposioClient()
    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)

    # Reuse the _extract_emails helper from main to normalize Composio responses
    from main import _extract_emails

    logger.info("Scheduler: email agent - fetching inbox")

    raw = await composio.execute_tool("GMAIL_FETCH_EMAILS", {"max_results": 5})
    emails = _extract_emails(raw)

    if not emails:
        logger.info("Scheduler: email agent - no emails found")
        return

    new_decisions = 0
    for email in emails:
        email_id = email.get("id", "")
        if not email_id:
            continue

        # Skip if we already have an unresolved decision for this email
        if decision_queue.has_pending_for_source(email_id):
            continue

        draft = await _draft_email_reply(client, email)
        priority = _infer_email_priority(email)

        sender_name = email["sender"].split("<")[0].strip() or email["sender"]

        decision_queue.add(Decision(
            id=f"email_{email_id}",
            agent_id="email",
            type="email_reply",
            priority=priority,
            title=f"Reply to {sender_name}",
            summary=email["subject"],
            data={
                "email": email,
                "draft": draft,
            },
            ui_pattern="tinder",
        ))
        new_decisions += 1

    logger.info("Scheduler: email agent - pushed %d new decisions", new_decisions)


async def _draft_email_reply(client: Any, email: dict[str, Any]) -> str:
    """
    Uses Claude Haiku to draft a brief professional reply to an email.

    Args:
        client: Initialized anthropic.Anthropic client.
        email: Normalized email dict with sender, subject, body fields.

    Returns:
        Draft reply text string (2-4 sentences).
    """
    import config

    prompt = (
        "Draft a brief, professional reply to this email. "
        "Write only the reply body text - no greeting, no sign-off. "
        "2-4 sentences max.\n\n"
        f"From: {email['sender']}\n"
        f"Subject: {email['subject']}\n"
        f"Body: {email['body'][:500]}"
    )

    resp = client.messages.create(
        model=config.HAIKU_MODEL,
        max_tokens=300,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.content[0].text.strip()


def _infer_email_priority(email: dict[str, Any]) -> str:
    """
    Infers decision priority from email subject/sender heuristics.

    Looks for urgency signals: words like 'urgent', 'asap', 'action required',
    or sender patterns like '@board' or 'investor'. Falls back to 'normal'.

    Args:
        email: Normalized email dict.

    Returns:
        'urgent', 'normal', or 'low'.
    """
    combined = (
        (email.get("subject") or "").lower()
        + " "
        + (email.get("body") or "")[:100].lower()
    )
    urgent_signals = ["urgent", "asap", "action required", "immediately", "deadline", "board", "investor"]
    if any(sig in combined for sig in urgent_signals):
        return "urgent"
    return "normal"


async def _run_code_agent() -> None:
    """
    Checks open GitHub PRs and creates review decisions.

    Currently a stub - the real implementation would call Composio GitHub tools
    to list open PRs, run a code review via Claude Sonnet, and push Decisions.
    The structure mirrors _run_email_agent() for consistency.
    """
    logger.info("Scheduler: code agent - checking PRs (stub)")
    # TODO: integrate Composio GitHub PR listing + Claude Sonnet code review
    # Pattern:
    # 1. composio.execute_tool("GITHUB_LIST_PULL_REQUESTS", {...})
    # 2. For each new PR, run Claude Sonnet code review
    # 3. decision_queue.add(Decision(id=f"pr_{pr_number}", agent_id="code", ...))
