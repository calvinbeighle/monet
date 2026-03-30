"""
integrations/composio_client.py - Composio integration wrapper for Monet.

Provides a unified interface for connecting external services (Gmail, GitHub)
and executing tools against those services. When COMPOSIO_API_KEY is absent,
operates in stub mode, returning mock data so the backend runs without
any third-party credentials.
"""

from __future__ import annotations

import logging
from typing import Any

import config

logger = logging.getLogger(__name__)


# --- OAuth Stub URLs ---

STUB_OAUTH_URLS: dict[str, str] = {
    "gmail": "https://stub.composio.dev/oauth/gmail",
    "github": "https://stub.composio.dev/oauth/github",
    "slack": "https://stub.composio.dev/oauth/slack",
    "calendar": "https://stub.composio.dev/oauth/calendar",
    "notion": "https://stub.composio.dev/oauth/notion",
}

# --- Stub Tool Responses ---

STUB_TOOL_RESPONSES: dict[str, Any] = {
    "GMAIL_FETCH_EMAILS": {
        "data": {
            "messages": [
                {
                    "messageId": "stub-msg-001",
                    "sender": "partner@horizonvc.com",
                    "subject": "Q2 board meeting - need metrics by Friday",
                    "messageText": (
                        "Hi, the Q2 board meeting is this Friday at 2 PM. "
                        "We need the following before then: ARR growth, churn rate, NPS score, "
                        "and burn rate for the quarter. Please send by Thursday EOD so we have "
                        "time to review. Let me know if you have any questions. Thanks."
                    ),
                    "messageTimestamp": "2026-03-28T09:14:00Z",
                    "to": "founder@monet.ai",
                },
                {
                    "messageId": "stub-msg-002",
                    "sender": "cto@prospect.io",
                    "subject": "Follow up: product demo last week",
                    "messageText": (
                        "Hey, really enjoyed the demo on Tuesday. Our team had a few "
                        "technical questions before we move forward: 1) What is your data "
                        "retention policy? 2) Do you support SSO? 3) Can we get a sandbox "
                        "environment to test? We are hoping to make a decision by end of month."
                    ),
                    "messageTimestamp": "2026-03-27T16:45:00Z",
                    "to": "founder@monet.ai",
                },
                {
                    "messageId": "stub-msg-003",
                    "sender": "legal@cloudvendor.com",
                    "subject": "Contract renewal - action required within 14 days",
                    "messageText": (
                        "Your current service agreement expires on April 12th. "
                        "We have prepared a renewal with updated terms including the new "
                        "enterprise SLA we discussed. Please review the attached PDF and sign "
                        "via DocuSign. If you wish to negotiate terms, please reply by April 5th."
                    ),
                    "messageTimestamp": "2026-03-27T11:20:00Z",
                    "to": "founder@monet.ai",
                },
                {
                    "messageId": "stub-msg-004",
                    "sender": "press@techcrunch.com",
                    "subject": "Interview request - AI tools for founders",
                    "messageText": (
                        "Hi, I am writing a piece on AI-powered productivity tools for "
                        "early stage founders. I came across Monet and would love a 20 minute "
                        "chat this week if you are available. Happy to work around your schedule. "
                        "The article targets publication in late April."
                    ),
                    "messageTimestamp": "2026-03-26T14:00:00Z",
                    "to": "founder@monet.ai",
                },
                {
                    "messageId": "stub-msg-005",
                    "sender": "team@linear.app",
                    "subject": "Your sprint cycle ends tomorrow",
                    "messageText": (
                        "This is a reminder that your current sprint cycle ends tomorrow. "
                        "You have 3 issues marked In Progress and 2 in Review. "
                        "Consider moving incomplete items to the backlog or next cycle. "
                        "Your team velocity this sprint was 34 points."
                    ),
                    "messageTimestamp": "2026-03-26T09:00:00Z",
                    "to": "founder@monet.ai",
                },
            ]
        }
    },
    "GMAIL_SEND_EMAIL": {
        "status": "sent",
        "message": "Email sent successfully (stub mode).",
    },
    "GMAIL_LIST_MESSAGES": [
        {
            "id": "stub-001",
            "subject": "Q1 investor update - need your input",
            "from": "partner@vcfirm.com",
            "snippet": "Hey, can you send over the Q1 metrics before the board meeting on Friday?",
        },
        {
            "id": "stub-002",
            "subject": "Follow up: product demo",
            "from": "cto@prospect.io",
            "snippet": "Really enjoyed the demo. A few technical questions before we move forward.",
        },
        {
            "id": "stub-003",
            "subject": "Contract renewal - action required",
            "from": "legal@vendor.com",
            "snippet": "Your contract expires in 14 days. Please review and sign the attached renewal.",
        },
    ],
    "GMAIL_GET_MESSAGE": {
        "id": "stub-001",
        "subject": "Q1 investor update - need your input",
        "from": "partner@vcfirm.com",
        "snippet": "Hey, can you send over the Q1 metrics before the board meeting on Friday?",
        "body": "Hey, can you send over the Q1 metrics before the board meeting on Friday? We need ARR, churn, and NPS at minimum.",
    },
    "GMAIL_CREATE_DRAFT": {
        "id": "draft-stub-001",
        "status": "created",
        "message": "Draft created successfully (stub mode).",
    },
    "GITHUB_LIST_PULL_REQUESTS": [
        {
            "number": 42,
            "title": "Add rate limiting to API endpoints",
            "user": {"login": "dev-alice"},
            "body": "Implements token bucket rate limiting. Needs review before merging to main.",
            "html_url": "https://github.com/org/repo/pull/42",
        },
        {
            "number": 37,
            "title": "Refactor auth middleware",
            "user": {"login": "dev-bob"},
            "body": "Splits auth into separate concerns. Breaking change - needs careful review.",
            "html_url": "https://github.com/org/repo/pull/37",
        },
        {
            "number": 51,
            "title": "Fix memory leak in websocket handler",
            "user": {"login": "dev-carol"},
            "body": "Patches unclosed connections. Urgent - production impact.",
            "html_url": "https://github.com/org/repo/pull/51",
        },
    ],
    "GITHUB_GET_PULL_REQUEST": {
        "number": 42,
        "title": "Add rate limiting to API endpoints",
        "user": {"login": "dev-alice"},
        "body": "Implements token bucket rate limiting. Needs review before merging to main.",
        "html_url": "https://github.com/org/repo/pull/42",
        "changed_files": 4,
        "additions": 87,
        "deletions": 12,
    },
    "GITHUB_CREATE_REVIEW": {
        "id": "review-stub-001",
        "status": "submitted",
        "message": "Review submitted successfully (stub mode).",
    },
}


