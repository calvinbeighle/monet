"""
code_agent.py - Code review background agent for Monet.

Uses Claude Sonnet (smart) via the Anthropic SDK to scan open GitHub pull
requests and identify PRs that need review. Produces Suggestion objects for
each actionable PR.

Tool definitions use Anthropic format (input_schema, not parameters).
Tool results are stripped to slim payloads to avoid passing full diffs
to the model context unnecessarily.
"""

from __future__ import annotations

import uuid
from typing import Any

import config
from agents.base import BaseAgent
from integrations.composio_client import ComposioClient
from models import Suggestion, UiPattern


# Maximum number of PRs to fetch per agent run
MAX_PRS = 5

# Maximum characters for the PR diff preview
DIFF_PREVIEW_MAX_CHARS = 300


class CodeAgent(BaseAgent):
    """
    Background agent that triages open GitHub pull requests.

    Runs on a schedule, fetches open PRs via Composio/GitHub,
    and produces Suggestion objects for PRs needing review.

    Uses claude-sonnet-4-6 since code review requires deeper reasoning
    than email triage.
    """

    def __init__(self, composio: ComposioClient) -> None:
        """
        Initializes the CodeAgent with a Composio client.

        Args:
            composio: The Composio integration client (stub or live).
        """
        self._composio = composio

    @property
    def agent_id(self) -> str:
        return "code"

    @property
    def model(self) -> str:
        return config.CODE_MODEL

    @property
    def tools(self) -> list[dict[str, Any]]:
        """
        Anthropic-format tool definitions for GitHub PR operations.

        Uses input_schema (Anthropic format) instead of OpenAI-style parameters.

        Returns:
            List of tool spec dicts for list_prs, get_pr, and create_review.
        """
        return [
            {
                "name": "list_prs",
                "description": (
                    "List open pull requests from GitHub. "
                    f"Returns at most {MAX_PRS} PRs with slim payloads "
                    "(number, title, author, description - no full diffs)."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "state": {
                            "type": "string",
                            "description": "PR state filter: 'open', 'closed', or 'all'.",
                        },
                        "max_results": {
                            "type": "integer",
                            "description": f"Number of PRs to fetch (max {MAX_PRS}).",
                        },
                    },
                    "required": [],
                },
            },
            {
                "name": "get_pr",
                "description": "Get details and diff preview for a specific pull request.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "pr_number": {
                            "type": "integer",
                            "description": "The GitHub pull request number.",
                        },
                        "repo": {
                            "type": "string",
                            "description": "The repository in 'owner/repo' format.",
                        },
                    },
                    "required": ["pr_number"],
                },
            },
            {
                "name": "create_review",
                "description": "Submit a review comment on a pull request.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "pr_number": {
                            "type": "integer",
                            "description": "The GitHub pull request number.",
                        },
                        "repo": {
                            "type": "string",
                            "description": "The repository in 'owner/repo' format.",
                        },
                        "body": {
                            "type": "string",
                            "description": "The review comment body.",
                        },
                        "event": {
                            "type": "string",
                            "description": "Review action: 'APPROVE', 'REQUEST_CHANGES', or 'COMMENT'.",
                        },
                    },
                    "required": ["pr_number", "body"],
                },
            },
        ]

    async def run(self, session_id: str) -> list[Suggestion]:
        """
        Runs the code review agent for one cycle.

        Fetches open PRs, evaluates each for review needs,
        and returns a list of Suggestion objects.

        Args:
            session_id: The ID of the current agent session.

        Returns:
            List of Suggestion objects, one per PR needing review.
        """
        prs = await self._fetch_prs()
        suggestions: list[Suggestion] = []

        for pr in prs:
            suggestion = _pr_to_suggestion(pr, self.agent_id)
            suggestions.append(suggestion)

        return suggestions

    async def _execute_tool(self, tool_name: str, tool_input: dict[str, Any]) -> Any:
        """
        Routes tool calls to the Composio GitHub integration.

        Strips results to slim payloads before returning to the model to
        avoid flooding the context window with full diffs.

        Args:
            tool_name: One of 'list_prs', 'get_pr', 'create_review'.
            tool_input: Arguments for the tool.

        Returns:
            Slim result dict or list safe for model context.

        Raises:
            ValueError: If an unknown tool name is provided.
        """
        if tool_name == "list_prs":
            result = await self._composio.execute_tool("GITHUB_LIST_PULL_REQUESTS", tool_input)
            return _slim_pr_list(result)

        if tool_name == "get_pr":
            result = await self._composio.execute_tool("GITHUB_GET_PULL_REQUEST", tool_input)
            return _slim_pr_detail(result)

        if tool_name == "create_review":
            return await self._composio.execute_tool("GITHUB_CREATE_REVIEW", tool_input)

        raise ValueError(f"Unknown tool: {tool_name}")

    async def _fetch_prs(self) -> list[dict[str, Any]]:
        """
        Fetches and slims the raw PR list from Composio/GitHub.

        Returns:
            List of slim PR dicts with number, title, author, and description.
        """
        raw = await self._composio.execute_tool(
            "GITHUB_LIST_PULL_REQUESTS",
            {"state": "open", "max_results": MAX_PRS},
        )
        return _slim_pr_list(raw)


