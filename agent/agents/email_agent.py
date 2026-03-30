"""
agents/email_agent.py

Email agent for Monet OS.
Handles inbox triage, email drafting, and sending via Gmail tooling.

Approval gates are inserted before any send_email call to prevent
accidental sends without explicit user confirmation.

UI pattern: TINDER (swipe-to-act card stack for inbox items)

When COMPOSIO_API_KEY is set and the user has connected Gmail, tool calls
are routed through GmailIntegration which delegates to the real Composio
Gmail actions. When no key is set, GmailIntegration falls back to stubs.
"""

from __future__ import annotations

import uuid
from typing import Any

from models import AgentType
from integrations.gmail import GmailIntegration
from .base import BaseAgent


# Tools that require a human approval gate before execution
_APPROVAL_REQUIRED_TOOLS = frozenset({"send_email"})

# Gmail tool definitions in OpenAI function format (used by OpenRouter)
_EMAIL_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "list_emails",
            "description": (
                "List emails from the user's Gmail inbox. "
                "Returns a list of email summaries with id, subject, sender, date, and snippet."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of emails to return. Default 10.",
                        "default": 10,
                    },
                    "label": {
                        "type": "string",
                        "description": "Gmail label to filter by (e.g. INBOX, STARRED, UNREAD).",
                        "default": "INBOX",
                    },
                    "query": {
                        "type": "string",
                        "description": "Optional Gmail search query string (e.g. 'from:boss@company.com').",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_email",
            "description": "Read the full content of a specific email by its Gmail message ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message_id": {
                        "type": "string",
                        "description": "The Gmail message ID of the email to read.",
                    },
                },
                "required": ["message_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "draft_email",
            "description": (
                "Create a draft email. Does NOT send it - only saves to Drafts folder. "
                "Use send_email to actually send."
            ),
            "parameters": {
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
                        "description": "Email body text (plain text or HTML).",
                    },
                    "reply_to_id": {
                        "type": "string",
                        "description": "Optional Gmail message ID this is a reply to.",
                    },
                },
                "required": ["to", "subject", "body"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_email",
            "description": (
                "Send an email via Gmail. "
                "IMPORTANT: This action requires explicit user approval before execution."
            ),
            "parameters": {
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
                        "description": "Email body text (plain text or HTML).",
                    },
                    "reply_to_id": {
                        "type": "string",
                        "description": "Optional Gmail message ID this is a reply to.",
                    },
                },
                "required": ["to", "subject", "body"],
            },
        },
    },
]

_SYSTEM_PROMPT = """
You are Monet's email assistant. You handle the user's inbox end-to-end.

When the user says "handle my inbox" or similar, follow this EXACT flow:
1. Call list_emails to get unread emails
2. For EACH email that needs a response, call read_email to get the full body
3. For EACH email that needs a response, call draft_email with a ready-to-send reply
4. Skip emails that don't need replies (newsletters, alerts, notifications) but still list them

For draft replies:
- Write as the user (first person, matching their tone)
- Be concise and professional
- Include the reply_to_id so it threads correctly
- The reply should be COMPLETE and ready to send as-is

Do NOT just summarize the inbox. Actually draft replies for every actionable email.
Do NOT ask the user what to do. Just draft the best reply for each email.
The user will review and approve/edit each draft in the UI before anything sends.

Never send an email without explicit user approval via the send_email tool.
""".strip()


class EmailAgent(BaseAgent):
    """
    Agent for handling Gmail inbox triage, drafting, and sending.

    Uses the TINDER UI pattern - emails are presented as a swipe-to-act
    card stack in the frontend. Approval gates are inserted before send_email.

    GmailIntegration handles the live/stub decision internally - when
    COMPOSIO_API_KEY is set and the user has connected Gmail, real Gmail
    data is returned. Otherwise, realistic stub data is used.
    """

    def __init__(self, session: Any) -> None:
        super().__init__(session)
        # GmailIntegration checks COMPOSIO_API_KEY internally and falls
        # back to stubs automatically when the key is absent.
        self._gmail = GmailIntegration(user_id="default")

    @property
    def agent_type(self) -> AgentType:
        return AgentType.EMAIL

    @property
    def system_prompt(self) -> str:
        return _SYSTEM_PROMPT

    @property
    def tools(self) -> list[dict[str, Any]]:
        return _EMAIL_TOOLS

    def requires_approval(self, tool_name: str) -> bool:
        """
        Require approval before sending any email.

        Args:
            tool_name: Name of the tool the LLM wants to invoke.

        Returns:
            bool: True only for send_email.
        """
        return tool_name in _APPROVAL_REQUIRED_TOOLS

    async def _execute_tool(
        self, tool_name: str, tool_input: dict[str, Any]
    ) -> Any:
        """
        Execute a Gmail tool call via GmailIntegration.

        GmailIntegration routes to real Composio Gmail actions when
        COMPOSIO_API_KEY is set, or returns stub data otherwise.

        Args:
            tool_name: The Gmail tool to execute.
            tool_input: Structured arguments for the tool.

        Returns:
            Any: Tool result from Gmail (live) or stub data.
        """
        if tool_name == "list_emails":
            return self._gmail.list_messages(
                max_results=tool_input.get("max_results", 10),
                label=tool_input.get("label", "INBOX"),
                query=tool_input.get("query"),
            )

        if tool_name == "read_email":
            message_id = tool_input.get("message_id", "")
            if not message_id:
                return {"error": "message_id is required for read_email"}
            return self._gmail.read_message(message_id)

        if tool_name == "draft_email":
            return self._gmail.draft_reply(
                to=tool_input.get("to", ""),
                subject=tool_input.get("subject", "(no subject)"),
                body=tool_input.get("body", ""),
                reply_to_id=tool_input.get("reply_to_id"),
            )

        if tool_name == "send_email":
            return self._gmail.send_email(
                to=tool_input.get("to", ""),
                subject=tool_input.get("subject", "(no subject)"),
                body=tool_input.get("body", ""),
                reply_to_id=tool_input.get("reply_to_id"),
            )

        return {"error": f"Unknown tool: {tool_name}"}
