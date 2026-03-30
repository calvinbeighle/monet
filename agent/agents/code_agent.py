"""
agents/code_agent.py

Code review and GitHub agent for Monet OS.
Handles PR review, diff analysis, and GitHub actions.

Approval gates are inserted before any destructive GitHub operations:
merge_pr, approve_pr, push_commit - to prevent accidental changes to repos.

UI pattern: DIFF (side-by-side diff viewer)

When COMPOSIO_API_KEY is set and the user has connected GitHub, tool calls
are routed through GitHubIntegration which delegates to the real Composio
GitHub actions. When no key is set, GitHubIntegration falls back to stubs.
"""

from __future__ import annotations

import uuid
from typing import Any

from models import AgentType
from integrations.github import GitHubIntegration
from .base import BaseAgent


# Tools that require a human approval gate before execution
_APPROVAL_REQUIRED_TOOLS = frozenset({"merge_pr", "approve_pr", "push_commit"})

# GitHub tool definitions in OpenAI function format (used by OpenRouter)
_CODE_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "list_prs",
            "description": (
                "List open pull requests for a GitHub repository. "
                "Returns PR number, title, author, branch, status, and review state."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "repo": {
                        "type": "string",
                        "description": "Repository in owner/name format (e.g. acme/backend).",
                    },
                    "state": {
                        "type": "string",
                        "enum": ["open", "closed", "all"],
                        "description": "Filter PRs by state. Default: open.",
                        "default": "open",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max number of PRs to return. Default 10.",
                        "default": 10,
                    },
                },
                "required": ["repo"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_diff",
            "description": (
                "Read the full diff for a pull request. "
                "Returns the unified diff for all changed files."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "repo": {
                        "type": "string",
                        "description": "Repository in owner/name format.",
                    },
                    "pr_number": {
                        "type": "integer",
                        "description": "The pull request number.",
                    },
                },
                "required": ["repo", "pr_number"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "post_review",
            "description": (
                "Post a code review comment on a pull request. "
                "Can post a top-level review summary or inline comments on specific lines."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "repo": {
                        "type": "string",
                        "description": "Repository in owner/name format.",
                    },
                    "pr_number": {
                        "type": "integer",
                        "description": "The pull request number.",
                    },
                    "body": {
                        "type": "string",
                        "description": "The review comment body (supports markdown).",
                    },
                    "event": {
                        "type": "string",
                        "enum": ["COMMENT", "REQUEST_CHANGES"],
                        "description": "Review type. Use COMMENT for general notes, REQUEST_CHANGES to block merge.",
                        "default": "COMMENT",
                    },
                    "comments": {
                        "type": "array",
                        "description": "Optional inline comments on specific lines.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "path": {"type": "string", "description": "File path."},
                                "line": {"type": "integer", "description": "Line number."},
                                "body": {"type": "string", "description": "Comment text."},
                            },
                            "required": ["path", "line", "body"],
                        },
                    },
                },
                "required": ["repo", "pr_number", "body"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "approve_pr",
            "description": (
                "Approve a pull request on GitHub. "
                "IMPORTANT: This action requires explicit user approval before execution."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "repo": {
                        "type": "string",
                        "description": "Repository in owner/name format.",
                    },
                    "pr_number": {
                        "type": "integer",
                        "description": "The pull request number to approve.",
                    },
                    "body": {
                        "type": "string",
                        "description": "Optional approval comment.",
                    },
                },
                "required": ["repo", "pr_number"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "merge_pr",
            "description": (
                "Merge a pull request on GitHub. "
                "IMPORTANT: This is a destructive action - requires explicit user approval."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "repo": {
                        "type": "string",
                        "description": "Repository in owner/name format.",
                    },
                    "pr_number": {
                        "type": "integer",
                        "description": "The pull request number to merge.",
                    },
                    "merge_method": {
                        "type": "string",
                        "enum": ["merge", "squash", "rebase"],
                        "description": "Merge strategy. Default: squash.",
                        "default": "squash",
                    },
                },
                "required": ["repo", "pr_number"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "push_commit",
            "description": (
                "Push a commit to a GitHub branch. "
                "IMPORTANT: This is a destructive action - requires explicit user approval."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "repo": {
                        "type": "string",
                        "description": "Repository in owner/name format.",
                    },
                    "branch": {
                        "type": "string",
                        "description": "Branch to push to.",
                    },
                    "message": {
                        "type": "string",
                        "description": "Commit message.",
                    },
                    "changes": {
                        "type": "array",
                        "description": "List of file changes to commit.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "path": {"type": "string", "description": "File path."},
                                "content": {"type": "string", "description": "New file content."},
                            },
                            "required": ["path", "content"],
                        },
                    },
                },
                "required": ["repo", "branch", "message", "changes"],
            },
        },
    },
]

