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
            fmt = tool_input.get("format", "bullets")
            depth = tool_input.get("depth", 2)
            return {
                "topic": topic,
                "format": fmt,
                "depth": depth,
                "outline": [
                    {
                        "heading": "1. Problem definition",
                        "items": [
                            f"What problem does '{topic}' actually solve?",
                            "Who has this problem most acutely?",
                            "What does the current (broken) solution look like?",
                        ],
                    },
                    {
                        "heading": "2. Key inputs and constraints",
                        "items": [
                            "Time horizon - what's the forcing function?",
                            "Resource constraints (team, budget, runway)",
                            "Non-negotiable requirements",
                        ],
                    },
                    {
                        "heading": "3. Strategic options",
                        "items": [
                            "Option A - conservative / low risk",
                            "Option B - moderate bet / balanced",
                            "Option C - aggressive / high upside",
                        ],
                    },
                    {
                        "heading": "4. Decision criteria",
                        "items": [
                            "Primary metric to optimize for",
                            "Secondary considerations",
                            "Kill criteria - what would make you abandon this?",
                        ],
                    },
                    {
                        "heading": "5. Next actions",
                        "items": [
                            "Immediate next step (today)",
                            "Week 1 milestones",
                            "Open questions that need answers before moving",
                        ],
                    },
                ],
            }

        if tool_name == "generate_questions":
            topic = tool_input.get("topic", "topic")
            perspective = tool_input.get("perspective", "general")
            count = tool_input.get("count", 5)
            questions_by_perspective: dict[str, list[str]] = {
                "customer": [
                    f"What does a customer actually do today when they have the '{topic}' problem?",
                    "What would make them switch from their current solution?",
                    "Who is the economic buyer vs. the day-to-day user?",
                    "What's the biggest objection they'd raise in a sales call?",
                    "What outcome do they care about - not feature, outcome?",
                    "Would they pay for this today or only once it's proven?",
                ],
                "investor": [
                    f"What is the market size for '{topic}' - total, serviceable, realistic?",
                    "What's the 10x better reason a customer switches?",
                    "Why will you win this, specifically - not just 'team and product'?",
                    "What's the moat once competitors copy the surface-level features?",
                    "What does the unit economics model look like at scale?",
                    "What's the biggest assumption that could kill this?",
                ],
                "competitor": [
                    f"Who is already working on '{topic}' and what have they figured out?",
                    "What have incumbents tried and abandoned - and why?",
                    "Where is the market segmenting that incumbents can't follow?",
                    "What would a well-funded competitor do in the next 12 months?",
                    "What's your defensible wedge that they can't easily replicate?",
                ],
                "technical": [
                    f"What's the hardest technical problem in building '{topic}'?",
                    "What are the failure modes under scale?",
                    "What would you build differently knowing what you know now?",
                    "Where is complexity hiding that will slow you down?",
                    "What are you over-engineering vs. under-engineering?",
                ],
                "general": [
                    f"What would have to be true for '{topic}' to actually work?",
                    "What's the single biggest risk - and is it in your control?",
                    "Who has solved a similar problem before, and what did they learn?",
                    f"What are you optimizing '{topic}' for - and is that the right thing?",
                    "What does failure look like at 6 months?",
                    "What's the version of this that ships in 2 weeks vs. 6 months?",
                    "What would you need to believe to double down on this?",
                ],
            }
            all_questions = questions_by_perspective.get(
                perspective,
                questions_by_perspective["general"],
            )
            return {
                "topic": topic,
                "perspective": perspective,
                "questions": all_questions[:count],
            }

        if tool_name == "compare_options":
            options = tool_input.get("options", [])
            context = tool_input.get("context", "")
            criteria = tool_input.get("criteria") or [
                "Speed to ship",
                "Scalability",
                "Reversibility",
                "Resource cost",
                "Customer impact",
            ]
            return {
                "options": options,
                "criteria": criteria,
                "context": context,
                "comparison": [
                    {
                        "option": opt,
                        "summary": f"Approach: {opt}",
                        "pros": [
                            f"Clear ownership - single team can drive {opt} end to end",
                            "Lower coordination overhead at this stage",
                        ],
                        "cons": [
                            "Creates technical debt if the approach needs to change",
                            "Harder to course-correct once shipped",
                        ],
                        "key_tradeoff": f"Speed now vs. flexibility later with {opt}",
                        "best_if": "You need to move fast and can tolerate rework",
                    }
                    for opt in options
                ],
            }

        return {"error": f"Unknown planning tool: {tool_name}"}
