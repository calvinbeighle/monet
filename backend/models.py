"""
models.py - Pydantic data models for Monet backend API.

Defines the core domain objects: Suggestion, Agent, Connection, Session, and AgentEvent.
All models use Pydantic v2 for validation and serialization.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field
import uuid


# --- Enums ---

class AgentStatus(str, Enum):
    """Lifecycle status of a background agent."""
    running = "running"
    idle = "idle"
    error = "error"


class SessionStatus(str, Enum):
    """Lifecycle status of an agent session."""
    pending = "pending"
    running = "running"
    completed = "completed"
    error = "error"


class UiPattern(str, Enum):
    """
    UI rendering pattern for the command result.
    Determines which frontend widget renders the response.
    """
    list = "list"
    detail = "detail"
    code = "code"
    chat = "chat"
    confirm = "confirm"


class EventType(str, Enum):
    """SSE event types emitted during an agent session stream."""
    text = "text"
    tool_call = "tool_call"
    tool_result = "tool_result"
    done = "done"
    error = "error"


# --- Core Models ---

class Suggestion(BaseModel):
    """
    A pre-staged action item surfaced by a background agent.

    Suggestions are generated proactively and presented to the user
    without requiring an explicit command.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    icon: str
    """Lucide icon name to render in the UI."""
    icon_color: str = Field(alias="iconColor", default="text-muted-foreground")
    """Tailwind color class for the icon."""
    title: str
    description: str
    ui_pattern: UiPattern = Field(alias="uiPattern", default=UiPattern.list)
    agent_id: str = Field(alias="agentId")
    metadata: dict[str, Any] = Field(default_factory=dict)
    """Arbitrary agent-specific payload (e.g. email ID, PR number)."""
    created_at: datetime = Field(default_factory=datetime.utcnow, alias="createdAt")

    model_config = {"populate_by_name": True}


class Agent(BaseModel):
    """
    Represents a background agent and its current runtime state.
    """
    id: str
    name: str
    status: AgentStatus = AgentStatus.idle
    last_run: Optional[datetime] = Field(default=None, alias="lastRun")
    summary: Optional[str] = None
    """Human-readable summary of the most recent run."""

    model_config = {"populate_by_name": True}


class Connection(BaseModel):
    """
    Represents an external service integration via Composio.
    """
    id: str
    service: str
    icon: str
    connected: bool = False


class AgentEvent(BaseModel):
    """
    A single event emitted during an agent session, streamed via SSE.
    """
    event_type: EventType = Field(alias="eventType")
    session_id: str = Field(alias="sessionId")
    text: Optional[str] = None
    """For 'text' events - the streamed token or chunk."""
    tool_name: Optional[str] = Field(default=None, alias="toolName")
    """For 'tool_call' events - the name of the tool being invoked."""
    tool_input: Optional[dict[str, Any]] = Field(default=None, alias="toolInput")
    """For 'tool_call' events - the arguments passed to the tool."""
    tool_result: Optional[Any] = Field(default=None, alias="toolResult")
    """For 'tool_result' events - the slim result returned by the tool."""
    error: Optional[str] = None
    """For 'error' events - the error message."""
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"populate_by_name": True}


class Session(BaseModel):
    """
    Tracks a single agent invocation session initiated by a user command.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    agent_type: str = Field(alias="agentType")
    ui_pattern: UiPattern = Field(alias="uiPattern", default=UiPattern.chat)
    status: SessionStatus = SessionStatus.pending
    events: list[AgentEvent] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow, alias="createdAt")

    model_config = {"populate_by_name": True}


# --- Request/Response Models ---

class IntentRequest(BaseModel):
    """Payload submitted to POST /intent from the command bar."""
    text: str
    """Raw user input from the command bar."""
    context: Optional[dict[str, Any]] = None
    """Optional context (current page, selected text, etc.)."""


class IntentResponse(BaseModel):
    """Response from POST /intent - kicks off an agent session."""
    session_id: str = Field(alias="sessionId")
    ui_pattern: UiPattern = Field(alias="uiPattern")
    agent_type: str = Field(alias="agentType")
    message: str = "Session started."

    model_config = {"populate_by_name": True}


class ApproveResponse(BaseModel):
    """Response from POST /approve or /reject."""
    success: bool
    action_id: str = Field(alias="actionId")
    session_id: str = Field(alias="sessionId")
    message: str

    model_config = {"populate_by_name": True}


class HistoryEntry(BaseModel):
    """A single entry in the recent action history log."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    action: str
    """Human-readable description of the action taken."""
    agent_id: str = Field(alias="agentId")
    status: str
    """'approved', 'rejected', or 'completed'."""
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"populate_by_name": True}
