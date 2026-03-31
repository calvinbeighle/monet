"""Tests for the writing agent."""

import json
from unittest.mock import patch, MagicMock

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

    @patch("agent.agents.writing.httpx")
    def test_execute_list_documents(self, mock_httpx):
        mock_response = MagicMock()
        mock_response.text = json.dumps(
            {
                "files": [
                    {"id": "doc1", "name": "Test Doc", "modifiedTime": "2026-03-31"}
                ]
            }
        )
        mock_response.raise_for_status = MagicMock()
        mock_httpx.get.return_value = mock_response

        result = self.agent.execute_tool("list_documents", {"max_results": 5})
        assert "files" in result
        mock_httpx.get.assert_called_once()
        call_params = mock_httpx.get.call_args[1]["params"]
        assert call_params["maxResults"] == 5

    @patch("agent.agents.writing.httpx")
    def test_execute_list_documents_default_max(self, mock_httpx):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"files": []})
        mock_response.raise_for_status = MagicMock()
        mock_httpx.get.return_value = mock_response

        self.agent.execute_tool("list_documents", {})
        call_params = mock_httpx.get.call_args[1]["params"]
        assert call_params["maxResults"] == 20

    @patch("agent.agents.writing.httpx")
    def test_execute_read_document(self, mock_httpx):
        mock_response = MagicMock()
        mock_response.text = json.dumps(
            {"documentId": "doc1", "title": "Test", "body": {"content": "Hello world"}}
        )
        mock_response.raise_for_status = MagicMock()
        mock_httpx.get.return_value = mock_response

        result = self.agent.execute_tool("read_document", {"document_id": "doc1"})
        assert "doc1" in result
        assert "documents/doc1" in mock_httpx.get.call_args[0][0]

    @patch("agent.agents.writing.httpx")
    def test_execute_create_document(self, mock_httpx):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"documentId": "new_doc", "title": "My Doc"})
        mock_response.raise_for_status = MagicMock()
        mock_httpx.post.return_value = mock_response

        result = self.agent.execute_tool(
            "create_document",
            {"title": "My Doc", "content": "Document body text"},
        )
        assert "new_doc" in result
        body = mock_httpx.post.call_args[1]["json"]
        assert body["title"] == "My Doc"
        assert body["body"] == "Document body text"

    @patch("agent.agents.writing.httpx")
    def test_execute_edit_document_replace(self, mock_httpx):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"status": "updated"})
        mock_response.raise_for_status = MagicMock()
        mock_httpx.post.return_value = mock_response

        result = self.agent.execute_tool(
            "edit_document",
            {"document_id": "doc1", "content": "New content", "mode": "replace"},
        )
        assert "updated" in result
        body = mock_httpx.post.call_args[1]["json"]
        assert body["content"] == "New content"
        assert body["mode"] == "replace"
        assert "documents/doc1" in mock_httpx.post.call_args[0][0]

    @patch("agent.agents.writing.httpx")
    def test_execute_edit_document_append(self, mock_httpx):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"status": "updated"})
        mock_response.raise_for_status = MagicMock()
        mock_httpx.post.return_value = mock_response

        result = self.agent.execute_tool(
            "edit_document",
            {"document_id": "doc1", "content": "Appended text"},
        )
        assert "updated" in result
        body = mock_httpx.post.call_args[1]["json"]
        assert body["mode"] == "replace"  # default mode

    @patch("agent.agents.writing.httpx")
    def test_execute_search_documents(self, mock_httpx):
        mock_response = MagicMock()
        mock_response.text = json.dumps(
            {"files": [{"id": "doc1", "name": "Meeting Notes"}]}
        )
        mock_response.raise_for_status = MagicMock()
        mock_httpx.get.return_value = mock_response

        result = self.agent.execute_tool(
            "search_documents", {"query": "meeting", "max_results": 5}
        )
        assert "Meeting Notes" in result
        call_params = mock_httpx.get.call_args[1]["params"]
        assert "meeting" in call_params["q"]
        assert call_params["maxResults"] == 5

    @patch("agent.agents.writing.httpx")
    def test_execute_search_documents_default_max(self, mock_httpx):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"files": []})
        mock_response.raise_for_status = MagicMock()
        mock_httpx.get.return_value = mock_response

        self.agent.execute_tool("search_documents", {"query": "test"})
        call_params = mock_httpx.get.call_args[1]["params"]
        assert call_params["maxResults"] == 10

    @patch("agent.agents.writing.httpx")
    def test_execute_tool_handles_http_error(self, mock_httpx):
        mock_httpx.get.side_effect = Exception("Connection refused")

        result = json.loads(self.agent.execute_tool("list_documents", {}))
        assert "error" in result
        assert "Connection refused" in result["error"]

    @patch("agent.agents.writing.httpx")
    def test_list_documents_filters_by_mime_type(self, mock_httpx):
        """list_documents only returns Google Docs, not other Drive files."""
        mock_response = MagicMock()
        mock_response.text = json.dumps({"files": []})
        mock_response.raise_for_status = MagicMock()
        mock_httpx.get.return_value = mock_response

        self.agent.execute_tool("list_documents", {})
        call_params = mock_httpx.get.call_args[1]["params"]
        assert "application/vnd.google-apps.document" in call_params["q"]

    @patch("agent.agents.writing.httpx")
    def test_list_documents_orders_by_modified_time(self, mock_httpx):
        mock_response = MagicMock()
        mock_response.text = json.dumps({"files": []})
        mock_response.raise_for_status = MagicMock()
        mock_httpx.get.return_value = mock_response

        self.agent.execute_tool("list_documents", {})
        call_params = mock_httpx.get.call_args[1]["params"]
        assert call_params["orderBy"] == "modifiedTime desc"
