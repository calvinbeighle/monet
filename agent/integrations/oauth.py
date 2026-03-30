"""
integrations/oauth.py

OAuth flow scaffolding for Monet integrations.

Manages the initiation, callback handling, and token storage for OAuth
connections to external services (Gmail, GitHub, etc.) via Composio.

Currently contains scaffolding with TODO markers. The actual OAuth redirect
endpoints will be added to main.py in a follow-up. The ComposioClient already
handles the Composio-side OAuth flow - this layer manages the application-side
token lifecycle (storage, retrieval, refresh).
"""

from __future__ import annotations

from typing import Any

from .composio_client import ComposioClient


# TODO: Replace with a persistent store (Redis, SQLite) for production.
# For now tokens are held in-process so they survive only for the session.
_token_store: dict[str, dict[str, Any]] = {}


class OAuthManager:
    """
    Manages OAuth flows and token storage for Monet integrations.

    Works alongside ComposioClient - Composio handles the actual OAuth
    redirect flows, this class manages the application-side state and
    provides a clean interface for the rest of the codebase to check
    connection status and retrieve tokens.

    Endpoint wiring (to be added to main.py):
      GET  /oauth/connect/{service}   -> initiate_oauth(service)
      GET  /oauth/callback/{service}  -> handle_callback(code, state)
    """

    def __init__(self, user_id: str = "default") -> None:
        self._client = ComposioClient()
        self._user_id = user_id

    # ------------------------------------------------------------------
    # OAuth initiation
    # ------------------------------------------------------------------

    def initiate_oauth(self, service: str) -> dict[str, Any]:
        """
        Start the OAuth flow for a given service.

        Delegates to ComposioClient to generate the redirect URL. The caller
        should redirect the user's browser to the returned redirect_url.

        Supported services: "gmail", "github"

        Args:
            service: Lowercase service name to connect.

        Returns:
            dict: OAuth initiation result with redirect_url and connection_id
                  when in live mode, or a stub confirmation in stub mode.

        Raises:
            ValueError: If the service name is not recognised.

        TODO: Store pending connection state (connection_id, state param) so
              handle_callback can verify the round-trip.
        TODO: Add PKCE or state parameter for CSRF protection.
        """
        service = service.lower().strip()

        if service == "gmail":
            return self._client.connect_gmail(user_id=self._user_id)

        if service == "github":
            return self._client.connect_github(user_id=self._user_id)

        raise ValueError(
            f"Unsupported OAuth service: '{service}'. "
            "Supported services: gmail, github."
        )

    # ------------------------------------------------------------------
    # Callback handling
    # ------------------------------------------------------------------

    def handle_callback(
        self,
        service: str,
        code: str,
        state: str | None = None,
    ) -> dict[str, Any]:
        """
        Handle the OAuth callback after the user authorises the connection.

        In live mode, exchanges the authorisation code for tokens via
        Composio and persists them to the token store. In stub mode, records
        a fake successful connection.

        Args:
            service: The service this callback is for (e.g. "gmail").
            code: The authorisation code returned by the OAuth provider.
            state: Optional CSRF state parameter for verification.

        Returns:
            dict: Result with status and service fields.

        TODO: Verify `state` against the stored value from initiate_oauth
              to prevent CSRF attacks.
        TODO: Persist tokens to a durable store rather than _token_store.
        TODO: Implement token refresh scheduling for expiring access tokens.
        """
        if self._client.is_stub:
            _token_store[f"{self._user_id}:{service}"] = {
                "service": service,
                "user_id": self._user_id,
                "stub": True,
                "code": code,
            }
            return {
                "status": "connected",
                "service": service,
                "stub": True,
            }

        # TODO: Call Composio to complete the OAuth exchange with `code`.
        # Composio typically handles this server-side and the connection
        # becomes active after the user completes the redirect flow.
        # The connection status can then be verified via list_connections().
        connections = self._client.list_connections(user_id=self._user_id)
        matched = next(
            (c for c in connections if c.get("service", "").lower() == service.lower()),
            None,
        )

        if matched:
            _token_store[f"{self._user_id}:{service}"] = matched
            return {"status": "connected", "service": service}

        return {"status": "pending", "service": service}

    # ------------------------------------------------------------------
    # Token retrieval
    # ------------------------------------------------------------------

    def get_token(self, service: str) -> dict[str, Any] | None:
        """
        Retrieve the stored OAuth token/connection record for a service.

        Args:
            service: Lowercase service name (e.g. "gmail", "github").

        Returns:
            dict | None: Stored token record, or None if not connected.

        TODO: Add token expiry checking and automatic refresh logic.
        TODO: Decrypt tokens if at-rest encryption is added to the store.
        """
        return _token_store.get(f"{self._user_id}:{service}")

    # ------------------------------------------------------------------
    # Connection status
    # ------------------------------------------------------------------

    def is_connected(self, service: str) -> bool:
        """
        Check whether the user has an active connection for a service.

        In live mode, queries the Composio API for current connection status.
        In stub mode, always returns True so the system works without keys.

        Args:
            service: Lowercase service name to check.

        Returns:
            bool: True if the service is connected and ready to use.
        """
        if self._client.is_stub:
            return True

        connections = self._client.list_connections(user_id=self._user_id)
        return any(
            c.get("service", "").lower() == service.lower()
            and c.get("status") == "connected"
            for c in connections
        )
