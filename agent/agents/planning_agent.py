"""
agents/planning_agent.py

Planning and brainstorming agent for Monet OS.
Helps founders think through strategy, roadmaps, ideas, and architecture.

This agent is conversational - no destructive tools - so no approval gates
are needed. The whiteboard UI pattern allows free-form canvas rendering
on the frontend.

UI pattern: WHITEBOARD (freeform canvas for structured thinking)
"""

from __future__ import annotations

from typing import Any

from models import AgentType
from .base import BaseAgent


# Planning tools - all read-only or generative, no approval gates needed
_PLANNING_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "create_outline",
            "description": (
                "Generate a structured outline or framework for a topic. "
                "Returns a hierarchical list of points, sections, or steps."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": "The topic or goal to create an outline for.",
                    },
                    "depth": {
                        "type": "integer",
                        "description": "How many levels deep to nest the outline (1-3). Default 2.",
                        "default": 2,
                    },
                    "format": {
                        "type": "string",
                        "enum": ["bullets", "numbered", "tree"],
                        "description": "Output format for the outline.",
                        "default": "bullets",
                    },
                },
                "required": ["topic"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "generate_questions",
            "description": (
                "Generate probing questions to help the user think more deeply about a topic. "
                "Useful for stress-testing assumptions, identifying unknowns, or exploring tradeoffs."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": "The topic or decision to generate questions about.",
                    },
                    "perspective": {
                        "type": "string",
                        "enum": ["customer", "investor", "competitor", "technical", "general"],
                        "description": "The lens through which to frame the questions.",
                        "default": "general",
                    },
                    "count": {
                        "type": "integer",
                        "description": "Number of questions to generate. Default 5.",
                        "default": 5,
                    },
                },
                "required": ["topic"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_options",
            "description": (
                "Create a structured comparison of multiple options or approaches. "
                "Returns a table with pros, cons, and tradeoffs for each option."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "options": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of options or approaches to compare.",
                    },
                    "criteria": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional list of evaluation criteria. If omitted, criteria are inferred.",
                    },
                    "context": {
                        "type": "string",
                        "description": "Background context to inform the comparison.",
                    },
                },
                "required": ["options"],
            },
        },
    },
]

_SYSTEM_PROMPT = """
You are Monet's planning and thinking partner - a sharp, honest thinking partner
for founders working through hard decisions and complex strategy.

Your job is to help the user think more clearly, not to think for them:
- Surface the assumptions they haven't questioned
- Map out the decision tree they're navigating
- Identify the one or two things that actually matter most
- Offer frameworks when useful, but don't force them
- Ask the uncomfortable questions others won't

Your style:
- Be direct and opinionated. If something seems like a bad idea, say so clearly.
- Founders are smart - skip the basics and go deep fast.
- Think out loud. Show the reasoning, not just the conclusion.
- Short sentences over long ones. Dense over fluffy.
- When using the whiteboard, structure output with clear headers and bullets.

This is not a therapy session. This is high-stakes thinking work.
Get to the insight as fast as possible.
""".strip()


class PlanningAgent(BaseAgent):
    """
    Agent for brainstorming, strategic planning, and structured thinking.

    Uses the WHITEBOARD UI pattern - the frontend renders a freeform canvas
    where structured outputs (outlines, comparisons, questions) are laid out
    visually. No approval gates are needed as all tools are read-only/generative.
    """

    @property
    def agent_type(self) -> AgentType:
        return AgentType.PLANNING

    @property
    def system_prompt(self) -> str:
        return _SYSTEM_PROMPT

    @property
    def tools(self) -> list[dict[str, Any]]:
        return _PLANNING_TOOLS

    def requires_approval(self, tool_name: str) -> bool:
        """
        Planning agent has no destructive tools - no approval gates needed.

        Args:
            tool_name: Name of the tool the LLM wants to invoke.

        Returns:
            bool: Always False.
        """
        return False

    async def _execute_tool(
        self, tool_name: str, tool_input: dict[str, Any]
    ) -> Any:
        """
        Execute a planning tool call.

        Returns structured stub data that the LLM can reason over.
        Replace with real implementations (or remove - the LLM can generate
        these natively) as the product evolves.

        Args:
            tool_name: The planning tool to execute.
            tool_input: Structured arguments for the tool.

        Returns:
            Any: Structured planning output.
        """
        if tool_name == "create_outline":
            topic = tool_input.get("topic", "topic")
            return {
                "topic": topic,
                "outline": [
                    {"heading": "Context and background", "items": ["Define the problem", "Current state"]},
                    {"heading": "Core options", "items": ["Option A", "Option B", "Option C"]},
                    {"heading": "Decision criteria", "items": ["What matters most", "Key constraints"]},
                    {"heading": "Next steps", "items": ["Immediate actions", "Open questions"]},
                ],
            }

        if tool_name == "generate_questions":
            topic = tool_input.get("topic", "topic")
            return {
                "topic": topic,
                "questions": [
                    "What would have to be true for this to work?",
                    "What's the single biggest risk?",
                    "Who has solved a similar problem before?",
                    "What are you optimizing for - and is that the right thing?",
                    "What does failure look like at 6 months?",
                ],
            }

        if tool_name == "compare_options":
            options = tool_input.get("options", [])
            return {
                "options": options,
                "comparison": [
                    {
                        "option": opt,
                        "pros": ["Stub pro 1", "Stub pro 2"],
                        "cons": ["Stub con 1"],
                        "key_tradeoff": "Speed vs quality",
                    }
                    for opt in options
                ],
            }

        return f"[stub] Unknown planning tool: {tool_name}"
