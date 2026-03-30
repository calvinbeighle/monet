"""
agents/code_agent.py

Code review and GitHub agent for Monet OS.
Handles PR review, diff analysis, and GitHub actions.

Approval gates are inserted before any destructive GitHub operations:
merge_pr, approve_pr, push_commit - to prevent accidental changes to repos.

UI pattern: DIFF (side-by-side diff viewer)
"""

from __future__ import annotations

from typing import Any

from models import AgentType
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
    """

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
        Execute a GitHub tool call.

        Currently stub implementations - replace with real GitHub API calls
        (via PyGithub or direct REST) when the GitHub OAuth integration is ready.

        Args:
            tool_name: The GitHub tool to execute.
            tool_input: Structured arguments for the tool.

        Returns:
            Any: Simulated tool result.
        """
        if tool_name == "list_prs":
            repo = tool_input.get("repo", "unknown/repo")
            return {
                "repo": repo,
                "prs": [
                    {
                        "number": 42,
                        "title": "feat: add streaming support to agent layer",
                        "author": "dev@team.com",
                        "branch": "feature/streaming",
                        "status": "open",
                        "reviews": "1 approval needed",
                        "additions": 312,
                        "deletions": 45,
                    },
                    {
                        "number": 41,
                        "title": "fix: correct session state race condition",
                        "author": "eng@team.com",
                        "branch": "fix/session-race",
                        "status": "open",
                        "reviews": "changes requested",
                        "additions": 18,
                        "deletions": 7,
                    },
                ],
            }

        if tool_name == "read_diff":
            pr_number = tool_input.get("pr_number", 0)
            return {
                "pr_number": pr_number,
                "diff": (
                    "--- a/agent/main.py\n"
                    "+++ b/agent/main.py\n"
                    "@@ -1,5 +1,10 @@\n"
                    " # stub diff - connect GitHub API for real diffs\n"
                    "+async def stream_events(session_id: str):\n"
                    "+    # new streaming implementation\n"
                    "+    pass\n"
                ),
            }

        if tool_name == "post_review":
            return {"status": "posted", "message": "Review comment posted (stub)."}

        if tool_name == "approve_pr":
            return {"status": "approved", "message": "PR approved (stub)."}

        if tool_name == "merge_pr":
            return {"status": "merged", "message": "PR merged (stub)."}

        if tool_name == "push_commit":
            return {"status": "pushed", "message": "Commit pushed (stub)."}

        return f"[stub] Unknown tool: {tool_name}"