_SYSTEM_PROMPT = """
You are Monet's code review assistant - a senior engineer who helps founders
stay on top of their GitHub activity without context-switching.

Your job:
- Summarize what a PR does and why it matters
- Identify bugs, security issues, or architectural concerns
- Suggest specific improvements with code examples when helpful
- Flag anything that should block a merge
- Draft review comments that are clear, specific, and actionable

Guidelines:
- Lead with the most important finding - do not bury the lede.
- Be direct. Skip the pleasantries. Engineers value clarity.
- When reviewing diffs, focus on logic errors, not style (unless the project has no linter).
- Distinguish blocking issues (must fix) from suggestions (nice to have).
- Never approve or merge a PR without explicit confirmation from the user.
- If a change looks risky, say so plainly.

Format your reviews with clear sections: Summary, Key Findings, Suggestions.
""".strip()


class CodeAgent(BaseAgent):
    """
    Agent for GitHub code review and PR management.

    Uses the DIFF UI pattern - the frontend renders a side-by-side diff viewer.
    Approval gates are required before merge_pr, approve_pr, and push_commit.

    GitHubIntegration handles the live/stub decision internally - when
    COMPOSIO_API_KEY is set and the user has connected GitHub, real GitHub
    data is returned. Otherwise, realistic stub data is used.
    """

    def __init__(self, session: Any) -> None:
        super().__init__(session)
        # GitHubIntegration checks COMPOSIO_API_KEY internally and falls
        # back to stubs automatically when the key is absent.
        self._github = GitHubIntegration(user_id="default")

    @property
    def agent_type(self) -> AgentType:
        return AgentType.CODE

    @property
    def system_prompt(self) -> str:
        return _SYSTEM_PROMPT

    @property
    def tools(self) -> list[dict[str, Any]]:
        return _CODE_TOOLS

    def requires_approval(self, tool_name: str) -> bool:
        """
        Require approval before any merge, approve, or push operation.

        Args:
            tool_name: Name of the tool the LLM wants to invoke.

        Returns:
            bool: True for merge_pr, approve_pr, push_commit.
        """
        return tool_name in _APPROVAL_REQUIRED_TOOLS

    async def _execute_tool(
        self, tool_name: str, tool_input: dict[str, Any]
    ) -> Any:
        """
        Execute a GitHub tool call via GitHubIntegration.

        GitHubIntegration routes to real Composio GitHub actions when
        COMPOSIO_API_KEY is set, or returns stub data otherwise.

        Args:
            tool_name: The GitHub tool to execute.
            tool_input: Structured arguments for the tool.

        Returns:
            Any: Tool result from GitHub (live) or stub data.
        """
        if tool_name == "list_prs":
            repo = tool_input.get("repo", "")
            if not repo:
                return {"error": "repo is required for list_prs"}
            return self._github.list_prs(
                repo=repo,
                state=tool_input.get("state", "open"),
                limit=tool_input.get("limit", 10),
            )

        if tool_name == "read_diff":
            repo = tool_input.get("repo", "")
            pr_number = tool_input.get("pr_number", 0)
            if not repo or not pr_number:
                return {"error": "repo and pr_number are required for read_diff"}
            return self._github.get_pr(repo=repo, pr_number=pr_number)

        if tool_name == "post_review":
            repo = tool_input.get("repo", "")
            pr_number = tool_input.get("pr_number", 0)
            if not repo or not pr_number:
                return {"error": "repo and pr_number are required for post_review"}
            return self._github.create_review(
                repo=repo,
                pr_number=pr_number,
                body=tool_input.get("body", ""),
                event=tool_input.get("event", "COMMENT"),
                comments=tool_input.get("comments"),
            )

        if tool_name == "approve_pr":
            repo = tool_input.get("repo", "")
            pr_number = tool_input.get("pr_number", 0)
            if not repo or not pr_number:
                return {"error": "repo and pr_number are required for approve_pr"}
            # Approval is submitted as a review with the APPROVE event
            return self._github.create_review(
                repo=repo,
                pr_number=pr_number,
                body=tool_input.get("body", "Approved."),
                event="APPROVE",
            )

        if tool_name == "merge_pr":
            repo = tool_input.get("repo", "")
            pr_number = tool_input.get("pr_number", 0)
            if not repo or not pr_number:
                return {"error": "repo and pr_number are required for merge_pr"}
            return self._github.merge_pr(
                repo=repo,
                pr_number=pr_number,
                merge_method=tool_input.get("merge_method", "squash"),
            )

        if tool_name == "push_commit":
            # push_commit is not directly supported by Composio's standard
            # GitHub actions in this version - fall back to a stub response.
            branch = tool_input.get("branch", "main")
            return {
                "status": "pushed",
                "branch": branch,
                "sha": uuid.uuid4().hex[:40],
                "message": f"Commit pushed to {branch}.",
                "note": "push_commit uses stub - connect a CI tool for real pushes.",
            }

        return {"error": f"Unknown tool: {tool_name}"}
