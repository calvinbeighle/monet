"""Tests for the email agent.

Why these tests matter: The email agent is the primary demo flow (SCOPE.md Feature 2).
Every tool call goes through Nango's proxy endpoint. These tests verify correct URL
construction, header format, and payload structure for the Gmail API via Nango proxy.
The draft_reply and send_email tools construct RFC 2822 MIME messages with base64url
encoding - these tests verify the MIME structure is correct for the Gmail API.
"""

import base64
import json
from unittest.mock import patch, MagicMock, call

from agent.agents.email import EmailAgent
from agent.models import UIPattern


class TestEmailAgent:
    def setup_method(self):
        self.agent = EmailAgent()

    def test_name(self):
        assert self.agent.name == "email"

    def test_default_ui_pattern(self):
        assert self.agent.default_ui_pattern == UIPattern.TINDER

    def test_system_prompt_not_empty(self):
        assert len(self.agent.system_prompt) > 0

    def test_tools_defined(self):
        tools = self.agent.tools
        tool_names = {t["name"] for t in tools}
        assert "list_inbox" in tool_names
        assert "read_email" in tool_names
        assert "draft_reply" in tool_names
        assert "send_email" in tool_names
        assert "archive_email" in tool_names
        assert "label_email" in tool_names

    def test_tools_have_required_fields(self):
        for tool in self.agent.tools:
            assert "name" in tool
            assert "description" in tool
            assert "input_schema" in tool
            assert tool["input_schema"]["type"] == "object"

    def test_approval_required_tools(self):
        assert "send_email" in self.agent.approval_required
        assert "archive_email" in self.agent.approval_required
        assert "list_inbox" not in self.agent.approval_required
        assert "read_email" not in self.agent.approval_required

    def test_suggestions_not_empty(self):
        assert len(self.agent.suggestions) > 0

    def test_execute_unknown_tool(self):
        result = json.loads(self.agent.execute_tool("nonexistent_tool", {}))
        assert "error" in result

    @patch("agent.nango.httpx.request")
    def test_execute_list_inbox(self, mock_request):
        """list_inbox batch-fetches metadata so the AI gets subject, from, date."""
        # First call: messages.list returning only stubs
        list_response = MagicMock()
        list_response.status_code = 200
        list_response.raise_for_status = MagicMock()
        list_response.json.return_value = {
            "messages": [{"id": "msg1", "threadId": "t1"}]
        }

        # Second call: metadata fetch for msg1
        meta_response = MagicMock()
        meta_response.status_code = 200
        meta_response.raise_for_status = MagicMock()
        meta_response.json.return_value = {
            "id": "msg1",
            "threadId": "t1",
            "payload": {
                "headers": [
                    {"name": "From", "value": "alice@example.com"},
                    {"name": "Subject", "value": "Hello there"},
                    {"name": "Date", "value": "Mon, 30 Mar 2026 10:00:00 +0000"},
                ]
            },
        }

        mock_request.side_effect = [list_response, meta_response]

        result = self.agent.execute_tool("list_inbox", {"max_results": 5})
        data = json.loads(result)
        assert "messages" in data
        assert len(data["messages"]) == 1
        msg = data["messages"][0]
        assert msg["id"] == "msg1"
        assert msg["subject"] == "Hello there"
        assert msg["from"] == "alice@example.com"
        assert msg["date"] == "Mon, 30 Mar 2026 10:00:00 +0000"

        # First call must be the messages.list
        first_call = mock_request.call_args_list[0][1]
        assert first_call["method"] == "GET"
        assert "/proxy/gmail/v1/users/me/messages" in first_call["url"]
        assert first_call["headers"]["Connection-Id"] is not None
        assert first_call["headers"]["Provider-Config-Key"] == "google-mail"

        # Second call must be the metadata fetch for msg1
        second_call = mock_request.call_args_list[1][1]
        assert "/proxy/gmail/v1/users/me/messages/msg1" in second_call["url"]
        assert second_call["params"]["format"] == "metadata"

    @patch("agent.nango.httpx.request")
    def test_execute_read_email_simple_body(self, mock_request):
        """read_email decodes base64url body from payload.body.data for simple messages."""
        body_text = "Hello, this is the email body."
        encoded = base64.urlsafe_b64encode(body_text.encode()).decode()

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "id": "msg1",
            "threadId": "t1",
            "payload": {
                "headers": [
                    {"name": "From", "value": "alice@example.com"},
                    {"name": "To", "value": "me@example.com"},
                    {"name": "Subject", "value": "Test Subject"},
                    {"name": "Date", "value": "Mon, 30 Mar 2026 10:00:00 +0000"},
                ],
                "body": {"data": encoded},
            },
        }
        mock_request.return_value = mock_response

        result = self.agent.execute_tool("read_email", {"message_id": "msg1"})
        assert (
            "/proxy/gmail/v1/users/me/messages/msg1" in mock_request.call_args[1]["url"]
        )

        data = json.loads(result)
        assert data["message_id"] == "msg1"
        assert data["thread_id"] == "t1"
        assert data["subject"] == "Test Subject"
        assert data["from"] == "alice@example.com"
        assert data["to"] == "me@example.com"
        assert data["date"] == "Mon, 30 Mar 2026 10:00:00 +0000"
        assert data["body"] == body_text

    @patch("agent.nango.httpx.request")
    def test_execute_read_email_multipart_body(self, mock_request):
        """read_email decodes base64url body from payload.parts for multipart messages."""
        body_text = "Multipart plain text body."
        encoded = base64.urlsafe_b64encode(body_text.encode()).decode()

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "id": "msg2",
            "threadId": "t2",
            "payload": {
                "headers": [
                    {"name": "From", "value": "bob@example.com"},
                    {"name": "To", "value": "me@example.com"},
                    {"name": "Subject", "value": "Multipart"},
                    {"name": "Date", "value": "Tue, 31 Mar 2026 09:00:00 +0000"},
                ],
                "parts": [
                    {"mimeType": "text/plain", "body": {"data": encoded}},
                    {
                        "mimeType": "text/html",
                        "body": {
                            "data": base64.urlsafe_b64encode(b"<b>html</b>").decode()
                        },
                    },
                ],
            },
        }
        mock_request.return_value = mock_response

        result = self.agent.execute_tool("read_email", {"message_id": "msg2"})
        data = json.loads(result)
        assert data["message_id"] == "msg2"
        assert data["subject"] == "Multipart"
        # Should prefer text/plain part
        assert data["body"] == body_text

    @patch("agent.nango.httpx.request")
    def test_execute_send_email(self, mock_request):
        """send_email constructs a base64url-encoded RFC 2822 MIME message."""
        mock_response = MagicMock()
        mock_response.text = json.dumps({"status": "sent", "id": "msg2"})
        mock_response.raise_for_status = MagicMock()
        mock_request.return_value = mock_response

        result = self.agent.execute_tool(
            "send_email",
            {
                "to": "test@example.com",
                "subject": "Test",
                "body": "Hello",
            },
        )
        assert "sent" in result
        # No reply_to_message_id, so only one call (the send)
        mock_request.assert_called_once()
        call_kwargs = mock_request.call_args[1]
        assert call_kwargs["method"] == "POST"
        assert "/proxy/gmail/v1/users/me/messages/send" in call_kwargs["url"]
        body = call_kwargs["json"]
        # Must have base64url-encoded raw MIME, not plain text fields
        assert "raw" in body
        assert "to" not in body  # to is inside the MIME, not a top-level field
        # Decode and verify MIME content
        decoded = base64.urlsafe_b64decode(body["raw"]).decode("utf-8")
        assert "To: test@example.com" in decoded
        assert "Subject: Test" in decoded
        assert "Hello" in decoded

    @patch("agent.nango.httpx.request")
    def test_execute_draft_reply(self, mock_request):
        """draft_reply reads original message for threading, then creates MIME draft."""
        # First call: GET original message (for thread ID, sender, subject)
        orig_response = MagicMock()
        orig_response.status_code = 200
        orig_response.json.return_value = {
            "threadId": "thread_abc",
            "payload": {
                "headers": [
                    {"name": "From", "value": "sender@example.com"},
                    {"name": "Subject", "value": "Original Subject"},
                    {"name": "Message-Id", "value": "<orig123@mail.example.com>"},
                ],
            },
        }
        orig_response.raise_for_status = MagicMock()

        # Second call: POST draft creation
        draft_response = MagicMock()
        draft_response.text = json.dumps(
            {"id": "d1", "message": {"threadId": "thread_abc"}}
        )
        draft_response.raise_for_status = MagicMock()

        mock_request.side_effect = [orig_response, draft_response]

        result = self.agent.execute_tool(
            "draft_reply",
            {"message_id": "msg_123", "body": "Thanks for your email."},
        )
        assert "d1" in result
        assert mock_request.call_count == 2

        # Verify first call reads original message
        first_call = mock_request.call_args_list[0][1]
        assert "/proxy/gmail/v1/users/me/messages/msg_123" in first_call["url"]
        assert first_call["method"] == "GET"

        # Verify second call creates draft with proper MIME
        second_call = mock_request.call_args_list[1][1]
        assert "/proxy/gmail/v1/users/me/drafts" in second_call["url"]
        body = second_call["json"]
        assert body["message"]["threadId"] == "thread_abc"
        # Decode and verify MIME content
        decoded = base64.urlsafe_b64decode(body["message"]["raw"]).decode("utf-8")
        assert "To: sender@example.com" in decoded
        assert "Subject: Re: Original Subject" in decoded
        assert "In-Reply-To: <orig123@mail.example.com>" in decoded
        assert "Thanks for your email." in decoded

    @patch("agent.nango.httpx.request")
    def test_execute_archive_email(self, mock_request):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"status": "archived"})
        mock_response.raise_for_status = MagicMock()
        mock_request.return_value = mock_response

        result = self.agent.execute_tool("archive_email", {"message_id": "msg_123"})
        assert "archived" in result
        body = mock_request.call_args[1]["json"]
        assert "INBOX" in body["removeLabelIds"]
        # connectionId should NOT be in the body
        assert "connectionId" not in body

    @patch("agent.nango.httpx.request")
    def test_execute_label_email_add(self, mock_request):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"status": "labeled"})
        mock_response.raise_for_status = MagicMock()
        mock_request.return_value = mock_response

        result = self.agent.execute_tool(
            "label_email",
            {"message_id": "msg_123", "label": "Important", "action": "add"},
        )
        assert "labeled" in result
        body = mock_request.call_args[1]["json"]
        assert "Important" in body["addLabelIds"]
        assert "connectionId" not in body

    @patch("agent.nango.httpx.request")
    def test_execute_label_email_remove(self, mock_request):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"status": "unlabeled"})
        mock_response.raise_for_status = MagicMock()
        mock_request.return_value = mock_response

        result = self.agent.execute_tool(
            "label_email",
            {"message_id": "msg_123", "label": "Spam", "action": "remove"},
        )
        assert "unlabeled" in result
        body = mock_request.call_args[1]["json"]
        assert "Spam" in body["removeLabelIds"]

    @patch("agent.nango.httpx.request")
    def test_execute_send_email_with_reply(self, mock_request):
        """send_email with reply_to_message_id reads original for threading headers."""
        # First call: GET original message for threading
        orig_response = MagicMock()
        orig_response.status_code = 200
        orig_response.json.return_value = {
            "threadId": "thread_xyz",
            "payload": {
                "headers": [
                    {"name": "Message-Id", "value": "<orig789@mail.example.com>"},
                    {"name": "Subject", "value": "Thread"},
                ],
            },
        }
        orig_response.raise_for_status = MagicMock()

        # Second call: POST send
        send_response = MagicMock()
        send_response.text = json.dumps({"status": "sent"})
        send_response.raise_for_status = MagicMock()

        mock_request.side_effect = [orig_response, send_response]

        self.agent.execute_tool(
            "send_email",
            {
                "to": "test@example.com",
                "subject": "Re: Thread",
                "body": "Reply content",
                "reply_to_message_id": "orig_msg_1",
            },
        )
        assert mock_request.call_count == 2
        # Verify send call has threadId and MIME with In-Reply-To
        send_call = mock_request.call_args_list[1][1]
        body = send_call["json"]
        assert body["threadId"] == "thread_xyz"
        decoded = base64.urlsafe_b64decode(body["raw"]).decode("utf-8")
        assert "In-Reply-To: <orig789@mail.example.com>" in decoded
        assert "References: <orig789@mail.example.com>" in decoded
        assert "Reply content" in decoded

    @patch("agent.nango.httpx.request")
    def test_send_email_reply_message_id_before_subject(self, mock_request):
        """Bug 3 fix: orig_subject must be initialized before the loop.

        If Message-Id header comes before Subject in the Gmail response, the
        old code would assign orig_subject only inside the Subject branch, but
        subject re-formatting happened inside the Message-Id branch iteration,
        causing a potential UnboundLocalError or using a stale value from a
        previous loop iteration. The fix initializes orig_subject = None before
        the loop and applies the Re: prefix after the loop completes.
        """
        orig_response = MagicMock()
        orig_response.status_code = 200
        orig_response.json.return_value = {
            "threadId": "thread_order",
            "payload": {
                "headers": [
                    # Message-Id appears FIRST - this triggered the bug
                    {"name": "Message-Id", "value": "<first@mail.example.com>"},
                    {"name": "Subject", "value": "Order Matters"},
                ],
            },
        }
        orig_response.raise_for_status = MagicMock()

        send_response = MagicMock()
        send_response.text = json.dumps({"status": "sent"})
        send_response.raise_for_status = MagicMock()

        mock_request.side_effect = [orig_response, send_response]

        # Should not raise UnboundLocalError or produce wrong subject
        self.agent.execute_tool(
            "send_email",
            {
                "to": "test@example.com",
                "subject": "anything",
                "body": "body text",
                "reply_to_message_id": "orig_msg_order",
            },
        )
        send_call = mock_request.call_args_list[1][1]
        decoded = base64.urlsafe_b64decode(send_call["json"]["raw"]).decode("utf-8")
        assert "In-Reply-To: <first@mail.example.com>" in decoded
        # subject should have been updated to Re: Order Matters
        assert "Subject: Re: Order Matters" in decoded

    @patch("agent.nango.httpx.request")
    def test_execute_list_inbox_unread_only(self, mock_request):
        """list_inbox with unread_only=True adds is:unread to query."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"messages": []}
        mock_request.return_value = mock_response

        self.agent.execute_tool("list_inbox", {"unread_only": True})
        # Only one call (the messages.list) since no messages to fetch metadata for
        first_call = mock_request.call_args_list[0][1]
        assert "is:unread" in first_call["params"]["q"]

    @patch("agent.nango.httpx.request")
    def test_execute_tool_handles_http_error(self, mock_request):
        mock_request.side_effect = Exception("Connection refused")

        result = json.loads(self.agent.execute_tool("list_inbox", {}))
        assert "error" in result
        assert "Connection refused" in result["error"]

    @patch("agent.nango.httpx.request")
    def test_proxy_headers_format(self, mock_request):
        """All requests must include Connection-Id and Provider-Config-Key headers."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"messages": []}
        mock_request.return_value = mock_response

        self.agent.execute_tool("list_inbox", {})
        headers = mock_request.call_args_list[0][1]["headers"]
        assert "Connection-Id" in headers
        assert "Provider-Config-Key" in headers
        assert headers["Provider-Config-Key"] == "google-mail"
        assert "Authorization" in headers
        assert headers["Authorization"].startswith("Bearer ")
