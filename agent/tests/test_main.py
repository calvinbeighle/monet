"""Tests for the FastAPI server endpoints."""

from unittest.mock import patch, MagicMock
from dataclasses import asdict

import pytest
from fastapi.testclient import TestClient

from agent.main import app, approval_gate
from agent.models import ApprovalStatus


@pytest.fixture
def client():
    return TestClient(app)


class TestHealthEndpoint:
    def test_health_returns_ok(self, client):
        response = client.get("/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "version" in data


class TestApprovalEndpoints:
    def test_list_approvals_empty(self, client):
        response = client.get("/api/approvals")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_approve_nonexistent(self, client):
        response = client.post("/api/approvals/nonexistent/approve")
        assert response.status_code == 404

    def test_reject_nonexistent(self, client):
        response = client.post("/api/approvals/nonexistent/reject")
        assert response.status_code == 404

    def test_approve_existing_request(self, client):
        req = approval_gate.create("send_email", {"to": "test@example.com"})

        response = client.post(f"/api/approvals/{req.id}/approve")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == ApprovalStatus.APPROVED.value

    def test_reject_existing_request(self, client):
        req = approval_gate.create("merge_pr", {"pr_number": 42})

        response = client.post(f"/api/approvals/{req.id}/reject")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == ApprovalStatus.REJECTED.value

    def test_list_pending_after_create(self, client):
        approval_gate.create("send_email", {}, session_id="test-api")

        response = client.get("/api/approvals", params={"session_id": "test-api"})
        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 1
        assert all(item["status"] == "pending" for item in data)


class TestRunEndpoint:
    @patch("agent.main.runner")
    def test_run_returns_result(self, mock_runner, client):
        from agent.models import AgentResult, AgentOutput

        mock_runner.run_sync.return_value = AgentResult(
            agent="email",
            ui_pattern="tinder",
            outputs=[AgentOutput(content="You have 5 emails")],
        )

        response = client.post("/api/run", json={"intent": "handle my inbox"})
        assert response.status_code == 200
        data = response.json()
        assert data["agent"] == "email"
        assert data["ui_pattern"] == "tinder"
        assert len(data["outputs"]) == 1


class TestStreamEndpoint:
    @patch("agent.main.runner")
    def test_stream_returns_ndjson(self, mock_runner, client):
        from agent.models import AgentEvent

        mock_runner.stream_sync.return_value = iter(
            [
                AgentEvent(
                    type="routing",
                    data="email",
                    metadata={"ui_pattern": "tinder", "agent": "email"},
                ),
                AgentEvent(type="token", data="Hello"),
                AgentEvent(type="done"),
            ]
        )

        response = client.post("/api/stream", json={"intent": "handle my inbox"})
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/x-ndjson")

        lines = [line for line in response.text.strip().split("\n") if line]
        assert len(lines) == 3

        import json

        first = json.loads(lines[0])
        assert first["type"] == "routing"

        last = json.loads(lines[-1])
        assert last["type"] == "done"
