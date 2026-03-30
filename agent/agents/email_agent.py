"""
agents/email_agent.py

Email agent for Monet OS.
Handles inbox triage, email drafting, and sending via Gmail tooling.

Approval gates are inserted before any send_email call to prevent
accidental sends without explicit user confirmation.

UI pattern: TINDER (swipe-to-act card stack for inbox items)
"""

from __future__ import annotations

from typing import Any

from models import AgentType
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
You are Monet's email assistant - a calm, efficient inbox copilot for a busy founder.

Your job is to help the user stay on top of their email with minimal friction:
- Triage unread messages by urgency and relevance
- Draft clear, professional replies that match the user's voice
- Flag anything that needs immediate attention
- Suggest when to defer, delegate, or archive

Guidelines:
- Be concise. Founders are busy. Get to the point.
- Preserve the user's tone when drafting replies - don't be overly formal or casual.
- Always confirm the recipient and content before sending.
- Never send an email without explicit user approval.
- If you are unsure about intent, ask one clarifying question.
- Prioritize action items and time-sensitive emails.

When listing emails, present them as a prioritized stack with the most urgent first.
""".strip()


class EmailAgent(BaseAgent):
    """
    Agent for handling Gmail inbox triage, drafting, and sending.

    Uses the TINDER UI pattern - emails are presented as a swipe-to-act
    card stack in the frontend. Approval gates are inserted before send_email.
    """

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
        Execute a Gmail tool call.

        Currently stub implementations - replace with real Gmail API calls
        when the Gmail OAuth integration is wired up.

        Args:
            tool_name: The Gmail tool to execute.
            tool_input: Structured arguments for the tool.

        Returns:
            Any: Simulated tool result.
        """
        if tool_name == "list_emails":
            return {
                "emails": [
                    {
                        "id": "stub_001",
                        "subject": "Q4 investor update - draft review needed",
                        "from": "partner@vc.com",
                        "date": "2026-03-29T09:00:00Z",
                        "snippet": "Hey, wanted to get your eyes on the draft before...",
                        "unread": True,
                    },
                    {
                        "id": "stub_002",
                        "subject": "Re: pricing feedback",
                        "from": "customer@acme.com",
                        "date": "2026-03-29T08:30:00Z",
                        "snippet": "Thanks for jumping on the call. Here are my thoughts...",
                        "unread": True,
                    },
                ]
            }

        if tool_name == "read_email":
            message_id = tool_input.get("message_id", "")
            return {
                "id": message_id,
                "subject": "[stub] Email content",
                "from": "sender@example.com",
                "body": "This is a stub email body. Connect Gmail API to see real content.",
            }

        if tool_name == "draft_email":
            return {
                "draft_id": "draft_stub_001",
                "status": "saved",
                "message": "Draft saved successfully (stub).",
            }

        if tool_name == "send_email":
            return {
                "message_id": "sent_stub_001",
                "status": "sent",
                "message": "Email sent successfully (stub).",
            }

        return f"[stub] Unknown tool: {tool_name}"
