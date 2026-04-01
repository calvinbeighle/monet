"""Email agent - handles Gmail operations via Nango proxy.

All API calls go through Nango's proxy endpoint:
  {METHOD} https://api.nango.dev/proxy/{gmail-api-path}
  Headers: Authorization, Connection-Id, Provider-Config-Key

Gmail API paths are relative to https://www.googleapis.com (the base_url
configured for the google-mail provider in Nango).
"""

import base64
import json
import logging
import os
from email.mime.text import MIMEText

from agent.agents.base import BaseAgent
from agent.models import UIPattern
from agent.nango import PROVIDERS, nango_proxy_request

logger = logging.getLogger(__name__)

# Gmail provider config from Nango
_PROVIDER_CONFIG_KEY = PROVIDERS["gmail"]["config_key"]
_CONNECTION_ID = os.environ.get(
    "NANGO_GMAIL_CONNECTION_ID", PROVIDERS["gmail"]["connection_id"]
)


class EmailAgent(BaseAgent):
    """Agent for email operations - reading, drafting, sending, organizing.

    Uses Nango's Gmail integration for OAuth and API access.
    When processing a batch (inbox triage), produces one draft per email
    and marks each as pending_approval before sending.
    """

    name = "email"
    description = "Reads, drafts, sends, and organizes your emails"
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
        """List inbox emails via Nango Gmail proxy.

        Gmail's messages.list returns only {id, threadId} pairs. After getting
        the list, batch-fetch metadata for each message so the AI has subject,
        sender, and date to work with.
        """
        max_results = params.get("max_results", 20)
        unread_only = params.get("unread_only", False)

        query = "in:inbox"
        if unread_only:
            query += " is:unread"

        resp = nango_proxy_request(
            method="GET",
            path="gmail/v1/users/me/messages",
            provider_config_key=_PROVIDER_CONFIG_KEY,
            connection_id=_CONNECTION_ID,
            params={"q": query, "maxResults": max_results},
        )
        resp.raise_for_status()
        data = resp.json()

        messages_raw = data.get("messages", [])
        if not messages_raw:
            return json.dumps({"messages": []})

        # Batch-fetch metadata for each message ID
        messages_with_metadata = []
        for msg_stub in messages_raw:
            msg_id = msg_stub.get("id")
            if not msg_id:
                continue
            meta_resp = nango_proxy_request(
                method="GET",
                path=f"gmail/v1/users/me/messages/{msg_id}",
                provider_config_key=_PROVIDER_CONFIG_KEY,
                connection_id=_CONNECTION_ID,
                params={
                    "format": "metadata",
                    "metadataHeaders": "From,Subject,Date",
                },
            )
            if meta_resp.status_code != 200:
                messages_with_metadata.append(
                    {"id": msg_id, "threadId": msg_stub.get("threadId")}
                )
                continue
            meta = meta_resp.json()
            headers_list = meta.get("payload", {}).get("headers", [])
            headers_map = {h["name"].lower(): h["value"] for h in headers_list}
            messages_with_metadata.append(
                {
                    "id": msg_id,
                    "threadId": meta.get("threadId"),
                    "subject": headers_map.get("subject", ""),
                    "from": headers_map.get("from", ""),
                    "date": headers_map.get("date", ""),
                }
            )

        return json.dumps({"messages": messages_with_metadata})

    def _tool_read_email(self, params: dict) -> str:
        """Read a specific email via Nango Gmail proxy.

        Gmail returns body content as base64url-encoded data in payload.parts
        (multipart) or payload.body.data (simple messages). Parse the response
        and return a clean structure with decoded body text.
        """
        message_id = params["message_id"]

        resp = nango_proxy_request(
            method="GET",
            path=f"gmail/v1/users/me/messages/{message_id}",
            provider_config_key=_PROVIDER_CONFIG_KEY,
            connection_id=_CONNECTION_ID,
        )
        resp.raise_for_status()
        data = resp.json()

        payload = data.get("payload", {})
        headers_list = payload.get("headers", [])
        headers_map = {h["name"].lower(): h["value"] for h in headers_list}

        # Decode body: multipart messages store parts in payload.parts,
        # simple messages store data directly in payload.body.data.
        body_text = ""
        parts = payload.get("parts", [])
        if parts:
            # Prefer text/plain part; fall back to first part with data
            for part in parts:
                mime = part.get("mimeType", "")
                part_data = part.get("body", {}).get("data", "")
                if part_data and mime == "text/plain":
                    body_text = base64.urlsafe_b64decode(part_data + "==").decode(
                        "utf-8", errors="replace"
                    )
                    break
            if not body_text:
                for part in parts:
                    part_data = part.get("body", {}).get("data", "")
                    if part_data:
                        body_text = base64.urlsafe_b64decode(part_data + "==").decode(
                            "utf-8", errors="replace"
                        )
                        break
        else:
            raw_data = payload.get("body", {}).get("data", "")
            if raw_data:
                body_text = base64.urlsafe_b64decode(raw_data + "==").decode(
                    "utf-8", errors="replace"
                )

        return json.dumps(
            {
                "message_id": data.get("id"),
                "thread_id": data.get("threadId"),
                "subject": headers_map.get("subject", ""),
                "from": headers_map.get("from", ""),
                "to": headers_map.get("to", ""),
                "date": headers_map.get("date", ""),
                "body": body_text,
            }
        )

    def _tool_draft_reply(self, params: dict) -> str:
        """Create a draft reply via Nango Gmail proxy.

        Reads the original message to get thread ID, sender, and subject,
        then constructs a proper RFC 2822 MIME message and base64url-encodes
        it for the Gmail API.
        """
        message_id = params["message_id"]
        body = params["body"]

        # Read original message to get threadId, sender, and subject
        orig_resp = nango_proxy_request(
            method="GET",
            path=f"gmail/v1/users/me/messages/{message_id}",
            provider_config_key=_PROVIDER_CONFIG_KEY,
            connection_id=_CONNECTION_ID,
            params={"format": "metadata", "metadataHeaders": "From,Subject,Message-Id"},
        )
        orig_resp.raise_for_status()
        orig = orig_resp.json()

        thread_id = orig.get("threadId", "")
        headers_list = orig.get("payload", {}).get("headers", [])
        headers_map = {h["name"].lower(): h["value"] for h in headers_list}

        reply_to = headers_map.get("from", "")
        subject = headers_map.get("subject", "")
        orig_message_id = headers_map.get("message-id", "")
        if subject and not subject.lower().startswith("re:"):
            subject = f"Re: {subject}"

        # Build RFC 2822 MIME message
        mime_msg = MIMEText(body)
        mime_msg["To"] = reply_to
        mime_msg["Subject"] = subject
        if orig_message_id:
            mime_msg["In-Reply-To"] = orig_message_id
            mime_msg["References"] = orig_message_id

        raw = base64.urlsafe_b64encode(mime_msg.as_bytes()).decode("ascii")

        resp = nango_proxy_request(
            method="POST",
            path="gmail/v1/users/me/drafts",
            provider_config_key=_PROVIDER_CONFIG_KEY,
            connection_id=_CONNECTION_ID,
            json_body={
                "message": {
                    "threadId": thread_id,
                    "raw": raw,
                },
            },
        )
        resp.raise_for_status()
        return resp.text

    def _tool_send_email(self, params: dict) -> str:
        """Send an email via Nango Gmail proxy.

        Constructs a proper RFC 2822 MIME message with base64url encoding.
        For replies, reads the original message to get threading headers.
        """
        to = params["to"]
        subject = params["subject"]
        body = params["body"]
        reply_to_id = params.get("reply_to_message_id")

        thread_id = None
        orig_message_id_header = None

        if reply_to_id:
            # Read original message for threading headers
            orig_resp = nango_proxy_request(
                method="GET",
                path=f"gmail/v1/users/me/messages/{reply_to_id}",
                provider_config_key=_PROVIDER_CONFIG_KEY,
                connection_id=_CONNECTION_ID,
                params={"format": "metadata", "metadataHeaders": "Message-Id,Subject"},
            )
            if orig_resp.status_code == 200:
                orig = orig_resp.json()
                thread_id = orig.get("threadId")
                headers_list = orig.get("payload", {}).get("headers", [])
                orig_subject = None
                for h in headers_list:
                    if h["name"].lower() == "message-id":
                        orig_message_id_header = h["value"]
                    if h["name"].lower() == "subject":
                        orig_subject = h["value"]
                if orig_subject is not None and not subject.lower().startswith("re:"):
                    subject = f"Re: {orig_subject}" if orig_subject else subject

        # Build RFC 2822 MIME message
        mime_msg = MIMEText(body)
        mime_msg["To"] = to
        mime_msg["Subject"] = subject
        if orig_message_id_header:
            mime_msg["In-Reply-To"] = orig_message_id_header
            mime_msg["References"] = orig_message_id_header

        raw = base64.urlsafe_b64encode(mime_msg.as_bytes()).decode("ascii")

        json_body: dict = {"raw": raw}
        if thread_id:
            json_body["threadId"] = thread_id

        resp = nango_proxy_request(
            method="POST",
            path="gmail/v1/users/me/messages/send",
            provider_config_key=_PROVIDER_CONFIG_KEY,
            connection_id=_CONNECTION_ID,
            json_body=json_body,
        )
        resp.raise_for_status()
        return resp.text

    def _tool_archive_email(self, params: dict) -> str:
        """Archive an email via Nango Gmail proxy."""
        message_id = params["message_id"]

        resp = nango_proxy_request(
            method="POST",
            path=f"gmail/v1/users/me/messages/{message_id}/modify",
            provider_config_key=_PROVIDER_CONFIG_KEY,
            connection_id=_CONNECTION_ID,
            json_body={"removeLabelIds": ["INBOX"]},
        )
        resp.raise_for_status()
        return resp.text

    def _tool_label_email(self, params: dict) -> str:
        """Add or remove a label via Nango Gmail proxy."""
        message_id = params["message_id"]
        action = params.get("action", "add")
        label = params["label"]

        body: dict = {}
        if action == "add":
            body["addLabelIds"] = [label]
        else:
            body["removeLabelIds"] = [label]

        resp = nango_proxy_request(
            method="POST",
            path=f"gmail/v1/users/me/messages/{message_id}/modify",
            provider_config_key=_PROVIDER_CONFIG_KEY,
            connection_id=_CONNECTION_ID,
            json_body=body,
        )
        resp.raise_for_status()
        return resp.text
