"""
models.py

Pydantic data models for the Monet agent backend.
Defines the request/response shapes for HTTP endpoints and SSE event payloads.
These models are shared across the entire agent layer.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------


class AgentType(str, Enum):
    """The type of agent that will handle a given intent."""

    EMAIL = "email"
    CODE = "code"
    PLANNING = "planning"
    CHAT = "chat"


class UIPattern(str, Enum):
    """
    The UI rendering pattern the frontend should use for this session.
    Each pattern maps to a distinct React component in the Monet OS shell.
    """

    TINDER = "tinder"       # swipe-to-act card stack (email)
    DIFF = "diff"           # side-by-side diff viewer (code review)
    WHITEBOARD = "whiteboard"  # freeform canvas (planning)
    CHAT = "chat"           # standard chat bubble stream


class EventType(str, Enum):
    """Types of SSE events emitted by the agent stream."""

    THINKING = "thinking"       # agent is processing
    TEXT = "text"               # streamed text token
    TOOL_CALL = "tool_call"     # agent invoked a tool
    TOOL_RESULT = "tool_result" # tool returned a result
    APPROVAL_REQUIRED = "approval_required"  # gate before destructive action
    APPROVAL_RESOLVED = "approval_resolved"  # gate was approved or rejected
    DONE = "done"               # session complete
    ERROR = "error"             # unrecoverable error


class SessionStatus(str, Enum):
    """Lifecycle status of an agent session."""

    PENDING = "pending"
    RUNNING = "running"
    AWAITING_APPROVAL = "awaiting_approval"
    DONE = "done"
    ERROR = "error"


# ---------------------------------------------------------------------------
# HTTP Request / Response models
# ---------------------------------------------------------------------------


class IntentRequest(BaseModel):
    """Incoming user intent from the OS shell."""

    text: str = Field(
        ...,
        description="Natural language intent from the user.",
        min_length=1,
        max_length=4096,
    )
    context: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional structured context (e.g. highlighted text, active app).",
    )


class IntentResponse(BaseModel):
    """Immediate response after accepting a user intent."""

    session_id: str = Field(description="Unique session identifier for streaming.")
    agent: AgentType = Field(description="Agent selected to handle this intent.")
    ui_pattern: UIPattern = Field(description="UI rendering hint for the frontend.")
    message: str = Field(description="Human-readable acknowledgement.")


class ApprovalRequest(BaseModel):
    """Body for approving or rejecting a pending action gate."""

    reason: str | None = Field(
        default=None,
        description="Optional human-readable reason for the decision.",
    )


# ---------------------------------------------------------------------------
# SSE Event model
# ---------------------------------------------------------------------------


class AgentEvent(BaseModel):
    """
    A single Server-Sent Event emitted by the agent stream.
    The frontend deserializes these to drive UI state transitions.
    """

    event_type: EventType
    session_id: str
    sequence: int = Field(description="Monotonically increasing sequence number.")
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    # Polymorphic payload - callers populate whichever field is relevant
    text: str | None = None
    tool_name: str | None = None
    tool_input: dict[str, Any] | None = None
    tool_result: Any | None = None
    action_id: str | None = None
    action_description: str | None = None
    error: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    def to_sse(self) -> str:
        """
        Serialize this event as a raw SSE wire string.
        Newlines within JSON are handled by the sse-starlette library;
        this helper is used for manual serialization in tests.

        Returns:
            str: SSE-formatted string with event type and JSON data.
        """
        return f"event: {self.event_type.value}\ndata: {self.model_dump_json()}\n\n"


# ---------------------------------------------------------------------------
# Session state (in-memory store)
# ---------------------------------------------------------------------------


class PendingAction(BaseModel):
    """An action paused at an approval gate."""

    action_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tool_name: str
    tool_input: dict[str, Any]
    description: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    approved: bool | None = None  # None = pending, True = approved, False = rejected


class SessionState(BaseModel):
    """
    Full runtime state of an agent session.
    Stored in memory (and optionally persisted to SQLite for replay).
    """

    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    agent: AgentType
    ui_pattern: UIPattern
    original_intent: str
    status: SessionStatus = SessionStatus.PENDING
    events: list[AgentEvent] = Field(default_factory=list)
    pending_actions: dict[str, PendingAction] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    error: str | None = None

    def next_sequence(self) -> int:
        """Return the next event sequence number for this session."""
        return len(self.events)

    def add_event(self, event: AgentEvent) -> None:
        """Append an event and update the session timestamp."""
        self.events.append(event)
        self.updated_at = datetime.utcnow()
