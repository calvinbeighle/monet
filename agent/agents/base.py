"""Base agent class - defines the interface all Monet agents implement."""

from abc import ABC, abstractmethod
from typing import Generator
from agent.models import AgentResult, AgentEvent, UIPattern


class BaseAgent(ABC):
    """Base class for all Monet agents.

    Each agent defines its own system prompt, tools, and which tools
    require approval before execution.
    """

    name: str = "base"
    description: str = "Base agent"
    default_ui_pattern: UIPattern = UIPattern.CHAT

    @property
    @abstractmethod
    def system_prompt(self) -> str:
        """The system prompt sent to Claude for this agent."""

    @property
    @abstractmethod
    def tools(self) -> list[dict]:
        """Tool definitions in Claude API format."""

    @property
    def approval_required(self) -> set[str]:
        """Tool names that require user approval before execution."""
        return set()

    @property
    def suggestions(self) -> list[str]:
        """Follow-up suggestion chips shown after agent completes."""
        return []

    @abstractmethod
    def execute_tool(self, tool_name: str, parameters: dict) -> str:
        """Execute a tool call and return the result as a string."""

    def run(self, intent: str, ui_pattern: str) -> AgentResult:
        """Run the agent synchronously. Override for custom behavior."""
        raise NotImplementedError(
            "Subclasses should implement run() or rely on AgentRunner"
        )

    def stream(self, intent: str, ui_pattern: str) -> Generator[AgentEvent, None, None]:
        """Stream agent events. Override for custom behavior."""
        raise NotImplementedError(
            "Subclasses should implement stream() or rely on AgentRunner"
        )
