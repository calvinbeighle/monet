"""Tests for the See Agents dashboard feature (SCOPE.md Feature 3).

Covers:
- ActivityStore direct unit tests
- AgentRunner.describe_agents / describe_agent metadata
- /api/agents, /api/agents/activity, /api/agents/{name} endpoints
- Activity tracking integration during run_sync / stream_sync
"""

import os
import tempfile
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from agent.activity_store import ActivityStore
from agent.main import app
from agent.tests.conftest import make_text_response, make_tool_response


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_store() -> tuple[ActivityStore, str]:
    """Return a fresh ActivityStore backed by a temp file and the path."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    return ActivityStore(db_path=path), path


# ---------------------------------------------------------------------------
# 1. TestActivityStore
# ---------------------------------------------------------------------------


class TestActivityStore:
    """Direct unit tests for ActivityStore - no runner needed."""

    def test_record_start_returns_id(self):
        store, path = _make_store()
        try:
            activity_id = store.record_start("email", "check inbox")
            assert isinstance(activity_id, str)
            assert len(activity_id) > 0
        finally:
            os.unlink(path)

    def test_record_finish_updates_status(self):
        store, path = _make_store()
        try:
            activity_id = store.record_start("email", "check inbox")
            store.record_finish(activity_id, summary="Done")

            rows = store.get_agent_activity("email")
            assert len(rows) == 1
            assert rows[0]["status"] == "completed"
            assert rows[0]["summary"] == "Done"
            assert rows[0]["finished_at"] is not None
        finally:
            os.unlink(path)

    def test_record_error_updates_status(self):
        store, path = _make_store()
        try:
            activity_id = store.record_start("code", "review PR")
            store.record_error(activity_id, "Connection timed out")

            rows = store.get_agent_activity("code")
            assert len(rows) == 1
            assert rows[0]["status"] == "error"
            assert rows[0]["error_message"] == "Connection timed out"
            assert rows[0]["finished_at"] is not None
        finally:
            os.unlink(path)

    def test_record_tool_call_increments_count(self):
        store, path = _make_store()
        try:
            activity_id = store.record_start("email", "check inbox")
            store.record_tool_call(activity_id)
            store.record_tool_call(activity_id)
            store.record_tool_call(activity_id)

            rows = store.get_agent_activity("email")
            assert rows[0]["tool_calls_count"] == 3
        finally:
            os.unlink(path)

    def test_record_approval_increments_count(self):
        store, path = _make_store()
        try:
            activity_id = store.record_start("email", "send email")
            store.record_approval(activity_id)
            store.record_approval(activity_id)

            rows = store.get_agent_activity("email")
            assert rows[0]["approvals_count"] == 2
        finally:
            os.unlink(path)

    def test_get_agent_activity_returns_recent(self):
        store, path = _make_store()
        try:
            # Insert three activities for "email" and one for "code"
            for i in range(3):
                aid = store.record_start("email", f"task {i}")
                store.record_finish(aid)

            store.record_start("code", "review PR")

            email_rows = store.get_agent_activity("email")
            assert len(email_rows) == 3
            for row in email_rows:
                assert row["agent_name"] == "email"

            code_rows = store.get_agent_activity("code")
            assert len(code_rows) == 1
        finally:
            os.unlink(path)

    def test_get_all_activity_respects_limit(self):
        store, path = _make_store()
        try:
            for i in range(10):
                store.record_start("general", f"question {i}")

            all_rows = store.get_all_activity(limit=4)
            assert len(all_rows) == 4
        finally:
            os.unlink(path)

    def test_get_running_filters_status(self):
        store, path = _make_store()
        try:
            running_id = store.record_start("planning", "plan sprint")
            done_id = store.record_start("email", "check inbox")
            store.record_finish(done_id)
            error_id = store.record_start("code", "review PR")
            store.record_error(error_id, "boom")

            running = store.get_running()
            assert len(running) == 1
            assert running[0]["id"] == running_id
            assert running[0]["status"] == "running"
        finally:
            os.unlink(path)

    def test_get_agent_stats_aggregates(self):
        store, path = _make_store()
        try:
            # 2 completed, 1 error, 1 running
            for _ in range(2):
                aid = store.record_start("email", "task")
                store.record_tool_call(aid)
                store.record_approval(aid)
                store.record_finish(aid)

            err_id = store.record_start("email", "bad task")
            store.record_error(err_id, "oops")

            store.record_start("email", "ongoing")

            stats = store.get_agent_stats("email")
            assert stats["total_runs"] == 4
            assert stats["completed"] == 2
            assert stats["errors"] == 1
            assert stats["running"] == 1
            assert stats["total_tool_calls"] == 2
            assert stats["total_approvals"] == 2
            assert stats["last_run_at"] is not None
        finally:
            os.unlink(path)

    def test_get_agent_stats_empty_agent(self):
        store, path = _make_store()
        try:
            stats = store.get_agent_stats("nonexistent")
            assert stats["total_runs"] == 0
            assert stats["completed"] == 0
            assert stats["errors"] == 0
            assert stats["running"] == 0
            assert stats["total_tool_calls"] == 0
            assert stats["total_approvals"] == 0
            assert stats["last_run_at"] is None
        finally:
            os.unlink(path)

    def test_record_start_stores_optional_fields(self):
        store, path = _make_store()
        try:
            activity_id = store.record_start(
                "email",
                "send newsletter",
                session_id="sess-abc",
                ui_pattern="tinder",
            )
            rows = store.get_agent_activity("email")
            assert rows[0]["session_id"] == "sess-abc"
            assert rows[0]["ui_pattern"] == "tinder"
        finally:
            os.unlink(path)


# ---------------------------------------------------------------------------
# 2. TestAgentDescriptions
# ---------------------------------------------------------------------------


KNOWN_AGENTS = {"email", "code", "planning", "general"}

EXPECTED_DESCRIPTIONS = {
    "email": "Reads, drafts, sends, and organizes your emails",
    "code": "Reviews PRs, writes code, and manages your GitHub repos",
    "planning": "Plans sprints, brainstorms ideas, and organizes tasks",
    "general": "Answers questions and handles general conversation",
}


class TestAgentDescriptions:
    """Verify agent metadata returned by runner.describe_agents / describe_agent."""

    def test_all_agents_have_descriptions(self, runner):
        for name, agent in runner.agents.items():
            assert hasattr(agent, "description"), f"{name} missing description"
            assert isinstance(agent.description, str)
            assert len(agent.description) > 0

    def test_describe_agents_returns_all_four(self, runner):
        agents = runner.describe_agents()
        names = {a["name"] for a in agents}
        assert names == KNOWN_AGENTS

    def test_describe_agents_includes_stats(self, runner):
        agents = runner.describe_agents()
        for agent in agents:
            assert "stats" in agent
            stats = agent["stats"]
            for key in ("total_runs", "completed", "errors", "running"):
                assert key in stats, f"stats missing key {key!r} for {agent['name']}"

    def test_describe_agents_includes_description(self, runner):
        agents = runner.describe_agents()
        for agent in agents:
            assert "description" in agent
            expected = EXPECTED_DESCRIPTIONS.get(agent["name"])
            if expected:
                assert agent["description"] == expected

    def test_describe_agents_includes_ui_pattern(self, runner):
        agents = runner.describe_agents()
        for agent in agents:
            assert "default_ui_pattern" in agent
            assert isinstance(agent["default_ui_pattern"], str)
            assert len(agent["default_ui_pattern"]) > 0

    def test_describe_agents_includes_tools(self, runner):
        agents = runner.describe_agents()
        for agent in agents:
            assert "tools" in agent
            assert isinstance(agent["tools"], list)

    def test_describe_agents_includes_approval_required(self, runner):
        agents = runner.describe_agents()
        for agent in agents:
            assert "approval_required" in agent
            assert isinstance(agent["approval_required"], list)

    def test_describe_agents_includes_suggestions(self, runner):
        agents = runner.describe_agents()
        for agent in agents:
            assert "suggestions" in agent
            assert isinstance(agent["suggestions"], list)

    def test_describe_agent_returns_detail(self, runner):
        detail = runner.describe_agent("email")
        assert detail is not None
        assert detail["name"] == "email"
        assert detail["description"] == EXPECTED_DESCRIPTIONS["email"]
        assert "stats" in detail
        assert "recent_activity" in detail
        assert "tools" in detail

    def test_describe_agent_nonexistent_returns_none(self, runner):
        result = runner.describe_agent("does_not_exist")
        assert result is None

    def test_describe_agent_includes_tools(self, runner):
        for name in KNOWN_AGENTS:
            detail = runner.describe_agent(name)
            assert detail is not None
            assert "tools" in detail
            # tools in detail view are full dicts (not just names)
            assert isinstance(detail["tools"], list)

    def test_describe_agent_includes_activity(self, runner):
        detail = runner.describe_agent("email")
        assert "recent_activity" in detail
        assert isinstance(detail["recent_activity"], list)

    def test_describe_agent_code(self, runner):
        detail = runner.describe_agent("code")
        assert detail is not None
        assert detail["description"] == EXPECTED_DESCRIPTIONS["code"]

    def test_describe_agent_planning(self, runner):
        detail = runner.describe_agent("planning")
        assert detail is not None
        assert detail["description"] == EXPECTED_DESCRIPTIONS["planning"]

    def test_describe_agent_general(self, runner):
        detail = runner.describe_agent("general")
        assert detail is not None
        assert detail["description"] == EXPECTED_DESCRIPTIONS["general"]


# ---------------------------------------------------------------------------
# 3. TestAgentsDashboardAPI
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    return TestClient(app)


class TestAgentsDashboardAPI:
    """HTTP endpoint tests for /api/agents and /api/agents/activity."""

    def test_list_agents_endpoint(self, client):
        response = client.get("/api/agents")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    def test_list_agents_returns_four_agents(self, client):
        response = client.get("/api/agents")
        assert response.status_code == 200
        agents = response.json()
        assert len(agents) == 4
        names = {a["name"] for a in agents}
        assert names == KNOWN_AGENTS

    def test_list_agents_each_has_required_fields(self, client):
        response = client.get("/api/agents")
        agents = response.json()
        for agent in agents:
            for field in (
                "name",
                "description",
                "default_ui_pattern",
                "tools",
                "stats",
            ):
                assert field in agent, (
                    f"field {field!r} missing from agent {agent.get('name')}"
                )

    def test_get_agent_detail_endpoint(self, client):
        response = client.get("/api/agents/email")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "email"
        assert "description" in data
        assert "tools" in data
        assert "recent_activity" in data
        assert "stats" in data

    def test_get_agent_detail_404(self, client):
        response = client.get("/api/agents/does_not_exist")
        assert response.status_code == 404
        error = response.json()
        assert "detail" in error

    def test_get_agent_detail_all_known_agents(self, client):
        for name in KNOWN_AGENTS:
            response = client.get(f"/api/agents/{name}")
            assert response.status_code == 200, f"Expected 200 for agent {name!r}"
            data = response.json()
            assert data["name"] == name

    def test_agents_activity_endpoint(self, client):
        response = client.get("/api/agents/activity")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    def test_agents_activity_limit_param(self, client):
        # Endpoint must accept a limit query param without error
        response = client.get("/api/agents/activity?limit=5")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # Result length must not exceed the requested limit
        assert len(data) <= 5

    def test_agents_activity_default_limit(self, client):
        # Default limit is 50 - should return a list (possibly empty)
        response = client.get("/api/agents/activity")
        assert response.status_code == 200
        assert len(response.json()) <= 50

    def test_list_agents_descriptions_match_expected(self, client):
        response = client.get("/api/agents")
        agents = {a["name"]: a for a in response.json()}
        for name, expected_desc in EXPECTED_DESCRIPTIONS.items():
            assert name in agents
            assert agents[name]["description"] == expected_desc


# ---------------------------------------------------------------------------
# 4. TestActivityTrackingIntegration
# ---------------------------------------------------------------------------


class TestActivityTrackingIntegration:
    """Verify the runner writes to activity_store during real execution."""

    def test_run_sync_records_activity(self, runner, mock_anthropic_client):
        """run_sync should create a completed activity record for the routed agent."""
        mock_anthropic_client.messages.create.return_value = make_text_response(
            "You have 3 unread emails."
        )

        runner.run_sync("handle my inbox")

        stats = runner.activity_store.get_agent_stats("email")
        assert stats["total_runs"] >= 1
        assert stats["completed"] >= 1

    def test_run_sync_records_activity_with_intent(self, runner, mock_anthropic_client):
        """Activity record should store the original intent string."""
        mock_anthropic_client.messages.create.return_value = make_text_response(
            "Here is your sprint plan."
        )

        runner.run_sync("plan the next sprint")

        activity = runner.activity_store.get_agent_activity("planning")
        assert len(activity) >= 1
        assert "plan the next sprint" in activity[0]["intent"]

    def test_run_sync_records_error_activity(self, runner, mock_anthropic_client):
        """run_sync should record an error activity when the agent errors out."""
        import anthropic

        mock_anthropic_client.messages.create.side_effect = (
            anthropic.AuthenticationError(
                message="Invalid API key",
                response=MagicMock(status_code=401),
                body={"error": {"message": "Invalid API key"}},
            )
        )

        runner.run_sync("handle my inbox")

        stats = runner.activity_store.get_agent_stats("email")
        assert stats["total_runs"] >= 1
        assert stats["errors"] >= 1

    def test_run_sync_activity_has_session_id(self, runner, mock_anthropic_client):
        """Activity record should store the session_id used during the run."""
        mock_anthropic_client.messages.create.return_value = make_text_response("Done.")

        runner.run_sync("handle my inbox", session_id="integration-test-session")

        activity = runner.activity_store.get_agent_activity("email")
        matching = [
            a for a in activity if a["session_id"] == "integration-test-session"
        ]
        assert len(matching) >= 1

    def test_run_sync_tool_call_increments_tool_count(
        self, runner, mock_anthropic_client
    ):
        """Each tool call during run_sync should be reflected in tool_calls_count."""
        tool_resp = make_tool_response("list_inbox", {"max_results": 10})
        text_resp = make_text_response("You have 5 emails.")
        mock_anthropic_client.messages.create.side_effect = [tool_resp, text_resp]

        email_agent = runner.agents["email"]
        original_execute = email_agent.execute_tool
        email_agent.execute_tool = MagicMock(return_value='{"messages": []}')

        try:
            runner.run_sync("handle my inbox")
        finally:
            email_agent.execute_tool = original_execute

        activity = runner.activity_store.get_agent_activity("email")
        assert activity[0]["tool_calls_count"] >= 1

    def test_stream_sync_records_activity(self, runner, mock_anthropic_client):
        """Consuming all events from stream_sync should produce a completed activity."""
        from agent.tests.conftest import MockContentBlock, MockResponse

        mock_stream = MagicMock()
        mock_stream.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream.__exit__ = MagicMock(return_value=False)
        mock_stream.__iter__ = MagicMock(return_value=iter([]))
        mock_stream.get_final_message.return_value = MockResponse(
            content=[MockContentBlock(type="text", text="Here are your emails.")]
        )
        mock_anthropic_client.messages.stream.return_value = mock_stream

        events = list(runner.stream_sync("handle my inbox"))

        assert events[-1].type == "done"

        stats = runner.activity_store.get_agent_stats("email")
        assert stats["total_runs"] >= 1
        assert stats["completed"] >= 1

    def test_stream_sync_records_activity_general_agent(
        self, runner, mock_anthropic_client
    ):
        """stream_sync should record activity for the general agent too."""
        from agent.tests.conftest import MockContentBlock, MockResponse

        mock_stream = MagicMock()
        mock_stream.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream.__exit__ = MagicMock(return_value=False)
        mock_stream.__iter__ = MagicMock(return_value=iter([]))
        mock_stream.get_final_message.return_value = MockResponse(
            content=[MockContentBlock(type="text", text="That is a great question.")]
        )
        mock_anthropic_client.messages.stream.return_value = mock_stream

        events = list(runner.stream_sync("what is the meaning of life"))

        assert events[-1].type == "done"

        stats = runner.activity_store.get_agent_stats("general")
        assert stats["total_runs"] >= 1

    def test_multiple_runs_accumulate_stats(self, runner, mock_anthropic_client):
        """Running the same agent multiple times should accumulate in stats."""
        mock_anthropic_client.messages.create.return_value = make_text_response("Done.")

        for _ in range(3):
            runner.run_sync("handle my inbox")

        stats = runner.activity_store.get_agent_stats("email")
        assert stats["total_runs"] >= 3
        assert stats["completed"] >= 3

    def test_run_sync_activity_stored_with_ui_pattern(
        self, runner, mock_anthropic_client
    ):
        """Activity record should store the routed ui_pattern."""
        mock_anthropic_client.messages.create.return_value = make_text_response(
            "Here is your plan."
        )

        runner.run_sync("plan the next sprint")

        activity = runner.activity_store.get_agent_activity("planning")
        assert len(activity) >= 1
        assert activity[0]["ui_pattern"] is not None
