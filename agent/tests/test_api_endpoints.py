"""Tests for FastAPI endpoint error handling and validation.

Covers: system routes, flow/advance, /api/run error handling, /api/stream error handling,
toggle_schedule None safety, update_custom_agent validation, home summary error handling.
"""

import json
from unittest.mock import MagicMock, patch, PropertyMock

import pytest
from fastapi.testclient import TestClient

from agent.main import app, runner, system_mgr, schedule_store, nango_mgr, auth_store


@pytest.fixture
def client():
    return TestClient(app)


# --- /api/run error handling ---


class TestRunEndpointErrors:
    def test_run_returns_result(self, client):
        """Normal run returns agent result."""
        with patch.object(runner, "run_sync") as mock_run:
            from agent.models import AgentResult, AgentOutput

            mock_run.return_value = AgentResult(
                agent="email",
                ui_pattern="chat",
                outputs=[AgentOutput(content="Done")],
            )
            resp = client.post("/api/run", json={"intent": "hello"})
            assert resp.status_code == 200
            data = resp.json()
            assert data["agent"] == "email"
            assert len(data["outputs"]) == 1

    def test_run_catches_unexpected_error(self, client):
        """Unexpected exception returns 500 with type name, not raw traceback."""
        with patch.object(runner, "run_sync", side_effect=RuntimeError("db exploded")):
            resp = client.post("/api/run", json={"intent": "hello"})
            assert resp.status_code == 500
            assert "RuntimeError" in resp.json()["detail"]


# --- /api/stream error handling ---


class TestStreamEndpointErrors:
    def test_stream_catches_unexpected_error(self, client):
        """Unexpected error in stream emits error+done events."""

        def exploding_generator(*args, **kwargs):
            raise ValueError("stream boom")

        with patch.object(runner, "stream_flow", side_effect=exploding_generator):
            resp = client.post("/api/stream", json={"intent": "hello"})
            assert resp.status_code == 200
            lines = [l for l in resp.text.strip().split("\n") if l]
            events = [json.loads(l) for l in lines]
            types = [e["type"] for e in events]
            assert "error" in types
            assert "done" in types
            error_event = next(e for e in events if e["type"] == "error")
            assert "ValueError" in error_event["data"]


# --- /api/flow/advance ---


class TestFlowAdvance:
    def test_advance_not_found(self, client):
        """Advancing a non-existent flow returns 404."""
        resp = client.post(
            "/api/flow/advance",
            json={"session_id": "nonexistent", "step_index": 0, "user_state": {}},
        )
        assert resp.status_code == 404

    def test_advance_found(self, client):
        """Advancing an active flow returns success."""
        with patch.object(runner, "signal_advance", return_value=True):
            resp = client.post(
                "/api/flow/advance",
                json={"session_id": "sess1", "step_index": 1, "user_state": {"x": 1}},
            )
            assert resp.status_code == 200
            assert resp.json()["status"] == "advancing"
            assert resp.json()["step_index"] == 1


# --- System routes ---


