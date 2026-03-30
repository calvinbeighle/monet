"""
email_agent.py - Email triage background agent for Monet.

Uses Claude Haiku (cheap, fast) via the Anthropic SDK to scan the inbox
and identify emails that need action. Produces Suggestion objects for each
actionable email.

Tool definitions use Anthropic format (input_schema, not parameters).
Tool results are stripped to slim payloads (subject, sender, preview only)
to avoid passing full HTML email bodies to the model context.
"""

from __future__ import annotations

import uuid
from typing import Any

import config
from agents.base import BaseAgent
from integrations.composio_client import ComposioClient
from models import Suggestion, UiPattern


# Maximum number of emails to fetch per agent run
MAX_EMAILS = 5

# Maximum characters for the email body preview
PREVIEW_MAX_CHARS = 200


class EmailAgent(BaseAgent):
    """
    Background agent that triages the Gmail inbox.

    Runs on a schedule, fetches recent emails via Composio/Gmail,
    and produces Suggestion objects for emails needing a reply or action.

    Uses claude-haiku-4-5 (cheap, fast) since email triage runs frequently
    and does not require deep reasoning.
    """

    def __init__(self, composio: ComposioClient) -> None:
        """
        Initializes the EmailAgent with a Composio client.

        Args:
            composio: The Composio integration client (stub or live).
        """
        self._composio = composio

    @property
    def agent_id(self) -> str:
        return "email"

    @property
    def model(self) -> str:
        return config.EMAIL_MODEL

    @property
    def tools(self) -> list[dict[str, Any]]:
        """
        Anthropic-format tool definitions for Gmail operations.

        Uses input_schema (Anthropic format) instead of OpenAI-style parameters.

        Returns:
            List of tool spec dicts for list_emails, read_email, and draft_email.
        """
        return [
            {
                "name": "list_emails",
                "description": (
                    "List recent unread emails from Gmail. "
                    f"Returns at most {MAX_EMAILS} emails with slim payloads "
                    "(subject, sender, preview only - no full bodies)."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "max_results": {
                            "type": "integer",
                            "description": f"Number of emails to fetch (max {MAX_EMAILS}).",
                        },
                        "query": {
                            "type": "string",
                            "description": "Gmail search query string (e.g. 'is:unread').",
                        },
                    },
                    "required": [],
                },
            },
            {
                "name": "read_email",
                "description": "Read the content of a specific email by ID.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "email_id": {
                            "type": "string",
                            "description": "The Gmail message ID.",
                        },
                    },
                    "required": ["email_id"],
                },
            },
            {
                "name": "draft_email",
                "description": "Create a draft reply to an email.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "to": {
                            "type": "string",
                            "description": "Recipient email address.",
                        },
                        "subject": {
                            "type": "string",
                            "description": "Email subject line.",
                        },
                        "body": {
                            "type": "string",
                            "description": "Email body text.",
                        },
                        "thread_id": {
                            "type": "string",
                            "description": "Optional Gmail thread ID to reply in.",
                        },
                    },
                    "required": ["to", "subject", "body"],
                },
            },
        ]

    async def run(self, session_id: str) -> list[Suggestion]:
        """
        Runs the email triage agent for one cycle.

        Fetches unread emails, evaluates each for required action,
        and returns a list of Suggestion objects for emails needing a reply.

        Args:
            session_id: The ID of the current agent session.

        Returns:
            List of Suggestion objects, one per actionable email.
        """
        emails = await self._fetch_emails()
        suggestions: list[Suggestion] = []

        for email in emails:
            suggestion = _email_to_suggestion(email, self.agent_id)
            suggestions.append(suggestion)

        return suggestions

    async def _execute_tool(self, tool_name: str, tool_input: dict[str, Any]) -> Any:
        """
        Routes tool calls to the Composio Gmail integration.

        Strips results to slim payloads before returning to the model to
        avoid flooding the context window with full email bodies.

        Args:
            tool_name: One of 'list_emails', 'read_email', 'draft_email'.
            tool_input: Arguments for the tool.

        Returns:
            Slim result dict or list safe for model context.

        Raises:
            ValueError: If an unknown tool name is provided.
        """
        if tool_name == "list_emails":
            result = await self._composio.execute_tool("GMAIL_LIST_MESSAGES", tool_input)
            return _slim_email_list(result)

        if tool_name == "read_email":
            result = await self._composio.execute_tool("GMAIL_GET_MESSAGE", tool_input)
            return _slim_email_detail(result)

        if tool_name == "draft_email":
            return await self._composio.execute_tool("GMAIL_CREATE_DRAFT", tool_input)

        raise ValueError(f"Unknown tool: {tool_name}")

    async def _fetch_emails(self) -> list[dict[str, Any]]:
        """
        Fetches and slims the raw email list from Composio/Gmail.

        Returns:
            List of slim email dicts with 'id', 'subject', 'sender', 'preview'.
        """
        raw = await self._composio.execute_tool(
            "GMAIL_LIST_MESSAGES",
            {"max_results": MAX_EMAILS, "query": "is:unread"},
        )
        return _slim_email_list(raw)


