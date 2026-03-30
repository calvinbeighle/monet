"""
router.py

Intent classification and routing for the Monet agent backend.
Maps natural language user intents to the appropriate agent type and UI pattern.

Classification strategy:
  1. Keyword matching (fast, deterministic, no LLM cost)
  2. Future: embed the intent and use a small classifier model

Each routing rule returns an (AgentType, UIPattern) pair that the OS shell
uses to both select the right agent and render the appropriate UI component.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from models import AgentType, UIPattern


@dataclass(frozen=True)
class RoutingResult:
    """The output of intent classification."""

    agent: AgentType
    ui_pattern: UIPattern
    confidence: float  # 0.0 - 1.0; keyword match = 0.9, default = 0.5


# ---------------------------------------------------------------------------
# Keyword rule definitions
# Each rule is an (pattern, agent, ui_pattern, confidence) tuple.
# Rules are evaluated in order; first match wins.
# ---------------------------------------------------------------------------

_ROUTING_RULES: list[tuple[re.Pattern[str], AgentType, UIPattern, float]] = [
    # Email / inbox
    (
        re.compile(
            r"\b(email|inbox|gmail|mail|message|unread|reply|forward|draft|send)\b",
            re.IGNORECASE,
        ),
        AgentType.EMAIL,
        UIPattern.TINDER,
        0.9,
    ),
    # Code / GitHub
    (
        re.compile(
            r"\b(pr|pull request|code|review|diff|merge|branch|commit|push|github|repo|"
            r"bug|fix|refactor|deploy|ci|lint|test|function|class|file)\b",
            re.IGNORECASE,
        ),
        AgentType.CODE,
        UIPattern.DIFF,
        0.9,
    ),
    # Planning / brainstorming
    (
        re.compile(
            r"\b(plan|planning|brainstorm|strategy|roadmap|idea|ideas|outline|"
            r"think|think through|whiteboard|explore|design|architecture|structure)\b",
            re.IGNORECASE,
        ),
        AgentType.PLANNING,
        UIPattern.WHITEBOARD,
        0.9,
    ),
]

# Fallback when no rule matches
_DEFAULT_ROUTING = RoutingResult(
    agent=AgentType.CHAT,
    ui_pattern=UIPattern.CHAT,
    confidence=0.5,
)


def classify_intent(text: str) -> RoutingResult:
    """
    Classify a natural language intent string into an agent + UI pattern.

    Uses ordered keyword matching. The first rule whose pattern matches the
    input text wins. Falls back to the generic chat agent if nothing matches.

    Args:
        text: Raw natural language intent from the user.

    Returns:
        RoutingResult containing the selected agent, UI pattern, and confidence.
    """
    if not text or not text.strip():
        return _DEFAULT_ROUTING

    normalized = text.strip()

    for pattern, agent, ui_pattern, confidence in _ROUTING_RULES:
        if pattern.search(normalized):
            return RoutingResult(
                agent=agent,
                ui_pattern=ui_pattern,
                confidence=confidence,
            )

    return _DEFAULT_ROUTING


def route_intent(text: str) -> dict[str, str]:
    """
    Public interface used by the FastAPI endpoint layer.

    Args:
        text: Raw natural language intent from the user.

    Returns:
        dict with keys "agent" and "ui_pattern" (string values).
    """
    result = classify_intent(text)
    return {
        "agent": result.agent.value,
        "ui_pattern": result.ui_pattern.value,
    }