class TestSystemEndpoints:
    def test_system_state(self, client):
        """GET /api/system/state returns system state dict."""
        with patch.object(system_mgr, "get_state") as mock_state:
            from agent.system import (
                SystemState,
                WifiStatus,
                VolumeState,
                BrightnessState,
            )

            mock_state.return_value = SystemState(
                wifi=WifiStatus(),
                volume=VolumeState(),
                brightness=BrightnessState(),
            )
            resp = client.get("/api/system/state")
            assert resp.status_code == 200
            data = resp.json()
            assert "wifi" in data
            assert "volume" in data
            assert "brightness" in data

    def test_wifi_status(self, client):
        """GET /api/system/wifi/status returns wifi status."""
        with patch.object(system_mgr, "wifi_status") as mock_ws:
            from agent.system import WifiStatus

            mock_ws.return_value = WifiStatus(connected=True, ssid="TestNet", signal=75)
            resp = client.get("/api/system/wifi/status")
            assert resp.status_code == 200
            assert resp.json()["ssid"] == "TestNet"

    def test_wifi_scan(self, client):
        """GET /api/system/wifi/scan returns list of networks."""
        with patch.object(system_mgr, "wifi_scan") as mock_scan:
            from agent.system import WifiNetwork

            mock_scan.return_value = [
                WifiNetwork(ssid="Net1", signal=80, security="WPA2"),
                WifiNetwork(ssid="Net2", signal=50, security="Open"),
            ]
            resp = client.get("/api/system/wifi/scan")
            assert resp.status_code == 200
            networks = resp.json()
            assert len(networks) == 2
            assert networks[0]["ssid"] == "Net1"

    def test_wifi_connect_success(self, client):
        """POST /api/system/wifi/connect succeeds."""
        with patch.object(system_mgr, "wifi_connect", return_value=True):
            resp = client.post(
                "/api/system/wifi/connect",
                json={"ssid": "TestNet", "password": "secret"},
            )
            assert resp.status_code == 200
            assert resp.json()["status"] == "connected"

    def test_wifi_connect_failure(self, client):
        """POST /api/system/wifi/connect returns 400 on failure."""
        with patch.object(system_mgr, "wifi_connect", return_value=False):
            resp = client.post("/api/system/wifi/connect", json={"ssid": "BadNet"})
            assert resp.status_code == 400

    def test_wifi_disconnect(self, client):
        """POST /api/system/wifi/disconnect returns status."""
        with patch.object(system_mgr, "wifi_disconnect", return_value=True):
            resp = client.post("/api/system/wifi/disconnect")
            assert resp.status_code == 200
            assert resp.json()["status"] == "disconnected"

    def test_volume_get(self, client):
        """GET /api/system/volume returns volume state."""
        with patch.object(system_mgr, "volume_get") as mock_vol:
            from agent.system import VolumeState

            mock_vol.return_value = VolumeState(level=75, muted=False)
            resp = client.get("/api/system/volume")
            assert resp.status_code == 200
            assert resp.json()["level"] == 75

    def test_volume_set(self, client):
        """POST /api/system/volume sets volume level."""
        with patch.object(system_mgr, "volume_set") as mock_set:
            from agent.system import VolumeState

            mock_set.return_value = VolumeState(level=50, muted=False)
            resp = client.post("/api/system/volume", json={"level": 50})
            assert resp.status_code == 200
            assert resp.json()["level"] == 50

    def test_volume_mute_toggle(self, client):
        """POST /api/system/volume/mute toggles mute."""
        with patch.object(system_mgr, "volume_mute_toggle") as mock_mute:
            from agent.system import VolumeState

            mock_mute.return_value = VolumeState(level=50, muted=True)
            resp = client.post("/api/system/volume/mute")
            assert resp.status_code == 200
            assert resp.json()["muted"] is True

    def test_brightness_get(self, client):
        """GET /api/system/brightness returns brightness state."""
        with patch.object(system_mgr, "brightness_get") as mock_br:
            from agent.system import BrightnessState

            mock_br.return_value = BrightnessState(level=80, max_brightness=100)
            resp = client.get("/api/system/brightness")
            assert resp.status_code == 200
            assert resp.json()["level"] == 80

    def test_brightness_set(self, client):
        """POST /api/system/brightness sets brightness."""
        with patch.object(system_mgr, "brightness_set") as mock_set:
            from agent.system import BrightnessState

            mock_set.return_value = BrightnessState(level=60, max_brightness=100)
            resp = client.post("/api/system/brightness", json={"level": 60})
            assert resp.status_code == 200
            assert resp.json()["level"] == 60

    def test_power_shutdown(self, client):
        """POST /api/system/power with shutdown action."""
        with patch.object(system_mgr, "power_shutdown", return_value=True):
            resp = client.post("/api/system/power", json={"action": "shutdown"})
            assert resp.status_code == 200
            assert resp.json()["status"] == "shutdown"

    def test_power_restart(self, client):
        """POST /api/system/power with restart action."""
        with patch.object(system_mgr, "power_restart", return_value=True):
            resp = client.post("/api/system/power", json={"action": "restart"})
            assert resp.status_code == 200

    def test_power_invalid_action(self, client):
        """POST /api/system/power with invalid action returns 400."""
        resp = client.post("/api/system/power", json={"action": "explode"})
        assert resp.status_code == 400
        assert "Invalid power action" in resp.json()["detail"]

    def test_power_failure(self, client):
        """POST /api/system/power returns 500 when action fails."""
        with patch.object(system_mgr, "power_suspend", return_value=False):
            resp = client.post("/api/system/power", json={"action": "suspend"})
            assert resp.status_code == 500


# --- Toggle schedule None safety ---


