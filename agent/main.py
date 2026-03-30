"""
main.py

FastAPI server for the Monet agent backend.
Provides HTTP endpoints for intent routing, SSE streaming, and approval gates.

Endpoints:
  POST /intent                            - receive user intent, start processing
  GET  /stream/{session_id}              - SSE stream of agent events
  POST /approve/{session_id}/{action_id} - approve a pending action
  POST /reject/{session_id}/{action_id}  - reject a pending action
  GET  /status                           - health check + service info (extended)
  GET  /sessions                         - list all sessions with status
  GET  /sessions/{session_id}            - full session details including events
  POST /sessions/{session_id}/cancel     - cancel a running session

Session state is held in memory (dict). For production, swap with Redis or SQLite.
"""

from __future__ import annotations

import asyncio
import uuid
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

from agents import create_agent
from config import get_config
from models import (
    AgentEvent,
    ApprovalRequest,
    EventType,
    IntentRequest,
    IntentResponse,
    SessionState,
    SessionStatus,
    UIPattern,
)
from router import classify_intent

# ---------------------------------------------------------------------------
# In-memory session store
# Key: session_id (str), Value: (SessionState, BaseAgent)
# ---------------------------------------------------------------------------
_sessions: dict[str, tuple[SessionState, Any]] = {}

# Background task handles - used by the cancel endpoint to kill running agents.
# Key: session_id (str), Value: asyncio.Task
_tasks: dict[str, asyncio.Task[None]] = {}


