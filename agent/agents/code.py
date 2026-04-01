"""Code agent - handles GitHub operations via Nango proxy.

All API calls go through Nango's proxy endpoint:
  {METHOD} https://api.nango.dev/proxy/{github-api-path}
  Headers: Authorization, Connection-Id, Provider-Config-Key

GitHub API paths are relative to https://api.github.com (the base_url
configured for the github provider in Nango).
"""

import json
import logging
import os

from agent.agents.base import BaseAgent
from agent.models import UIPattern
from agent.nango import PROVIDERS, nango_proxy_request

logger = logging.getLogger(__name__)

# GitHub provider config from Nango
_PROVIDER_CONFIG_KEY = PROVIDERS["github"]["config_key"]
_CONNECTION_ID = os.environ.get(
    "NANGO_GITHUB_CONNECTION_ID", PROVIDERS["github"]["connection_id"]
)


class CodeAgent(BaseAgent):
    """Agent for code operations - PR reviews, code generation, GitHub actions.

    Uses Nango's GitHub integration for OAuth and API access.
    Destructive actions (approve, merge, push) require user approval.
    """

    name = "code"
    description = "Reviews PRs, writes code, and manages your GitHub repos"
    default_ui_pattern = UIPattern.DIFF

    @property
    def system_prompt(self) -> str:
        return (
            "You are Monet's code assistant. You help users with GitHub and code tasks.\n\n"
            "When reviewing a PR:\n"
            "- Read the full diff\n"
            "- Analyze changes for correctness, style, and potential issues\n"
            "- Write a clear review with inline comments where appropriate\n"
            "- Wait for user approval before posting the review\n\n"
            "When writing code:\n"
            "- Understand the request fully before writing\n"
            "- Write clean, well-structured code\n"
            "- Explain your approach\n\n"
            "The approve_pr, merge_pr, and push_code tools require user approval.\n"
            "Always use the tools provided. Never fabricate code review content."
        )

    @property
    def tools(self) -> list[dict]:
        return [
            {
                "name": "list_prs",
                "description": "List open pull requests for a repository.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "repo": {
                            "type": "string",
                            "description": "Repository in owner/name format",
                        },
                        "state": {
                            "type": "string",
                            "description": "PR state: open, closed, or all",
                            "default": "open",
                            "enum": ["open", "closed", "all"],
                        },
                    },
                    "required": ["repo"],
                },
            },
            {
                "name": "read_diff",
                "description": "Read the diff for a specific pull request.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "repo": {
                            "type": "string",
                            "description": "Repository in owner/name format",
                        },
                        "pr_number": {
                            "type": "integer",
                            "description": "Pull request number",
                        },
                    },
                    "required": ["repo", "pr_number"],
                },
            },
            {
                "name": "read_file",
                "description": "Read a file from a repository at a specific ref.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "repo": {
                            "type": "string",
                            "description": "Repository in owner/name format",
                        },
                        "path": {
                            "type": "string",
                            "description": "File path within the repository",
                        },
                        "ref": {
                            "type": "string",
                            "description": "Git ref (branch, tag, or SHA). Defaults to main.",
                            "default": "main",
                        },
                    },
                    "required": ["repo", "path"],
                },
            },
            {
                "name": "post_review",
                "description": "Post a review on a pull request.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "repo": {
                            "type": "string",
                            "description": "Repository in owner/name format",
                        },
                        "pr_number": {
                            "type": "integer",
                            "description": "Pull request number",
                        },
                        "body": {
                            "type": "string",
                            "description": "Review body text",
                        },
                        "event": {
                            "type": "string",
                            "description": "Review action",
                            "enum": ["APPROVE", "REQUEST_CHANGES", "COMMENT"],
                            "default": "COMMENT",
                        },
                    },
                    "required": ["repo", "pr_number", "body"],
                },
            },
            {
                "name": "approve_pr",
                "description": "Approve a pull request. REQUIRES USER APPROVAL.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "repo": {
                            "type": "string",
                            "description": "Repository in owner/name format",
                        },
                        "pr_number": {
                            "type": "integer",
                            "description": "Pull request number",
                        },
                    },
                    "required": ["repo", "pr_number"],
                },
            },
            {
                "name": "merge_pr",
                "description": "Merge a pull request. REQUIRES USER APPROVAL.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "repo": {
                            "type": "string",
                            "description": "Repository in owner/name format",
                        },
                        "pr_number": {
                            "type": "integer",
                            "description": "Pull request number",
                        },
                        "merge_method": {
                            "type": "string",
                            "description": "Merge method to use",
                            "enum": ["merge", "squash", "rebase"],
                            "default": "squash",
                        },
                    },
                    "required": ["repo", "pr_number"],
                },
            },
            {
                "name": "push_code",
                "description": "Push commits to a remote branch. REQUIRES USER APPROVAL.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "repo": {
                            "type": "string",
                            "description": "Repository in owner/name format",
                        },
                        "branch": {
                            "type": "string",
                            "description": "Branch to push to",
                        },
                        "files": {
                            "type": "array",
                            "description": "Files to commit and push",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "path": {"type": "string"},
                                    "content": {"type": "string"},
                                },
                                "required": ["path", "content"],
                            },
                        },
                        "message": {
                            "type": "string",
                            "description": "Commit message",
                        },
                    },
                    "required": ["repo", "branch", "files", "message"],
                },
            },
            {
                "name": "create_branch",
                "description": "Create a new branch from a base ref.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "repo": {
                            "type": "string",
                            "description": "Repository in owner/name format",
                        },
                        "branch": {
                            "type": "string",
                            "description": "New branch name",
                        },
                        "from_ref": {
                            "type": "string",
                            "description": "Base ref to branch from",
                            "default": "main",
                        },
                    },
                    "required": ["repo", "branch"],
                },
            },
            {
                "name": "write_file",
                "description": "Create or update a file in a repository.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "repo": {
                            "type": "string",
                            "description": "Repository in owner/name format",
                        },
                        "path": {
                            "type": "string",
                            "description": "File path within the repository",
                        },
                        "content": {
                            "type": "string",
                            "description": "File content",
                        },
                        "branch": {
                            "type": "string",
                            "description": "Branch to write to",
                            "default": "main",
                        },
                        "message": {
                            "type": "string",
                            "description": "Commit message for the change",
                        },
                    },
                    "required": ["repo", "path", "content", "message"],
                },
            },
        ]

    @property
    def approval_required(self) -> set[str]:
        return {"approve_pr", "merge_pr", "push_code"}

    @property
    def suggestions(self) -> list[str]:
        return ["Review open PRs", "Show the diff", "Run tests", "Create a branch"]

    def execute_tool(self, tool_name: str, parameters: dict) -> str:
        """Execute a GitHub tool via Nango proxy API."""
        try:
            handler = getattr(self, f"_tool_{tool_name}", None)
            if handler is None:
                return json.dumps({"error": f"Unknown tool: {tool_name}"})
            return handler(parameters)
        except Exception as e:
            logger.error("Tool execution failed: %s(%s) - %s", tool_name, parameters, e)
            return json.dumps({"error": str(e)})

    def _tool_list_prs(self, params: dict) -> str:
        repo = params["repo"]
        state = params.get("state", "open")

        resp = nango_proxy_request(
            method="GET",
            path=f"repos/{repo}/pulls",
            provider_config_key=_PROVIDER_CONFIG_KEY,
            connection_id=_CONNECTION_ID,
            params={"state": state},
        )
        resp.raise_for_status()
        return resp.text

    def _tool_read_diff(self, params: dict) -> str:
        repo = params["repo"]
        pr_number = params["pr_number"]

        resp = nango_proxy_request(
            method="GET",
            path=f"repos/{repo}/pulls/{pr_number}",
            provider_config_key=_PROVIDER_CONFIG_KEY,
            connection_id=_CONNECTION_ID,
            extra_headers={"Accept": "application/vnd.github.v3.diff"},
        )
        resp.raise_for_status()
        return resp.text

    def _tool_read_file(self, params: dict) -> str:
        repo = params["repo"]
        path = params["path"]
        ref = params.get("ref", "main")

        resp = nango_proxy_request(
            method="GET",
            path=f"repos/{repo}/contents/{path}",
            provider_config_key=_PROVIDER_CONFIG_KEY,
            connection_id=_CONNECTION_ID,
            params={"ref": ref},
        )
        resp.raise_for_status()
        return resp.text

    def _tool_post_review(self, params: dict) -> str:
        repo = params["repo"]
        pr_number = params["pr_number"]

        resp = nango_proxy_request(
            method="POST",
            path=f"repos/{repo}/pulls/{pr_number}/reviews",
            provider_config_key=_PROVIDER_CONFIG_KEY,
            connection_id=_CONNECTION_ID,
            json_body={
                "body": params["body"],
                "event": params.get("event", "COMMENT"),
            },
        )
        resp.raise_for_status()
        return resp.text

    def _tool_approve_pr(self, params: dict) -> str:
        repo = params["repo"]
        pr_number = params["pr_number"]

        resp = nango_proxy_request(
            method="POST",
            path=f"repos/{repo}/pulls/{pr_number}/reviews",
            provider_config_key=_PROVIDER_CONFIG_KEY,
            connection_id=_CONNECTION_ID,
            json_body={
                "body": "Approved via Monet",
                "event": "APPROVE",
            },
        )
        resp.raise_for_status()
        return resp.text

    def _tool_merge_pr(self, params: dict) -> str:
        repo = params["repo"]
        pr_number = params["pr_number"]

        resp = nango_proxy_request(
            method="PUT",
            path=f"repos/{repo}/pulls/{pr_number}/merge",
            provider_config_key=_PROVIDER_CONFIG_KEY,
            connection_id=_CONNECTION_ID,
            json_body={"merge_method": params.get("merge_method", "squash")},
        )
        resp.raise_for_status()
        return resp.text

    def _tool_push_code(self, params: dict) -> str:
        repo = params["repo"]

        resp = nango_proxy_request(
            method="POST",
            path=f"repos/{repo}/git/commits",
            provider_config_key=_PROVIDER_CONFIG_KEY,
            connection_id=_CONNECTION_ID,
            json_body={
                "branch": params["branch"],
                "files": params["files"],
                "message": params["message"],
            },
        )
        resp.raise_for_status()
        return resp.text

    def _tool_create_branch(self, params: dict) -> str:
        """Create a branch by resolving the source ref to a SHA first.

        The GitHub API requires a full 40-char commit SHA for creating refs,
        not a branch name. This method first resolves the source branch to
        its HEAD SHA, then creates the new ref.
        """
        repo = params["repo"]
        from_ref = params.get("from_ref", "main")

        # Resolve the source branch name to its commit SHA
        ref_resp = nango_proxy_request(
            method="GET",
            path=f"repos/{repo}/git/ref/heads/{from_ref}",
            provider_config_key=_PROVIDER_CONFIG_KEY,
            connection_id=_CONNECTION_ID,
        )
        ref_resp.raise_for_status()
        sha = ref_resp.json()["object"]["sha"]

        resp = nango_proxy_request(
            method="POST",
            path=f"repos/{repo}/git/refs",
            provider_config_key=_PROVIDER_CONFIG_KEY,
            connection_id=_CONNECTION_ID,
            json_body={
                "ref": f"refs/heads/{params['branch']}",
                "sha": sha,
            },
        )
        resp.raise_for_status()
        return resp.text

    def _tool_write_file(self, params: dict) -> str:
        repo = params["repo"]
        path = params["path"]

        resp = nango_proxy_request(
            method="PUT",
            path=f"repos/{repo}/contents/{path}",
            provider_config_key=_PROVIDER_CONFIG_KEY,
            connection_id=_CONNECTION_ID,
            json_body={
                "content": params["content"],
                "message": params["message"],
                "branch": params.get("branch", "main"),
            },
        )
        resp.raise_for_status()
        return resp.text
