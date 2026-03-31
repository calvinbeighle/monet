"""Writing agent - handles Google Docs operations via Nango integration."""

import json
import logging
import os

import httpx

from agent.agents.base import BaseAgent
from agent.models import UIPattern

logger = logging.getLogger(__name__)

NANGO_BASE_URL = os.environ.get("NANGO_BASE_URL", "https://api.nango.dev")
NANGO_SECRET_KEY = os.environ.get("NANGO_SECRET_KEY", "")
NANGO_CONNECTION_ID = os.environ.get("NANGO_GDOCS_CONNECTION_ID", "google-docs-default")


def _nango_headers() -> dict:
    return {
        "Authorization": f"Bearer {NANGO_SECRET_KEY}",
        "Content-Type": "application/json",
    }


class WritingAgent(BaseAgent):
    """Agent for writing operations - creating, editing, and organizing documents.

    Uses Nango's Google Docs integration for OAuth and API access.
    Creating and editing documents require user approval before execution.
    """

    name = "writing"
    description = "Creates, edits, and organizes your documents in Google Docs"
    default_ui_pattern = UIPattern.CHAT

    @property
    def system_prompt(self) -> str:
        return (
            "You are Monet's writing assistant. You help users create and edit documents "
            "in Google Docs.\n\n"
            "When creating a document:\n"
            "- Understand the user's intent and desired content\n"
            "- Draft the document content clearly and thoroughly\n"
            "- Create the document with appropriate title and content\n"
            "- Wait for user approval before creating\n\n"
            "When editing a document:\n"
            "- Read the existing document first for full context\n"
            "- Make targeted edits that match the user's request\n"
            "- Present changes for user approval before applying\n\n"
            "When searching or listing documents:\n"
            "- Use search to find relevant documents\n"
            "- Present results clearly with titles and snippets\n\n"
            "Always use the tools provided. Never fabricate document content or metadata.\n"
            "The create_document and edit_document tools require user approval - the system\n"
            "will pause and ask the user before executing these."
        )

    @property
    def tools(self) -> list[dict]:
        return [
            {
                "name": "list_documents",
                "description": "List recent documents from the user's Google Drive. Returns title, document ID, last modified date, and a snippet for each document.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum number of documents to return (default 20)",
                            "default": 20,
                        },
                    },
                    "required": [],
                },
            },
            {
                "name": "read_document",
                "description": "Read the full content of a specific Google Doc by document ID. Returns title, content, and metadata.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "The Google Docs document ID",
                        },
                    },
                    "required": ["document_id"],
                },
            },
            {
                "name": "create_document",
                "description": "Create a new Google Doc with the given title and content. REQUIRES USER APPROVAL.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "The document title",
                        },
                        "content": {
                            "type": "string",
                            "description": "The document body content",
                        },
                    },
                    "required": ["title", "content"],
                },
            },
            {
                "name": "edit_document",
                "description": "Edit an existing Google Doc by replacing or appending content. REQUIRES USER APPROVAL.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "document_id": {
                            "type": "string",
                            "description": "The Google Docs document ID to edit",
                        },
                        "content": {
                            "type": "string",
                            "description": "The new content to write to the document",
                        },
                        "mode": {
                            "type": "string",
                            "description": "Either 'replace' (overwrite) or 'append' (add to end)",
                            "enum": ["replace", "append"],
                            "default": "replace",
                        },
                    },
                    "required": ["document_id", "content"],
                },
            },
            {
                "name": "search_documents",
                "description": "Search for documents in Google Drive by keyword. Returns matching documents with title, ID, and snippet.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query string",
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum number of results to return (default 10)",
                            "default": 10,
                        },
                    },
                    "required": ["query"],
                },
            },
        ]

    @property
    def approval_required(self) -> set[str]:
        return {"create_document", "edit_document"}

    @property
    def suggestions(self) -> list[str]:
        return [
            "List my documents",
            "Create a new doc",
            "Edit a document",
            "Search my docs",
        ]

    def execute_tool(self, tool_name: str, parameters: dict) -> str:
        """Execute a Google Docs tool via Nango proxy API."""
        try:
            handler = getattr(self, f"_tool_{tool_name}", None)
            if handler is None:
                return json.dumps({"error": f"Unknown tool: {tool_name}"})
            return handler(parameters)
        except Exception as e:
            logger.error("Tool execution failed: %s(%s) - %s", tool_name, parameters, e)
            return json.dumps({"error": str(e)})

    def _tool_list_documents(self, params: dict) -> str:
        """List recent Google Docs via Nango Google Drive proxy."""
        max_results = params.get("max_results", 20)

        resp = httpx.get(
            f"{NANGO_BASE_URL}/v1/google-drive/files",
            headers=_nango_headers(),
            params={
                "connectionId": NANGO_CONNECTION_ID,
                "q": "mimeType='application/vnd.google-apps.document'",
                "maxResults": max_results,
                "orderBy": "modifiedTime desc",
            },
            timeout=30,
        )
        resp.raise_for_status()
        return resp.text

    def _tool_read_document(self, params: dict) -> str:
        """Read a specific Google Doc via Nango proxy."""
        document_id = params["document_id"]

        resp = httpx.get(
            f"{NANGO_BASE_URL}/v1/google-docs/documents/{document_id}",
            headers=_nango_headers(),
            params={"connectionId": NANGO_CONNECTION_ID},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.text

    def _tool_create_document(self, params: dict) -> str:
        """Create a new Google Doc via Nango proxy."""
        resp = httpx.post(
            f"{NANGO_BASE_URL}/v1/google-docs/documents",
            headers=_nango_headers(),
            json={
                "connectionId": NANGO_CONNECTION_ID,
                "title": params["title"],
                "body": params["content"],
            },
            timeout=30,
        )
        resp.raise_for_status()
        return resp.text

    def _tool_edit_document(self, params: dict) -> str:
        """Edit an existing Google Doc via Nango proxy."""
        document_id = params["document_id"]
        mode = params.get("mode", "replace")

        resp = httpx.post(
            f"{NANGO_BASE_URL}/v1/google-docs/documents/{document_id}",
            headers=_nango_headers(),
            json={
                "connectionId": NANGO_CONNECTION_ID,
                "content": params["content"],
                "mode": mode,
            },
            timeout=30,
        )
        resp.raise_for_status()
        return resp.text

    def _tool_search_documents(self, params: dict) -> str:
        """Search Google Drive for documents via Nango proxy."""
        query = params["query"]
        max_results = params.get("max_results", 10)

        resp = httpx.get(
            f"{NANGO_BASE_URL}/v1/google-drive/files",
            headers=_nango_headers(),
            params={
                "connectionId": NANGO_CONNECTION_ID,
                "q": f"mimeType='application/vnd.google-apps.document' and fullText contains '{query}'",
                "maxResults": max_results,
                "orderBy": "relevance",
            },
            timeout=30,
        )
        resp.raise_for_status()
        return resp.text