# ---------------------------------------------------------------------------
# Application lifecycle
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    FastAPI lifespan context manager.
    Validates config on startup so bad env vars fail fast.
    """
    cfg = get_config()
    print(f"Monet agent backend starting up")
    print(f"  Model        : {cfg.model}")
    print(f"  Base URL     : {cfg.openrouter_base_url}")
    print(f"  Integrations : {'stub mode (set COMPOSIO_API_KEY to enable real integrations)' if cfg.stub_mode else 'live mode (Composio connected)'}")
    yield
    print("Monet agent backend shutting down")


app = FastAPI(
    title="Monet Agent Backend",
    description="AI agent layer for the Monet OS - routes intents to specialized agents.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tighten this in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# POST /intent
# ---------------------------------------------------------------------------


@app.post("/intent", response_model=IntentResponse)
async def receive_intent(body: IntentRequest) -> IntentResponse:
    """
    Accept a user intent, classify it, create a session, and launch the agent.

    The agent runs in a background asyncio task. The caller should immediately
    open a GET /stream/{session_id} connection to receive events.

    Args:
        body: IntentRequest containing the natural language intent text.

    Returns:
        IntentResponse with session_id, selected agent, and UI pattern hint.
    """
    routing = classify_intent(body.text)

    session = SessionState(
        session_id=str(uuid.uuid4()),
        agent=routing.agent,
        ui_pattern=routing.ui_pattern,
        original_intent=body.text,
        status=SessionStatus.PENDING,
    )

    agent = create_agent(session)
    _sessions[session.session_id] = (session, agent)

    # Run the agent loop in the background so this endpoint returns immediately.
    # Store the task handle so the cancel endpoint can kill it.
    task = asyncio.create_task(
        _run_agent_safe(session.session_id, body.text),
        name=f"agent-{session.session_id}",
    )
    _tasks[session.session_id] = task

    return IntentResponse(
        session_id=session.session_id,
        agent=routing.agent,
        ui_pattern=routing.ui_pattern,
        original_intent=body.text,
        message=f"Session started. Connect to /stream/{session.session_id} for events.",
    )


async def _run_agent_safe(session_id: str, intent: str) -> None:
    """
    Wrapper that catches any unhandled exception from the agent loop
    and emits an ERROR event so the SSE consumer is notified.

    Args:
        session_id: The session to run the agent for.
        intent: The original user intent text.
    """
    entry = _sessions.get(session_id)
    if entry is None:
        return
    session, agent = entry
    try:
        await agent.run(intent)
    except Exception as exc:
        session.status = SessionStatus.ERROR
        session.error = str(exc)
        error_event = AgentEvent(
            event_type=EventType.ERROR,
            session_id=session_id,
            sequence=session.next_sequence(),
            error=str(exc),
        )
        session.add_event(error_event)


# ---------------------------------------------------------------------------
# GET /stream/{session_id}
# ---------------------------------------------------------------------------


@app.get("/stream/{session_id}")
async def stream_events(session_id: str) -> EventSourceResponse:
    """
    SSE endpoint that streams agent events for a session.

    The generator yields all already-buffered events first (for reconnects),
    then tails new events as they are appended by the agent loop.

    Args:
        session_id: The session to stream events for.

    Returns:
        EventSourceResponse: Server-Sent Events stream.

    Raises:
        HTTPException 404: If the session does not exist.
    """
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found.")

    async def event_generator() -> AsyncIterator[dict[str, str]]:
        """Yield SSE events until the session reaches a terminal state."""
        session, _ = _sessions[session_id]
        cursor = 0  # index of next event to yield

        while True:
            # Drain any buffered events
            events = session.events
            while cursor < len(events):
                event = events[cursor]
                yield {
                    "event": event.event_type.value,
                    "data": event.model_dump_json(),
                    "id": str(event.sequence),
                }
                cursor += 1

            # Check for terminal state
            if session.status in (SessionStatus.DONE, SessionStatus.ERROR):
                break

            # Yield control and poll for new events
            await asyncio.sleep(0.05)

    return EventSourceResponse(event_generator())


# ---------------------------------------------------------------------------
# POST /approve/{session_id}/{action_id}
# ---------------------------------------------------------------------------


@app.post("/approve/{session_id}/{action_id}")
async def approve_action(
    session_id: str,
    action_id: str,
    body: ApprovalRequest | None = None,
) -> JSONResponse:
    """
    Approve a pending action gate, allowing the agent to proceed.

    Args:
        session_id: The session containing the pending action.
        action_id: The specific action ID from the APPROVAL_REQUIRED event.
        body: Optional request body with a reason string.

    Returns:
        JSON confirmation.

    Raises:
        HTTPException 404: If the session or action is not found.
    """
    session, agent = _get_session_or_404(session_id)

    if action_id not in session.pending_actions:
        raise HTTPException(
            status_code=404,
            detail=f"Action {action_id} not found in session {session_id}.",
        )

    try:
        agent.approve_action(action_id, reason=body.reason if body else None)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return JSONResponse({"status": "approved", "action_id": action_id})


# ---------------------------------------------------------------------------
# POST /reject/{session_id}/{action_id}
# ---------------------------------------------------------------------------


@app.post("/reject/{session_id}/{action_id}")
async def reject_action(
    session_id: str,
    action_id: str,
    body: ApprovalRequest | None = None,
) -> JSONResponse:
    """
    Reject a pending action gate, cancelling that specific tool call.

    The agent loop continues with a rejection signal in the tool result,
    and the LLM decides how to proceed (usually by acknowledging the rejection).

    Args:
        session_id: The session containing the pending action.
        action_id: The specific action ID from the APPROVAL_REQUIRED event.
        body: Optional request body with a reason string.

    Returns:
        JSON confirmation.

    Raises:
        HTTPException 404: If the session or action is not found.
    """
    session, agent = _get_session_or_404(session_id)

    if action_id not in session.pending_actions:
        raise HTTPException(
            status_code=404,
            detail=f"Action {action_id} not found in session {session_id}.",
        )

    try:
        agent.reject_action(action_id, reason=body.reason if body else None)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return JSONResponse({"status": "rejected", "action_id": action_id})


# ---------------------------------------------------------------------------
# GET /status
# ---------------------------------------------------------------------------


@app.get("/status")
async def get_status() -> JSONResponse:
    """
    Health check endpoint. Returns extended service status and runtime info.

    Returns:
        JSON with status, model config, session counts, and a summary list
        of all sessions (id, agent, status, intent).
    """
    cfg = get_config()
    active = sum(
        1 for s, _ in _sessions.values()
        if s.status in (SessionStatus.PENDING, SessionStatus.RUNNING, SessionStatus.AWAITING_APPROVAL)
    )
    sessions_summary = [
        {
            "session_id": s.session_id,
            "agent": s.agent.value,
            "status": s.status.value,
            "intent": s.original_intent,
        }
        for s, _ in _sessions.values()
    ]
    return JSONResponse({
        "status": "ok",
        "model": cfg.model,
        "active_sessions": active,
        "total_sessions": len(_sessions),
        "sessions": sessions_summary,
    })


# ---------------------------------------------------------------------------
# GET /sessions
# ---------------------------------------------------------------------------


@app.get("/sessions")
async def list_sessions() -> JSONResponse:
    """
    List all sessions with their current status and metadata.

    Returns:
        JSON array where each entry contains session_id, agent, ui_pattern,
        status, created_at, and original_intent.
    """
    result = [
        {
            "session_id": s.session_id,
            "agent": s.agent.value,
            "ui_pattern": s.ui_pattern.value,
            "status": s.status.value,
            "created_at": s.created_at.isoformat(),
            "original_intent": s.original_intent,
        }
        for s, _ in _sessions.values()
    ]
    return JSONResponse(result)


# ---------------------------------------------------------------------------
# GET /sessions/{session_id}
# ---------------------------------------------------------------------------


@app.get("/sessions/{session_id}")
async def get_session(session_id: str) -> JSONResponse:
    """
    Get full details for a single session, including all buffered events.

    Args:
        session_id: The session to retrieve.

    Returns:
        JSON with session metadata and a full events array.

    Raises:
        HTTPException 404: If the session does not exist.
    """
    session, _ = _get_session_or_404(session_id)
    return JSONResponse({
        "session_id": session.session_id,
        "agent": session.agent.value,
        "ui_pattern": session.ui_pattern.value,
        "status": session.status.value,
        "created_at": session.created_at.isoformat(),
        "updated_at": session.updated_at.isoformat(),
        "original_intent": session.original_intent,
        "error": session.error,
        "events": [e.model_dump(mode="json") for e in session.events],
    })


# ---------------------------------------------------------------------------
# POST /sessions/{session_id}/cancel
# ---------------------------------------------------------------------------


@app.post("/sessions/{session_id}/cancel")
async def cancel_session(session_id: str) -> JSONResponse:
    """
    Cancel a running agent session.

    Cancels the background asyncio task (if still running) and sets the
    session status to ERROR with a cancellation message.

    Args:
        session_id: The session to cancel.

    Returns:
        JSON confirmation with the session_id.

    Raises:
        HTTPException 404: If the session does not exist.
        HTTPException 409: If the session is already in a terminal state.
    """
    session, _ = _get_session_or_404(session_id)

    terminal = (SessionStatus.DONE, SessionStatus.ERROR)
    if session.status in terminal:
        raise HTTPException(
            status_code=409,
            detail=f"Session {session_id} is already in a terminal state ({session.status.value}).",
        )

    task = _tasks.get(session_id)
    if task is not None and not task.done():
        task.cancel()

    session.status = SessionStatus.ERROR
    session.error = "Cancelled by user."

    cancel_event = AgentEvent(
        event_type=EventType.ERROR,
        session_id=session_id,
        sequence=session.next_sequence(),
        error="Cancelled by user.",
    )
    session.add_event(cancel_event)

    return JSONResponse({"status": "cancelled", "session_id": session_id})


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _get_session_or_404(session_id: str) -> tuple[SessionState, Any]:
    """
    Look up a session by ID or raise HTTP 404.

    Args:
        session_id: The session to retrieve.

    Returns:
        Tuple of (SessionState, BaseAgent).

    Raises:
        HTTPException 404: If the session does not exist.
    """
    entry = _sessions.get(session_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found.")
    return entry


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    cfg = get_config()
    uvicorn.run(
        "main:app",
        host=cfg.host,
        port=cfg.port,
        reload=cfg.debug,
    )
