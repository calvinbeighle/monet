"""
orchestrator.py - Central intent router and agent coordinator for Monet.

The Orchestrator is the top-level brain that interprets raw user text from
the command bar and decides how to handle it:

- Route to a single agent (email, code, planning)
- Fan out to multiple agents in parallel
- Answer directly without involving an agent

Uses Claude Sonnet for smart routing decisions - cost is justified because
this runs once per user command, not on a schedule.
"""

from __future__ import annotations

import json
import logging

import anthropic
import config

logger = logging.getLogger(__name__)

# System prompt that instructs the model to emit structured routing decisions
_ORCHESTRATOR_SYSTEM = """You are the Monet orchestrator. Your job is to analyze a user's request and decide how to handle it.

You must respond with valid JSON only - no prose, no markdown, just a raw JSON object.

Routing options:

1. Delegate to a single agent:
{"action": "delegate", "agent": "email", "task": "triage inbox and draft replies"}
{"action": "delegate", "agent": "code", "task": "review open pull requests"}
{"action": "delegate", "agent": "planning", "task": "create a sprint plan for next week"}

2. Fan out to multiple agents simultaneously:
{"action": "multi", "agents": [{"agent": "email", "task": "check inbox"}, {"agent": "code", "task": "check PRs"}]}

3. Answer directly (no agent needed):
{"action": "answer", "response": "Here is the answer to your question..."}

Agent capabilities:
- email: reads Gmail, drafts replies, triages inbox
- code: reads GitHub PRs, runs code review, checks CI status
- planning: creates sprint docs, updates Notion, reviews todos

Only use "answer" for questions that don't require real-time data (tool access) to resolve.
"""


def route_intent(text: str) -> dict:
    """
    Uses Claude Sonnet to classify a user's intent and produce a routing decision.

    Returns a structured dict indicating how the request should be handled:
    - "delegate": send to one agent with a specific task
    - "multi": fan out to multiple agents in parallel
    - "answer": respond directly without an agent

    Falls back gracefully to a direct answer if JSON parsing fails.

    Args:
        text: Raw user input from the command bar.

    Returns:
        Routing dict with "action" key plus agent/task info or direct response.
    """
    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)

    try:
        response = client.messages.create(
            model=config.SONNET_MODEL,
            max_tokens=300,
            system=_ORCHESTRATOR_SYSTEM,
            messages=[{"role": "user", "content": text}],
        )

        raw_text = response.content[0].text.strip()
        routing = json.loads(raw_text)
        logger.info("Orchestrator routed '%s' -> action=%s", text[:60], routing.get("action"))
        return routing

    except json.JSONDecodeError as exc:
        logger.warning("Orchestrator returned non-JSON: %s", exc)
        # Fall back to a direct answer with whatever text the model returned
        return {
            "action": "answer",
            "response": response.content[0].text if response else "I couldn't process that request.",
        }

    except Exception as exc:
        logger.exception("Orchestrator error routing '%s': %s", text[:60], exc)
        raise
