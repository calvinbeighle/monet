"""Custom agent - user-created agents with dynamic system prompts and borrowed tools.

SCOPE.md Feature 3 specifies that users can create agents through conversation
(e.g., "Make me an agent that summarizes my emails every morning"). CustomAgent
is the runtime representation: it uses a user-provided system prompt and borrows
tool implementations from built-in agents (email, code, writing) so custom agents
can actually do real work through connected tools.
"""

import json
import logging
from typing import Optional

from agent.agents.base import BaseAgent
from agent.custom_agent_store import CustomAgentConfig
from agent.models import UIPattern

logger = logging.getLogger(__name__)

# Maps tool set names to the built-in agent classes that provide those tools.
# Lazily imported to avoid circular imports.
_TOOL_SET_REGISTRY: Optional[dict[str, type]] = None


def _get_tool_set_registry() -> dict[str, type]:
    """Lazy-load the tool set registry to avoid circular imports."""
    global _TOOL_SET_REGISTRY
    if _TOOL_SET_REGISTRY is None:
        from agent.agents.email import EmailAgent
        from agent.agents.code import CodeAgent
        from agent.agents.writing import WritingAgent

        _TOOL_SET_REGISTRY = {
            "email": EmailAgent,
            "code": CodeAgent,
            "writing": WritingAgent,
        }
    return _TOOL_SET_REGISTRY


# Available tool sets users can choose from when creating custom agents.
AVAILABLE_TOOL_SETS = ["email", "code", "writing"]


class CustomAgent(BaseAgent):
    """A user-created agent with a dynamic system prompt and borrowed tools.

    Unlike built-in agents which have hardcoded tools and prompts, CustomAgent
    is configured at runtime from a CustomAgentConfig (persisted in SQLite).
    It borrows tool definitions and implementations from built-in agents
    based on the user's tool_sets selection.
    """

    def __init__(self, config: CustomAgentConfig) -> None:
        self._config = config
        self.name = config.name
        self.description = config.description
        self.default_ui_pattern = UIPattern(config.ui_pattern)

        # Instantiate the built-in agents whose tools we borrow
        registry = _get_tool_set_registry()
        self._tool_agents: dict[str, BaseAgent] = {}
        for tool_set in config.tool_sets:
            if tool_set in registry:
                self._tool_agents[tool_set] = registry[tool_set]()

        # Build the combined tool list and tool-name-to-agent lookup
        self._tool_list: list[dict] = []
        self._tool_dispatch: dict[str, BaseAgent] = {}
        for tool_set_name, agent in self._tool_agents.items():
            for tool_def in agent.tools:
                self._tool_list.append(tool_def)
                self._tool_dispatch[tool_def["name"]] = agent

        # Approval set: union of config overrides and inherited defaults
        self._approval_set: set[str] = set(config.approval_tools)
        for agent in self._tool_agents.values():
            self._approval_set |= agent.approval_required

    @property
    def system_prompt(self) -> str:
        return self._config.system_prompt

    @property
    def tools(self) -> list[dict]:
        return self._tool_list

    @property
    def approval_required(self) -> set[str]:
        return self._approval_set

    @property
    def suggestions(self) -> list[str]:
        return self._config.suggestions

    def execute_tool(self, tool_name: str, parameters: dict) -> str:
        """Dispatch tool execution to the built-in agent that owns the tool."""
        delegate = self._tool_dispatch.get(tool_name)
        if delegate is None:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})
        return delegate.execute_tool(tool_name, parameters)
