"""Tests for the code agent.

Why these tests matter: The code agent handles all GitHub operations (SCOPE.md Feature 2).
Every tool call goes through Nango's proxy endpoint. These tests verify correct URL
construction, header format, and payload structure for the GitHub API via Nango proxy.
"""

import json
from unittest.mock import patch, MagicMock

from agent.agents.code import CodeAgent
from agent.models import UIPattern


class TestCodeAgent:
    def setup_method(self):
        self.agent = CodeAgent()

    def test_name(self):
        assert self.agent.name == "code"

    def test_default_ui_pattern(self):
        assert self.agent.default_ui_pattern == UIPattern.DIFF

    def test_system_prompt_not_empty(self):
        assert len(self.agent.system_prompt) > 0

    def test_tools_defined(self):
        tools = self.agent.tools
        tool_names = {t["name"] for t in tools}
        assert "list_prs" in tool_names
        assert "read_diff" in tool_names
        assert "read_file" in tool_names
        assert "post_review" in tool_names
        assert "approve_pr" in tool_names
        assert "merge_pr" in tool_names
        assert "push_code" in tool_names
        assert "create_branch" in tool_names
        assert "write_file" in tool_names

    def test_tools_have_required_fields(self):
        for tool in self.agent.tools:
            assert "name" in tool
            assert "description" in tool
            assert "input_schema" in tool
            assert tool["input_schema"]["type"] == "object"

    def test_approval_required_tools(self):
        assert "approve_pr" in self.agent.approval_required
        assert "merge_pr" in self.agent.approval_required
        assert "push_code" in self.agent.approval_required
        assert "list_prs" not in self.agent.approval_required
        assert "read_diff" not in self.agent.approval_required
        assert "post_review" not in self.agent.approval_required

    def test_suggestions_not_empty(self):
        assert len(self.agent.suggestions) > 0

    def test_execute_unknown_tool(self):
        result = json.loads(self.agent.execute_tool("nonexistent_tool", {}))
        assert "error" in result

    @patch("agent.nango.httpx.request")
    def test_execute_list_prs(self, mock_request):
        mock_response = MagicMock()
        mock_response.text = json.dumps([{"number": 1, "title": "Fix bug"}])
        mock_response.raise_for_status = MagicMock()
        mock_request.return_value = mock_response

        result = self.agent.execute_tool("list_prs", {"repo": "owner/repo"})
        assert "Fix bug" in result
        call_kwargs = mock_request.call_args[1]
        assert "/proxy/repos/owner/repo/pulls" in call_kwargs["url"]
        assert call_kwargs["headers"]["Provider-Config-Key"] == "github"

    @patch("agent.nango.httpx.request")
    def test_execute_read_diff(self, mock_request):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"diff": "+added line\n-removed line"})
        mock_response.raise_for_status = MagicMock()
        mock_request.return_value = mock_response

        result = self.agent.execute_tool(
            "read_diff", {"repo": "owner/repo", "pr_number": 1}
        )
        assert "diff" in result
        headers = mock_request.call_args[1]["headers"]
        assert headers["Accept"] == "application/vnd.github.v3.diff"

    @patch("agent.nango.httpx.request")
    def test_execute_merge_pr(self, mock_request):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"merged": True})
        mock_response.raise_for_status = MagicMock()
        mock_request.return_value = mock_response

        result = self.agent.execute_tool(
            "merge_pr", {"repo": "owner/repo", "pr_number": 1}
        )
        assert "merged" in result
        call_kwargs = mock_request.call_args[1]
        assert call_kwargs["method"] == "PUT"
        # connectionId should NOT be in body
        assert "connectionId" not in call_kwargs["json"]

    @patch("agent.nango.httpx.request")
    def test_execute_read_file(self, mock_request):
        """read_file should decode base64 content and return clean JSON."""
        import base64 as _b64

        raw_content = "print('hello')"
        encoded = _b64.b64encode(raw_content.encode()).decode()
        mock_response = MagicMock()
        mock_response.text = json.dumps(
            {
                "content": encoded,
                "encoding": "base64",
                "sha": "abc123",
                "size": len(raw_content),
                "path": "src/main.py",
            }
        )
        mock_response.json.return_value = {
            "content": encoded,
            "encoding": "base64",
            "sha": "abc123",
            "size": len(raw_content),
            "path": "src/main.py",
        }
        mock_response.raise_for_status = MagicMock()
        mock_request.return_value = mock_response

        result = self.agent.execute_tool(
            "read_file", {"repo": "owner/repo", "path": "src/main.py"}
        )
        parsed = json.loads(result)
        # Content must be decoded from base64, not the raw base64 string
        assert parsed["content"] == raw_content
        assert parsed["sha"] == "abc123"
        assert parsed["path"] == "src/main.py"
        assert (
            "/proxy/repos/owner/repo/contents/src/main.py"
            in mock_request.call_args[1]["url"]
        )

    @patch("agent.nango.httpx.request")
    def test_execute_post_review(self, mock_request):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"id": 1, "state": "COMMENTED"})
        mock_response.raise_for_status = MagicMock()
        mock_request.return_value = mock_response

        result = self.agent.execute_tool(
            "post_review",
            {"repo": "owner/repo", "pr_number": 42, "body": "LGTM", "event": "COMMENT"},
        )
        assert "COMMENTED" in result
        body = mock_request.call_args[1]["json"]
        assert "connectionId" not in body
        assert body["body"] == "LGTM"

    @patch("agent.nango.httpx.request")
    def test_execute_approve_pr(self, mock_request):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"id": 2, "state": "APPROVED"})
        mock_response.raise_for_status = MagicMock()
        mock_request.return_value = mock_response

        result = self.agent.execute_tool(
            "approve_pr", {"repo": "owner/repo", "pr_number": 42}
        )
        assert "APPROVED" in result
        body = mock_request.call_args[1]["json"]
        assert body["event"] == "APPROVE"
        assert "connectionId" not in body

    @patch("agent.nango.httpx.request")
    def test_execute_create_branch(self, mock_request):
        """create_branch resolves source ref to SHA before creating the new ref."""
        # First call: GET ref to resolve SHA
        ref_response = MagicMock()
        ref_response.json.return_value = {"object": {"sha": "abc123def456"}}
        ref_response.raise_for_status = MagicMock()

        # Second call: POST create ref
        create_response = MagicMock()
        create_response.text = json.dumps({"ref": "refs/heads/feature-x"})
        create_response.raise_for_status = MagicMock()

        mock_request.side_effect = [ref_response, create_response]

        result = self.agent.execute_tool(
            "create_branch", {"repo": "owner/repo", "branch": "feature-x"}
        )
        assert "feature-x" in result
        assert mock_request.call_count == 2
        # Verify first call resolves the ref
        first_call = mock_request.call_args_list[0][1]
        assert "/proxy/repos/owner/repo/git/ref/heads/main" in first_call["url"]
        # Verify second call uses the resolved SHA
        second_call = mock_request.call_args_list[1][1]
        assert second_call["json"]["sha"] == "abc123def456"
        assert second_call["json"]["ref"] == "refs/heads/feature-x"

    @patch("agent.nango.httpx.request")
    def test_execute_write_file_new_file(self, mock_request):
        """write_file on a new file (404 on GET) should PUT without sha."""
        get_response = MagicMock()
        get_response.status_code = 404
        get_response.raise_for_status = MagicMock()

        put_response = MagicMock()
        put_response.text = json.dumps({"content": {"sha": "newsha"}})
        put_response.raise_for_status = MagicMock()

        mock_request.side_effect = [get_response, put_response]

        result = self.agent.execute_tool(
            "write_file",
            {
                "repo": "owner/repo",
                "path": "README.md",
                "content": "# Hello",
                "message": "Add readme",
            },
        )
        assert "sha" in result
        assert mock_request.call_count == 2
        put_call = mock_request.call_args_list[1][1]
        # New file - sha must NOT be in the body
        assert "sha" not in put_call["json"]
        # Content must be base64-encoded
        import base64 as _b64

        assert put_call["json"]["content"] == _b64.b64encode(b"# Hello").decode("ascii")

    @patch("agent.nango.httpx.request")
    def test_execute_write_file_existing_file(self, mock_request):
        """write_file on an existing file (200 on GET) must include the current sha."""
        get_response = MagicMock()
        get_response.status_code = 200
        get_response.json.return_value = {"sha": "existingsha456"}
        get_response.raise_for_status = MagicMock()

        put_response = MagicMock()
        put_response.text = json.dumps({"content": {"sha": "updatedsha"}})
        put_response.raise_for_status = MagicMock()

        mock_request.side_effect = [get_response, put_response]

        result = self.agent.execute_tool(
            "write_file",
            {
                "repo": "owner/repo",
                "path": "README.md",
                "content": "# Updated",
                "message": "Update readme",
            },
        )
        assert "sha" in result
        put_call = mock_request.call_args_list[1][1]
        # Existing file - sha MUST be in the body
        assert put_call["json"]["sha"] == "existingsha456"

    @patch("agent.nango.httpx.request")
    def test_execute_push_code(self, mock_request):
        """push_code uses the 6-step GitHub Git Data API flow."""

        def make_json_mock(data):
            m = MagicMock()
            m.json.return_value = data
            m.raise_for_status = MagicMock()
            return m

        # Step 1: GET ref
        ref_resp = make_json_mock({"object": {"sha": "parentsha"}})
        # Step 2: GET commit
        commit_resp = make_json_mock({"tree": {"sha": "basetreesha"}})
        # Step 3: POST blob (one file)
        blob_resp = make_json_mock({"sha": "blobsha"})
        # Step 4: POST tree
        tree_resp = make_json_mock({"sha": "newtreesha"})
        # Step 5: POST commit
        new_commit_resp = make_json_mock({"sha": "newcommitsha"})
        # Step 6: PATCH ref
        update_ref_resp = make_json_mock(
            {"ref": "refs/heads/feature-x", "object": {"sha": "newcommitsha"}}
        )

        mock_request.side_effect = [
            ref_resp,
            commit_resp,
            blob_resp,
            tree_resp,
            new_commit_resp,
            update_ref_resp,
        ]

        result = self.agent.execute_tool(
            "push_code",
            {
                "repo": "owner/repo",
                "branch": "feature-x",
                "files": [{"path": "main.py", "content": "print('hi')"}],
                "message": "Add main",
            },
        )
        assert "newcommitsha" in result
        # 6 HTTP calls total: get ref, get commit, create blob, create tree, create commit, update ref
        assert mock_request.call_count == 6

        calls = mock_request.call_args_list
        # Step 1: GET ref
        assert "git/ref/heads/feature-x" in calls[0][1]["url"]
        assert calls[0][1]["method"] == "GET"
        # Step 2: GET commit using parent SHA
        assert "git/commits/parentsha" in calls[1][1]["url"]
        assert calls[1][1]["method"] == "GET"
        # Step 3: POST blob
        assert "git/blobs" in calls[2][1]["url"]
        assert calls[2][1]["method"] == "POST"
        assert calls[2][1]["json"]["encoding"] == "utf-8"
        # Step 4: POST tree with base_tree and entries
        assert "git/trees" in calls[3][1]["url"]
        tree_body = calls[3][1]["json"]
        assert tree_body["base_tree"] == "basetreesha"
        assert tree_body["tree"][0]["sha"] == "blobsha"
        assert tree_body["tree"][0]["mode"] == "100644"
        # Step 5: POST commit with correct parents and tree
        assert "git/commits" in calls[4][1]["url"]
        commit_body = calls[4][1]["json"]
        assert commit_body["parents"] == ["parentsha"]
        assert commit_body["tree"] == "newtreesha"
        # Step 6: PATCH ref
        assert "git/refs/heads/feature-x" in calls[5][1]["url"]
        assert calls[5][1]["method"] == "PATCH"
        assert calls[5][1]["json"]["sha"] == "newcommitsha"

    @patch("agent.nango.httpx.request")
    def test_execute_tool_handles_error(self, mock_request):
        mock_request.side_effect = Exception("API error")

        result = json.loads(self.agent.execute_tool("list_prs", {"repo": "owner/repo"}))
        assert "error" in result
        assert "API error" in result["error"]

    @patch("agent.nango.httpx.request")
    def test_proxy_headers_format(self, mock_request):
        """All requests must include Connection-Id and Provider-Config-Key headers."""
        mock_response = MagicMock()
        mock_response.text = json.dumps([])
        mock_response.raise_for_status = MagicMock()
        mock_request.return_value = mock_response

        self.agent.execute_tool("list_prs", {"repo": "owner/repo"})
        headers = mock_request.call_args[1]["headers"]
        assert "Connection-Id" in headers
        assert "Provider-Config-Key" in headers
        assert headers["Provider-Config-Key"] == "github"
