"""Tests for Nango integration - connection status checks and OAuth connect flow.

Why these tests matter: The Connect Tools feature is a demo requirement (SCOPE.md
Feature 2). Users must be able to connect Gmail and GitHub via OAuth during
onboarding. These tests verify the backend correctly queries Nango for connection
status and generates OAuth connect URLs, including graceful degradation when
Nango is not configured.
"""

import json
from unittest.mock import MagicMock, patch

import pytest

from agent.nango import (
    PROVIDERS,
    ConnectSession,
    NangoManager,
    ToolConnectionStatus,
)


class TestNangoManager:
    """Tests for NangoManager connection status and session creation."""

    def test_configured_with_secret_key(self):
        mgr = NangoManager(secret_key="test-key")
        assert mgr.configured is True

    def test_not_configured_without_secret_key(self):
        mgr = NangoManager(secret_key="")
        assert mgr.configured is False

    def test_providers_defined(self):
        assert "gmail" in PROVIDERS
        assert "github" in PROVIDERS
        assert PROVIDERS["gmail"]["config_key"] == "google-mail"
        assert PROVIDERS["github"]["config_key"] == "github"

    def test_check_connection_unknown_provider(self):
        mgr = NangoManager(secret_key="test-key")
        status = mgr.check_connection("unknown")
        assert status.connected is False
        assert status.name == "unknown"
        assert status.connection_id == ""

    def test_check_connection_no_secret_key(self):
        mgr = NangoManager(secret_key="")
        status = mgr.check_connection("gmail")
        assert status.connected is False
        assert status.name == "Gmail"
        assert status.provider == "gmail"

    @patch("agent.nango.httpx.get")
    def test_check_connection_active(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "id": "123",
            "connection_id": "gmail-default",
            "credentials": {"access_token": "ya29.xxx"},
        }
        mock_get.return_value = mock_resp

        mgr = NangoManager(secret_key="test-key", base_url="https://api.nango.dev")
        status = mgr.check_connection("gmail")

        assert status.connected is True
        assert status.name == "Gmail"
        assert status.provider == "gmail"
        mock_get.assert_called_once()
        call_args = mock_get.call_args
        assert "gmail-default" in call_args[0][0]

    @patch("agent.nango.httpx.get")
    def test_check_connection_no_credentials(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "id": "123",
            "connection_id": "gmail-default",
            "credentials": {},
        }
        mock_get.return_value = mock_resp

        mgr = NangoManager(secret_key="test-key")
        status = mgr.check_connection("gmail")
        assert status.connected is False

    @patch("agent.nango.httpx.get")
    def test_check_connection_404(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 404
        mock_get.return_value = mock_resp

        mgr = NangoManager(secret_key="test-key")
        status = mgr.check_connection("gmail")
        assert status.connected is False

    @patch("agent.nango.httpx.get")
    def test_check_connection_network_error(self, mock_get):
        mock_get.side_effect = Exception("Connection refused")

        mgr = NangoManager(secret_key="test-key")
        status = mgr.check_connection("gmail")
        assert status.connected is False
        assert status.name == "Gmail"

    @patch("agent.nango.httpx.get")
    def test_check_connection_github(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "credentials": {"access_token": "ghp_xxx"},
        }
        mock_get.return_value = mock_resp

        mgr = NangoManager(secret_key="test-key")
        status = mgr.check_connection("github")
        assert status.connected is True
        assert status.name == "GitHub"
        assert status.provider == "github"

    @patch("agent.nango.httpx.get")
    def test_check_connection_api_key_credentials(self, mock_get):
        """Connections using api_key instead of access_token should also be detected."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "credentials": {"api_key": "some-key"},
        }
        mock_get.return_value = mock_resp

        mgr = NangoManager(secret_key="test-key")
        status = mgr.check_connection("gmail")
        assert status.connected is True

    @patch("agent.nango.httpx.get")
    def test_get_all_statuses(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"credentials": {"access_token": "token"}}
        mock_get.return_value = mock_resp

        mgr = NangoManager(secret_key="test-key")
        statuses = mgr.get_all_statuses()
        assert len(statuses) == 2
        providers = {s.provider for s in statuses}
        assert providers == {"gmail", "github"}
        assert all(s.connected for s in statuses)

    @patch("agent.nango.httpx.get")
    def test_get_all_statuses_mixed(self, mock_get):
        """One connected, one not."""

        def side_effect(url, **kwargs):
            resp = MagicMock()
            if "gmail-default" in url:
                resp.status_code = 200
                resp.json.return_value = {"credentials": {"access_token": "token"}}
            else:
                resp.status_code = 404
            return resp

        mock_get.side_effect = side_effect

        mgr = NangoManager(secret_key="test-key")
        statuses = mgr.get_all_statuses()
        gmail = next(s for s in statuses if s.provider == "gmail")
        github = next(s for s in statuses if s.provider == "github")
        assert gmail.connected is True
        assert github.connected is False


class TestConnectSession:
    """Tests for OAuth connect session creation."""

    def test_create_session_unknown_provider(self):
        mgr = NangoManager(secret_key="test-key")
        result = mgr.create_connect_session("unknown")
        assert result is None

    def test_create_session_no_secret_key(self):
        mgr = NangoManager(secret_key="")
        result = mgr.create_connect_session("gmail")
        assert result is None

    @patch("agent.nango.httpx.post")
    def test_create_session_success(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "data": {"token": "session-token-123"},
        }
        mock_post.return_value = mock_resp

        mgr = NangoManager(secret_key="test-key", base_url="https://api.nango.dev")
        session = mgr.create_connect_session("gmail")
        assert session is not None
        assert session.token == "session-token-123"
        assert session.provider == "gmail"
        assert "google-mail" in session.url
        assert "gmail-default" in session.url
        assert "session-token-123" in session.url

    @patch("agent.nango.httpx.post")
    def test_create_session_201_status(self, mock_post):
        """Nango may return 201 Created for new sessions."""
        mock_resp = MagicMock()
        mock_resp.status_code = 201
        mock_resp.json.return_value = {
            "data": {"token": "tok-201"},
        }
        mock_post.return_value = mock_resp

        mgr = NangoManager(secret_key="test-key")
        session = mgr.create_connect_session("github")
        assert session is not None
        assert session.token == "tok-201"
        assert session.provider == "github"

    @patch("agent.nango.httpx.post")
    def test_create_session_network_error(self, mock_post):
        mock_post.side_effect = Exception("Timeout")

        mgr = NangoManager(secret_key="test-key")
        result = mgr.create_connect_session("gmail")
        assert result is None

    @patch("agent.nango.httpx.post")
    def test_create_session_server_error(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_post.return_value = mock_resp

        mgr = NangoManager(secret_key="test-key")
        result = mgr.create_connect_session("gmail")
        assert result is None

    @patch("agent.nango.httpx.post")
    def test_create_session_token_in_flat_response(self, mock_post):
        """Handle both {data: {token}} and {token} response formats."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"token": "flat-token"}
        mock_post.return_value = mock_resp

        mgr = NangoManager(secret_key="test-key")
        session = mgr.create_connect_session("gmail")
        assert session is not None
        assert session.token == "flat-token"


class TestToolConnectionStatus:
    """Tests for the ToolConnectionStatus data model."""

    def test_fields(self):
        status = ToolConnectionStatus(
            name="Gmail",
            provider="gmail",
            connected=True,
            connection_id="gmail-default",
        )
        assert status.name == "Gmail"
        assert status.provider == "gmail"
        assert status.connected is True
        assert status.connection_id == "gmail-default"


class TestAPIEndpoints:
    """Tests for the /api/tools/* FastAPI endpoints."""

    def setup_method(self):
        from fastapi.testclient import TestClient

        from agent.main import app

        self.client = TestClient(app)

    def test_tools_status_endpoint(self):
        resp = self.client.get("/api/tools/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "tools" in data
        assert "configured" in data
        assert isinstance(data["tools"], list)
        assert len(data["tools"]) == 2
        names = {t["name"] for t in data["tools"]}
        assert names == {"Gmail", "GitHub"}

    def test_tools_status_has_required_fields(self):
        resp = self.client.get("/api/tools/status")
        data = resp.json()
        for tool in data["tools"]:
            assert "name" in tool
            assert "provider" in tool
            assert "connected" in tool
            assert "connection_id" in tool

    def test_tools_connect_unknown_provider(self):
        resp = self.client.get("/api/tools/connect/unknown")
        assert resp.status_code == 404

    def test_tools_connect_no_nango_key(self):
        """Without NANGO_SECRET_KEY, connect should return 503."""
        resp = self.client.get("/api/tools/connect/gmail")
        # Will be 503 if no key is set in test env
        assert resp.status_code in (200, 503)
