"""Intent router - maps user intents to agents and UI patterns.

Uses keyword matching first, then falls back to Claude Haiku classification
when no keyword rule matches.
"""

import json
import logging
import re
from typing import Optional

import anthropic

from agent.models import FlowPlan, FlowStep, RoutedIntent, UIPattern

logger = logging.getLogger(__name__)

VALID_AGENTS = {"email", "code", "planning", "writing", "general"}
VALID_UI_PATTERNS = {p.value for p in UIPattern}

CLASSIFICATION_PROMPT = """You are an intent classifier for Monet OS. Given a user intent, classify it into exactly one agent and one UI pattern.

Agents:
- email: anything about emails, inbox, messages, correspondence, newsletters, mail
- code: programming, debugging, repositories, PRs, APIs, software, scripts, functions
- writing: documents, articles, blogs, essays, reports, memos, notes, proofreading, Google Docs
- planning: project planning, sprints, brainstorming, roadmaps, task organization, architecture
- general: anything that does not fit the above categories

UI patterns:
- tinder: batch decisions on multiple similar items (e.g. processing many emails)
- chat: conversational back-and-forth (e.g. drafting a single email, writing code)
- diff: side-by-side comparison (e.g. code review, comparing versions)
- whiteboard: visual canvas with nodes and connections (e.g. planning, brainstorming)

Respond with ONLY a JSON object, no other text:
{"agent": "<agent_name>", "ui_pattern": "<pattern_name>"}"""


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
            r"\b(document|doc|article|blog|essay|report|memo|notes|summarize|summary|rewrite|proofread|google doc)\b"
            r"|\bwrite\b.*\b(doc|article|blog|essay|report|memo|document)\b",
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

    Uses keyword matching against a prioritized rule set (first match wins).
    When no keyword rule matches, falls back to Claude Haiku classification
    for natural language understanding.
    """

    def __init__(self, client: Optional[anthropic.Anthropic] = None):
        self._client = client

    def _classify_with_llm(self, intent: str) -> Optional[RoutedIntent]:
        """Use Claude Haiku to classify intents that keyword rules miss."""
        if self._client is None:
            return None
        try:
            response = self._client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=100,
                messages=[{"role": "user", "content": intent}],
                system=CLASSIFICATION_PROMPT,
            )
            text = response.content[0].text.strip()
            parsed = json.loads(text)
            agent = parsed.get("agent", "general")
            ui_pattern = parsed.get("ui_pattern", "chat")
            if agent not in VALID_AGENTS:
                agent = "general"
            if ui_pattern not in VALID_UI_PATTERNS:
                ui_pattern = UIPattern.CHAT.value
            return RoutedIntent(agent=agent, ui_pattern=ui_pattern, original=intent)
        except Exception as e:
            logger.warning("LLM classification failed, using default: %s", e)
            return None

    def route(self, intent: str) -> RoutedIntent:
        for pattern, agent, ui_pattern in ROUTING_RULES:
            if pattern.search(intent):
                return RoutedIntent(
                    agent=agent, ui_pattern=ui_pattern.value, original=intent
                )

        # Keyword rules didn't match - try LLM classification
        llm_result = self._classify_with_llm(intent)
        if llm_result is not None:
            return llm_result

        # Final fallback: general agent with chat UI
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
