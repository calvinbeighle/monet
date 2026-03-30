"""Intent router - maps user intents to agents and UI patterns via keyword matching."""

import re
from agent.models import RoutedIntent, UIPattern


ROUTING_RULES: list[tuple[re.Pattern, str, UIPattern]] = [
    # Email batch - tinder UI
    (
        re.compile(r"\b(inbox|batch|emails|triage|handle my)\b", re.IGNORECASE),
        "email",
        UIPattern.TINDER,
    ),
    # Email single - chat UI
    (
        re.compile(r"\b(reply|draft|send|forward|email to|compose)\b", re.IGNORECASE),
        "email",
        UIPattern.CHAT,
    ),
    # Code review - diff UI
    (
        re.compile(r"\b(review|pr|pull request|diff|compare)\b", re.IGNORECASE),
        "code",
        UIPattern.DIFF,
    ),
    # Code write - chat UI
    (
        re.compile(
            r"\b(write|build|implement|code|fix|debug|refactor)\b", re.IGNORECASE
        ),
        "code",
        UIPattern.CHAT,
    ),
    # Planning - whiteboard UI
    (
        re.compile(
            r"\b(plan|sprint|brainstorm|roadmap|architect|design)\b", re.IGNORECASE
        ),
        "planning",
        UIPattern.WHITEBOARD,
    ),
]


class IntentRouter:
    """Routes user intents to the appropriate agent and UI pattern.

    Uses keyword matching against a prioritized rule set.
    Rules are evaluated in order - first match wins.
    """

    def route(self, intent: str) -> RoutedIntent:
        for pattern, agent, ui_pattern in ROUTING_RULES:
            if pattern.search(intent):
                return RoutedIntent(
                    agent=agent, ui_pattern=ui_pattern.value, original=intent
                )

        # Default: general agent with chat UI
        return RoutedIntent(
            agent="general", ui_pattern=UIPattern.CHAT.value, original=intent
        )
