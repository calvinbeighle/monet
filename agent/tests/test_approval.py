"""Tests for the approval gate."""

import threading
import time

from agent.approval import ApprovalGate
from agent.models import ApprovalStatus


class TestApprovalGate:
    def setup_method(self):
        self.gate = ApprovalGate()

    def test_create_request(self):
        req = self.gate.create("send_email", {"to": "test@example.com"})
        assert req.tool_name == "send_email"
        assert req.parameters == {"to": "test@example.com"}
        assert req.status == ApprovalStatus.PENDING
        assert len(req.id) == 8

    def test_approve_request(self):
        req = self.gate.create("send_email", {"to": "test@example.com"})
        result = self.gate.approve(req.id)
        assert result is not None
        assert result.status == ApprovalStatus.APPROVED

    def test_reject_request(self):
        req = self.gate.create("merge_pr", {"pr_number": 42})
        result = self.gate.reject(req.id)
        assert result is not None
        assert result.status == ApprovalStatus.REJECTED

    def test_approve_nonexistent_returns_none(self):
        result = self.gate.approve("nonexistent")
        assert result is None

    def test_reject_nonexistent_returns_none(self):
        result = self.gate.reject("nonexistent")
        assert result is None

    def test_double_approve_returns_none(self):
        req = self.gate.create("send_email", {})
        self.gate.approve(req.id)
        result = self.gate.approve(req.id)
        assert result is None

    def test_approve_rejected_returns_none(self):
        req = self.gate.create("send_email", {})
        self.gate.reject(req.id)
        result = self.gate.approve(req.id)
        assert result is None

    def test_list_pending(self):
        self.gate.create("send_email", {})
        self.gate.create("merge_pr", {})
        req3 = self.gate.create("archive_email", {})
        self.gate.approve(req3.id)

        pending = self.gate.list_pending()
        assert len(pending) == 2
        assert all(r.status == ApprovalStatus.PENDING for r in pending)

    def test_list_pending_by_session(self):
        self.gate.create("send_email", {}, session_id="session1")
        self.gate.create("merge_pr", {}, session_id="session2")
        self.gate.create("archive_email", {}, session_id="session1")

        pending = self.gate.list_pending(session_id="session1")
        assert len(pending) == 2

    def test_get_request(self):
        req = self.gate.create("send_email", {"to": "test@example.com"})
        fetched = self.gate.get(req.id)
        assert fetched is not None
        assert fetched.id == req.id
        assert fetched.tool_name == "send_email"

    def test_get_nonexistent_returns_none(self):
        assert self.gate.get("nonexistent") is None

    def test_wait_for_approval(self):
        """Test that wait_for_resolution unblocks when approved."""
        req = self.gate.create("send_email", {})

        def approve_later():
            time.sleep(0.1)
            self.gate.approve(req.id)

        thread = threading.Thread(target=approve_later)
        thread.start()

        status = self.gate.wait_for_resolution(req.id, timeout=5)
        assert status == ApprovalStatus.APPROVED
        thread.join()

    def test_wait_for_rejection(self):
        """Test that wait_for_resolution unblocks when rejected."""
        req = self.gate.create("send_email", {})

        def reject_later():
            time.sleep(0.1)
            self.gate.reject(req.id)

        thread = threading.Thread(target=reject_later)
        thread.start()

        status = self.gate.wait_for_resolution(req.id, timeout=5)
        assert status == ApprovalStatus.REJECTED
        thread.join()

    def test_wait_timeout(self):
        """Test that wait_for_resolution returns PENDING on timeout."""
        req = self.gate.create("send_email", {})
        status = self.gate.wait_for_resolution(req.id, timeout=0.1)
        # After timeout, request is still pending
        assert status == ApprovalStatus.PENDING

    def test_wait_nonexistent_returns_rejected(self):
        status = self.gate.wait_for_resolution("nonexistent", timeout=0.1)
        assert status == ApprovalStatus.REJECTED
