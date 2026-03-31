"""Intent router - maps user intents to agents and UI patterns via keyword matching."""

import re
from agent.models import FlowPlan, FlowStep, RoutedIntent, UIPattern


# Multi-step flow rules: checked first. Each is (regex, list[FlowStep]).
FLOW_RULES: list[tuple[re.Pattern, list[FlowStep]]] = [
    # "plan and prioritize my emails" -> whiteboard -> tinder -> chat
    (
        re.compile(r"\b(plan|organize|triage)\b.*\b(emails|inbox)\b", re.IGNORECASE),
        [
            FlowStep(
                agent="planning",
                ui_pattern=UIPattern.WHITEBOARD.value,
                label="Plan on whiteboard",
            ),
            FlowStep(
                agent="email",
                ui_pattern=UIPattern.TINDER.value,
                label="Review decisions",
                carry_map={"nodes": "cards"},
            ),
            FlowStep(
                agent="email",
                ui_pattern=UIPattern.CHAT.value,
                label="Execute actions",
                carry_map={"decisions": "context"},
            ),
        ],
    ),
    # "review and fix PR" -> diff -> chat
    (
        re.compile(r"\b(review|look at)\b.*\b(fix|implement|address)\b", re.IGNORECASE),
        [
            FlowStep(
                agent="code",
                ui_pattern=UIPattern.DIFF.value,
                label="Review changes",
            ),
            FlowStep(
                agent="code",
                ui_pattern=UIPattern.CHAT.value,
                label="Implement fixes",
                carry_map={"diff_decisions": "context"},
            ),
        ],
    ),
    # "brainstorm then prioritize" -> whiteboard -> tinder
    (
        re.compile(
            r"\b(brainstorm|plan)\b.*\b(then|and)\b.*\b(prioritize|rank|decide)\b",
            re.IGNORECASE,
        ),
        [
            FlowStep(
                agent="planning",
                ui_pattern=UIPattern.WHITEBOARD.value,
                label="Brainstorm ideas",
            ),
            FlowStep(
                agent="planning",
                ui_pattern=UIPattern.TINDER.value,
                label="Prioritize items",
                carry_map={"nodes": "cards"},
            ),
        ],
    ),
]


ROUTING_RULES: list[tuple[re.Pattern, str, UIPattern]] = [
    # Agent creation - must come first so "create an agent that handles my inbox"
    # routes to the creation flow, not the email agent.
    (
        re.compile(
            r"\b(create|make|set up|configure)\b.*\b(agent|bot|assistant)\b",
            re.IGNORECASE,
        ),
        "general",
        UIPattern.CHAT,
    ),
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
    # Planning - whiteboard UI (before code-write so "write a plan" routes here)
    (
        re.compile(
            r"\b(plan|sprint|brainstorm|roadmap|architect|design|prioritize|organize)\b",
            re.IGNORECASE,
        ),
        "planning",
        UIPattern.WHITEBOARD,
    ),
    # Writing - chat UI (before code-write so "write a doc" routes here, not to code)
    (
        re.compile(
            r"\b(document|doc|article|blog|essay|report|memo|notes|summarize|rewrite|proofread|google doc)\b",
            re.IGNORECASE,
        ),
        "writing",
        UIPattern.CHAT,
    ),
    # Code write - chat UI
    (
        re.compile(
            r"\b(write|build|implement|code|fix|debug|refactor)\b", re.IGNORECASE
        ),
        "code",
        UIPattern.CHAT,
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

    def route_flow(self, intent: str) -> FlowPlan:
        """Route an intent, detecting multi-step flows.

        Checks flow rules first (multi-step). Falls back to single-step
        via the existing route() method.
        """
        for pattern, steps in FLOW_RULES:
            if pattern.search(intent):
                return FlowPlan(steps=list(steps), original=intent)

        # Single-step fallback
        routed = self.route(intent)
        return FlowPlan(
            steps=[
                FlowStep(
                    agent=routed.agent,
                    ui_pattern=routed.ui_pattern,
                    label=f"Run {routed.agent}",
                )
            ],
            original=intent,
        )
