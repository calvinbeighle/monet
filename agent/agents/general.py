"""General agent - conversational fallback for unknown or general intents."""

import logging

from agent.agents.base import BaseAgent
from agent.models import UIPattern

logger = logging.getLogger(__name__)


class GeneralAgent(BaseAgent):
    """Fallback agent for intents that don't match email, code, or planning.

    Has no tools - pure conversational agent backed by Claude. Handles
    general questions, explanations, and anything the specialized agents
    can't route to. Always uses the chat UI pattern.
    """

    name = "general"
    default_ui_pattern = UIPattern.CHAT

    @property
    def system_prompt(self) -> str:
        return (
            "You are Monet, an AI assistant built into an agent-native operating system. "
            "You help users with general questions, explanations, and tasks that don't "
            "require specific tool integrations like email or code review.\n\n"
            "You can:\n"
            "- Answer questions about any topic\n"
            "- Help with writing, editing, and summarizing text\n"
            "- Explain concepts and provide guidance\n"
            "- Help users figure out what they want to do (then suggest they rephrase "
            "their intent for a specialized agent)\n\n"
            "Keep responses concise and helpful. If a user seems to want email, code, "
            "or planning help, suggest they phrase their intent more specifically so "
            "the system can route them to the right agent.\n\n"
            "For example:\n"
            "- For email: 'reply to John's email' or 'handle my inbox'\n"
            "- For code: 'review the open PR' or 'write a function that...'\n"
            "- For planning: 'plan the next sprint' or 'brainstorm marketing ideas'"
        )

    @property
    def tools(self) -> list[dict]:
        # General agent has no tools - pure conversation
        return []

    def execute_tool(self, tool_name: str, parameters: dict) -> str:
        return f'{{"error": "General agent has no tools. Unknown tool: {tool_name}"}}'
