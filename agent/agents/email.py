"""Email agent - handles Gmail operations via Nango integration."""

import json
import logging
import os
from typing import Optional

import httpx

from agent.agents.base import BaseAgent
from agent.models import UIPattern

logger = logging.getLogger(__name__)

NANGO_BASE_URL = os.environ.get("NANGO_BASE_URL", "https://api.nango.dev")
NANGO_SECRET_KEY = os.environ.get("NANGO_SECRET_KEY", "")
NANGO_CONNECTION_ID = os.environ.get("NANGO_GMAIL_CONNECTION_ID", "gmail-default")


def _nango_headers() -> dict:
    return {
        "Authorization": f"Bearer {NANGO_SECRET_KEY}",
        "Content-Type": "application/json",
    }


class EmailAgent(BaseAgent):
    """Agent for email operations - reading, drafting, sending, organizing.

    Uses Nango's Gmail integration for OAuth and API access.
    When processing a batch (inbox triage), produces one draft per email
    and marks each as pending_approval before sending.
    """

    name = "email"
    default_ui_pattern = UIPattern.TINDER

    @property
    def system_prompt(self) -> str:
        return (
            "You are Monet's email assistant. You help users manage their Gmail inbox.\n\n"
            "When handling a batch of emails (inbox triage):\n"
            "- Read each unread email\n"
            "- Draft a reply for each one\n"
            "- Present each draft for user approval before sending\n"
            "- Mark processed emails appropriately\n\n"
            "When handling a single email:\n"
            "- Read the full thread for context\n"
            "- Draft a thoughtful reply\n"
            "- Wait for user approval before sending\n\n"
            "Always use the tools provided. Never fabricate email content or metadata.\n"
            "The send_email and archive_email tools require user approval - the system\n"
            "will pause and ask the user before executing these."
        )

    @property
    def tools(self) -> list[dict]:
        return [
            {
                "name": "list_inbox",
                "description": "List recent emails from the user's Gmail inbox. Returns subject, sender, date, and message ID for each email.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum number of emails to return (default 20)",
                            "default": 20,
                        },
                        "unread_only": {
                            "type": "boolean",
                            "description": "If true, only return unread emails",
                            "default": False,
                        },
                    },
                    "required": [],
                },
            },
            {
                "name": "read_email",
                "description": "Read the full content of a specific email by message ID. Returns subject, from, to, date, and body.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "message_id": {
                            "type": "string",
                            "description": "The Gmail message ID",
                        },
                    },
                    "required": ["message_id"],
                },
            },
            {
                "name": "draft_reply",
                "description": "Create a draft reply to an email. Does NOT send - just creates the draft for review.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "message_id": {
                            "type": "string",
                            "description": "The message ID to reply to",
                        },
                        "body": {
                            "type": "string",
                            "description": "The reply body text",
                        },
                    },
                    "required": ["message_id", "body"],
                },
            },
            {
                "name": "send_email",
                "description": "Send an email or a draft reply. REQUIRES USER APPROVAL.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "to": {
                            "type": "string",
                            "description": "Recipient email address",
                        },
                        "subject": {
                            "type": "string",
                            "description": "Email subject line",
                        },
                        "body": {
                            "type": "string",
                            "description": "Email body text",
                        },
                        "reply_to_message_id": {
                            "type": "string",
                            "description": "If replying, the original message ID",
                        },
                    },
                    "required": ["to", "subject", "body"],
                },
            },
            {
                "name": "archive_email",
                "description": "Archive an email (remove from inbox). REQUIRES USER APPROVAL.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "message_id": {
                            "type": "string",
                            "description": "The message ID to archive",
                        },
                    },
                    "required": ["message_id"],
                },
            },
            {
                "name": "label_email",
                "description": "Add or remove a label from an email.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "message_id": {
                            "type": "string",
                            "description": "The message ID",
                        },
                        "label": {
                            "type": "string",
                            "description": "Label name to add",
                        },
                        "action": {
                            "type": "string",
                            "description": "Either 'add' or 'remove'",
                            "enum": ["add", "remove"],
                            "default": "add",
                        },
                    },
                    "required": ["message_id", "label"],
                },
            },
        ]

    @property
    def approval_required(self) -> set[str]:
        return {"send_email", "archive_email"}

    @property
    def suggestions(self) -> list[str]:
        return ["Check inbox", "Draft a reply", "Send a follow-up", "Archive thread"]

    def execute_tool(self, tool_name: str, parameters: dict) -> str:
        """Execute a Gmail tool via Nango proxy API."""
        try:
            handler = getattr(self, f"_tool_{tool_name}", None)
            if handler is None:
                return json.dumps({"error": f"Unknown tool: {tool_name}"})
            return handler(parameters)
        except Exception as e:
            logger.error("Tool execution failed: %s(%s) - %s", tool_name, parameters, e)
            return json.dumps({"error": str(e)})

    def _tool_list_inbox(self, params: dict) -> str:
        """List inbox emails via Nango Gmail proxy."""

        max_results = params.get("max_results", 20)
        unread_only = params.get("unread_only", False)

        query = "in:inbox"
        if unread_only:
            query += " is:unread"

        resp = httpx.get(
            f"{NANGO_BASE_URL}/v1/gmail/messages",
            headers=_nango_headers(),
            params={
                "connectionId": NANGO_CONNECTION_ID,
                "q": query,
                "maxResults": max_results,
            },
            timeout=30,
        )
        resp.raise_for_status()
        return resp.text

    def _tool_read_email(self, params: dict) -> str:
        """Read a specific email via Nango Gmail proxy."""

        message_id = params["message_id"]
        resp = httpx.get(
            f"{NANGO_BASE_URL}/v1/gmail/messages/{message_id}",
            headers=_nango_headers(),
            params={"connectionId": NANGO_CONNECTION_ID},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.text

    def _tool_draft_reply(self, params: dict) -> str:
        """Create a draft reply via Nango Gmail proxy."""

        resp = httpx.post(
            f"{NANGO_BASE_URL}/v1/gmail/drafts",
            headers=_nango_headers(),
            json={
                "connectionId": NANGO_CONNECTION_ID,
                "replyToMessageId": params["message_id"],
                "body": params["body"],
            },
            timeout=30,
        )
        resp.raise_for_status()
        return resp.text

    def _tool_send_email(self, params: dict) -> str:
        """Send an email via Nango Gmail proxy."""

        payload: dict = {
            "connectionId": NANGO_CONNECTION_ID,
            "to": params["to"],
            "subject": params["subject"],
            "body": params["body"],
        }
        if params.get("reply_to_message_id"):
            payload["replyToMessageId"] = params["reply_to_message_id"]

        resp = httpx.post(
            f"{NANGO_BASE_URL}/v1/gmail/messages/send",
            headers=_nango_headers(),
            json=payload,
            timeout=30,
        )
        resp.raise_for_status()
        return resp.text

    def _tool_archive_email(self, params: dict) -> str:
        """Archive an email via Nango Gmail proxy."""

        message_id = params["message_id"]
        resp = httpx.post(
            f"{NANGO_BASE_URL}/v1/gmail/messages/{message_id}/modify",
            headers=_nango_headers(),
            json={
                "connectionId": NANGO_CONNECTION_ID,
                "removeLabelIds": ["INBOX"],
            },
            timeout=30,
        )
        resp.raise_for_status()
        return resp.text

    def _tool_label_email(self, params: dict) -> str:
        """Add or remove a label via Nango Gmail proxy."""

        message_id = params["message_id"]
        action = params.get("action", "add")
        label = params["label"]

        body: dict = {"connectionId": NANGO_CONNECTION_ID}
        if action == "add":
            body["addLabelIds"] = [label]
        else:
            body["removeLabelIds"] = [label]

        resp = httpx.post(
            f"{NANGO_BASE_URL}/v1/gmail/messages/{message_id}/modify",
            headers=_nango_headers(),
            json=body,
            timeout=30,
        )
        resp.raise_for_status()
        return resp.text
