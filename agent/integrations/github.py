"""
integrations/github.py

GitHub integration layer for the Monet agent backend.

Each method checks whether Composio is connected (live mode) and delegates
to the ComposioClient if so. When Composio is not configured (stub mode),
methods return the same realistic mock data that the CodeAgent stubs use -
so the system behaves identically during local development and demos.

Composio action names used:
  GITHUB_LIST_PULL_REQUESTS   - list PRs for a repository
  GITHUB_GET_PULL_REQUEST     - read full PR details including diff
  GITHUB_CREATE_REVIEW        - post a review comment on a PR
  GITHUB_MERGE_PULL_REQUEST   - merge a PR (destructive - requires approval)
  GITHUB_LIST_REPOSITORIES    - list repos accessible to the connected account
"""

from __future__ import annotations

from typing import Any

from .composio_client import ComposioClient


class GitHubIntegration:
    """
    GitHub operations backed by Composio when available, stubs otherwise.

    Instantiate once and inject wherever GitHub access is needed. The
    ComposioClient handles the stub-vs-live decision internally.
    """

    def __init__(self, user_id: str = "default") -> None:
        self._client = ComposioClient()
        self._user_id = user_id

    # ------------------------------------------------------------------
    # Pull request listing
    # ------------------------------------------------------------------

    def list_prs(
        self,
        repo: str,
        state: str = "open",
        limit: int = 10,
    ) -> dict[str, Any]:
        """
        List pull requests for a GitHub repository.

        In stub mode, returns the same mock PRs the CodeAgent produces.
        In live mode, delegates to the Composio GitHub action.

        Args:
            repo: Repository in owner/name format (e.g. acme/backend).
            state: Filter by PR state - "open", "closed", or "all".
            limit: Maximum number of PRs to return.

        Returns:
            dict: {"repo": str, "prs": [...]} where each PR has number,
                  title, author, branch, status, reviews, additions, deletions.
        """
        if not self._client.is_stub:
            result = self._client.execute_tool(
                tool_name="GITHUB_LIST_PULL_REQUESTS",
                tool_input={"owner": repo.split("/")[0], "repo": repo.split("/")[-1], "state": state, "per_page": limit},
                user_id=self._user_id,
            )
            return result  # type: ignore[return-value]

        # Stub response - same data the CodeAgent list_prs stub returns
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

    # ------------------------------------------------------------------
    # PR detail
    # ------------------------------------------------------------------

    def get_pr(self, repo: str, pr_number: int) -> dict[str, Any]:
        """
        Fetch full details and diff for a specific pull request.

        Args:
            repo: Repository in owner/name format.
            pr_number: The pull request number.

        Returns:
            dict: PR details with pr_number and diff fields.
        """
        if not self._client.is_stub:
            result = self._client.execute_tool(
                tool_name="GITHUB_GET_PULL_REQUEST",
                tool_input={
                    "owner": repo.split("/")[0],
                    "repo": repo.split("/")[-1],
                    "pull_number": pr_number,
                },
                user_id=self._user_id,
            )
            return result  # type: ignore[return-value]

        # Stub response - same shape as CodeAgent read_diff stub
        return {
            "pr_number": pr_number,
            "diff": (
                "--- a/agent/main.py\n"
                "+++ b/agent/main.py\n"
                "@@ -1,5 +1,10 @@\n"
                " # stub diff - connect GitHub via Composio for real diffs\n"
                "+async def stream_events(session_id: str):\n"
                "+    # new streaming implementation\n"
                "+    pass\n"
            ),
        }

    # ------------------------------------------------------------------
    # Review creation
    # ------------------------------------------------------------------

    def create_review(
        self,
        repo: str,
        pr_number: int,
        body: str,
        event: str = "COMMENT",
        comments: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """
        Post a code review on a pull request.

        Can submit a top-level review summary or include inline comments on
        specific file lines. Use event="REQUEST_CHANGES" to block merge.

        Args:
            repo: Repository in owner/name format.
            pr_number: The pull request number.
            body: Top-level review comment (supports markdown).
            event: Review type - "COMMENT" or "REQUEST_CHANGES".
            comments: Optional list of inline comments. Each dict requires
                      path (str), line (int), and body (str).

        Returns:
            dict: Review record with status and message fields.
        """
        if not self._client.is_stub:
            tool_input: dict[str, Any] = {
                "owner": repo.split("/")[0],
                "repo": repo.split("/")[-1],
                "pull_number": pr_number,
                "body": body,
                "event": event,
            }
            if comments:
                tool_input["comments"] = comments

            result = self._client.execute_tool(
                tool_name="GITHUB_CREATE_REVIEW",
                tool_input=tool_input,
                user_id=self._user_id,
            )
            return result  # type: ignore[return-value]

        # Stub response
        return {"status": "posted", "message": "Review comment posted (stub)."}

    # ------------------------------------------------------------------
    # PR merge
    # ------------------------------------------------------------------

    def merge_pr(
        self,
        repo: str,
        pr_number: int,
        merge_method: str = "squash",
    ) -> dict[str, Any]:
        """
        Merge a pull request on GitHub.

        This is a destructive operation - callers must ensure explicit user
        approval has been recorded by the agent approval gate before calling
        this method.

        Args:
            repo: Repository in owner/name format.
            pr_number: The pull request number to merge.
            merge_method: Merge strategy - "merge", "squash", or "rebase".

        Returns:
            dict: Merge result with status and message fields.
        """
        if not self._client.is_stub:
            result = self._client.execute_tool(
                tool_name="GITHUB_MERGE_PULL_REQUEST",
                tool_input={
                    "owner": repo.split("/")[0],
                    "repo": repo.split("/")[-1],
                    "pull_number": pr_number,
                    "merge_method": merge_method,
                },
                user_id=self._user_id,
            )
            return result  # type: ignore[return-value]

        # Stub response - same shape as CodeAgent merge_pr stub
        return {"status": "merged", "message": "PR merged (stub)."}

    # ------------------------------------------------------------------
    # Repository listing
    # ------------------------------------------------------------------

    def list_repos(self, limit: int = 20) -> dict[str, Any]:
        """
        List GitHub repositories accessible to the connected account.

        Args:
            limit: Maximum number of repositories to return.

        Returns:
            dict: {"repos": [...]} where each entry has name, full_name,
                  private, and default_branch fields.
        """
        if not self._client.is_stub:
            result = self._client.execute_tool(
                tool_name="GITHUB_LIST_REPOSITORIES",
                tool_input={"per_page": limit},
                user_id=self._user_id,
            )
            return result  # type: ignore[return-value]

        # Stub response
        return {
            "repos": [
                {
                    "name": "backend",
                    "full_name": "acme/backend",
                    "private": True,
                    "default_branch": "main",
                },
                {
                    "name": "frontend",
                    "full_name": "acme/frontend",
                    "private": True,
                    "default_branch": "main",
                },
            ]
        }