# --- Data Shaping Helpers ---

def _slim_email_list(raw: Any) -> list[dict[str, Any]]:
    """
    Strips a Gmail message list response to slim objects.

    Keeps only id, subject, sender, and a short preview to avoid
    sending full message bodies to the LLM context.

    Args:
        raw: Raw response from Composio GMAIL_LIST_MESSAGES.

    Returns:
        List of slim email dicts.
    """
    if not isinstance(raw, (list, dict)):
        return _stub_email_list()

    messages = raw if isinstance(raw, list) else raw.get("messages", [])

    slim: list[dict[str, Any]] = []
    for msg in messages[:MAX_EMAILS]:
        if not isinstance(msg, dict):
            continue
        slim.append({
            "id": msg.get("id", str(uuid.uuid4())),
            "subject": msg.get("subject", "(no subject)"),
            "sender": msg.get("from", msg.get("sender", "unknown")),
            "preview": _truncate(msg.get("snippet", msg.get("body", "")), PREVIEW_MAX_CHARS),
        })

    return slim if slim else _stub_email_list()


def _slim_email_detail(raw: Any) -> dict[str, Any]:
    """
    Strips a single Gmail message response to a slim object.

    Args:
        raw: Raw response from Composio GMAIL_GET_MESSAGE.

    Returns:
        Slim email dict with id, subject, sender, and preview.
    """
    if not isinstance(raw, dict):
        return {"error": "Could not read email."}

    return {
        "id": raw.get("id", ""),
        "subject": raw.get("subject", "(no subject)"),
        "sender": raw.get("from", "unknown"),
        "preview": _truncate(raw.get("snippet", raw.get("body", "")), PREVIEW_MAX_CHARS),
    }


def _stub_email_list() -> list[dict[str, Any]]:
    """
    Returns a hardcoded stub email list for use when Composio is in stub mode.

    Returns:
        List of mock slim email dicts.
    """
    return [
        {
            "id": "stub-email-1",
            "subject": "Q1 investor update - need your input",
            "sender": "partner@vcfirm.com",
            "preview": "Hey, can you send over the Q1 metrics before the board meeting on Friday?",
        },
        {
            "id": "stub-email-2",
            "subject": "Follow up: product demo",
            "sender": "cto@prospect.io",
            "preview": "Really enjoyed the demo. A few technical questions before we move forward...",
        },
        {
            "id": "stub-email-3",
            "subject": "Contract renewal - action required",
            "sender": "legal@vendor.com",
            "preview": "Your contract expires in 14 days. Please review and sign the attached renewal.",
        },
    ]


def _email_to_suggestion(email: dict[str, Any], agent_id: str) -> Suggestion:
    """
    Converts a slim email dict into a Suggestion object.

    Args:
        email: Slim email dict with id, subject, sender, preview.
        agent_id: The agent that produced this suggestion.

    Returns:
        A Suggestion ready to be surfaced in the UI.
    """
    return Suggestion(
        icon="Mail",
        iconColor="text-blue-400",
        title=email.get("subject", "(no subject)"),
        description=f"From {email.get('sender', 'unknown')} - {email.get('preview', '')}",
        uiPattern=UiPattern.detail,
        agentId=agent_id,
        metadata={
            "email_id": email.get("id"),
            "sender": email.get("sender"),
            "subject": email.get("subject"),
        },
    )


def _truncate(text: str, max_chars: int) -> str:
    """
    Truncates a string to a maximum character length, appending ellipsis if cut.

    Args:
        text: Input string.
        max_chars: Maximum allowed characters.

    Returns:
        Truncated string.
    """
    if not text:
        return ""
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "..."
