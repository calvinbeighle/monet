"""Tests for the keystroke collection pipeline.

Tests cover:
- KeystrokeStore: CRUD, batch ingest, filtering, summaries, pruning, aggregates
- KeystrokeCollector: queue management, sensitive context filtering, lifecycle
- API endpoints: ingest, summary, events, count, hourly, prune, clear
- Privacy: sensitive contexts are filtered, clear_all works

The keystroke pipeline is the foundation for Monet's personalization engine.
SCOPE.md: "Keystroke collection pipeline for user behavior modeling"
"""

import os
import tempfile
import time
from unittest.mock import patch

import pytest

from agent.keystroke_store import (
    DEFAULT_RETENTION_DAYS,
    EVENT_TYPE_KEY_PRESS,
    EVENT_TYPE_KEY_RELEASE,
    EVENT_TYPE_MODIFIER,
    MAX_BATCH_SIZE,
    VALID_EVENT_TYPES,
    InteractionSummary,
    KeystrokeEvent,
    KeystrokeStore,
)
from agent.keystroke_collector import (
    SENSITIVE_CONTEXTS,
    KeystrokeCollector,
    is_sensitive_context,
    _find_focused_name,
)


@pytest.fixture
def keystroke_store():
    """Create a KeystrokeStore backed by a temporary SQLite database."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    store = KeystrokeStore(db_path=path)
    yield store
    os.unlink(path)


def _make_event(
    event_type=EVENT_TYPE_KEY_PRESS,
    key_code=30,
    timestamp=None,
    context="terminal",
    modifiers="",
    session_id="test-session",
):
    """Helper to create a KeystrokeEvent with sensible defaults."""
    return KeystrokeEvent(
        event_type=event_type,
        key_code=key_code,
        timestamp=timestamp or time.time(),
        context=context,
        modifiers=modifiers,
        session_id=session_id,
    )


# --- KeystrokeStore tests ---


class TestKeystrokeStoreInit:
    """Tests for store initialization and schema."""

    def test_creates_tables(self, keystroke_store):
        """Store creates keystroke_events and keystroke_hourly_agg tables."""
        import sqlite3

        with sqlite3.connect(keystroke_store.db_path) as conn:
            tables = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
            table_names = {t[0] for t in tables}
        assert "keystroke_events" in table_names
        assert "keystroke_hourly_agg" in table_names

    def test_creates_indexes(self, keystroke_store):
        """Store creates performance indexes."""
        import sqlite3

        with sqlite3.connect(keystroke_store.db_path) as conn:
            indexes = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index'"
            ).fetchall()
            index_names = {i[0] for i in indexes}
        assert "idx_keystroke_timestamp" in index_names
        assert "idx_keystroke_context" in index_names
        assert "idx_keystroke_session" in index_names

    def test_idempotent_init(self, keystroke_store):
        """Calling _init_db again does not fail or duplicate tables."""
        keystroke_store._init_db()
        assert keystroke_store.get_event_count() == 0


class TestKeystrokeIngest:
    """Tests for batch event ingestion."""

    def test_ingest_single_event(self, keystroke_store):
        event = _make_event()
        count = keystroke_store.ingest([event])
        assert count == 1
        assert keystroke_store.get_event_count() == 1

    def test_ingest_multiple_events(self, keystroke_store):
        events = [_make_event(key_code=i) for i in range(10)]
        count = keystroke_store.ingest(events)
        assert count == 10
        assert keystroke_store.get_event_count() == 10

    def test_ingest_empty_list(self, keystroke_store):
        count = keystroke_store.ingest([])
        assert count == 0

    def test_ingest_filters_invalid_event_types(self, keystroke_store):
        events = [
            _make_event(event_type="key_press"),
            _make_event(event_type="invalid_type"),
            _make_event(event_type="key_release"),
        ]
        count = keystroke_store.ingest(events)
        assert count == 2  # Only valid types stored

    def test_ingest_all_valid_types(self, keystroke_store):
        events = [
            _make_event(event_type=EVENT_TYPE_KEY_PRESS),
            _make_event(event_type=EVENT_TYPE_KEY_RELEASE),
            _make_event(event_type=EVENT_TYPE_MODIFIER),
        ]
        count = keystroke_store.ingest(events)
        assert count == 3

    def test_ingest_caps_batch_size(self, keystroke_store):
        # Create more events than MAX_BATCH_SIZE
        events = [_make_event(key_code=i) for i in range(MAX_BATCH_SIZE + 100)]
        count = keystroke_store.ingest(events)
        assert count == MAX_BATCH_SIZE

    def test_ingest_duplicate_ids_ignored(self, keystroke_store):
        event = _make_event()
        keystroke_store.ingest([event])
        # Same event again - should be ignored (INSERT OR IGNORE)
        count = keystroke_store.ingest([event])
        assert count == 1  # Reports 1 attempted but DB has only 1
        assert keystroke_store.get_event_count() == 1

    def test_ingest_preserves_all_fields(self, keystroke_store):
        ts = time.time()
        event = _make_event(
            event_type=EVENT_TYPE_KEY_PRESS,
            key_code=42,
            timestamp=ts,
            context="vscode",
            modifiers="29,42",
            session_id="sess-123",
        )
        keystroke_store.ingest([event])
        events = keystroke_store.get_events(limit=1)
        assert len(events) == 1
        e = events[0]
        assert e["event_type"] == EVENT_TYPE_KEY_PRESS
        assert e["key_code"] == 42
        assert e["timestamp"] == ts
        assert e["context"] == "vscode"
        assert e["modifiers"] == "29,42"
        assert e["session_id"] == "sess-123"


class TestKeystrokeQuery:
    """Tests for querying stored events."""

    def test_get_events_default(self, keystroke_store):
        events = [_make_event(key_code=i) for i in range(5)]
        keystroke_store.ingest(events)
        result = keystroke_store.get_events()
        assert len(result) == 5

    def test_get_events_with_limit(self, keystroke_store):
        events = [_make_event(key_code=i) for i in range(10)]
        keystroke_store.ingest(events)
        result = keystroke_store.get_events(limit=3)
        assert len(result) == 3

    def test_get_events_filter_by_context(self, keystroke_store):
        keystroke_store.ingest(
            [
                _make_event(context="terminal"),
                _make_event(context="browser"),
                _make_event(context="terminal"),
            ]
        )
        result = keystroke_store.get_events(context="terminal")
        assert len(result) == 2
        assert all(e["context"] == "terminal" for e in result)

    def test_get_events_filter_by_session(self, keystroke_store):
        keystroke_store.ingest(
            [
                _make_event(session_id="a"),
                _make_event(session_id="b"),
                _make_event(session_id="a"),
            ]
        )
        result = keystroke_store.get_events(session_id="a")
        assert len(result) == 2

    def test_get_events_filter_by_time_range(self, keystroke_store):
        now = time.time()
        keystroke_store.ingest(
            [
                _make_event(timestamp=now - 100),
                _make_event(timestamp=now - 50),
                _make_event(timestamp=now),
            ]
        )
        result = keystroke_store.get_events(since=now - 75, until=now - 25)
        assert len(result) == 1

    def test_get_events_ordered_by_timestamp_desc(self, keystroke_store):
        now = time.time()
        keystroke_store.ingest(
            [
                _make_event(timestamp=now - 2),
                _make_event(timestamp=now),
                _make_event(timestamp=now - 1),
            ]
        )
        result = keystroke_store.get_events()
        timestamps = [e["timestamp"] for e in result]
        assert timestamps == sorted(timestamps, reverse=True)


class TestKeystrokeCount:
    """Tests for event counting."""

    def test_count_empty(self, keystroke_store):
        assert keystroke_store.get_event_count() == 0

    def test_count_after_ingest(self, keystroke_store):
        keystroke_store.ingest([_make_event() for _ in range(7)])
        assert keystroke_store.get_event_count() == 7

    def test_count_with_time_range(self, keystroke_store):
        now = time.time()
        keystroke_store.ingest(
            [
                _make_event(timestamp=now - 100),
                _make_event(timestamp=now - 50),
                _make_event(timestamp=now),
            ]
        )
        assert keystroke_store.get_event_count(since=now - 75) == 2


class TestKeystrokeSummary:
    """Tests for the personalization summary endpoint."""

    def test_empty_summary(self, keystroke_store):
        summary = keystroke_store.get_summary()
        assert summary.total_events == 0
        assert summary.events_per_minute == 0.0
        assert summary.top_contexts == []

    def test_summary_counts_events(self, keystroke_store):
        events = [_make_event() for _ in range(20)]
        keystroke_store.ingest(events)
        summary = keystroke_store.get_summary()
        assert summary.total_events == 20

    def test_summary_tracks_sessions(self, keystroke_store):
        keystroke_store.ingest(
            [
                _make_event(session_id="a"),
                _make_event(session_id="b"),
                _make_event(session_id="a"),
            ]
        )
        summary = keystroke_store.get_summary()
        assert summary.total_sessions == 2

    def test_summary_computes_epm(self, keystroke_store):
        now = time.time()
        # 60 events spread over 1 minute = ~60 epm
        events = [_make_event(timestamp=now - 60 + i) for i in range(60)]
        keystroke_store.ingest(events)
        summary = keystroke_store.get_summary()
        assert summary.events_per_minute > 50  # Approximately 60

    def test_summary_top_contexts(self, keystroke_store):
        keystroke_store.ingest(
            [
                _make_event(context="terminal"),
                _make_event(context="terminal"),
                _make_event(context="terminal"),
                _make_event(context="browser"),
            ]
        )
        summary = keystroke_store.get_summary()
        assert len(summary.top_contexts) >= 1
        assert summary.top_contexts[0]["context"] == "terminal"
        assert summary.top_contexts[0]["count"] == 3

    def test_summary_time_range(self, keystroke_store):
        summary = keystroke_store.get_summary()
        assert summary.first_event_at is None
        assert summary.last_event_at is None

        now = time.time()
        keystroke_store.ingest([_make_event(timestamp=now)])
        summary = keystroke_store.get_summary()
        assert summary.first_event_at is not None
        assert summary.last_event_at is not None

    def test_summary_active_days(self, keystroke_store):
        now = time.time()
        keystroke_store.ingest(
            [
                _make_event(timestamp=now),
                _make_event(timestamp=now - 86400),  # Yesterday
            ]
        )
        summary = keystroke_store.get_summary()
        assert summary.active_days >= 1


class TestKeystrokeHourlyAggregates:
    """Tests for hourly aggregate storage."""

    def test_update_and_get_aggregate(self, keystroke_store):
        keystroke_store.update_hourly_aggregate("2026-03-31T14", 150, 45, "terminal")
        aggs = keystroke_store.get_hourly_aggregates()
        assert len(aggs) == 1
        assert aggs[0]["hour_bucket"] == "2026-03-31T14"
        assert aggs[0]["event_count"] == 150
        assert aggs[0]["unique_keys"] == 45
        assert aggs[0]["top_context"] == "terminal"

    def test_upsert_aggregate(self, keystroke_store):
        keystroke_store.update_hourly_aggregate("2026-03-31T14", 100, 30, "terminal")
        keystroke_store.update_hourly_aggregate("2026-03-31T14", 200, 50, "browser")
        aggs = keystroke_store.get_hourly_aggregates()
        assert len(aggs) == 1
        assert aggs[0]["event_count"] == 200  # Updated, not duplicated

    def test_multiple_hour_buckets(self, keystroke_store):
        keystroke_store.update_hourly_aggregate("2026-03-31T14", 100, 30, "terminal")
        keystroke_store.update_hourly_aggregate("2026-03-31T15", 80, 25, "browser")
        aggs = keystroke_store.get_hourly_aggregates()
        assert len(aggs) == 2


class TestKeystrokePrune:
    """Tests for data retention and pruning."""

    def test_prune_removes_old_events(self, keystroke_store):
        now = time.time()
        old_ts = now - (DEFAULT_RETENTION_DAYS + 1) * 86400
        keystroke_store.ingest(
            [
                _make_event(timestamp=old_ts),
                _make_event(timestamp=now),
            ]
        )
        deleted = keystroke_store.prune()
        assert deleted == 1
        assert keystroke_store.get_event_count() == 1

    def test_prune_keeps_recent_events(self, keystroke_store):
        keystroke_store.ingest([_make_event() for _ in range(5)])
        deleted = keystroke_store.prune()
        assert deleted == 0
        assert keystroke_store.get_event_count() == 5

    def test_prune_custom_retention(self, keystroke_store):
        now = time.time()
        keystroke_store.ingest(
            [
                _make_event(timestamp=now - 2 * 86400),  # 2 days ago
                _make_event(timestamp=now),
            ]
        )
        deleted = keystroke_store.prune(retention_days=1)
        assert deleted == 1

    def test_clear_all(self, keystroke_store):
        keystroke_store.ingest([_make_event() for _ in range(10)])
        keystroke_store.update_hourly_aggregate("2026-03-31T14", 100, 30, "term")
        deleted = keystroke_store.clear_all()
        assert deleted == 10
        assert keystroke_store.get_event_count() == 0
        assert keystroke_store.get_hourly_aggregates() == []


# --- Sensitive context filtering tests ---


class TestSensitiveContext:
    """Tests for privacy-preserving context filtering."""

    def test_empty_context_not_sensitive(self):
        assert is_sensitive_context("") is False

    def test_normal_context_not_sensitive(self):
        assert is_sensitive_context("Terminal - vim") is False
        assert is_sensitive_context("Firefox - GitHub") is False

    def test_password_context_is_sensitive(self):
        assert is_sensitive_context("Enter Password") is True
        assert is_sensitive_context("password dialog") is True

    def test_auth_context_is_sensitive(self):
        assert is_sensitive_context("Authentication Required") is True
        assert is_sensitive_context("Login Screen") is True

    def test_sudo_context_is_sensitive(self):
        assert is_sensitive_context("sudo prompt") is True

    def test_gpg_context_is_sensitive(self):
        assert is_sensitive_context("gpg key entry") is True

    def test_ssh_askpass_is_sensitive(self):
        assert is_sensitive_context("ssh-askpass") is True

    def test_case_insensitive(self):
        assert is_sensitive_context("PASSWORD Entry") is True
        assert is_sensitive_context("SUDO PROMPT") is True

    def test_all_sensitive_keywords_detected(self):
        for keyword in SENSITIVE_CONTEXTS:
            assert is_sensitive_context(f"Window - {keyword} - dialog") is True


# --- Sway IPC helper tests ---


class TestSwayIPC:
    """Tests for Sway tree parsing."""

    def test_find_focused_simple(self):
        tree = {"focused": True, "name": "Terminal", "nodes": []}
        assert _find_focused_name(tree) == "Terminal"

    def test_find_focused_nested(self):
        tree = {
            "focused": False,
            "name": "root",
            "nodes": [
                {
                    "focused": False,
                    "name": "workspace",
                    "nodes": [
                        {"focused": True, "name": "Firefox", "nodes": []},
                    ],
                    "floating_nodes": [],
                },
            ],
            "floating_nodes": [],
        }
        assert _find_focused_name(tree) == "Firefox"

    def test_find_focused_none(self):
        tree = {"focused": False, "name": "root", "nodes": []}
        assert _find_focused_name(tree) == ""

    def test_find_focused_in_floating(self):
        tree = {
            "focused": False,
            "name": "root",
            "nodes": [],
            "floating_nodes": [
                {"focused": True, "name": "Dialog", "nodes": []},
            ],
        }
        assert _find_focused_name(tree) == "Dialog"


# --- KeystrokeCollector tests ---


class TestKeystrokeCollector:
    """Tests for the collector daemon."""

    def test_collector_init(self, keystroke_store):
        collector = KeystrokeCollector(store=keystroke_store, flush_interval=0.1)
        assert collector.running is False
        assert collector.queue_size == 0

    def test_enqueue_event(self, keystroke_store):
        collector = KeystrokeCollector(store=keystroke_store)
        event = _make_event()
        assert collector.enqueue_event(event) is True
        assert collector.queue_size == 1

    def test_enqueue_filters_sensitive(self, keystroke_store):
        collector = KeystrokeCollector(store=keystroke_store)
        event = _make_event(context="password dialog")
        assert collector.enqueue_event(event) is False
        assert collector.queue_size == 0

    def test_start_stop_lifecycle(self, keystroke_store):
        collector = KeystrokeCollector(store=keystroke_store, flush_interval=0.05)
        collector.start()
        assert collector.running is True
        # Enqueue and wait for flush
        collector.enqueue_event(_make_event())
        time.sleep(0.15)
        collector.stop()
        assert collector.running is False
        # Event should have been flushed to store
        assert keystroke_store.get_event_count() == 1

    def test_start_is_idempotent(self, keystroke_store):
        collector = KeystrokeCollector(store=keystroke_store, flush_interval=0.05)
        collector.start()
        collector.start()  # Should not fail
        assert collector.running is True
        collector.stop()

    def test_stop_flushes_remaining(self, keystroke_store):
        collector = KeystrokeCollector(
            store=keystroke_store,
            flush_interval=60,  # Long interval
        )
        collector.start()
        for i in range(5):
            collector.enqueue_event(_make_event(key_code=i))
        collector.stop()  # Should flush immediately
        assert keystroke_store.get_event_count() == 5

    def test_queue_full_drops_event(self, keystroke_store):
        collector = KeystrokeCollector(store=keystroke_store)
        # Fill the queue
        for i in range(10000):
            collector.enqueue_event(_make_event(key_code=i % 256))
        # Next event should be dropped
        result = collector.enqueue_event(_make_event())
        assert result is False


# --- API endpoint tests ---


class TestKeystrokeAPI:
    """Tests for the keystroke HTTP API endpoints."""

    @pytest.fixture
    def client(self, tmp_path):
        """Create a test client with an isolated database."""
        db_path = str(tmp_path / "test.db")
        os.environ["MONET_DB_PATH"] = db_path

        from agent.main import app, keystroke_store as app_ks

        app_ks.__init__(db_path=db_path)

        from fastapi.testclient import TestClient

        return TestClient(app)

    def test_ingest_endpoint(self, client):
        resp = client.post(
            "/api/keystrokes/ingest",
            json={
                "events": [
                    {
                        "event_type": "key_press",
                        "key_code": 30,
                        "timestamp": time.time(),
                        "context": "terminal",
                        "session_id": "test",
                    }
                ]
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["ingested"] == 1

    def test_ingest_empty_events(self, client):
        resp = client.post("/api/keystrokes/ingest", json={"events": []})
        assert resp.status_code == 200
        assert resp.json()["ingested"] == 0

    def test_ingest_malformed_events_skipped(self, client):
        resp = client.post(
            "/api/keystrokes/ingest",
            json={
                "events": [
                    {
                        "event_type": "key_press",
                        "key_code": 30,
                        "timestamp": time.time(),
                    },
                    {},  # Missing fields but gets defaults
                ]
            },
        )
        assert resp.status_code == 200

    def test_summary_endpoint(self, client):
        resp = client.get("/api/keystrokes/summary")
        assert resp.status_code == 200
        data = resp.json()
        assert "total_events" in data
        assert "events_per_minute" in data
        assert "peak_hour" in data
        assert "top_contexts" in data

    def test_summary_with_days_param(self, client):
        resp = client.get("/api/keystrokes/summary?days=7")
        assert resp.status_code == 200

    def test_events_endpoint(self, client):
        # Ingest first
        client.post(
            "/api/keystrokes/ingest",
            json={
                "events": [
                    {
                        "event_type": "key_press",
                        "key_code": 30,
                        "timestamp": time.time(),
                        "context": "terminal",
                    }
                ]
            },
        )
        resp = client.get("/api/keystrokes/events")
        assert resp.status_code == 200
        events = resp.json()
        assert len(events) == 1
        assert events[0]["key_code"] == 30

    def test_events_with_filters(self, client):
        resp = client.get("/api/keystrokes/events?context=terminal&limit=5")
        assert resp.status_code == 200

    def test_count_endpoint(self, client):
        resp = client.get("/api/keystrokes/count")
        assert resp.status_code == 200
        assert "count" in resp.json()

    def test_hourly_endpoint(self, client):
        resp = client.get("/api/keystrokes/hourly")
        assert resp.status_code == 200

    def test_prune_endpoint(self, client):
        resp = client.post("/api/keystrokes/prune?retention_days=30")
        assert resp.status_code == 200
        assert resp.json()["status"] == "pruned"

    def test_prune_rejects_zero_days(self, client):
        resp = client.post("/api/keystrokes/prune?retention_days=0")
        assert resp.status_code == 400

    def test_clear_endpoint(self, client):
        # Ingest some events first
        client.post(
            "/api/keystrokes/ingest",
            json={
                "events": [
                    {
                        "event_type": "key_press",
                        "key_code": 30,
                        "timestamp": time.time(),
                    }
                ]
            },
        )
        resp = client.delete("/api/keystrokes")
        assert resp.status_code == 200
        assert resp.json()["status"] == "cleared"
        # Verify cleared
        count_resp = client.get("/api/keystrokes/count")
        assert count_resp.json()["count"] == 0


# --- Data model tests ---


class TestDataModels:
    """Tests for keystroke data models."""

    def test_keystroke_event_defaults(self):
        event = KeystrokeEvent(
            event_type="key_press",
            key_code=30,
            timestamp=time.time(),
        )
        assert event.context == ""
        assert event.modifiers == ""
        assert event.session_id == ""
        assert len(event.id) == 12

    def test_keystroke_event_unique_ids(self):
        e1 = KeystrokeEvent(event_type="key_press", key_code=30, timestamp=time.time())
        e2 = KeystrokeEvent(event_type="key_press", key_code=30, timestamp=time.time())
        assert e1.id != e2.id

    def test_interaction_summary_defaults(self):
        summary = InteractionSummary()
        assert summary.total_events == 0
        assert summary.total_sessions == 0
        assert summary.events_per_minute == 0.0
        assert summary.peak_hour == 0
        assert summary.top_contexts == []
        assert summary.active_days == 0
        assert summary.first_event_at is None
        assert summary.last_event_at is None

    def test_valid_event_types(self):
        assert EVENT_TYPE_KEY_PRESS in VALID_EVENT_TYPES
        assert EVENT_TYPE_KEY_RELEASE in VALID_EVENT_TYPES
        assert EVENT_TYPE_MODIFIER in VALID_EVENT_TYPES
        assert len(VALID_EVENT_TYPES) == 3