class ComposioClient:
    """
    Wrapper around Composio for OAuth connections and tool execution.

    If COMPOSIO_API_KEY is not set, `is_stub` is True and all methods
    return hardcoded mock data so the backend runs in a fully offline mode.
    """

    def __init__(self) -> None:
        """
        Initializes the Composio client.

        Detects whether to run in stub mode based on COMPOSIO_API_KEY presence.
        Attempts to import and configure the composio SDK if a key is present.
        """
        self._api_key = config.COMPOSIO_API_KEY
        self._sdk = None

        if not self.is_stub:
            self._init_sdk()

    @property
    def is_stub(self) -> bool:
        """
        Whether the client is running in stub mode.

        Returns:
            True if COMPOSIO_API_KEY is absent or empty.
        """
        return not bool(self._api_key)

    def _init_sdk(self) -> None:
        """
        Attempts to initialize the Composio Python SDK.

        Logs a warning and falls back to stub mode if the SDK is unavailable.
        """
        try:
            from composio import ComposioToolSet  # type: ignore
            self._sdk = ComposioToolSet(api_key=self._api_key)
            logger.info("Composio SDK initialized (live mode).")
        except ImportError:
            logger.warning(
                "composio-core not installed. Falling back to stub mode."
            )
            self._sdk = None

    # --- OAuth ---

    async def connect_gmail(self) -> str:
        """
        Initiates Gmail OAuth connection via Composio.

        Returns:
            OAuth redirect URL (real or stub).
        """
        if self.is_stub or not self._sdk:
            logger.info("Stub: returning stub Gmail OAuth URL.")
            return STUB_OAUTH_URLS["gmail"]

        try:
            request = self._sdk.get_entity("default").initiate_connection("GMAIL")
            return request.redirectUrl
        except Exception as exc:
            logger.exception("Failed to initiate Gmail OAuth: %s", exc)
            return STUB_OAUTH_URLS["gmail"]

    async def connect_github(self) -> str:
        """
        Initiates GitHub OAuth connection via Composio.

        Returns:
            OAuth redirect URL (real or stub).
        """
        if self.is_stub or not self._sdk:
            logger.info("Stub: returning stub GitHub OAuth URL.")
            return STUB_OAUTH_URLS["github"]

        try:
            request = self._sdk.get_entity("default").initiate_connection("GITHUB")
            return request.redirectUrl
        except Exception as exc:
            logger.exception("Failed to initiate GitHub OAuth: %s", exc)
            return STUB_OAUTH_URLS["github"]

    async def connect_service(self, service: str) -> str:
        """
        Initiates an OAuth connection for any named service.

        Routes to known service handlers or falls back to a generic stub URL.

        Args:
            service: Lowercase service name (e.g. 'gmail', 'github').

        Returns:
            OAuth redirect URL.
        """
        if service == "gmail":
            return await self.connect_gmail()
        if service == "github":
            return await self.connect_github()

        if self.is_stub or not self._sdk:
            return STUB_OAUTH_URLS.get(service, f"https://stub.composio.dev/oauth/{service}")

        try:
            request = self._sdk.get_entity("default").initiate_connection(service.upper())
            return request.redirectUrl
        except Exception as exc:
            logger.exception("Failed to initiate %s OAuth: %s", service, exc)
            return f"https://stub.composio.dev/oauth/{service}"

    async def list_connections(self) -> list[dict[str, Any]]:
        """
        Returns the list of connected external services.

        In stub mode, returns a hardcoded list with all services disconnected.

        Returns:
            List of connection dicts with 'service', 'connected', 'icon', 'id' keys.
        """
        stub_connections = [
            {"id": "gmail", "service": "gmail", "icon": "Mail", "connected": False},
            {"id": "github", "service": "github", "icon": "Github", "connected": False},
            {"id": "slack", "service": "slack", "icon": "MessageSquare", "connected": False},
            {"id": "calendar", "service": "calendar", "icon": "Calendar", "connected": False},
            {"id": "notion", "service": "notion", "icon": "FileText", "connected": False},
        ]

        if self.is_stub or not self._sdk:
            return stub_connections

        try:
            connections = self._sdk.get_entity("default").get_connections()
            return [
                {
                    "id": conn.appName.lower(),
                    "service": conn.appName.lower(),
                    "icon": _service_to_icon(conn.appName.lower()),
                    "connected": conn.status == "ACTIVE",
                }
                for conn in connections
            ]
        except Exception as exc:
            logger.exception("Failed to list connections: %s", exc)
            return stub_connections

    async def execute_tool(self, tool_name: str, tool_input: dict[str, Any]) -> Any:
        """
        Executes a Composio tool action by name.

        In stub mode, returns hardcoded mock responses. In live mode,
        calls the Composio SDK and returns real results.

        Args:
            tool_name: Composio action name (e.g. 'GMAIL_LIST_MESSAGES').
            tool_input: Arguments to pass to the action.

        Returns:
            Tool result data (real or stub).
        """
        if self.is_stub or not self._sdk:
            result = STUB_TOOL_RESPONSES.get(tool_name, {"status": "ok", "stub": True})
            logger.debug("Stub tool '%s' -> %s", tool_name, result)
            return result

        try:
            result = self._sdk.execute_action(
                action=tool_name,
                params=tool_input,
                entity_id="default",
            )
            return result.get("response_data", result)
        except Exception as exc:
            logger.exception("Tool execution failed for '%s': %s", tool_name, exc)
            return STUB_TOOL_RESPONSES.get(tool_name, {"error": str(exc)})


# --- Helpers ---

def _service_to_icon(service: str) -> str:
    """
    Maps a service name to a Lucide icon name.

    Args:
        service: Lowercase service name.

    Returns:
        Lucide icon name string.
    """
    icon_map = {
        "gmail": "Mail",
        "github": "Github",
        "slack": "MessageSquare",
        "notion": "FileText",
        "calendar": "Calendar",
        "linear": "Layers",
    }
    return icon_map.get(service, "Plug")
