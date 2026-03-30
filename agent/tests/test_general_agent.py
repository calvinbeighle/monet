"""Tests for the general agent."""

import json

from agent.agents.general import GeneralAgent
from agent.models import UIPattern


class TestGeneralAgent:
    def setup_method(self):
        self.agent = GeneralAgent()

    def test_name(self):
        assert self.agent.name == "general"

    def test_default_ui_pattern(self):
        assert self.agent.default_ui_pattern == UIPattern.CHAT

    def test_system_prompt_not_empty(self):
        assert len(self.agent.system_prompt) > 0

    def test_system_prompt_mentions_specialized_agents(self):
        """System prompt should guide users toward specialized agents."""
        prompt = self.agent.system_prompt
        assert "email" in prompt.lower()
        assert "code" in prompt.lower()
        assert "planning" in prompt.lower()

    def test_no_tools(self):
        """General agent has no tools - pure conversation."""
        assert self.agent.tools == []

    def test_no_approval_required(self):
        assert len(self.agent.approval_required) == 0

    def test_execute_unknown_tool_returns_error(self):
        """Executing any tool should return an error since there are no tools."""
        result = self.agent.execute_tool("some_tool", {"param": "value"})
        assert "error" in result.lower()
        assert "no tools" in result.lower() or "Unknown tool" in result.lower()
