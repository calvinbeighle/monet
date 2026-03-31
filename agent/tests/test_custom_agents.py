"""Tests for user-created custom agents (SCOPE.md Feature 3).

Custom agents are a core MVP capability: users can create agents through
conversation or the dashboard UI. This validates the full stack:
persistence (CustomAgentStore), runtime behavior (CustomAgent), dynamic
registration (AgentRunner), and API endpoints (main.py).
"""

import json
import os
import tempfile

import pytest

from agent.custom_agent_store import CustomAgentConfig, CustomAgentStore
from agent.agents.custom import CustomAgent, AVAILABLE_TOOL_SETS
from agent.models import UIPattern


# ---- Fixtures ----


@pytest.fixture
def store():
    """Create a custom agent store backed by a temporary database."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        yield CustomAgentStore(db_path=path)
    finally:
        os.unlink(path)


@pytest.fixture
def sample_config():
    """A minimal custom agent config for testing."""
    return CustomAgentConfig(
        name="morning-briefing",
        description="Summarizes my emails every morning",
        system_prompt="You are a morning briefing agent. Summarize the user's inbox concisely.",
        tool_sets=["email"],
        approval_tools=[],
        ui_pattern="chat",
        suggestions=["Summarize inbox", "Draft replies"],
    )


@pytest.fixture
def config_no_tools():
    """A custom agent with no tools (conversational only)."""
    return CustomAgentConfig(
        name="tutor",
        description="Explains concepts in simple terms",
        system_prompt="You are a friendly tutor. Explain concepts clearly.",
        tool_sets=[],
        ui_pattern="chat",
    )


# ---- CustomAgentStore Tests ----


class TestCustomAgentStore:
    def test_create_and_get(self, store, sample_config):
        created = store.create(sample_config)
        assert created.name == "morning-briefing"
        assert created.created_at > 0

        loaded = store.get("morning-briefing")
        assert loaded is not None
        assert loaded.name == "morning-briefing"
        assert loaded.description == "Summarizes my emails every morning"
        assert (
            loaded.system_prompt
            == "You are a morning briefing agent. Summarize the user's inbox concisely."
        )
        assert loaded.tool_sets == ["email"]
        assert loaded.ui_pattern == "chat"
        assert loaded.suggestions == ["Summarize inbox", "Draft replies"]

    def test_create_duplicate_raises(self, store, sample_config):
        store.create(sample_config)
        with pytest.raises(ValueError, match="already exists"):
            store.create(sample_config)

    def test_get_nonexistent_returns_none(self, store):
        assert store.get("nonexistent") is None

    def test_list_all_empty(self, store):
        assert store.list_all() == []

    def test_list_all_returns_all(self, store, sample_config, config_no_tools):
        store.create(sample_config)
        store.create(config_no_tools)
        configs = store.list_all()
        names = [c.name for c in configs]
        assert "morning-briefing" in names
        assert "tutor" in names

    def test_list_all_ordered_by_created_at_desc(self, store):
        store.create(
            CustomAgentConfig(name="first", description="a", system_prompt="a")
        )
        store.create(
            CustomAgentConfig(name="second", description="b", system_prompt="b")
        )
        configs = store.list_all()
        assert configs[0].name == "second"
        assert configs[1].name == "first"

    def test_update_existing(self, store, sample_config):
        store.create(sample_config)
        sample_config.description = "Updated description"
        sample_config.system_prompt = "Updated prompt"
        sample_config.tool_sets = ["email", "code"]

        updated = store.update(sample_config)
        assert updated is not None
        assert updated.description == "Updated description"
        assert updated.tool_sets == ["email", "code"]

        loaded = store.get("morning-briefing")
        assert loaded.description == "Updated description"
        assert loaded.tool_sets == ["email", "code"]

    def test_update_nonexistent_returns_none(self, store, sample_config):
        result = store.update(sample_config)
        assert result is None

    def test_delete_existing(self, store, sample_config):
        store.create(sample_config)
        assert store.delete("morning-briefing") is True
        assert store.get("morning-briefing") is None

    def test_delete_nonexistent(self, store):
        assert store.delete("nonexistent") is False

    def test_exists(self, store, sample_config):
        assert store.exists("morning-briefing") is False
        store.create(sample_config)
        assert store.exists("morning-briefing") is True

    def test_timestamps_set_on_create(self, store, sample_config):
        created = store.create(sample_config)
        assert created.created_at > 0
        assert created.updated_at > 0
        assert created.created_at == created.updated_at

    def test_updated_at_changes_on_update(self, store, sample_config):
        created = store.create(sample_config)
        original_updated = created.updated_at

        import time

        time.sleep(0.01)

        sample_config.description = "Changed"
        updated = store.update(sample_config)
        assert updated.updated_at > original_updated

    def test_json_serialization_roundtrip(self, store):
        """Verify that list fields (tool_sets, suggestions) survive JSON roundtrip in SQLite."""
        config = CustomAgentConfig(
            name="test-agent",
            description="test",
            system_prompt="test",
            tool_sets=["email", "code", "writing"],
            approval_tools=["send_email", "merge_pr"],
            suggestions=["Do X", "Do Y", "Do Z"],
        )
        store.create(config)
        loaded = store.get("test-agent")
        assert loaded.tool_sets == ["email", "code", "writing"]
        assert loaded.approval_tools == ["send_email", "merge_pr"]
        assert loaded.suggestions == ["Do X", "Do Y", "Do Z"]


# ---- CustomAgent Tests ----


class TestCustomAgent:
    def test_basic_properties(self, sample_config):
        agent = CustomAgent(sample_config)
        assert agent.name == "morning-briefing"
        assert agent.description == "Summarizes my emails every morning"
        assert agent.default_ui_pattern == UIPattern.CHAT
        assert agent.suggestions == ["Summarize inbox", "Draft replies"]

    def test_system_prompt_from_config(self, sample_config):
        agent = CustomAgent(sample_config)
        assert "morning briefing" in agent.system_prompt.lower()

    def test_borrows_email_tools(self, sample_config):
        agent = CustomAgent(sample_config)
        tool_names = [t["name"] for t in agent.tools]
        assert "list_inbox" in tool_names
        assert "read_email" in tool_names
        assert "draft_reply" in tool_names
        assert "send_email" in tool_names

    def test_borrows_code_tools(self):
        config = CustomAgentConfig(
            name="pr-helper",
            description="Reviews PRs",
            system_prompt="Review code.",
            tool_sets=["code"],
        )
        agent = CustomAgent(config)
        tool_names = [t["name"] for t in agent.tools]
        assert "list_prs" in tool_names
        assert "read_diff" in tool_names

    def test_borrows_writing_tools(self):
        config = CustomAgentConfig(
            name="writer",
            description="Writes docs",
            system_prompt="Write.",
            tool_sets=["writing"],
        )
        agent = CustomAgent(config)
        tool_names = [t["name"] for t in agent.tools]
        assert "create_document" in tool_names
        assert "edit_document" in tool_names

    def test_multiple_tool_sets(self):
        config = CustomAgentConfig(
            name="multi",
            description="Does everything",
            system_prompt="Handle all tasks.",
            tool_sets=["email", "code"],
        )
        agent = CustomAgent(config)
        tool_names = [t["name"] for t in agent.tools]
        assert "list_inbox" in tool_names
        assert "list_prs" in tool_names

    def test_no_tool_sets(self, config_no_tools):
        agent = CustomAgent(config_no_tools)
        assert agent.tools == []
        assert agent.approval_required == set()

    def test_inherits_approval_required(self, sample_config):
        agent = CustomAgent(sample_config)
        assert "send_email" in agent.approval_required
        assert "archive_email" in agent.approval_required

    def test_custom_approval_tools_merged(self):
        config = CustomAgentConfig(
            name="strict",
            description="Extra cautious",
            system_prompt="Be careful.",
            tool_sets=["email"],
            approval_tools=["list_inbox"],
        )
        agent = CustomAgent(config)
        # list_inbox is not normally approval-required for email agent,
        # but the custom config adds it
        assert "list_inbox" in agent.approval_required
        # And the built-in ones are still there
        assert "send_email" in agent.approval_required

    def test_execute_tool_dispatches_to_delegate(self, sample_config):
        """Tool execution should be delegated to the built-in agent that owns the tool."""
        agent = CustomAgent(sample_config)
        # Calling an unknown tool returns error JSON
        result = agent.execute_tool("nonexistent_tool", {})
        parsed = json.loads(result)
        assert "error" in parsed

    def test_ui_pattern_whiteboard(self):
        config = CustomAgentConfig(
            name="planner",
            description="Plans things",
            system_prompt="Plan.",
            ui_pattern="whiteboard",
        )
        agent = CustomAgent(config)
        assert agent.default_ui_pattern == UIPattern.WHITEBOARD

    def test_available_tool_sets_constant(self):
        assert "email" in AVAILABLE_TOOL_SETS
        assert "code" in AVAILABLE_TOOL_SETS
        assert "writing" in AVAILABLE_TOOL_SETS


# ---- Router Tests ----


class TestCustomAgentRouting:
    def test_create_agent_intent_routes_to_general(self):
        from agent.router import IntentRouter

        router = IntentRouter()
        result = router.route("create an agent that handles my inbox")
        assert result.agent == "general"
        assert result.ui_pattern == "chat"

    def test_make_agent_intent_routes_to_general(self):
        from agent.router import IntentRouter

        router = IntentRouter()
        result = router.route(
            "make me an agent that summarizes my emails every morning"
        )
        assert result.agent == "general"
        assert result.ui_pattern == "chat"

    def test_set_up_bot_intent_routes_to_general(self):
        from agent.router import IntentRouter

        router = IntentRouter()
        result = router.route("set up a bot that reviews PRs")
        assert result.agent == "general"
        assert result.ui_pattern == "chat"

    def test_configure_assistant_intent_routes_to_general(self):
        from agent.router import IntentRouter

        router = IntentRouter()
        result = router.route("configure an assistant for my team")
        assert result.agent == "general"
        assert result.ui_pattern == "chat"

    def test_normal_email_intent_not_captured(self):
        from agent.router import IntentRouter

        router = IntentRouter()
        result = router.route("reply to John's email")
        assert result.agent == "email"

    def test_normal_code_intent_not_captured(self):
        from agent.router import IntentRouter

        router = IntentRouter()
        result = router.route("build a function that sorts numbers")
        assert result.agent == "code"


# ---- AgentRunner Integration Tests ----


class TestRunnerCustomAgentIntegration:
    @pytest.fixture
    def runner(self):
        """Create a runner with a temporary database for testing."""
        from unittest.mock import MagicMock
        from agent.runner import AgentRunner
        from agent.session_store import SessionStore
        from agent.activity_store import ActivityStore
        from agent.custom_agent_store import CustomAgentStore

        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self._db_path = path

        session_store = SessionStore(db_path=path)
        activity_store = ActivityStore(db_path=path)
        custom_store = CustomAgentStore(db_path=path)

        runner = AgentRunner(
            client=MagicMock(),
            session_store=session_store,
            activity_store=activity_store,
            custom_agent_store=custom_store,
        )
        yield runner
        os.unlink(path)

    def test_register_custom_agent(self, runner, sample_config):
        runner.register_custom_agent(sample_config)
        assert "morning-briefing" in runner.agents
        assert runner.is_custom_agent("morning-briefing")

    def test_builtin_agents_not_custom(self, runner):
        assert not runner.is_custom_agent("email")
        assert not runner.is_custom_agent("code")
        assert not runner.is_custom_agent("general")

    def test_describe_agents_includes_custom_flag(self, runner, sample_config):
        runner.register_custom_agent(sample_config)
        agents = runner.describe_agents()
        custom_agents = [a for a in agents if a["custom"]]
        builtin_agents = [a for a in agents if not a["custom"]]
        assert len(custom_agents) == 1
        assert custom_agents[0]["name"] == "morning-briefing"
        assert len(builtin_agents) == 5  # email, code, general, planning, writing

    def test_describe_agent_includes_custom_flag(self, runner, sample_config):
        runner.register_custom_agent(sample_config)
        detail = runner.describe_agent("morning-briefing")
        assert detail["custom"] is True
        detail_builtin = runner.describe_agent("email")
        assert detail_builtin["custom"] is False

    def test_unregister_custom_agent(self, runner, sample_config):
        runner.register_custom_agent(sample_config)
        assert runner.unregister_custom_agent("morning-briefing") is True
        assert "morning-briefing" not in runner.agents
        assert not runner.is_custom_agent("morning-briefing")

    def test_unregister_nonexistent_returns_false(self, runner):
        assert runner.unregister_custom_agent("nonexistent") is False

    def test_update_custom_agent(self, runner, sample_config):
        runner.register_custom_agent(sample_config)
        sample_config.description = "Updated"
        updated = runner.update_custom_agent(sample_config)
        assert updated.description == "Updated"
        assert runner.agents["morning-briefing"].description == "Updated"

    def test_custom_agents_loaded_on_init(self):
        """Custom agents persisted in SQLite should be loaded when a new runner is created."""
        from unittest.mock import MagicMock
        from agent.runner import AgentRunner
        from agent.session_store import SessionStore
        from agent.activity_store import ActivityStore
        from agent.custom_agent_store import CustomAgentStore

        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)

        try:
            # First: create a custom agent via the store directly
            store = CustomAgentStore(db_path=path)
            store.create(
                CustomAgentConfig(
                    name="persisted-agent",
                    description="test",
                    system_prompt="test prompt",
                )
            )

            # Second: create a new runner - it should load the custom agent
            runner = AgentRunner(
                client=MagicMock(),
                session_store=SessionStore(db_path=path),
                activity_store=ActivityStore(db_path=path),
                custom_agent_store=CustomAgentStore(db_path=path),
            )
            assert "persisted-agent" in runner.agents
            assert runner.is_custom_agent("persisted-agent")
        finally:
            os.unlink(path)

    def test_register_duplicate_raises(self, runner, sample_config):
        runner.register_custom_agent(sample_config)
        with pytest.raises(ValueError):
            runner.register_custom_agent(sample_config)


# ---- API Endpoint Tests ----


class TestCustomAgentAPI:
    @pytest.fixture(autouse=True)
    def cleanup_custom_agents(self):
        """Clean up any custom agents after each test."""
        from agent.main import runner

        yield
        # Remove all custom agents registered during the test
        custom_names = [
            name for name in list(runner.agents.keys()) if runner.is_custom_agent(name)
        ]
        for name in custom_names:
            runner.unregister_custom_agent(name)

    @pytest.fixture
    def client(self):
        """Create a FastAPI test client using the module-level app."""
        from fastapi.testclient import TestClient
        from agent.main import app

        return TestClient(app)

    def test_list_tool_sets(self, client):
        resp = client.get("/api/agents/tool-sets")
        assert resp.status_code == 200
        data = resp.json()
        assert "email" in data["tool_sets"]
        assert "code" in data["tool_sets"]
        assert "writing" in data["tool_sets"]

    def test_create_custom_agent(self, client):
        resp = client.post(
            "/api/agents/custom",
            json={
                "name": "test-agent",
                "description": "A test agent",
                "system_prompt": "You are a test agent.",
                "tool_sets": ["email"],
                "ui_pattern": "chat",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "created"
        assert data["name"] == "test-agent"

    def test_create_agent_appears_in_list(self, client):
        client.post(
            "/api/agents/custom",
            json={
                "name": "listed-agent",
                "description": "Should appear in list",
                "system_prompt": "Test.",
            },
        )
        resp = client.get("/api/agents")
        names = [a["name"] for a in resp.json()]
        assert "listed-agent" in names

    def test_create_agent_detail_viewable(self, client):
        client.post(
            "/api/agents/custom",
            json={
                "name": "detail-agent",
                "description": "Has detail",
                "system_prompt": "Test.",
                "tool_sets": ["email"],
            },
        )
        resp = client.get("/api/agents/detail-agent")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "detail-agent"
        assert data["custom"] is True

    def test_create_duplicate_returns_409(self, client):
        payload = {
            "name": "dup-agent",
            "description": "First",
            "system_prompt": "Test.",
        }
        client.post("/api/agents/custom", json=payload)
        resp = client.post("/api/agents/custom", json=payload)
        assert resp.status_code == 409

    def test_create_reserved_name_returns_409(self, client):
        resp = client.post(
            "/api/agents/custom",
            json={
                "name": "email",
                "description": "Trying to override",
                "system_prompt": "Test.",
            },
        )
        assert resp.status_code == 409

    def test_create_invalid_tool_set_returns_400(self, client):
        resp = client.post(
            "/api/agents/custom",
            json={
                "name": "bad-tools",
                "description": "Invalid",
                "system_prompt": "Test.",
                "tool_sets": ["nonexistent"],
            },
        )
        assert resp.status_code == 400

    def test_create_invalid_ui_pattern_returns_400(self, client):
        resp = client.post(
            "/api/agents/custom",
            json={
                "name": "bad-ui",
                "description": "Invalid",
                "system_prompt": "Test.",
                "ui_pattern": "nonexistent",
            },
        )
        assert resp.status_code == 400

    def test_delete_custom_agent(self, client):
        client.post(
            "/api/agents/custom",
            json={
                "name": "to-delete",
                "description": "Will be deleted",
                "system_prompt": "Test.",
            },
        )
        resp = client.delete("/api/agents/custom/to-delete")
        assert resp.status_code == 200
        assert resp.json()["status"] == "deleted"

        # Verify gone from list
        resp = client.get("/api/agents")
        names = [a["name"] for a in resp.json()]
        assert "to-delete" not in names

    def test_delete_builtin_returns_404(self, client):
        resp = client.delete("/api/agents/custom/email")
        assert resp.status_code == 404

    def test_delete_nonexistent_returns_404(self, client):
        resp = client.delete("/api/agents/custom/nonexistent")
        assert resp.status_code == 404

    def test_update_custom_agent(self, client):
        client.post(
            "/api/agents/custom",
            json={
                "name": "updatable",
                "description": "Original",
                "system_prompt": "Original prompt.",
            },
        )
        resp = client.put(
            "/api/agents/custom/updatable",
            json={
                "name": "updatable",
                "description": "Updated",
                "system_prompt": "Updated prompt.",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "updated"

        # Verify update took effect
        resp = client.get("/api/agents/updatable")
        assert resp.json()["description"] == "Updated"

    def test_update_builtin_returns_404(self, client):
        resp = client.put(
            "/api/agents/custom/email",
            json={
                "name": "email",
                "description": "Trying to update",
                "system_prompt": "Test.",
            },
        )
        assert resp.status_code == 404