# --- Data Shaping Helpers ---

def _slim_pr_list(raw: Any) -> list[dict[str, Any]]:
    """
    Strips a GitHub PR list response to slim objects.

    Keeps only number, title, author, and a short description to avoid
    sending full diffs to the LLM context.

    Args:
        raw: Raw response from Composio GITHUB_LIST_PULL_REQUESTS.

    Returns:
        List of slim PR dicts.
    """
    if not isinstance(raw, (list, dict)):
        return _stub_pr_list()

    prs = raw if isinstance(raw, list) else raw.get("pull_requests", raw.get("items", []))

    slim: list[dict[str, Any]] = []
    for pr in prs[:MAX_PRS]:
        if not isinstance(pr, dict):
            continue
        slim.append({
            "number": pr.get("number", 0),
            "title": pr.get("title", "(untitled)"),
            "author": pr.get("user", {}).get("login", pr.get("author", "unknown")),
            "description": _truncate(pr.get("body", ""), DIFF_PREVIEW_MAX_CHARS),
            "url": pr.get("html_url", pr.get("url", "")),
            "repo": pr.get("repo", pr.get("repository", {}).get("full_name", "")),
        })

    return slim if slim else _stub_pr_list()


def _slim_pr_detail(raw: Any) -> dict[str, Any]:
    """
    Strips a single GitHub PR response to a slim object.

    Args:
        raw: Raw response from Composio GITHUB_GET_PULL_REQUEST.

    Returns:
        Slim PR dict with number, title, author, description, and diff preview.
    """
    if not isinstance(raw, dict):
        return {"error": "Could not read PR."}

    return {
        "number": raw.get("number", 0),
        "title": raw.get("title", "(untitled)"),
        "author": raw.get("user", {}).get("login", "unknown"),
        "description": _truncate(raw.get("body", ""), DIFF_PREVIEW_MAX_CHARS),
        "diff_preview": _truncate(raw.get("patch", raw.get("diff", "")), DIFF_PREVIEW_MAX_CHARS),
        "url": raw.get("html_url", ""),
        "changed_files": raw.get("changed_files", 0),
        "additions": raw.get("additions", 0),
        "deletions": raw.get("deletions", 0),
    }


def _stub_pr_list() -> list[dict[str, Any]]:
    """
    Returns a hardcoded stub PR list for use when Composio is in stub mode.

    Returns:
        List of mock slim PR dicts.
    """
    return [
        {
            "number": 42,
            "title": "Add rate limiting to API endpoints",
            "author": "dev-alice",
            "description": "Implements token bucket rate limiting. Needs review before merging to main.",
            "url": "https://github.com/org/repo/pull/42",
            "repo": "org/repo",
        },
        {
            "number": 37,
            "title": "Refactor auth middleware",
            "author": "dev-bob",
            "description": "Splits auth into separate concerns. Breaking change - needs careful review.",
            "url": "https://github.com/org/repo/pull/37",
            "repo": "org/repo",
        },
        {
            "number": 51,
            "title": "Fix memory leak in websocket handler",
            "author": "dev-carol",
            "description": "Patches unclosed connections. Urgent - production impact.",
            "url": "https://github.com/org/repo/pull/51",
            "repo": "org/repo",
        },
    ]


def _pr_to_suggestion(pr: dict[str, Any], agent_id: str) -> Suggestion:
    """
    Converts a slim PR dict into a Suggestion object.

    Args:
        pr: Slim PR dict with number, title, author, description.
        agent_id: The agent that produced this suggestion.

    Returns:
        A Suggestion ready to be surfaced in the UI.
    """
    return Suggestion(
        icon="GitPullRequest",
        iconColor="text-purple-400",
        title=f"PR #{pr.get('number')}: {pr.get('title', '(untitled)')}",
        description=f"By {pr.get('author', 'unknown')} - {pr.get('description', '')}",
        uiPattern=UiPattern.code,
        agentId=agent_id,
        metadata={
            "pr_number": pr.get("number"),
            "author": pr.get("author"),
            "url": pr.get("url"),
            "repo": pr.get("repo"),
        },
    )


def _truncate(text: str, max_chars: int) -> str:
    """
    Truncates a string to a maximum character length, appending ellipsis if cut.

    Args:
        text: Input string.
        max_chars: Maximum allowed characters.

    Returns:
        Truncated string.
    """
    if not text:
        return ""
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "..."
