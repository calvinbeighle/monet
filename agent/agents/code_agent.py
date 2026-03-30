"""
agents/code_agent.py

Code review and GitHub agent for Monet OS.
Handles PR review, diff analysis, and GitHub actions.

Approval gates are inserted before any destructive GitHub operations:
merge_pr, approve_pr, push_commit - to prevent accidental changes to repos.

UI pattern: DIFF (side-by-side diff viewer)
"""

from __future__ import annotations

import uuid
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
            repo = tool_input.get("repo", "acme/backend")
            return {
                "repo": repo,
                "open_count": 3,
                "prs": [
                    {
                        "number": 47,
                        "title": "feat: resumable SSE streams for agent sessions",
                        "author": "maya-dev",
                        "branch": "feature/resumable-streams",
                        "base": "main",
                        "status": "open",
                        "review_status": "review_required",
                        "checks": "passing",
                        "additions": 412,
                        "deletions": 58,
                        "files_changed": 6,
                        "created_at": "2026-03-28T14:00:00Z",
                        "description": (
                            "Implements resumable SSE streams so clients can reconnect "
                            "mid-session without losing events. Adds a cursor-based replay "
                            "mechanism in the event store."
                        ),
                    },
                    {
                        "number": 46,
                        "title": "fix: session status race condition under concurrent approvals",
                        "author": "tom-eng",
                        "branch": "fix/approval-race",
                        "base": "main",
                        "status": "open",
                        "review_status": "changes_requested",
                        "checks": "passing",
                        "additions": 34,
                        "deletions": 12,
                        "files_changed": 2,
                        "created_at": "2026-03-27T18:30:00Z",
                        "description": (
                            "Fixes a race where two simultaneous approval requests for the "
                            "same action_id could both set approved=True and release the gate twice."
                        ),
                    },
                    {
                        "number": 44,
                        "title": "chore: upgrade httpx to 0.28 and pin pydantic to 2.7",
                        "author": "bot-dependabot",
                        "branch": "deps/httpx-0.28",
                        "base": "main",
                        "status": "open",
                        "review_status": "review_required",
                        "checks": "failing",
                        "additions": 8,
                        "deletions": 8,
                        "files_changed": 2,
                        "created_at": "2026-03-26T09:00:00Z",
                        "description": "Automated dependency update. CI is red - breaking change in httpx timeout API.",
                    },
                ],
            }

        if tool_name == "read_diff":
            pr_number = tool_input.get("pr_number", 47)
            repo = tool_input.get("repo", "acme/backend")
            diffs: dict[int, str] = {
                47: (
                    "diff --git a/agent/main.py b/agent/main.py\n"
                    "index a3f2c01..b7d9e44 100644\n"
                    "--- a/agent/main.py\n"
                    "+++ b/agent/main.py\n"
                    "@@ -191,6 +191,8 @@ async def stream_events(session_id: str) -> EventSourceResponse:\n"
                    "     async def event_generator() -> AsyncIterator[dict[str, str]]:\n"
                    '         \"\"\"Yield SSE events until the session reaches a terminal state.\"\"\"\n'
                    "         session, _ = _sessions[session_id]\n"
                    "-        cursor = 0  # index of next event to yield\n"
                    "+        # Accept Last-Event-ID header for reconnect cursor\n"
                    "+        last_id = request.headers.get('last-event-id', '0')\n"
                    "+        cursor = int(last_id) if last_id.isdigit() else 0\n"
                    "\n"
                    "         while True:\n"
                    "             events = session.events\n"
                    "diff --git a/agent/models.py b/agent/models.py\n"
                    "--- a/agent/models.py\n"
                    "+++ b/agent/models.py\n"
                    "@@ -180,6 +180,10 @@ class SessionState(BaseModel):\n"
                    "     def add_event(self, event: AgentEvent) -> None:\n"
                    '         \"\"\"Append an event and update the session timestamp.\"\"\"\n'
                    "         self.events.append(event)\n"
                    "         self.updated_at = datetime.utcnow()\n"
                    "+\n"
                    "+    def events_from(self, cursor: int) -> list[AgentEvent]:\n"
                    '+        \"\"\"Return all events at or after the given sequence cursor.\"\"\"\n'
                    "         return self.events[cursor:]\n"
                ),
                46: (
                    "diff --git a/agent/agents/base.py b/agent/agents/base.py\n"
                    "--- a/agent/agents/base.py\n"
                    "+++ b/agent/agents/base.py\n"
                    "@@ -390,7 +390,12 @@ class BaseAgent(ABC):\n"
                    "         gate = asyncio.Event()\n"
                    "         self._approval_events[action_id] = gate\n"
                    "\n"
                    "-        await gate.wait()\n"
                    "-        del self._approval_events[action_id]\n"
                    "+        # Use a lock to prevent double-release under concurrent approvals\n"
                    "+        async with self._approval_lock:\n"
                    "+            if action_id in self._approval_events:\n"
                    "+                await gate.wait()\n"
                    "+                del self._approval_events[action_id]\n"
                    "+            # else: already resolved by a concurrent caller, skip\n"
                ),
            }
            default_diff = (
                f"diff --git a/README.md b/README.md\n"
                f"--- a/README.md\n"
                f"+++ b/README.md\n"
                f"@@ -1,1 +1,1 @@\n"
                f"-Old content\n"
                f"+New content for PR #{pr_number}\n"
            )
            return {
                "repo": repo,
                "pr_number": pr_number,
                "diff": diffs.get(pr_number, default_diff),
            }

        if tool_name == "post_review":
            pr_number = tool_input.get("pr_number", 0)
            event = tool_input.get("event", "COMMENT")
            return {
                "status": "posted",
                "pr_number": pr_number,
                "review_id": f"review_{uuid.uuid4().hex[:8]}",
                "event": event,
                "message": f"Review posted on PR #{pr_number}.",
            }

        if tool_name == "approve_pr":
            pr_number = tool_input.get("pr_number", 0)
            return {
                "status": "approved",
                "pr_number": pr_number,
                "review_id": f"review_{uuid.uuid4().hex[:8]}",
                "message": f"PR #{pr_number} approved.",
            }

        if tool_name == "merge_pr":
            pr_number = tool_input.get("pr_number", 0)
            method = tool_input.get("merge_method", "squash")
            return {
                "status": "merged",
                "pr_number": pr_number,
                "merge_method": method,
                "sha": uuid.uuid4().hex[:40],
                "message": f"PR #{pr_number} merged via {method}.",
            }

        if tool_name == "push_commit":
            branch = tool_input.get("branch", "main")
            return {
                "status": "pushed",
                "branch": branch,
                "sha": uuid.uuid4().hex[:40],
                "message": f"Commit pushed to {branch}.",
            }

        return {"error": f"Unknown tool: {tool_name}"}
