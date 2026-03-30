"""
integrations/gmail.py

Gmail integration layer for the Monet agent backend.

Each method checks whether Composio is connected (live mode) and delegates
to the ComposioClient if so. When Composio is not configured (stub mode),
methods return the same realistic mock data that the EmailAgent stubs use -
so the system behaves identically during local development.

Composio action names used (verified against composio-core 0.7.x):
  GMAIL_FETCH_EMAILS               - list inbox messages
  GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID - read a full message by ID
  GMAIL_CREATE_EMAIL_DRAFT          - save a draft without sending
  GMAIL_SEND_EMAIL                  - send an email (requires user approval upstream)
"""

from __future__ import annotations

from typing import Any

from .composio_client import ComposioClient


class GmailIntegration:
    """
    Gmail operations backed by Composio when available, stubs otherwise.

    Instantiate once and inject wherever Gmail access is needed. The
    ComposioClient handles the stub-vs-live decision internally.
    """

    def __init__(self, user_id: str = "default") -> None:
        self._client = ComposioClient()
        self._user_id = user_id

    # ------------------------------------------------------------------
    # Message listing
    # ------------------------------------------------------------------

    def list_messages(
        self,
        max_results: int = 10,
        label: str = "INBOX",
        query: str | None = None,
    ) -> dict[str, Any]:
        """
        List emails from the user's Gmail inbox.

        Returns a prioritised list of email summaries. In stub mode the
        returned data matches what the EmailAgent stubs produce so the
        frontend and agent loop see consistent shapes during development.

        Args:
            max_results: Maximum number of messages to return.
            label: Gmail label to filter by (e.g. INBOX, STARRED, UNREAD).
            query: Optional Gmail search query string (e.g. 'from:boss@company.com').

        Returns:
            dict: {"emails": [...]} where each entry has id, subject, from,
                  date, snippet, and unread fields.
        """
        if not self._client.is_stub:
            result = self._client.execute_tool(
                tool_name="GMAIL_FETCH_EMAILS",
                tool_input={
                    "max_results": max_results,
                    "label_ids": [label],
                    "query": query or "",
                },
                user_id=self._user_id,
            )
            return result  # type: ignore[return-value]

        # Stub response - same data the EmailAgent returns
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

    # ------------------------------------------------------------------
    # Message reading
    # ------------------------------------------------------------------

    def read_message(self, message_id: str) -> dict[str, Any]:
        """
        Read the full content of a specific Gmail message.

        Args:
            message_id: The Gmail message ID to fetch.

        Returns:
            dict: Full message data with id, subject, from, and body fields.
        """
        if not self._client.is_stub:
            result = self._client.execute_tool(
                tool_name="GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
                tool_input={"message_id": message_id},
                user_id=self._user_id,
            )
            return result  # type: ignore[return-value]

        # Stub response - same shape as EmailAgent read_email stub
        return {
            "id": message_id,
            "subject": "[stub] Email content",
            "from": "sender@example.com",
            "body": "This is a stub email body. Connect Gmail via Composio to see real content.",
        }

    # ------------------------------------------------------------------
    # Draft creation
    # ------------------------------------------------------------------

    def draft_reply(
        self,
        to: str,
        subject: str,
        body: str,
        reply_to_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Create a Gmail draft without sending it.

        Saves the draft to the user's Drafts folder. Does NOT send.
        Call send_email to actually deliver the message.

        Args:
            to: Recipient email address.
            subject: Email subject line.
            body: Email body (plain text or HTML).
            reply_to_id: Optional Gmail message ID this draft replies to.

        Returns:
            dict: Draft record with draft_id and status fields.
        """
        if not self._client.is_stub:
            tool_input: dict[str, Any] = {
                "recipient_email": to,
                "subject": subject,
                "body": body,
            }
            if reply_to_id:
                tool_input["thread_id"] = reply_to_id

            result = self._client.execute_tool(
                tool_name="GMAIL_CREATE_EMAIL_DRAFT",
                tool_input=tool_input,
                user_id=self._user_id,
            )
            return result  # type: ignore[return-value]

        # Stub response
        return {
            "draft_id": "draft_stub_001",
            "status": "saved",
            "message": "Draft saved successfully (stub).",
        }

    # ------------------------------------------------------------------
    # Sending
    # ------------------------------------------------------------------

    def send_email(
        self,
        to: str,
        subject: str,
        body: str,
        reply_to_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Send an email via Gmail.

        This method should only be called after explicit user approval has
        been recorded by the agent approval gate. Callers are responsible
        for gating this call behind a human confirmation step.

        Args:
            to: Recipient email address.
            subject: Email subject line.
            body: Email body (plain text or HTML).
            reply_to_id: Optional Gmail message ID this is a reply to.

        Returns:
            dict: Sent message record with message_id and status fields.
        """
        if not self._client.is_stub:
            tool_input: dict[str, Any] = {
                "recipient_email": to,
                "subject": subject,
                "body": body,
            }
            if reply_to_id:
                tool_input["thread_id"] = reply_to_id

            result = self._client.execute_tool(
                tool_name="GMAIL_SEND_EMAIL",
                tool_input=tool_input,
                user_id=self._user_id,
            )
            return result  # type: ignore[return-value]

        # Stub response - same shape as EmailAgent send_email stub
        return {
            "message_id": "sent_stub_001",
            "status": "sent",
            "message": "Email sent successfully (stub).",
        }
