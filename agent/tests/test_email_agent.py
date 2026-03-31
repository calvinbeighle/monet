"""Tests for the email agent."""

import json
from unittest.mock import patch, MagicMock

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

    @patch("agent.agents.email.httpx")
    def test_execute_list_inbox(self, mock_httpx):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"messages": [{"id": "1", "subject": "Test"}]})
        mock_response.raise_for_status = MagicMock()
        mock_httpx.get.return_value = mock_response

        result = self.agent.execute_tool("list_inbox", {"max_results": 5})
        assert "messages" in result

    @patch("agent.agents.email.httpx")
    def test_execute_read_email(self, mock_httpx):
        mock_response = MagicMock()
        mock_response.text = json.dumps(
            {"id": "msg1", "subject": "Test", "body": "Hello"}
        )
        mock_response.raise_for_status = MagicMock()
        mock_httpx.get.return_value = mock_response

        result = self.agent.execute_tool("read_email", {"message_id": "msg1"})
        assert "msg1" in result

    @patch("agent.agents.email.httpx")
    def test_execute_send_email(self, mock_httpx):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"status": "sent", "id": "msg2"})
        mock_response.raise_for_status = MagicMock()
        mock_httpx.post.return_value = mock_response

        result = self.agent.execute_tool(
            "send_email",
            {
                "to": "test@example.com",
                "subject": "Test",
                "body": "Hello",
            },
        )
        assert "sent" in result

    @patch("agent.agents.email.httpx")
    def test_execute_draft_reply(self, mock_httpx):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"draft_id": "d1", "status": "created"})
        mock_response.raise_for_status = MagicMock()
        mock_httpx.post.return_value = mock_response

        result = self.agent.execute_tool(
            "draft_reply",
            {"message_id": "msg_123", "body": "Thanks for your email."},
        )
        assert "draft_id" in result
        mock_httpx.post.assert_called_once()
        call_args = mock_httpx.post.call_args
        assert "drafts" in call_args[0][0]

    @patch("agent.agents.email.httpx")
    def test_execute_archive_email(self, mock_httpx):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"status": "archived"})
        mock_response.raise_for_status = MagicMock()
        mock_httpx.post.return_value = mock_response

        result = self.agent.execute_tool("archive_email", {"message_id": "msg_123"})
        assert "archived" in result
        call_args = mock_httpx.post.call_args
        body = call_args[1]["json"]
        assert "INBOX" in body["removeLabelIds"]

    @patch("agent.agents.email.httpx")
    def test_execute_label_email_add(self, mock_httpx):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"status": "labeled"})
        mock_response.raise_for_status = MagicMock()
        mock_httpx.post.return_value = mock_response

        result = self.agent.execute_tool(
            "label_email",
            {"message_id": "msg_123", "label": "Important", "action": "add"},
        )
        assert "labeled" in result
        body = mock_httpx.post.call_args[1]["json"]
        assert "Important" in body["addLabelIds"]

    @patch("agent.agents.email.httpx")
    def test_execute_label_email_remove(self, mock_httpx):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"status": "unlabeled"})
        mock_response.raise_for_status = MagicMock()
        mock_httpx.post.return_value = mock_response

        result = self.agent.execute_tool(
            "label_email",
            {"message_id": "msg_123", "label": "Spam", "action": "remove"},
        )
        assert "unlabeled" in result
        body = mock_httpx.post.call_args[1]["json"]
        assert "Spam" in body["removeLabelIds"]

    @patch("agent.agents.email.httpx")
    def test_execute_send_email_with_reply(self, mock_httpx):
        """send_email with reply_to_message_id includes replyToMessageId in payload."""
        mock_response = MagicMock()
        mock_response.text = json.dumps({"status": "sent"})
        mock_response.raise_for_status = MagicMock()
        mock_httpx.post.return_value = mock_response

        self.agent.execute_tool(
            "send_email",
            {
                "to": "test@example.com",
                "subject": "Re: Thread",
                "body": "Reply content",
                "reply_to_message_id": "orig_msg_1",
            },
        )
        body = mock_httpx.post.call_args[1]["json"]
        assert body["replyToMessageId"] == "orig_msg_1"

    @patch("agent.agents.email.httpx")
    def test_execute_list_inbox_unread_only(self, mock_httpx):
        """list_inbox with unread_only=True adds is:unread to query."""
        mock_response = MagicMock()
        mock_response.text = json.dumps({"messages": []})
        mock_response.raise_for_status = MagicMock()
        mock_httpx.get.return_value = mock_response

        self.agent.execute_tool("list_inbox", {"unread_only": True})
        call_params = mock_httpx.get.call_args[1]["params"]
        assert "is:unread" in call_params["q"]

    @patch("agent.agents.email.httpx")
    def test_execute_tool_handles_http_error(self, mock_httpx):
        import httpx as real_httpx

        mock_httpx.get.side_effect = Exception("Connection refused")

        result = json.loads(self.agent.execute_tool("list_inbox", {}))
        assert "error" in result
        assert "Connection refused" in result["error"]
