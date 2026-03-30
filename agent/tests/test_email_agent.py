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
    def test_execute_tool_handles_http_error(self, mock_httpx):
        import httpx as real_httpx

        mock_httpx.get.side_effect = Exception("Connection refused")

        result = json.loads(self.agent.execute_tool("list_inbox", {}))
        assert "error" in result
        assert "Connection refused" in result["error"]
