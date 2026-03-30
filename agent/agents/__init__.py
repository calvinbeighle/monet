"""
agents/__init__.py

Public interface for the agents package.
Exports the agent factory function and all concrete agent classes.
"""

from models import AgentType, SessionState

from .base import BaseAgent
from .code_agent import CodeAgent
from .email_agent import EmailAgent
from .planning_agent import PlanningAgent

__all__ = [
    "BaseAgent",
    "EmailAgent",
    "CodeAgent",
    "PlanningAgent",
    "create_agent",
]

# Map from AgentType to the corresponding agent class
_AGENT_REGISTRY: dict[AgentType, type[BaseAgent]] = {
    AgentType.EMAIL: EmailAgent,
    AgentType.CODE: CodeAgent,
    AgentType.PLANNING: PlanningAgent,
}


def create_agent(session: SessionState) -> BaseAgent:
    """
    Factory function that instantiates the correct agent for a session.

    Falls back to PlanningAgent (conversational) for the CHAT type since
    it has no destructive tools and a flexible system prompt.

    Args:
        session: The session state containing the agent type and context.

    Returns:
        BaseAgent: An initialized agent ready to call run().

    Raises:
        ValueError: If the agent type has no registered implementation.
    """
    agent_class = _AGENT_REGISTRY.get(session.agent)
    if agent_class is None:
        # CHAT falls through to planning agent as the default conversational handler
        if session.agent == AgentType.CHAT:
            return PlanningAgent(session)
        raise ValueError(f"No agent implementation registered for type: {session.agent}")
    return agent_class(session)
