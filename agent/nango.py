"""Nango integration - connection status and OAuth connect flow.

Nango manages OAuth tokens for Gmail and GitHub. This module provides:
- Connection status checks (is a tool connected and active?)
- Connect session creation (generate a URL to initiate OAuth)

The agents (email.py, code.py) use Nango as a transparent proxy for API calls.
This module handles the connection lifecycle that happens before agents can work.
"""

import logging
import os
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

NANGO_BASE_URL = os.environ.get("NANGO_BASE_URL", "https://api.nango.dev")
NANGO_SECRET_KEY = os.environ.get("NANGO_SECRET_KEY", "")

# Provider config keys in Nango - these match what's configured in the Nango dashboard
PROVIDERS = {
    "gmail": {
        "config_key": "google-mail",
        "connection_id": os.environ.get("NANGO_GMAIL_CONNECTION_ID", "gmail-default"),
        "display_name": "Gmail",
    },
    "github": {
        "config_key": "github",
        "connection_id": os.environ.get("NANGO_GITHUB_CONNECTION_ID", "github-default"),
        "display_name": "GitHub",
    },
}


@dataclass
class ToolConnectionStatus:
    """Status of a single tool connection."""

    name: str
    provider: str
    connected: bool
    connection_id: str


@dataclass
class ConnectSession:
    """A Nango connect session for initiating OAuth."""

    url: str
    token: str
    provider: str


class NangoManager:
    """Manages Nango tool connections - status checks and OAuth initiation."""

    def __init__(
        self,
        base_url: str | None = None,
        secret_key: str | None = None,
    ):
        self._base_url = base_url or NANGO_BASE_URL
        self._secret_key = secret_key or NANGO_SECRET_KEY

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._secret_key}",
            "Content-Type": "application/json",
        }

    @property
    def configured(self) -> bool:
        """Whether Nango credentials are configured."""
        return bool(self._secret_key)

    def check_connection(self, provider: str) -> ToolConnectionStatus:
        """Check if a specific provider connection is active.

        Calls Nango's GET /connection/{connectionId} endpoint.
        Returns connected=True only if the connection exists and has valid credentials.
        """
        provider_info = PROVIDERS.get(provider)
        if provider_info is None:
            return ToolConnectionStatus(
                name=provider,
                provider=provider,
                connected=False,
                connection_id="",
            )

        connection_id = provider_info["connection_id"]
        display_name = provider_info["display_name"]

        if not self._secret_key:
            return ToolConnectionStatus(
                name=display_name,
                provider=provider,
                connected=False,
                connection_id=connection_id,
            )

        try:
            resp = httpx.get(
                f"{self._base_url}/connection/{connection_id}",
                headers=self._headers(),
                params={"provider_config_key": provider_info["config_key"]},
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json()
                # Connection exists - check if credentials are present
                has_creds = bool(
                    data.get("credentials", {}).get("access_token")
                    or data.get("credentials", {}).get("api_key")
                )
                return ToolConnectionStatus(
                    name=display_name,
                    provider=provider,
                    connected=has_creds,
                    connection_id=connection_id,
                )
        except Exception as e:
            logger.warning("Nango connection check failed for %s: %s", provider, e)

        return ToolConnectionStatus(
            name=display_name,
            provider=provider,
            connected=False,
            connection_id=connection_id,
        )

    def get_all_statuses(self) -> list[ToolConnectionStatus]:
        """Check connection status for all configured providers."""
        return [self.check_connection(p) for p in PROVIDERS]

    def create_connect_session(
        self, provider: str, user_id: str = "monet-user"
    ) -> ConnectSession | None:
        """Create a Nango connect session for initiating OAuth.

        Uses POST /connect/sessions to get a session token, then constructs
        the connect URL. Returns None if Nango is not configured or the
        provider is unknown.
        """
        provider_info = PROVIDERS.get(provider)
        if provider_info is None or not self._secret_key:
            return None

        try:
            resp = httpx.post(
                f"{self._base_url}/connect/sessions",
                headers=self._headers(),
                json={
                    "end_user": {"id": user_id},
                    "allowed_integrations": [provider_info["config_key"]],
                },
                timeout=10,
            )
            if resp.status_code == 200 or resp.status_code == 201:
                data = resp.json()
                token = data.get("data", {}).get("token", data.get("token", ""))
                # Nango connect UI URL with session token
                url = f"{self._base_url}/oauth/connect/{provider_info['config_key']}?connection_id={provider_info['connection_id']}&connect_session_token={token}"
                return ConnectSession(
                    url=url,
                    token=token,
                    provider=provider,
                )
        except Exception as e:
            logger.warning(
                "Nango connect session creation failed for %s: %s", provider, e
            )

        return None
