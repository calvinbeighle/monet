"""Tests for the writing agent.

Why these tests matter: The writing agent handles Google Docs operations (SCOPE.md Feature 2).
Tool calls go through Nango's proxy endpoint using two providers: google-docs for document
CRUD and google-drive for listing/searching files. These tests verify correct URL
construction, header format, and payload structure.
"""

import json
from unittest.mock import patch, MagicMock, call

from agent.agents.writing import WritingAgent
from agent.models import UIPattern


class TestWritingAgent:
    def setup_method(self):
        self.agent = WritingAgent()

    def test_name(self):
        assert self.agent.name == "writing"

    def test_default_ui_pattern(self):
        assert self.agent.default_ui_pattern == UIPattern.CHAT

    def test_system_prompt_not_empty(self):
        assert len(self.agent.system_prompt) > 0

    def test_system_prompt_mentions_documents(self):
        assert "document" in self.agent.system_prompt.lower()

    def test_tools_defined(self):
        tools = self.agent.tools
        tool_names = {t["name"] for t in tools}
        assert "list_documents" in tool_names
        assert "read_document" in tool_names
        assert "create_document" in tool_names
        assert "edit_document" in tool_names
        assert "search_documents" in tool_names

    def test_tools_count(self):
        assert len(self.agent.tools) == 5

    def test_tools_have_required_fields(self):
        for tool in self.agent.tools:
            assert "name" in tool
            assert "description" in tool
            assert "input_schema" in tool
            assert tool["input_schema"]["type"] == "object"

    def test_approval_required_tools(self):
        assert "create_document" in self.agent.approval_required
        assert "edit_document" in self.agent.approval_required
        assert "list_documents" not in self.agent.approval_required
        assert "read_document" not in self.agent.approval_required
        assert "search_documents" not in self.agent.approval_required

    def test_suggestions_not_empty(self):
        assert len(self.agent.suggestions) > 0

    def test_description_not_empty(self):
        assert len(self.agent.description) > 0

    def test_execute_unknown_tool(self):
        result = json.loads(self.agent.execute_tool("nonexistent_tool", {}))
        assert "error" in result

    @patch("agent.nango.httpx.request")
    def test_execute_list_documents(self, mock_request):
        mock_response = MagicMock()
        mock_response.text = json.dumps(
            {
                "files": [
                    {"id": "doc1", "name": "Test Doc", "modifiedTime": "2026-03-31"}
                ]
            }
        )
        mock_response.raise_for_status = MagicMock()
        mock_request.return_value = mock_response

        result = self.agent.execute_tool("list_documents", {"max_results": 5})
        assert "files" in result
        mock_request.assert_called_once()
        call_kwargs = mock_request.call_args[1]
        assert "/proxy/drive/v3/files" in call_kwargs["url"]
        assert call_kwargs["params"]["pageSize"] == 5
        assert call_kwargs["headers"]["Provider-Config-Key"] == "google-drive"

    @patch("agent.nango.httpx.request")
    def test_execute_list_documents_default_max(self, mock_request):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"files": []})
        mock_response.raise_for_status = MagicMock()
        mock_request.return_value = mock_response

        self.agent.execute_tool("list_documents", {})
        call_kwargs = mock_request.call_args[1]
        assert call_kwargs["params"]["pageSize"] == 20

    @patch("agent.nango.httpx.request")
    def test_execute_read_document(self, mock_request):
        mock_response = MagicMock()
        mock_response.text = json.dumps(
            {"documentId": "doc1", "title": "Test", "body": {"content": "Hello world"}}
        )
        mock_response.raise_for_status = MagicMock()
        mock_request.return_value = mock_response

        result = self.agent.execute_tool("read_document", {"document_id": "doc1"})
        assert "doc1" in result
        assert "/proxy/v1/documents/doc1" in mock_request.call_args[1]["url"]
        assert (
            mock_request.call_args[1]["headers"]["Provider-Config-Key"] == "google-docs"
        )

    @patch("agent.nango.httpx.request")
    def test_execute_create_document(self, mock_request):
        # First call creates the doc, second call inserts content via batchUpdate
        create_response = MagicMock()
        create_response.text = json.dumps({"documentId": "new_doc", "title": "My Doc"})
        create_response.json.return_value = {"documentId": "new_doc", "title": "My Doc"}
        create_response.raise_for_status = MagicMock()

        update_response = MagicMock()
        update_response.text = json.dumps({"replies": []})
        update_response.raise_for_status = MagicMock()

        mock_request.side_effect = [create_response, update_response]

        result = self.agent.execute_tool(
            "create_document",
            {"title": "My Doc", "content": "Document body text"},
        )
        assert "new_doc" in result
        # First call: POST to create document
        first_call = mock_request.call_args_list[0][1]
        assert first_call["method"] == "POST"
        assert "/proxy/v1/documents" in first_call["url"]
        assert first_call["json"]["title"] == "My Doc"
        # Second call: POST batchUpdate to insert content
        second_call = mock_request.call_args_list[1][1]
        assert "batchUpdate" in second_call["url"]
        assert (
            second_call["json"]["requests"][0]["insertText"]["text"]
            == "Document body text"
        )

    @patch("agent.nango.httpx.request")
    def test_execute_edit_document_replace(self, mock_request):
        # First call: GET to read doc (for end index), second call: POST batchUpdate
        doc_response = MagicMock()
        doc_response.json.return_value = {
            "documentId": "doc1",
            "body": {"content": [{"endIndex": 50}]},
        }
        doc_response.raise_for_status = MagicMock()

        update_response = MagicMock()
        update_response.text = json.dumps({"replies": []})
        update_response.raise_for_status = MagicMock()

        mock_request.side_effect = [doc_response, update_response]

        result = self.agent.execute_tool(
            "edit_document",
            {"document_id": "doc1", "content": "New content", "mode": "replace"},
        )
        assert "replies" in result
        # Second call should be batchUpdate with delete + insert
        update_call = mock_request.call_args_list[1][1]
        assert "batchUpdate" in update_call["url"]
        requests = update_call["json"]["requests"]
        assert any("deleteContentRange" in r for r in requests)
        assert any("insertText" in r for r in requests)

    @patch("agent.nango.httpx.request")
    def test_execute_edit_document_append(self, mock_request):
        # First call: GET to read doc, second call: POST batchUpdate
        doc_response = MagicMock()
        doc_response.json.return_value = {
            "documentId": "doc1",
            "body": {"content": [{"endIndex": 50}]},
        }
        doc_response.raise_for_status = MagicMock()

        update_response = MagicMock()
        update_response.text = json.dumps({"replies": []})
        update_response.raise_for_status = MagicMock()

        mock_request.side_effect = [doc_response, update_response]

        result = self.agent.execute_tool(
            "edit_document",
            {"document_id": "doc1", "content": "Appended text", "mode": "append"},
        )
        assert "replies" in result
        update_call = mock_request.call_args_list[1][1]
        requests = update_call["json"]["requests"]
        # Append should only have insertText, no delete
        assert not any("deleteContentRange" in r for r in requests)
        insert = next(r for r in requests if "insertText" in r)
        assert insert["insertText"]["text"] == "Appended text"
        # Insert at end index - 1
        assert insert["insertText"]["location"]["index"] == 49

    @patch("agent.nango.httpx.request")
    def test_execute_search_documents(self, mock_request):
        mock_response = MagicMock()
        mock_response.text = json.dumps(
            {"files": [{"id": "doc1", "name": "Meeting Notes"}]}
        )
        mock_response.raise_for_status = MagicMock()
        mock_request.return_value = mock_response

        result = self.agent.execute_tool(
            "search_documents", {"query": "meeting", "max_results": 5}
        )
        assert "Meeting Notes" in result
        call_kwargs = mock_request.call_args[1]
        assert "meeting" in call_kwargs["params"]["q"]
        assert call_kwargs["params"]["pageSize"] == 5
        assert call_kwargs["headers"]["Provider-Config-Key"] == "google-drive"

    @patch("agent.nango.httpx.request")
    def test_execute_search_documents_default_max(self, mock_request):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"files": []})
        mock_response.raise_for_status = MagicMock()
        mock_request.return_value = mock_response

        self.agent.execute_tool("search_documents", {"query": "test"})
        call_kwargs = mock_request.call_args[1]
        assert call_kwargs["params"]["pageSize"] == 10

    @patch("agent.nango.httpx.request")
    def test_execute_tool_handles_http_error(self, mock_request):
        mock_request.side_effect = Exception("Connection refused")

        result = json.loads(self.agent.execute_tool("list_documents", {}))
        assert "error" in result
        assert "Connection refused" in result["error"]

    @patch("agent.nango.httpx.request")
    def test_list_documents_filters_by_mime_type(self, mock_request):
        """list_documents only returns Google Docs, not other Drive files."""
        mock_response = MagicMock()
        mock_response.text = json.dumps({"files": []})
        mock_response.raise_for_status = MagicMock()
        mock_request.return_value = mock_response

        self.agent.execute_tool("list_documents", {})
        call_kwargs = mock_request.call_args[1]
        assert "application/vnd.google-apps.document" in call_kwargs["params"]["q"]

    @patch("agent.nango.httpx.request")
    def test_list_documents_orders_by_modified_time(self, mock_request):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"files": []})
        mock_response.raise_for_status = MagicMock()
        mock_request.return_value = mock_response

        self.agent.execute_tool("list_documents", {})
        call_kwargs = mock_request.call_args[1]
        assert call_kwargs["params"]["orderBy"] == "modifiedTime desc"

    @patch("agent.nango.httpx.request")
    def test_docs_use_google_docs_provider(self, mock_request):
        """read_document and create_document should use google-docs provider."""
        mock_response = MagicMock()
        mock_response.text = json.dumps({"documentId": "d1", "title": "T"})
        mock_response.json.return_value = {"documentId": "d1"}
        mock_response.raise_for_status = MagicMock()
        mock_request.return_value = mock_response

        self.agent.execute_tool("read_document", {"document_id": "d1"})
        headers = mock_request.call_args[1]["headers"]
        assert headers["Provider-Config-Key"] == "google-docs"

    @patch("agent.nango.httpx.request")
    def test_drive_ops_use_google_drive_provider(self, mock_request):
        """list_documents and search_documents should use google-drive provider."""
        mock_response = MagicMock()
        mock_response.text = json.dumps({"files": []})
        mock_response.raise_for_status = MagicMock()
        mock_request.return_value = mock_response

        self.agent.execute_tool("list_documents", {})
        headers = mock_request.call_args[1]["headers"]
        assert headers["Provider-Config-Key"] == "google-drive"
