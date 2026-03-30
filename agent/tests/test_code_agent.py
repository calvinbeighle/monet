"""Tests for the code agent."""

import json
from unittest.mock import patch, MagicMock

from agent.agents.code import CodeAgent
from agent.models import UIPattern


class TestCodeAgent:
    def setup_method(self):
        self.agent = CodeAgent()

    def test_name(self):
        assert self.agent.name == "code"

    def test_default_ui_pattern(self):
        assert self.agent.default_ui_pattern == UIPattern.DIFF

    def test_system_prompt_not_empty(self):
        assert len(self.agent.system_prompt) > 0

    def test_tools_defined(self):
        tools = self.agent.tools
        tool_names = {t["name"] for t in tools}
        assert "list_prs" in tool_names
        assert "read_diff" in tool_names
        assert "read_file" in tool_names
        assert "post_review" in tool_names
        assert "approve_pr" in tool_names
        assert "merge_pr" in tool_names
        assert "push_code" in tool_names
        assert "create_branch" in tool_names
        assert "write_file" in tool_names

    def test_tools_have_required_fields(self):
        for tool in self.agent.tools:
            assert "name" in tool
            assert "description" in tool
            assert "input_schema" in tool
            assert tool["input_schema"]["type"] == "object"

    def test_approval_required_tools(self):
        assert "approve_pr" in self.agent.approval_required
        assert "merge_pr" in self.agent.approval_required
        assert "push_code" in self.agent.approval_required
        assert "list_prs" not in self.agent.approval_required
        assert "read_diff" not in self.agent.approval_required
        assert "post_review" not in self.agent.approval_required

    def test_suggestions_not_empty(self):
        assert len(self.agent.suggestions) > 0

    def test_execute_unknown_tool(self):
        result = json.loads(self.agent.execute_tool("nonexistent_tool", {}))
        assert "error" in result

    @patch("agent.agents.code.httpx")
    def test_execute_list_prs(self, mock_httpx):
        mock_response = MagicMock()
        mock_response.text = json.dumps([{"number": 1, "title": "Fix bug"}])
        mock_response.raise_for_status = MagicMock()
        mock_httpx.get.return_value = mock_response

        result = self.agent.execute_tool("list_prs", {"repo": "owner/repo"})
        assert "Fix bug" in result

    @patch("agent.agents.code.httpx")
    def test_execute_read_diff(self, mock_httpx):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"diff": "+added line\n-removed line"})
        mock_response.raise_for_status = MagicMock()
        mock_httpx.get.return_value = mock_response

        result = self.agent.execute_tool(
            "read_diff", {"repo": "owner/repo", "pr_number": 1}
        )
        assert "diff" in result

    @patch("agent.agents.code.httpx")
    def test_execute_merge_pr(self, mock_httpx):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"merged": True})
        mock_response.raise_for_status = MagicMock()
        mock_httpx.put.return_value = mock_response

        result = self.agent.execute_tool(
            "merge_pr", {"repo": "owner/repo", "pr_number": 1}
        )
        assert "merged" in result

    @patch("agent.agents.code.httpx")
    def test_execute_tool_handles_error(self, mock_httpx):
        mock_httpx.get.side_effect = Exception("API error")

        result = json.loads(self.agent.execute_tool("list_prs", {"repo": "owner/repo"}))
        assert "error" in result
        assert "API error" in result["error"]
