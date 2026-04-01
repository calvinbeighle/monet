"""Writing agent - handles Google Docs operations via Nango proxy.

All API calls go through Nango's proxy endpoint:
  {METHOD} https://api.nango.dev/proxy/{api-path}
  Headers: Authorization, Connection-Id, Provider-Config-Key

Two providers are used:
  - google-docs (base: https://docs.googleapis.com) for document CRUD
  - google-drive (base: https://www.googleapis.com) for listing/searching files
"""

import json
import logging
import os

from agent.agents.base import BaseAgent
from agent.models import UIPattern
from agent.nango import PROVIDERS, nango_proxy_request

logger = logging.getLogger(__name__)

# Google Docs provider - for reading/creating/editing documents
_DOCS_CONFIG_KEY = PROVIDERS["google-docs"]["config_key"]
_DOCS_CONNECTION_ID = os.environ.get(
    "NANGO_GDOCS_CONNECTION_ID", PROVIDERS["google-docs"]["connection_id"]
)

# Google Drive provider - for listing/searching files
_DRIVE_CONFIG_KEY = PROVIDERS["google-drive"]["config_key"]
_DRIVE_CONNECTION_ID = os.environ.get(
    "NANGO_GDRIVE_CONNECTION_ID", PROVIDERS["google-drive"]["connection_id"]
)


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

        resp = nango_proxy_request(
            method="GET",
            path="drive/v3/files",
            provider_config_key=_DRIVE_CONFIG_KEY,
            connection_id=_DRIVE_CONNECTION_ID,
            params={
                "q": "mimeType='application/vnd.google-apps.document'",
                "pageSize": max_results,
                "orderBy": "modifiedTime desc",
                "fields": "files(id,name,modifiedTime,description)",
            },
        )
        resp.raise_for_status()
        return resp.text

    def _tool_read_document(self, params: dict) -> str:
        """Read a specific Google Doc via Nango proxy."""
        document_id = params["document_id"]

        resp = nango_proxy_request(
            method="GET",
            path=f"v1/documents/{document_id}",
            provider_config_key=_DOCS_CONFIG_KEY,
            connection_id=_DOCS_CONNECTION_ID,
        )
        resp.raise_for_status()

        # Parse the deeply nested Docs API response into clean plain text
        doc = resp.json()
        title = doc.get("title", "")
        plain_text_parts = []
        for block in doc.get("body", {}).get("content", []):
            paragraph = block.get("paragraph", {})
            for element in paragraph.get("elements", []):
                text_run = element.get("textRun", {})
                content = text_run.get("content", "")
                if content:
                    plain_text_parts.append(content)
        plain_text = "".join(plain_text_parts)
        return json.dumps(
            {
                "document_id": document_id,
                "title": title,
                "content": plain_text,
            }
        )

    def _tool_create_document(self, params: dict) -> str:
        """Create a new Google Doc via Nango proxy."""
        resp = nango_proxy_request(
            method="POST",
            path="v1/documents",
            provider_config_key=_DOCS_CONFIG_KEY,
            connection_id=_DOCS_CONNECTION_ID,
            json_body={
                "title": params["title"],
            },
        )
        resp.raise_for_status()

        # If content provided, insert it via batchUpdate
        doc_data = resp.json()
        doc_id = doc_data.get("documentId", "")
        content = params.get("content", "")

        if content and doc_id:
            update_resp = nango_proxy_request(
                method="POST",
                path=f"v1/documents/{doc_id}:batchUpdate",
                provider_config_key=_DOCS_CONFIG_KEY,
                connection_id=_DOCS_CONNECTION_ID,
                json_body={
                    "requests": [
                        {
                            "insertText": {
                                "location": {"index": 1},
                                "text": content,
                            }
                        }
                    ]
                },
            )
            update_resp.raise_for_status()

        title = params.get("title", "")
        return json.dumps(
            {
                "documentId": doc_id,
                "title": title,
                "message": "Document created and content inserted successfully.",
            }
        )

    def _tool_edit_document(self, params: dict) -> str:
        """Edit an existing Google Doc via Nango proxy using batchUpdate."""
        document_id = params["document_id"]
        mode = params.get("mode", "replace")
        content = params["content"]

        if mode == "replace":
            # First get the document to find end index
            doc_resp = nango_proxy_request(
                method="GET",
                path=f"v1/documents/{document_id}",
                provider_config_key=_DOCS_CONFIG_KEY,
                connection_id=_DOCS_CONNECTION_ID,
            )
            doc_resp.raise_for_status()
            doc = doc_resp.json()
            end_index = doc.get("body", {}).get("content", [{}])[-1].get("endIndex", 2)

            requests = []
            # Delete existing content (index 1 to end-1 to preserve the trailing newline)
            if end_index > 2:
                requests.append(
                    {
                        "deleteContentRange": {
                            "range": {"startIndex": 1, "endIndex": end_index - 1}
                        }
                    }
                )
            # Insert new content
            requests.append(
                {
                    "insertText": {
                        "location": {"index": 1},
                        "text": content,
                    }
                }
            )
        else:
            # Append mode - insert at end
            doc_resp = nango_proxy_request(
                method="GET",
                path=f"v1/documents/{document_id}",
                provider_config_key=_DOCS_CONFIG_KEY,
                connection_id=_DOCS_CONNECTION_ID,
            )
            doc_resp.raise_for_status()
            doc = doc_resp.json()
            end_index = doc.get("body", {}).get("content", [{}])[-1].get("endIndex", 2)

            requests = [
                {
                    "insertText": {
                        "location": {"index": end_index - 1},
                        "text": content,
                    }
                }
            ]

        resp = nango_proxy_request(
            method="POST",
            path=f"v1/documents/{document_id}:batchUpdate",
            provider_config_key=_DOCS_CONFIG_KEY,
            connection_id=_DOCS_CONNECTION_ID,
            json_body={"requests": requests},
        )
        resp.raise_for_status()
        return resp.text

    def _tool_search_documents(self, params: dict) -> str:
        """Search Google Drive for documents via Nango proxy."""
        query = params["query"]
        max_results = params.get("max_results", 10)

        # Escape single quotes to prevent Drive API query injection (400 errors)
        escaped_query = query.replace("'", "\\'")

        resp = nango_proxy_request(
            method="GET",
            path="drive/v3/files",
            provider_config_key=_DRIVE_CONFIG_KEY,
            connection_id=_DRIVE_CONNECTION_ID,
            params={
                "q": f"mimeType='application/vnd.google-apps.document' and fullText contains '{escaped_query}'",
                "pageSize": max_results,
                "orderBy": "relevance",
                "fields": "files(id,name,modifiedTime,description)",
            },
        )
        resp.raise_for_status()
        return resp.text
