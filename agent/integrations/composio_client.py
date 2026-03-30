"""
integrations/composio_client.py

Composio SDK wrapper that bridges stub mode and production mode.

When COMPOSIO_API_KEY is absent (stub mode), all methods return realistic
mock data identical to what the agent stubs produce. When COMPOSIO_API_KEY
is present, the real Composio SDK is used to execute tools against live
connected accounts.

This is the single seam in the architecture - swap in real credentials and
every integration downstream upgrades automatically.
"""

from __future__ import annotations

import os
from typing import Any

from config import get_config


def _is_stub_mode() -> bool:
    """
    Return True when no Composio API key is configured.

    Reads directly from the environment rather than the frozen Config so the
    check works before config is fully initialised (e.g. during import time
    in tests).

    Returns:
        bool: True if running in stub mode (no real API key present).
    """
    return not os.getenv("COMPOSIO_API_KEY", "").strip()


class ComposioClient:
    """
    Thin wrapper around the Composio Python SDK.

    Operates in one of two modes:
    - Stub mode  (COMPOSIO_API_KEY missing): returns hardcoded mock data.
    - Live mode  (COMPOSIO_API_KEY present): delegates to the real Composio SDK.

    All public methods are safe to call without any API keys - they will
    silently fall back to realistic stub responses so the rest of the system
    keeps working during local development and demos.
    """

    def __init__(self) -> None:
        self._stub = _is_stub_mode()
        self._sdk: Any | None = None

        if not self._stub:
            self._sdk = self._init_sdk()

    # ------------------------------------------------------------------
    # SDK initialisation
    # ------------------------------------------------------------------

    def _init_sdk(self) -> Any:
        """
        Initialise the Composio SDK client with the configured API key.

        Raises:
            ImportError: If the composio-core package is not installed.
            RuntimeError: If SDK initialisation fails for any reason.

        Returns:
            Any: Initialised Composio SDK client instance.
        """
        try:
            from composio_openai import ComposioToolSet  # type: ignore[import]
        except ImportError as exc:
            raise ImportError(
                "composio-core is not installed. "
                "Run `pip install composio-core` or add it to requirements.txt."
            ) from exc

        api_key = os.getenv("COMPOSIO_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError(
                "COMPOSIO_API_KEY is required to initialise the Composio SDK."
            )

        try:
            return ComposioToolSet(api_key=api_key)
        except Exception as exc:
            raise RuntimeError(
                f"Failed to initialise Composio SDK: {exc}"
            ) from exc

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    def connect_gmail(self, user_id: str = "default") -> dict[str, Any]:
        """
        Initiate a Gmail OAuth connection via Composio.

        In stub mode, returns a mock connection record indicating Gmail is
        pre-connected. In live mode, triggers the Composio OAuth flow.

        Args:
            user_id: Identifier for the user initiating the connection.

        Returns:
            dict: Connection record with status, service, and redirect URL if applicable.
        """
        if self._stub:
            return {
                "status": "connected",
                "service": "gmail",
                "user_id": user_id,
                "stub": True,
                "message": "Stub Gmail connection - set COMPOSIO_API_KEY for real OAuth.",
            }

        try:
            connection = self._sdk.initiate_connection(
                app="GMAIL",
                entity_id=user_id,
            )
            return {
                "status": "pending",
                "service": "gmail",
                "user_id": user_id,
                "redirect_url": getattr(connection, "redirectUrl", None),
                "connection_id": getattr(connection, "connectionId", None),
            }
        except Exception as exc:
            raise RuntimeError(f"Failed to connect Gmail via Composio: {exc}") from exc

    def connect_github(self, user_id: str = "default") -> dict[str, Any]:
        """
        Initiate a GitHub OAuth connection via Composio.

        In stub mode, returns a mock connection record indicating GitHub is
        pre-connected. In live mode, triggers the Composio OAuth flow.

        Args:
            user_id: Identifier for the user initiating the connection.

        Returns:
            dict: Connection record with status, service, and redirect URL if applicable.
        """
        if self._stub:
            return {
                "status": "connected",
                "service": "github",
                "user_id": user_id,
                "stub": True,
                "message": "Stub GitHub connection - set COMPOSIO_API_KEY for real OAuth.",
            }

        try:
            connection = self._sdk.initiate_connection(
                app="GITHUB",
                entity_id=user_id,
            )
            return {
                "status": "pending",
                "service": "github",
                "user_id": user_id,
                "redirect_url": getattr(connection, "redirectUrl", None),
                "connection_id": getattr(connection, "connectionId", None),
            }
        except Exception as exc:
            raise RuntimeError(f"Failed to connect GitHub via Composio: {exc}") from exc

    def list_connections(self, user_id: str = "default") -> list[dict[str, Any]]:
        """
        List all active Composio connections for a user.

        In stub mode, returns a mock list showing Gmail and GitHub connected.
        In live mode, queries the Composio API for real connection records.

        Args:
            user_id: Identifier for the user whose connections to list.

        Returns:
            list[dict]: Connection records with service, status, and metadata.
        """
        if self._stub:
            return [
                {
                    "service": "gmail",
                    "status": "connected",
                    "user_id": user_id,
                    "stub": True,
                },
                {
                    "service": "github",
                    "status": "connected",
                    "user_id": user_id,
                    "stub": True,
                },
            ]

        try:
            connections = self._sdk.get_connected_accounts(entity_id=user_id)
            return [
                {
                    "service": getattr(c, "appName", "unknown").lower(),
                    "status": getattr(c, "status", "unknown"),
                    "connection_id": getattr(c, "id", None),
                    "user_id": user_id,
                }
                for c in (connections or [])
            ]
        except Exception as exc:
            raise RuntimeError(f"Failed to list Composio connections: {exc}") from exc

    # ------------------------------------------------------------------
    # Tool execution
    # ------------------------------------------------------------------

    def execute_tool(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        user_id: str = "default",
    ) -> Any:
        """
        Execute a Composio tool action.

        Routes the call to the real Composio SDK in live mode. In stub mode,
        returns a generic placeholder that callers can override with their own
        mock data (see GmailIntegration and GitHubIntegration).

        Args:
            tool_name: The Composio action name (e.g. "GMAIL_LIST_THREADS").
            tool_input: Structured parameters for the action.
            user_id: Entity ID identifying which connected account to use.

        Returns:
            Any: The result from Composio, or stub data.
        """
        if self._stub:
            return {
                "stub": True,
                "tool": tool_name,
                "input": tool_input,
                "message": f"Stub result for {tool_name} - set COMPOSIO_API_KEY for real execution.",
            }

        try:
            entity = self._sdk.get_entity(id=user_id)
            result = entity.execute(
                action=tool_name,
                params=tool_input,
            )
            return result
        except Exception as exc:
            raise RuntimeError(
                f"Composio tool execution failed for {tool_name}: {exc}"
            ) from exc

    # ------------------------------------------------------------------
    # Utility
    # ------------------------------------------------------------------

    @property
    def is_stub(self) -> bool:
        """
        Whether this client is operating in stub mode.

        Returns:
            bool: True if no real Composio API key is configured.
        """
        return self._stub
