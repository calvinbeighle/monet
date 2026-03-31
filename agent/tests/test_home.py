"""Tests for the home screen summary endpoint.

The home screen is the default landing after login - it aggregates
tool status, agent info, recent activity, and quick actions into
a single response so the Flutter shell loads in one roundtrip.
"""

import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from agent.main import app, runner, nango_mgr, schedule_store, _build_quick_actions
from agent.nango import ToolConnectionStatus


client = TestClient(app)


class TestHomeSummary:
    """Tests for GET /api/home/summary endpoint."""

    def test_returns_200(self):
        response = client.get("/api/home/summary")
        assert response.status_code == 200

    def test_response_has_required_keys(self):
        response = client.get("/api/home/summary")
        data = response.json()
        assert "tools" in data
        assert "agents" in data
        assert "recent_activity" in data
        assert "quick_actions" in data
        assert "active_schedules" in data
        assert "total_schedules" in data

    def test_tools_is_list(self):
        response = client.get("/api/home/summary")
        data = response.json()
        assert isinstance(data["tools"], list)

    def test_agents_is_list(self):
        response = client.get("/api/home/summary")
        data = response.json()
        assert isinstance(data["agents"], list)

    def test_agents_include_builtin(self):
        """All 5 built-in agents should be present."""
        response = client.get("/api/home/summary")
        data = response.json()
        names = [a["name"] for a in data["agents"]]
        assert "email" in names
        assert "code" in names
        assert "planning" in names
        assert "general" in names
        assert "writing" in names

    def test_agents_have_stats(self):
        response = client.get("/api/home/summary")
        data = response.json()
        for agent in data["agents"]:
            assert "stats" in agent
            assert "total_runs" in agent["stats"]

    def test_recent_activity_is_list(self):
        response = client.get("/api/home/summary")
        data = response.json()
        assert isinstance(data["recent_activity"], list)

    def test_quick_actions_is_list(self):
        response = client.get("/api/home/summary")
        data = response.json()
        assert isinstance(data["quick_actions"], list)

    def test_quick_actions_always_has_defaults(self):
        """Plan my day and help should always appear."""
        response = client.get("/api/home/summary")
        data = response.json()
        labels = [a["label"] for a in data["quick_actions"]]
        assert "Plan my day" in labels
        assert "What can you do?" in labels

    def test_quick_actions_have_required_fields(self):
        response = client.get("/api/home/summary")
        data = response.json()
        for action in data["quick_actions"]:
            assert "label" in action
            assert "icon" in action
            assert "intent" in action

    def test_schedule_counts_are_ints(self):
        response = client.get("/api/home/summary")
        data = response.json()
        assert isinstance(data["active_schedules"], int)
        assert isinstance(data["total_schedules"], int)

    def test_tools_have_name_and_connected(self):
        response = client.get("/api/home/summary")
        data = response.json()
        for tool in data["tools"]:
            assert "name" in tool
            assert "connected" in tool


class TestBuildQuickActions:
    """Tests for the _build_quick_actions helper."""

    def test_no_connected_tools(self):
        actions = _build_quick_actions(set())
        labels = [a["label"] for a in actions]
        # Default actions only
        assert "Plan my day" in labels
        assert "What can you do?" in labels
        assert "Handle my inbox" not in labels
        assert "Review open PRs" not in labels
        assert "Write a document" not in labels

    def test_gmail_connected(self):
        actions = _build_quick_actions({"gmail"})
        labels = [a["label"] for a in actions]
        assert "Handle my inbox" in labels
        assert "Draft an email" in labels

    def test_github_connected(self):
        actions = _build_quick_actions({"github"})
        labels = [a["label"] for a in actions]
        assert "Review open PRs" in labels
        assert "Check my repos" in labels

    def test_google_docs_connected(self):
        actions = _build_quick_actions({"google-docs"})
        labels = [a["label"] for a in actions]
        assert "Write a document" in labels
        assert "Find a doc" in labels

    def test_all_connected(self):
        actions = _build_quick_actions({"gmail", "github", "google-docs"})
        labels = [a["label"] for a in actions]
        # All tool-specific actions present
        assert "Handle my inbox" in labels
        assert "Review open PRs" in labels
        assert "Write a document" in labels
        # Plus defaults
        assert "Plan my day" in labels

    def test_every_action_has_intent(self):
        actions = _build_quick_actions({"gmail", "github", "google-docs"})
        for action in actions:
            assert action["intent"], f"Action {action['label']} has no intent"

    def test_every_action_has_icon(self):
        actions = _build_quick_actions({"gmail", "github", "google-docs"})
        for action in actions:
            assert action["icon"], f"Action {action['label']} has no icon"
