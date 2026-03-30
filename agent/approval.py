"""Approval gate - pauses agent execution for user approval on sensitive actions."""

import threading
from typing import Optional
from agent.models import ApprovalRequest, ApprovalStatus


class ApprovalGate:
    """Manages approval requests for sensitive tool calls.

    When an agent tries to use a tool that requires approval (e.g. send_email,
    merge_pr), the gate creates an ApprovalRequest and blocks until the user
    approves or rejects via the API.
    """

    def __init__(self) -> None:
        self._requests: dict[str, ApprovalRequest] = {}
        self._events: dict[str, threading.Event] = {}
        self._lock = threading.Lock()

    def create(
        self, tool_name: str, parameters: dict, session_id: Optional[str] = None
    ) -> ApprovalRequest:
        """Create a new approval request and return it. Caller should wait on resolve()."""
        req = ApprovalRequest(
            tool_name=tool_name, parameters=parameters, session_id=session_id
        )
        with self._lock:
            self._requests[req.id] = req
            self._events[req.id] = threading.Event()
        return req

    def approve(self, request_id: str) -> Optional[ApprovalRequest]:
        """Approve a pending request. Returns the request or None if not found."""
        with self._lock:
            req = self._requests.get(request_id)
            if req is None or req.status != ApprovalStatus.PENDING:
                return None
            req.status = ApprovalStatus.APPROVED
            event = self._events.get(request_id)
        if event:
            event.set()
        return req

    def reject(self, request_id: str) -> Optional[ApprovalRequest]:
        """Reject a pending request. Returns the request or None if not found."""
        with self._lock:
            req = self._requests.get(request_id)
            if req is None or req.status != ApprovalStatus.PENDING:
                return None
            req.status = ApprovalStatus.REJECTED
            event = self._events.get(request_id)
        if event:
            event.set()
        return req

    def wait_for_resolution(
        self, request_id: str, timeout: Optional[float] = None
    ) -> ApprovalStatus:
        """Block until the request is approved or rejected. Returns the final status."""
        event = self._events.get(request_id)
        if event is None:
            return ApprovalStatus.REJECTED
        event.wait(timeout=timeout)
        req = self._requests.get(request_id)
        if req is None:
            return ApprovalStatus.REJECTED
        return req.status

    def list_pending(self, session_id: Optional[str] = None) -> list[ApprovalRequest]:
        """Return all pending approval requests, optionally filtered by session."""
        with self._lock:
            pending = [
                r for r in self._requests.values() if r.status == ApprovalStatus.PENDING
            ]
            if session_id:
                pending = [r for r in pending if r.session_id == session_id]
            return pending

    def get(self, request_id: str) -> Optional[ApprovalRequest]:
        """Get an approval request by ID."""
        return self._requests.get(request_id)