class TestToggleSchedule:
    def test_toggle_not_found(self, client):
        """Toggle non-existent schedule returns 404."""
        with patch.object(schedule_store, "get", return_value=None):
            resp = client.post("/api/schedules/nonexistent/toggle")
            assert resp.status_code == 404

    def test_toggle_deleted_during_update(self, client):
        """Toggle returns 404 if schedule deleted between get and update."""
        from agent.scheduler import ScheduleConfig

        config = ScheduleConfig(
            id="sched1", agent_name="email", intent="check inbox", enabled=True
        )
        with patch.object(schedule_store, "get", return_value=config):
            with patch.object(schedule_store, "update", return_value=None):
                resp = client.post("/api/schedules/sched1/toggle")
                assert resp.status_code == 404
                assert "deleted" in resp.json()["detail"].lower()

    def test_toggle_success(self, client):
        """Toggle flips enabled state and returns new state."""
        from agent.scheduler import ScheduleConfig

        config = ScheduleConfig(
            id="sched1", agent_name="email", intent="check inbox", enabled=True
        )
        toggled = ScheduleConfig(
            id="sched1", agent_name="email", intent="check inbox", enabled=False
        )
        with patch.object(schedule_store, "get", return_value=config):
            with patch.object(schedule_store, "update", return_value=toggled):
                resp = client.post("/api/schedules/sched1/toggle")
                assert resp.status_code == 200
                assert resp.json()["enabled"] is False


# --- Update custom agent validation ---


class TestUpdateCustomAgentValidation:
    def test_update_invalid_tool_sets(self, client):
        """Update with invalid tool sets returns 400."""
        with patch.object(runner, "is_custom_agent", return_value=True):
            resp = client.put(
                "/api/agents/custom/myagent",
                json={
                    "name": "myagent",
                    "description": "test",
                    "system_prompt": "be helpful",
                    "tool_sets": ["nonexistent"],
                    "approval_tools": [],
                    "ui_pattern": "chat",
                    "suggestions": [],
                },
            )
            assert resp.status_code == 400
            assert "Invalid tool sets" in resp.json()["detail"]

    def test_update_invalid_ui_pattern(self, client):
        """Update with invalid UI pattern returns 400."""
        with patch.object(runner, "is_custom_agent", return_value=True):
            resp = client.put(
                "/api/agents/custom/myagent",
                json={
                    "name": "myagent",
                    "description": "test",
                    "system_prompt": "be helpful",
                    "tool_sets": [],
                    "approval_tools": [],
                    "ui_pattern": "invalid_pattern",
                    "suggestions": [],
                },
            )
            assert resp.status_code == 400
            assert "Invalid UI pattern" in resp.json()["detail"]

    def test_update_not_custom_agent(self, client):
        """Update built-in agent returns 404."""
        with patch.object(runner, "is_custom_agent", return_value=False):
            resp = client.put(
                "/api/agents/custom/email",
                json={
                    "name": "email",
                    "description": "test",
                    "system_prompt": "be helpful",
                    "tool_sets": [],
                    "approval_tools": [],
                    "ui_pattern": "chat",
                    "suggestions": [],
                },
            )
            assert resp.status_code == 404


# --- Home summary error handling ---


class TestHomeSummary:
    def test_home_summary_error(self, client):
        """Home summary returns 500 on unexpected error."""
        with patch.object(
            nango_mgr, "get_user_facing_statuses", side_effect=RuntimeError("boom")
        ):
            resp = client.get("/api/home/summary")
            assert resp.status_code == 500
            assert "Failed to load" in resp.json()["detail"]

    def test_home_summary_success(self, client):
        """Home summary returns aggregated data."""
        from agent.nango import ToolConnectionStatus

        statuses = [
            ToolConnectionStatus(
                name="Gmail", provider="gmail", connected=True, connection_id="conn1"
            ),
            ToolConnectionStatus(
                name="GitHub", provider="github", connected=False, connection_id="conn2"
            ),
        ]
        with patch.object(nango_mgr, "get_user_facing_statuses", return_value=statuses):
            with patch.object(runner, "describe_agents", return_value=[]):
                with patch.object(
                    runner.activity_store, "get_all_activity", return_value=[]
                ):
                    with patch.object(schedule_store, "list_all", return_value=[]):
                        resp = client.get("/api/home/summary")
                        assert resp.status_code == 200
                        data = resp.json()
                        assert "tools" in data
                        assert "agents" in data
                        assert "quick_actions" in data
                        assert len(data["tools"]) == 2
