"""Tests for scheduled agent execution (SCOPE.md Feature 3 - autonomous background agents).

SCOPE.md requires agents that "run autonomously in the background" and user-created
agents like "summarize my emails every morning." These tests validate the full
scheduling stack: ScheduleStore (SQLite persistence), AgentScheduler (background
thread execution), and API endpoints.

Why scheduled execution matters: without it, agents are purely reactive. With it,
agents become proactive - monitoring inboxes, summarizing daily, checking PRs
periodically. This is the core differentiator between a chatbot and an autonomous OS.
"""

import os
import tempfile
import time
import threading
from unittest.mock import MagicMock, patch

import pytest

from agent.scheduler import (
    AgentScheduler,
    ScheduleConfig,
    ScheduleStore,
    ScheduleType,
    SCHEDULER_POLL_INTERVAL,
)
from agent.models import AgentOutput, AgentResult


# ---- Fixtures ----


@pytest.fixture
def store():
    """Create a schedule store backed by a temporary database."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        yield ScheduleStore(db_path=path)
    finally:
        os.unlink(path)


@pytest.fixture
def sample_schedule():
    """A minimal interval schedule for testing."""
    return ScheduleConfig(
        agent_name="email",
        intent="Summarize my inbox",
        schedule_type="interval",
        interval_minutes=30,
    )


@pytest.fixture
def daily_schedule():
    """A daily schedule for testing."""
    return ScheduleConfig(
        agent_name="email",
        intent="Morning briefing",
        schedule_type="daily",
        daily_time="09:00",
    )


@pytest.fixture
def scheduler(store):
    """Create a scheduler with a mock runner."""
    sched = AgentScheduler(schedule_store=store)
    yield sched
    sched.stop()


# ---- ScheduleStore Tests ----


class TestScheduleStore:
    def test_create_and_get(self, store, sample_schedule):
        created = store.create(sample_schedule)
        assert created.agent_name == "email"
        assert created.intent == "Summarize my inbox"
        assert created.created_at > 0
        assert created.next_run_at > 0

        loaded = store.get(created.id)
        assert loaded is not None
        assert loaded.agent_name == "email"
        assert loaded.intent == "Summarize my inbox"
        assert loaded.schedule_type == "interval"
        assert loaded.interval_minutes == 30
        assert loaded.enabled is True

    def test_get_nonexistent_returns_none(self, store):
        assert store.get("nonexistent") is None

    def test_list_all_empty(self, store):
        assert store.list_all() == []

    def test_list_all_returns_all(self, store, sample_schedule, daily_schedule):
        store.create(sample_schedule)
        store.create(daily_schedule)
        schedules = store.list_all()
        assert len(schedules) == 2

    def test_list_all_ordered_by_created_at_desc(self, store):
        s1 = ScheduleConfig(agent_name="email", intent="First")
        store.create(s1)
        time.sleep(0.01)
        s2 = ScheduleConfig(agent_name="code", intent="Second")
        store.create(s2)
        schedules = store.list_all()
        assert schedules[0].intent == "Second"
        assert schedules[1].intent == "First"

    def test_list_for_agent(self, store):
        store.create(ScheduleConfig(agent_name="email", intent="Task 1"))
        store.create(ScheduleConfig(agent_name="code", intent="Task 2"))
        store.create(ScheduleConfig(agent_name="email", intent="Task 3"))

        email_schedules = store.list_for_agent("email")
        assert len(email_schedules) == 2
        assert all(s.agent_name == "email" for s in email_schedules)

        code_schedules = store.list_for_agent("code")
        assert len(code_schedules) == 1

    def test_list_due(self, store):
        now = time.time()
        # Schedule that is past due
        past_due = ScheduleConfig(agent_name="email", intent="Past due")
        past_due.next_run_at = now - 100
        store.create(past_due)

        # Schedule that is not yet due
        future = ScheduleConfig(agent_name="code", intent="Future")
        future.next_run_at = now + 10000
        store.create(future)

        due = store.list_due(now)
        assert len(due) == 1
        assert due[0].intent == "Past due"

    def test_list_due_excludes_disabled(self, store):
        now = time.time()
        disabled = ScheduleConfig(agent_name="email", intent="Disabled")
        disabled.next_run_at = now - 100
        disabled.enabled = False
        store.create(disabled)

        due = store.list_due(now)
        assert len(due) == 0

    def test_update_existing(self, store, sample_schedule):
        created = store.create(sample_schedule)
        created.intent = "Updated intent"
        created.interval_minutes = 60
        created.enabled = False

        updated = store.update(created)
        assert updated is not None
        assert updated.intent == "Updated intent"
        assert updated.interval_minutes == 60
        assert updated.enabled is False

        loaded = store.get(created.id)
        assert loaded.intent == "Updated intent"
        assert loaded.enabled is False

    def test_update_nonexistent_returns_none(self, store):
        config = ScheduleConfig(id="nonexistent", agent_name="x", intent="x")
        result = store.update(config)
        assert result is None

    def test_delete_existing(self, store, sample_schedule):
        created = store.create(sample_schedule)
        assert store.delete(created.id) is True
        assert store.get(created.id) is None

    def test_delete_nonexistent(self, store):
        assert store.delete("nonexistent") is False

    def test_record_run_updates_timing(self, store, sample_schedule):
        created = store.create(sample_schedule)
        original_next = created.next_run_at

        now = time.time()
        updated = store.record_run(created.id, now)
        assert updated is not None
        assert updated.last_run_at == now
        assert updated.next_run_at > now
        # For interval of 30 min, next run should be ~30 min from now
        assert abs(updated.next_run_at - (now + 30 * 60)) < 1

    def test_record_run_nonexistent(self, store):
        assert store.record_run("nonexistent") is None

    def test_timestamps_set_on_create(self, store, sample_schedule):
        created = store.create(sample_schedule)
        assert created.created_at > 0
        assert created.updated_at > 0
        assert created.created_at == created.updated_at

    def test_interval_next_run_computed(self, store):
        config = ScheduleConfig(
            agent_name="email",
            intent="Test",
            schedule_type="interval",
            interval_minutes=15,
        )
        now = time.time()
        created = store.create(config)
        # next_run_at should be ~15 min from create time
        assert created.next_run_at > now
        assert created.next_run_at <= now + 15 * 60 + 1

    def test_daily_next_run_computed(self, store, daily_schedule):
        created = store.create(daily_schedule)
        now = time.time()
        # next_run_at should be in the future
        assert created.next_run_at > now
        # And within 24 hours
        assert created.next_run_at <= now + 86400 + 1

    def test_daily_time_parsing_handles_invalid(self, store):
        """Invalid daily_time should fall back to 09:00."""
        config = ScheduleConfig(
            agent_name="email",
            intent="Test",
            schedule_type="daily",
            daily_time="invalid",
        )
        created = store.create(config)
        # Should not crash, should compute a valid next_run_at
        assert created.next_run_at > 0

    def test_enabled_flag_persistence(self, store, sample_schedule):
        sample_schedule.enabled = True
        created = store.create(sample_schedule)
        assert created.enabled is True

        created.enabled = False
        store.update(created)
        loaded = store.get(created.id)
        assert loaded.enabled is False

    def test_created_by_persists(self, store, sample_schedule):
        sample_schedule.created_by = "testuser"
        created = store.create(sample_schedule)
        loaded = store.get(created.id)
        assert loaded.created_by == "testuser"


# ---- AgentScheduler Tests ----


class TestAgentScheduler:
    def test_initial_state(self, scheduler):
        assert scheduler.is_running is False
        assert scheduler.execution_log == []

    def test_start_and_stop(self, scheduler):
        scheduler.start()
        assert scheduler.is_running is True
        scheduler.stop()
        assert scheduler.is_running is False

    def test_double_start_ignored(self, scheduler):
        scheduler.start()
        scheduler.start()  # Should not crash
        assert scheduler.is_running is True
        scheduler.stop()

    def test_stop_when_not_running(self, scheduler):
        scheduler.stop()  # Should not crash
        assert scheduler.is_running is False

    def test_set_runner(self, scheduler):
        mock_runner = MagicMock()
        scheduler.set_runner(mock_runner)
        assert scheduler._runner is mock_runner

    def test_get_status_empty(self, scheduler):
        status = scheduler.get_status()
        assert status["running"] is False
        assert status["total_schedules"] == 0
        assert status["enabled_schedules"] == 0
        assert status["recent_executions"] == []

    def test_get_status_with_schedules(self, scheduler, store, sample_schedule):
        store.create(sample_schedule)
        disabled = ScheduleConfig(agent_name="code", intent="Test", enabled=False)
        store.create(disabled)

        status = scheduler.get_status()
        assert status["total_schedules"] == 2
        assert status["enabled_schedules"] == 1

    def test_execute_schedule_calls_runner(self, scheduler, store, sample_schedule):
        mock_runner = MagicMock()
        mock_runner.run_sync.return_value = AgentResult(
            agent="email",
            ui_pattern="chat",
            outputs=[AgentOutput(content="Inbox summary")],
        )
        scheduler.set_runner(mock_runner)

        created = store.create(sample_schedule)
        now = time.time()
        scheduler._execute_schedule(created, now)

        mock_runner.run_sync.assert_called_once_with("Summarize my inbox")
        assert len(scheduler.execution_log) == 1
        assert scheduler.execution_log[0]["success"] is True
        assert scheduler.execution_log[0]["agent_name"] == "email"

    def test_execute_schedule_records_failure(self, scheduler, store, sample_schedule):
        mock_runner = MagicMock()
        mock_runner.run_sync.side_effect = RuntimeError("API error")
        scheduler.set_runner(mock_runner)

        created = store.create(sample_schedule)
        now = time.time()
        scheduler._execute_schedule(created, now)

        assert len(scheduler.execution_log) == 1
        assert scheduler.execution_log[0]["success"] is False
        assert "API error" in scheduler.execution_log[0]["error"]

    def test_execute_without_runner_skips(self, scheduler, store, sample_schedule):
        created = store.create(sample_schedule)
        # No runner set - should skip without error
        scheduler._execute_schedule(created, time.time())
        assert len(scheduler.execution_log) == 0

    def test_check_and_execute_runs_due_schedules(self, scheduler, store):
        now = time.time()
        due = ScheduleConfig(agent_name="email", intent="Due now")
        due.next_run_at = now - 100
        store.create(due)

        future = ScheduleConfig(agent_name="code", intent="Future")
        future.next_run_at = now + 10000
        store.create(future)

        mock_runner = MagicMock()
        mock_runner.run_sync.return_value = AgentResult(
            agent="email", ui_pattern="chat", outputs=[]
        )
        scheduler.set_runner(mock_runner)

        scheduler._check_and_execute()

        # Only the due schedule should have been executed
        mock_runner.run_sync.assert_called_once_with("Due now")

    def test_execution_log_capped(self, scheduler, store):
        mock_runner = MagicMock()
        mock_runner.run_sync.return_value = AgentResult(
            agent="email", ui_pattern="chat", outputs=[]
        )
        scheduler.set_runner(mock_runner)

        # Create and execute many schedules
        now = time.time()
        for i in range(150):
            s = ScheduleConfig(agent_name="email", intent=f"Task {i}")
            s.next_run_at = now - 100
            created = store.create(s)
            scheduler._execute_schedule(created, now)

        # Log should be capped at max_log_size (100)
        assert len(scheduler.execution_log) <= 100

    def test_background_thread_executes_due(self, scheduler, store):
        """Integration test: verify the background thread picks up and executes due schedules."""
        now = time.time()
        due = ScheduleConfig(agent_name="email", intent="Background test")
        due.next_run_at = now - 100
        store.create(due)

        mock_runner = MagicMock()
        mock_runner.run_sync.return_value = AgentResult(
            agent="email", ui_pattern="chat", outputs=[]
        )
        scheduler.set_runner(mock_runner)

        # Patch the poll interval to be very short for testing
        with patch("agent.scheduler.SCHEDULER_POLL_INTERVAL", 0.1):
            scheduler._stop_event = threading.Event()
            scheduler._running = True
            scheduler._thread = threading.Thread(
                target=scheduler._run_loop, daemon=True
            )
            scheduler._thread.start()

            # Wait for execution
            deadline = time.time() + 2
            while not mock_runner.run_sync.called and time.time() < deadline:
                time.sleep(0.05)

            scheduler.stop()

        assert mock_runner.run_sync.called
        assert mock_runner.run_sync.call_args[0][0] == "Background test"

    def test_record_run_advances_next_run(self, store, sample_schedule):
        created = store.create(sample_schedule)
        now = time.time()

        updated = store.record_run(created.id, now)
        assert updated.last_run_at == now
        assert updated.next_run_at == pytest.approx(now + 30 * 60, abs=1)


# ---- API Endpoint Tests ----


class TestSchedulerAPI:
    @pytest.fixture(autouse=True)
    def cleanup_schedules(self):
        """Clean up schedules after each test."""
        yield
        from agent.main import scheduler as app_scheduler

        for s in app_scheduler.store.list_all():
            app_scheduler.store.delete(s.id)

    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        from agent.main import app

        return TestClient(app)

    def test_list_schedules_empty(self, client):
        resp = client.get("/api/schedules")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_create_schedule_interval(self, client):
        resp = client.post(
            "/api/schedules",
            json={
                "agent_name": "email",
                "intent": "Summarize my inbox",
                "schedule_type": "interval",
                "interval_minutes": 30,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "created"
        assert data["schedule"]["agent_name"] == "email"
        assert data["schedule"]["interval_minutes"] == 30
        assert data["schedule"]["enabled"] is True

    def test_create_schedule_daily(self, client):
        resp = client.post(
            "/api/schedules",
            json={
                "agent_name": "email",
                "intent": "Morning briefing",
                "schedule_type": "daily",
                "daily_time": "09:00",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["schedule"]["schedule_type"] == "daily"
        assert data["schedule"]["daily_time"] == "09:00"

    def test_create_schedule_invalid_agent(self, client):
        resp = client.post(
            "/api/schedules",
            json={
                "agent_name": "nonexistent",
                "intent": "Test",
                "schedule_type": "interval",
            },
        )
        assert resp.status_code == 404

    def test_create_schedule_invalid_type(self, client):
        resp = client.post(
            "/api/schedules",
            json={
                "agent_name": "email",
                "intent": "Test",
                "schedule_type": "invalid",
            },
        )
        assert resp.status_code == 400

    def test_create_schedule_invalid_interval(self, client):
        resp = client.post(
            "/api/schedules",
            json={
                "agent_name": "email",
                "intent": "Test",
                "schedule_type": "interval",
                "interval_minutes": 0,
            },
        )
        assert resp.status_code == 400

    def test_list_schedules_returns_created(self, client):
        client.post(
            "/api/schedules",
            json={
                "agent_name": "email",
                "intent": "Task 1",
                "schedule_type": "interval",
            },
        )
        client.post(
            "/api/schedules",
            json={
                "agent_name": "code",
                "intent": "Task 2",
                "schedule_type": "daily",
                "daily_time": "10:00",
            },
        )
        resp = client.get("/api/schedules")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_get_schedule(self, client):
        resp = client.post(
            "/api/schedules",
            json={
                "agent_name": "email",
                "intent": "Test",
                "schedule_type": "interval",
            },
        )
        schedule_id = resp.json()["schedule"]["id"]

        resp = client.get(f"/api/schedules/{schedule_id}")
        assert resp.status_code == 200
        assert resp.json()["intent"] == "Test"

    def test_get_schedule_not_found(self, client):
        resp = client.get("/api/schedules/nonexistent")
        assert resp.status_code == 404

    def test_update_schedule(self, client):
        resp = client.post(
            "/api/schedules",
            json={
                "agent_name": "email",
                "intent": "Original",
                "schedule_type": "interval",
                "interval_minutes": 30,
            },
        )
        schedule_id = resp.json()["schedule"]["id"]

        resp = client.put(
            f"/api/schedules/{schedule_id}",
            json={
                "intent": "Updated",
                "interval_minutes": 60,
                "enabled": False,
            },
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "updated"

        resp = client.get(f"/api/schedules/{schedule_id}")
        assert resp.json()["intent"] == "Updated"
        assert resp.json()["interval_minutes"] == 60
        assert resp.json()["enabled"] is False

    def test_update_schedule_not_found(self, client):
        resp = client.put("/api/schedules/nonexistent", json={"intent": "X"})
        assert resp.status_code == 404

    def test_delete_schedule(self, client):
        resp = client.post(
            "/api/schedules",
            json={
                "agent_name": "email",
                "intent": "To delete",
                "schedule_type": "interval",
            },
        )
        schedule_id = resp.json()["schedule"]["id"]

        resp = client.delete(f"/api/schedules/{schedule_id}")
        assert resp.status_code == 200
        assert resp.json()["status"] == "deleted"

        resp = client.get(f"/api/schedules/{schedule_id}")
        assert resp.status_code == 404

    def test_delete_schedule_not_found(self, client):
        resp = client.delete("/api/schedules/nonexistent")
        assert resp.status_code == 404

    def test_toggle_schedule(self, client):
        resp = client.post(
            "/api/schedules",
            json={
                "agent_name": "email",
                "intent": "Test",
                "schedule_type": "interval",
            },
        )
        schedule_id = resp.json()["schedule"]["id"]

        # Disable
        resp = client.post(f"/api/schedules/{schedule_id}/toggle")
        assert resp.status_code == 200
        assert resp.json()["enabled"] is False

        # Enable again
        resp = client.post(f"/api/schedules/{schedule_id}/toggle")
        assert resp.status_code == 200
        assert resp.json()["enabled"] is True

    def test_toggle_nonexistent(self, client):
        resp = client.post("/api/schedules/nonexistent/toggle")
        assert resp.status_code == 404

    def test_scheduler_status(self, client):
        resp = client.get("/api/schedules/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "running" in data
        assert "total_schedules" in data
        assert "enabled_schedules" in data

    def test_list_schedules_for_agent(self, client):
        client.post(
            "/api/schedules",
            json={
                "agent_name": "email",
                "intent": "Email task",
                "schedule_type": "interval",
            },
        )
        client.post(
            "/api/schedules",
            json={
                "agent_name": "code",
                "intent": "Code task",
                "schedule_type": "interval",
            },
        )

        resp = client.get("/api/schedules?agent_name=email")
        assert resp.status_code == 200
        schedules = resp.json()
        assert len(schedules) == 1
        assert schedules[0]["agent_name"] == "email"
