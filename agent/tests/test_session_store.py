"""Tests for SQLite session store."""

import os
import tempfile
import pytest

from agent.session_store import SessionStore


@pytest.fixture
def store():
    """Create a session store backed by a temporary database."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        yield SessionStore(db_path=path)
    finally:
        os.unlink(path)


class TestSessionStore:
    def test_create_and_check_session(self, store):
        store.create_session("sess-1")
        assert store.session_exists("sess-1")
        assert not store.session_exists("sess-2")

    def test_create_session_idempotent(self, store):
        store.create_session("sess-1")
        store.create_session("sess-1")  # Should not raise
        assert store.session_exists("sess-1")

    def test_append_and_get_messages(self, store):
        store.create_session("sess-1")
        store.append_message("sess-1", "user", "hello")
        store.append_message("sess-1", "assistant", "hi there")

        messages = store.get_messages("sess-1")
        assert len(messages) == 2
        assert messages[0] == {"role": "user", "content": "hello"}
        assert messages[1] == {"role": "assistant", "content": "hi there"}

    def test_get_messages_empty_session(self, store):
        store.create_session("sess-1")
        messages = store.get_messages("sess-1")
        assert messages == []

    def test_get_messages_nonexistent_session(self, store):
        messages = store.get_messages("nonexistent")
        assert messages == []

    def test_messages_preserve_order(self, store):
        store.create_session("sess-1")
        for i in range(10):
            store.append_message("sess-1", "user", f"message {i}")

        messages = store.get_messages("sess-1")
        assert len(messages) == 10
        for i, msg in enumerate(messages):
            assert msg["content"] == f"message {i}"

    def test_messages_with_complex_content(self, store):
        """Tool results are stored as JSON lists of dicts."""
        store.create_session("sess-1")
        tool_results = [
            {
                "type": "tool_result",
                "tool_use_id": "toolu_123",
                "content": '{"emails": [{"id": 1, "subject": "Hello"}]}',
            }
        ]
        store.append_message("sess-1", "user", tool_results)

        messages = store.get_messages("sess-1")
        assert len(messages) == 1
        assert messages[0]["role"] == "user"
        assert messages[0]["content"] == tool_results

    def test_sessions_are_isolated(self, store):
        store.create_session("sess-1")
        store.create_session("sess-2")
        store.append_message("sess-1", "user", "for session 1")
        store.append_message("sess-2", "user", "for session 2")

        msgs1 = store.get_messages("sess-1")
        msgs2 = store.get_messages("sess-2")
        assert len(msgs1) == 1
        assert len(msgs2) == 1
        assert msgs1[0]["content"] == "for session 1"
        assert msgs2[0]["content"] == "for session 2"

    def test_list_sessions(self, store):
        store.create_session("sess-1")
        store.create_session("sess-2")
        store.append_message("sess-1", "user", "hello")
        store.append_message("sess-1", "assistant", "hi")

        sessions = store.list_sessions()
        assert len(sessions) == 2
        # Most recently updated first
        sess1 = next(s for s in sessions if s["session_id"] == "sess-1")
        assert sess1["message_count"] == 2

    def test_delete_session(self, store):
        store.create_session("sess-1")
        store.append_message("sess-1", "user", "hello")

        assert store.delete_session("sess-1")
        assert not store.session_exists("sess-1")
        assert store.get_messages("sess-1") == []

    def test_delete_nonexistent_session(self, store):
        assert not store.delete_session("nonexistent")

    def test_persistence_across_instances(self):
        """A new SessionStore instance reads data written by a previous one."""
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        try:
            store1 = SessionStore(db_path=path)
            store1.create_session("sess-1")
            store1.append_message("sess-1", "user", "persisted message")

            # Create a new instance pointing to the same file
            store2 = SessionStore(db_path=path)
            assert store2.session_exists("sess-1")
            messages = store2.get_messages("sess-1")
            assert len(messages) == 1
            assert messages[0]["content"] == "persisted message"
        finally:
            os.unlink(path)
