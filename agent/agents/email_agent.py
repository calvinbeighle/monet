"""
agents/email_agent.py

Email agent for Monet OS.
Handles inbox triage, email drafting, and sending via Gmail tooling.

Approval gates are inserted before any send_email call to prevent
accidental sends without explicit user confirmation.

UI pattern: TINDER (swipe-to-act card stack for inbox items)
"""

from __future__ import annotations

import uuid
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
                "total_unread": 5,
                "emails": [
                    {
                        "id": "msg_001",
                        "subject": "Q1 investor update - need your eyes on this draft",
                        "from": "sarah.chen@sequoia.com",
                        "from_name": "Sarah Chen",
                        "date": "2026-03-29T09:15:00Z",
                        "snippet": "Hey, wanted to get your review before we circulate to the full LP list. A few sections need tightening...",
                        "unread": True,
                        "labels": ["INBOX", "IMPORTANT"],
                    },
                    {
                        "id": "msg_002",
                        "subject": "Re: enterprise pricing - follow-up from our call",
                        "from": "marcus.obi@acmecorp.com",
                        "from_name": "Marcus Obi",
                        "date": "2026-03-29T08:47:00Z",
                        "snippet": "Thanks for the breakdown. My main concern is the per-seat model for teams over 50. Can we get on a quick call Thursday?",
                        "unread": True,
                        "labels": ["INBOX"],
                    },
                    {
                        "id": "msg_003",
                        "subject": "Intro: Jared <> David Park (Stripe BD)",
                        "from": "alex@mutualbff.com",
                        "from_name": "Alex Rivera",
                        "date": "2026-03-29T07:30:00Z",
                        "snippet": "Jared, meet David. David, meet Jared. David runs BD partnerships at Stripe and is exploring integrations in the AI-native space...",
                        "unread": True,
                        "labels": ["INBOX"],
                    },
                    {
                        "id": "msg_004",
                        "subject": "Legal: NDA from Benchmark for diligence materials",
                        "from": "noreply@docusign.com",
                        "from_name": "DocuSign",
                        "date": "2026-03-28T22:10:00Z",
                        "snippet": "You have a document to review and sign. Sent by: Benchmark Capital. Please sign by March 31, 2026...",
                        "unread": True,
                        "labels": ["INBOX"],
                    },
                    {
                        "id": "msg_005",
                        "subject": "Re: Re: hiring - senior eng candidate feedback",
                        "from": "priya.nair@gmail.com",
                        "from_name": "Priya Nair",
                        "date": "2026-03-28T17:55:00Z",
                        "snippet": "Loop assessment results are in. Strong on systems design, mixed on the take-home. I'd say move forward with an offer but let's discuss comp...",
                        "unread": False,
                        "labels": ["INBOX"],
                    },
                ],
            }

        if tool_name == "read_email":
            message_id = tool_input.get("message_id", "msg_001")
            # Return realistic body based on which message is requested
            bodies: dict[str, dict[str, Any]] = {
                "msg_001": {
                    "id": "msg_001",
                    "subject": "Q1 investor update - need your eyes on this draft",
                    "from": "sarah.chen@sequoia.com",
                    "from_name": "Sarah Chen",
                    "date": "2026-03-29T09:15:00Z",
                    "body": (
                        "Hey Jared,\n\n"
                        "Attaching the Q1 LP update draft for your review. Main sections:\n\n"
                        "1. Revenue - ARR grew 3.2x YoY. I think you undersell the NRR story here. Let's sharpen that.\n"
                        "2. Product - the agent OS positioning is still a bit jargon-heavy for a general LP audience.\n"
                        "3. Team - you added two engineers but didn't mention the CTO search. Should we include?\n"
                        "4. Outlook - conservative on the H1 targets given market. Benchmark will push on this.\n\n"
                        "Would love a redline back by EOD Thursday if possible. I want to circulate before the weekend.\n\n"
                        "- Sarah"
                    ),
                    "thread_id": "thread_001",
                },
                "msg_002": {
                    "id": "msg_002",
                    "subject": "Re: enterprise pricing - follow-up from our call",
                    "from": "marcus.obi@acmecorp.com",
                    "from_name": "Marcus Obi",
                    "date": "2026-03-29T08:47:00Z",
                    "body": (
                        "Jared,\n\n"
                        "Thanks for the time yesterday - really helpful context on the roadmap.\n\n"
                        "Main sticking point for our team: the per-seat pricing gets painful at scale. "
                        "We have 80 people who'd realistically use this, but only 20 are power users. "
                        "Is there a tiered or usage-based model we could explore?\n\n"
                        "Also flagging that our procurement team needs SOC 2 Type II before any contract. "
                        "Timeline on that?\n\n"
                        "Happy to jump on a 20-minute call Thursday afternoon if that works.\n\n"
                        "Marcus"
                    ),
                    "thread_id": "thread_002",
                },
            }
            default_body = {
                "id": message_id,
                "subject": "Email content",
                "from": "sender@example.com",
                "from_name": "Sender",
                "date": "2026-03-29T08:00:00Z",
                "body": "This is a stub email body. No message found with that ID.",
                "thread_id": f"thread_{message_id}",
            }
            return bodies.get(message_id, default_body)

        if tool_name == "draft_email":
            to = tool_input.get("to", "recipient@example.com")
            subject = tool_input.get("subject", "(no subject)")
            return {
                "draft_id": f"draft_{uuid.uuid4().hex[:8]}",
                "status": "saved",
                "to": to,
                "subject": subject,
                "message": f"Draft saved to Drafts folder. Ready to review before sending.",
            }

        if tool_name == "send_email":
            to = tool_input.get("to", "recipient@example.com")
            subject = tool_input.get("subject", "(no subject)")
            return {
                "message_id": f"sent_{uuid.uuid4().hex[:8]}",
                "status": "sent",
                "to": to,
                "subject": subject,
                "message": f"Email sent successfully to {to}.",
            }

        return {"error": f"Unknown tool: {tool_name}"}
