"""
main.py - FastAPI application entry point for Monet backend.

Exposes all API endpoints for the Monet AI decision copilot:
- Intent classification and session management
- Pre-staged suggestion retrieval
- SSE streaming of agent events
- Action approval/rejection
- Agent and connection status
- Composio OAuth initiation
- Action history

CORS is open for all origins in development.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, AsyncGenerator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse

import config
from agents.runner import AgentRunner
from integrations.composio_client import ComposioClient
from models import (
    Agent,
    AgentEvent,
    ApproveResponse,
    Connection,
    EventType,
    HistoryEntry,
    IntentRequest,
    IntentResponse,
    Session,
    SessionStatus,
    Suggestion,
    UiPattern,
)
from router import classify_intent
from decision_queue import decision_queue, Decision
from scheduler import AgentScheduler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# --- App State ---

# Active sessions keyed by session_id
_sessions: dict[str, Session] = {}

# Composio client (shared across all agents)
_composio = ComposioClient()

# Agent runner (manages background tasks + suggestion store)
_runner = AgentRunner(_composio)


# --- Lifespan ---

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Application lifespan handler.

    On startup: validates config, seeds stub suggestions, starts the background
    scheduler, and schedules legacy agent loops. On shutdown: cancels all tasks.
    """
    try:
        config.validate_config()
    except ValueError as exc:
        logger.warning("Config warning: %s", exc)

    # Seed initial suggestions from agents on first boot (legacy suggestion store)
    asyncio.create_task(_seed_suggestions())

    # Start background scheduler - runs email/code agents on a schedule and
    # pushes decisions into the decision_queue for the user to review
    scheduler = AgentScheduler()
    app.state.scheduler = scheduler
    asyncio.create_task(scheduler.start())

    # Also keep legacy scheduled runs for the AgentRunner suggestion store
    _runner.schedule_agent("email", interval_minutes=15.0)
    _runner.schedule_agent("code", interval_minutes=30.0)

    logger.info("Monet backend started.")
    yield

    await scheduler.stop()
    _runner.stop_all()
    logger.info("Monet backend shut down.")


async def _seed_suggestions() -> None:
    """
    Runs both agents once on startup to pre-populate the suggestion store.
    Errors are caught and logged without crashing the app.
    """
    for agent_type in ("email", "code"):
        try:
            await _runner.run_agent(agent_type)
        except Exception as exc:
            logger.warning("Seed run for '%s' failed: %s", agent_type, exc)


# --- App Init ---

app = FastAPI(
    title="Monet Backend",
    description="AI decision copilot backend - agent orchestration and streaming API.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Health ---

@app.get("/")
async def health_check() -> dict[str, Any]:
    """
    Health check endpoint.

    Returns:
        Status dict with service name, version, and stub mode flag.
    """
    return {
        "status": "ok",
        "service": "monet-backend",
        "version": "0.1.0",
        "stub_mode": _composio.is_stub,
    }


# --- Chat ---

@app.post("/chat")
async def chat(data: dict) -> EventSourceResponse:
    """
    Streams a Claude response for a general chat message.

    Uses Claude Haiku for speed and low cost. Returns an SSE stream with
    named 'text' events as tokens arrive and a final 'done' event.
    Supports multi-turn context via the optional 'history' field.

    Args:
        data: Dict with 'text' (the user message) and optional 'history'
              (list of prior messages for multi-turn context).

    Returns:
        EventSourceResponse with named SSE events: text, done, error.
    """
    import anthropic

    user_text = data.get("text", "").strip()
    if not user_text:
        return EventSourceResponse(_empty_chat_generator())

    # Build message history for multi-turn context
    history: list[dict] = data.get("history", [])
    messages = [*history, {"role": "user", "content": user_text}]

    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)

    async def generate() -> AsyncGenerator[dict[str, str], None]:
        """Streams token chunks from Claude Haiku as SSE text events."""
        try:
            with client.messages.stream(
                model=config.HAIKU_MODEL,
                max_tokens=1024,
                messages=messages,
                system=(
                    "You are Monet, a helpful AI assistant for startup founders. "
                    "Be concise and direct. No fluff."
                ),
            ) as stream:
                for text_chunk in stream.text_stream:
                    yield {"event": "text", "data": json.dumps({"text": text_chunk})}
            yield {"event": "done", "data": json.dumps({"status": "complete"})}
        except Exception as exc:
            logger.exception("Chat stream error: %s", exc)
            yield {"event": "error", "data": json.dumps({"error": str(exc)})}

    return EventSourceResponse(generate())


async def _empty_chat_generator() -> AsyncGenerator[dict[str, str], None]:
    """Yields a done event immediately when no message text is provided."""
    yield {"event": "done", "data": json.dumps({"status": "complete"})}


# --- Intent ---

@app.post("/intent", response_model=IntentResponse)
async def submit_intent(body: IntentRequest) -> IntentResponse:
    """
    Routes the user's command bar input through the orchestrator, then creates
    a new agent session for the resolved agent type.

    The orchestrator uses Claude Sonnet to decide whether to delegate to a single
    agent, fan out to multiple agents, or answer directly. The resulting session
    can be streamed via GET /stream/{session_id}.

    Args:
        body: IntentRequest with raw user text and optional context.

    Returns:
        IntentResponse with session_id and the classified UI pattern.
    """
    # Try the orchestrator first (smart LLM routing via Claude Sonnet)
    # Fall back to keyword-based classify_intent if orchestrator raises
    try:
        from orchestrator import route_intent
        routing = route_intent(body.text)
        action = routing.get("action", "answer")

        if action == "delegate":
            agent_type = routing.get("agent", "general")
        elif action == "multi":
            # For multi-agent, use the first agent for the session type
            agents_list = routing.get("agents", [])
            agent_type = agents_list[0]["agent"] if agents_list else "general"
        else:
            agent_type = "general"

    except Exception as exc:
        logger.warning("Orchestrator unavailable, falling back to keyword router: %s", exc)
        classification = classify_intent(body.text)
        agent_type = classification["agent_type"]

    # Map agent type to UI pattern
    _ui_map = {
        "email": UiPattern.list,
        "code": UiPattern.code,
        "planning": UiPattern.detail,
        "general": UiPattern.chat,
    }
    ui_pattern = _ui_map.get(agent_type, UiPattern.chat)

    session_id = str(uuid.uuid4())
    session = Session(
        id=session_id,
        agentType=agent_type,
        uiPattern=ui_pattern,
        status=SessionStatus.pending,
    )
    _sessions[session_id] = session

    # Kick off the agent run as a background task
    asyncio.create_task(_run_session(session_id, agent_type, body.text))

    return IntentResponse(
        sessionId=session_id,
        uiPattern=ui_pattern,
        agentType=agent_type,
    )


async def _run_session(session_id: str, agent_type: str, user_text: str) -> None:
    """
    Runs the classified agent for a user-initiated session.

    Emits events into the session's event list so they can be
    streamed to the client via GET /stream/{session_id}.

    Args:
        session_id: The active session ID.
        agent_type: The classified agent type to run.
        user_text: The original user command text.
    """
    session = _sessions.get(session_id)
    if not session:
        return

    session.status = SessionStatus.running

    try:
        from agents.email_agent import EmailAgent
        from agents.code_agent import CodeAgent
        from agents.base import BaseAgent

        agent: BaseAgent
        if agent_type == "email":
            agent = EmailAgent(_composio)
        elif agent_type == "code":
            agent = CodeAgent(_composio)
        else:
            # General: stream a conversational reply
            await _run_general_session(session_id, user_text)
            return

        messages = [
            {
                "role": "system",
                "content": (
                    "You are Monet, an AI decision copilot for founders. "
                    "Be concise. Think step by step before using tools."
                ),
            },
            {"role": "user", "content": user_text},
        ]

        async for event in agent._chat_with_tools(messages, session_id):
            session.events.append(event)

        done_event = AgentEvent(
            eventType=EventType.done,
            sessionId=session_id,
        )
        session.events.append(done_event)
        session.status = SessionStatus.completed

    except Exception as exc:
        logger.exception("Session '%s' error: %s", session_id, exc)
        error_event = AgentEvent(
            eventType=EventType.error,
            sessionId=session_id,
            error=str(exc),
        )
        session.events.append(error_event)
        session.status = SessionStatus.error


async def _run_general_session(session_id: str, user_text: str) -> None:
    """
    Runs a streaming conversational response for unclassified (general) intent.

    Emits text events directly into the session's event list.

    Args:
        session_id: The active session ID.
        user_text: The original user input.
    """
    from agents.email_agent import EmailAgent
    from agents.base import BaseAgent

    session = _sessions.get(session_id)
    if not session:
        return

    # Use email agent's model (Gemini Flash) for general chat - it's fast
    agent = EmailAgent(_composio)
    messages = [
        {
            "role": "system",
            "content": (
                "You are Monet, an AI decision copilot for startup founders. "
                "Be direct, concise, and helpful. No fluff."
            ),
        },
        {"role": "user", "content": user_text},
    ]

    async for event in agent._chat_stream(messages, session_id):
        session.events.append(event)

    done_event = AgentEvent(
        eventType=EventType.done,
        sessionId=session_id,
    )
    session.events.append(done_event)
    session.status = SessionStatus.completed


# --- Suggestions ---

@app.get("/suggestions")
async def get_suggestions() -> dict[str, Any]:
    """
    Returns all pre-staged action items from background agents.

    Suggestions are produced proactively by scheduled agent runs and
    presented to the user without requiring an explicit command.

    Returns:
        Dict with 'suggestions' list and total count.
    """
    suggestions = _runner.get_suggestions()
    return {
        "suggestions": [s.model_dump(by_alias=True) for s in suggestions],
        "total": len(suggestions),
    }


# --- SSE Stream ---

@app.get("/stream/{session_id}")
async def stream_session(session_id: str) -> EventSourceResponse:
    """
    Streams agent events for a session as SSE (Server-Sent Events).

    Polls the session's event list and emits new events as they arrive.
    Uses named event types (text, tool_call, tool_result, done, error).
    Closes the stream when a 'done' or 'error' event is received.

    Args:
        session_id: The session to stream events for.

    Returns:
        EventSourceResponse with named SSE events.

    Raises:
        HTTPException 404: If the session does not exist.
    """
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")

    return EventSourceResponse(_event_generator(session_id))


async def _event_generator(session_id: str) -> AsyncGenerator[dict[str, str], None]:
    """
    Async generator that yields SSE events for a session.

    Tracks emitted event index to avoid re-sending events.
    Polls every 100ms for new events. Times out after 5 minutes.

    Args:
        session_id: The session to stream events for.

    Yields:
        Dicts with 'event' (name) and 'data' (JSON string) keys.
    """
    session = _sessions.get(session_id)
    if not session:
        yield {"event": "error", "data": json.dumps({"error": "Session not found."})}
        return

    emitted_index = 0
    timeout_seconds = 300
    elapsed = 0.0
    poll_interval = 0.1

    while elapsed < timeout_seconds:
        events = session.events
        while emitted_index < len(events):
            event = events[emitted_index]
            emitted_index += 1

            yield {
                "event": event.event_type.value,
                "data": _serialize_event(event),
            }

            if event.event_type in (EventType.done, EventType.error):
                return

        if session.status in (SessionStatus.completed, SessionStatus.error):
            # Drain any remaining events not yet emitted
            continue

        await asyncio.sleep(poll_interval)
        elapsed += poll_interval


def _serialize_event(event: AgentEvent) -> str:
    """
    Serializes an AgentEvent to a JSON string for SSE data payload.

    Args:
        event: The AgentEvent to serialize.

    Returns:
        JSON string representation.
    """
    return event.model_dump_json(by_alias=True)


# --- Approve / Reject ---

@app.post("/approve/{session_id}/{action_id}", response_model=ApproveResponse)
async def approve_action(session_id: str, action_id: str) -> ApproveResponse:
    """
    Approves a staged action and records it in history.

    Removes the suggestion from the store and logs the approval.

    Args:
        session_id: The session context for this action.
        action_id: The suggestion ID to approve.

    Returns:
        ApproveResponse indicating success.
    """
    removed = _runner.remove_suggestion(action_id)

    _runner.add_history(HistoryEntry(
        action=f"Approved action {action_id}",
        agentId=removed.agent_id if removed else "unknown",
        status="approved",
    ))

    return ApproveResponse(
        success=True,
        actionId=action_id,
        sessionId=session_id,
        message="Action approved and queued for execution.",
    )


@app.post("/reject/{session_id}/{action_id}", response_model=ApproveResponse)
async def reject_action(session_id: str, action_id: str) -> ApproveResponse:
    """
    Rejects a staged action and records it in history.

    Removes the suggestion from the store and logs the rejection.

    Args:
        session_id: The session context for this action.
        action_id: The suggestion ID to reject.

    Returns:
        ApproveResponse indicating success.
    """
    removed = _runner.remove_suggestion(action_id)

    _runner.add_history(HistoryEntry(
        action=f"Rejected action {action_id}",
        agentId=removed.agent_id if removed else "unknown",
        status="rejected",
    ))

    return ApproveResponse(
        success=True,
        actionId=action_id,
        sessionId=session_id,
        message="Action rejected and removed.",
    )


# --- Agents ---

@app.get("/agents")
async def list_agents() -> dict[str, Any]:
    """
    Returns the current status and metadata of all registered agents.

    Enriches each agent with the real pending decision count from the
    decision_queue and the scheduler's current run state. Also includes
    emoji and mood fields for the AgentOrbit UI.

    Returns:
        Dict with 'agents' list, each containing id, name, status,
        decisionCount, emoji, mood, lastRun, and summary.
    """
    runner_agents = {a.id: a for a in _runner.get_agents()}

    # Agent personality config - emoji and mood reflect current state
    _agent_meta: dict[str, dict[str, Any]] = {
        "email": {
            "name": "Email Agent",
            "emoji_idle": "😌",
            "emoji_running": "🤓",
            "emoji_decisions": "📬",
            "mood_idle": "Nothing new in inbox",
            "mood_running": "Reading your inbox...",
            "decision_view": "tinder",
        },
        "code": {
            "name": "Code Agent",
            "emoji_idle": "😎",
            "emoji_running": "🔍",
            "emoji_decisions": "👀",
            "mood_idle": "All PRs look good",
            "mood_running": "Reviewing pull requests...",
            "decision_view": "diff",
        },
        "planning": {
            "name": "Planning Agent",
            "emoji_idle": "🧘",
            "emoji_running": "📋",
            "emoji_decisions": "✅",
            "mood_idle": "Ready when you are",
            "mood_running": "Building your sprint plan...",
            "decision_view": "whiteboard",
        },
    }

    scheduler: AgentScheduler | None = None
    try:
        scheduler = app.state.scheduler
    except AttributeError:
        pass

    agents_out = []
    for agent_id, meta in _agent_meta.items():
        runner_agent = runner_agents.get(agent_id)
        pending_count = decision_queue.get_pending_count(agent_id)

        # Determine live status
        is_scheduler_running = scheduler.is_running(agent_id) if scheduler else False
        runner_status = runner_agent.status.value if runner_agent else "idle"
        status = "running" if is_scheduler_running or runner_status == "running" else runner_status

        # Choose emoji and mood based on state
        if pending_count > 0:
            emoji = meta["emoji_decisions"]
            mood = f"{pending_count} {'decision' if pending_count == 1 else 'decisions'} waiting"
        elif status == "running":
            emoji = meta["emoji_running"]
            mood = meta["mood_running"]
        else:
            emoji = meta["emoji_idle"]
            mood = meta["mood_idle"]

        # Format lastRun as a human-readable relative time
        last_run_str = None
        last_run_dt = None
        if scheduler:
            last_run_dt = scheduler.get_last_run(agent_id)
        if not last_run_dt and runner_agent and runner_agent.last_run:
            last_run_dt = runner_agent.last_run
        if last_run_dt:
            delta = datetime.utcnow() - last_run_dt
            minutes = int(delta.total_seconds() / 60)
            if minutes < 2:
                last_run_str = "just now"
            elif minutes < 60:
                last_run_str = f"{minutes}m ago"
            else:
                hours = minutes // 60
                last_run_str = f"{hours}hr ago"

        agents_out.append({
            "id": agent_id,
            "name": meta["name"],
            "status": status,
            "decisionCount": pending_count,
            "decisionView": meta["decision_view"],
            "emoji": emoji,
            "mood": mood,
            "lastRun": last_run_str,
            "summary": runner_agent.summary if runner_agent else None,
        })

    return {"agents": agents_out}


# --- Decisions ---

@app.get("/decisions")
async def get_decisions(agent_id: str | None = None) -> dict[str, Any]:
    """
    Returns all pending (unresolved) decisions from the decision queue.

    Optionally filters by agent. The frontend polls this endpoint to populate
    agent card decision counts and the tinder swipe stack.

    Args:
        agent_id: Optional agent filter (e.g. 'email', 'code').

    Returns:
        Dict with 'decisions' list and 'total' count.
    """
    pending = decision_queue.get_pending(agent_id)
    serialized = [
        {
            "id": d.id,
            "agentId": d.agent_id,
            "type": d.type,
            "priority": d.priority,
            "title": d.title,
            "summary": d.summary,
            "data": d.data,
            "uiPattern": d.ui_pattern,
            "createdAt": d.created_at.isoformat(),
        }
        for d in pending
    ]
    return {"decisions": serialized, "total": len(serialized)}


@app.post("/decisions/{decision_id}/resolve")
async def resolve_decision(decision_id: str, data: dict) -> dict[str, Any]:
    """
    Resolves a pending decision as approved or skipped.

    If resolution is 'approved' and a reply_text is provided, sends the email
    via Composio Gmail before marking the decision resolved.

    Args:
        decision_id: The ID of the decision to resolve.
        data: Dict with 'resolution' ('approved' or 'skipped') and optional
              'reply_text' for email approvals.

    Returns:
        Dict with 'status' and the resolved decision_id.

    Raises:
        HTTPException 404: If the decision_id is not found.
    """
    resolution = data.get("resolution", "skipped")
    reply_text = data.get("reply_text")

    # Find the decision before resolving so we can read its data
    pending = decision_queue.get_pending()
    target = next((d for d in pending if d.id == decision_id), None)
    if not target:
        raise HTTPException(status_code=404, detail=f"Decision '{decision_id}' not found.")

    # Send the email if this is an approved email_reply
    if resolution == "approved" and target.type == "email_reply" and reply_text:
        email = target.data.get("email", {})
        try:
            composio = ComposioClient()
            await composio.execute_tool(
                "GMAIL_SEND_EMAIL",
                {
                    "to": email.get("sender", ""),
                    "subject": f"Re: {email.get('subject', '')}",
                    "body": reply_text,
                    "reply_to_id": email.get("id", ""),
                },
            )
            logger.info("Sent approved reply for decision '%s'", decision_id)
        except Exception as exc:
            logger.warning("Failed to send reply for decision '%s': %s", decision_id, exc)

    decision_queue.resolve(decision_id, resolution)
    logger.info("Decision '%s' resolved as '%s'", decision_id, resolution)
    return {"status": "resolved", "decisionId": decision_id, "resolution": resolution}


# --- Connections ---

@app.get("/connections")
async def list_connections() -> dict[str, Any]:
    """
    Returns connected external services via Composio.

    In stub mode, returns all services as disconnected.

    Returns:
        Dict with 'connections' list and 'stub_mode' flag.
    """
    connections = await _composio.list_connections()
    return {
        "connections": connections,
        "stub_mode": _composio.is_stub,
    }


@app.post("/connect/{service}")
async def connect_service(service: str) -> dict[str, str]:
    """
    Initiates a Composio OAuth flow for a named service.

    Args:
        service: Lowercase service name (e.g. 'gmail', 'github').

    Returns:
        Dict with 'oauth_url' for the frontend to redirect to.
    """
    oauth_url = await _composio.connect_service(service)
    return {
        "service": service,
        "oauth_url": oauth_url,
    }


# --- Email Triage ---

def strip_html(html: str) -> str:
    """
    Strip HTML tags and decode entities to get plain text suitable for display.

    Removes all HTML markup, collapses whitespace, decodes common HTML entities,
    and strips URLs. Caps output at 500 characters.

    Args:
        html: Raw HTML string from Composio/Gmail email body.

    Returns:
        Clean plain-text string, truncated to 500 characters.
    """
    if not html:
        return ""
    # Remove HTML tags
    text = re.sub(r'<[^>]+>', ' ', html)
    # Remove extra whitespace
    text = re.sub(r'\s+', ' ', text)
    # Decode common HTML entities
    text = (
        text.replace('&amp;', '&')
            .replace('&lt;', '<')
            .replace('&gt;', '>')
            .replace('&quot;', '"')
            .replace('&#39;', "'")
            .replace('&nbsp;', ' ')
    )
    # Remove URLs
    text = re.sub(r'https?://\S+', '', text)
    return text.strip()[:500]


def _extract_emails(raw: Any) -> list[dict[str, Any]]:
    """
    Extracts slim, normalised email records from a raw Composio GMAIL_FETCH_EMAILS response.

    Handles both the nested {'data': {'messages': [...]}} shape that Composio returns
    and bare list responses. Caps at 5 emails.

    Args:
        raw: Raw response from composio.execute_tool("GMAIL_FETCH_EMAILS", ...).

    Returns:
        List of dicts with id, sender, subject, body, timestamp, to keys.
    """
    if isinstance(raw, dict) and "data" in raw:
        raw = raw["data"]

    messages: list[Any] = []
    if isinstance(raw, dict) and "messages" in raw:
        messages = raw["messages"]
    elif isinstance(raw, list):
        messages = raw

    result = []
    for m in messages[:5]:
        raw_body = (
            m.get("messageText")
            or m.get("body")
            or m.get("preview")
            or m.get("snippet")
            or ""
        )
        result.append({
            "id": m.get("messageId") or m.get("id") or "",
            "sender": m.get("sender") or m.get("from") or "",
            "subject": m.get("subject") or "(no subject)",
            "body": strip_html(raw_body),
            "timestamp": m.get("messageTimestamp") or m.get("date") or "",
            "to": m.get("to") or "",
        })
    return result


@app.post("/triage-inbox")
async def triage_inbox() -> dict[str, Any]:
    """
    Fetches the 5 most recent emails via Composio Gmail and drafts a reply for each.

    Calls tools directly (no agent loop) for speed. Uses Claude Haiku to generate
    brief, professional draft replies. Falls back to stub data when Composio is
    not connected.

    Returns:
        Dict with 'cards' list and 'count' integer. Each card has: id, sender,
        subject, body, draft, timestamp.
    """
    import anthropic

    composio = ComposioClient()
    raw = await composio.execute_tool("GMAIL_FETCH_EMAILS", {"max_results": 5})
    emails = _extract_emails(raw)

    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)

    cards = []
    for email in emails:
        prompt = (
            "Draft a brief, professional reply to this email. "
            "Write only the reply body text - no greeting like 'Dear X', no sign-off. "
            "2-4 sentences max.\n\n"
            f"From: {email['sender']}\n"
            f"Subject: {email['subject']}\n"
            f"Body: {email['body'][:500]}"
        )
        resp = client.messages.create(
            model=config.HAIKU_MODEL,
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        draft = resp.content[0].text.strip()

        cards.append({
            "id": email["id"],
            "sender": email["sender"],
            "subject": email["subject"],
            "body": email["body"],
            "draft": draft,
            "timestamp": email["timestamp"],
            "to": email["to"],
        })

    logger.info("Triage inbox: produced %d cards.", len(cards))
    return {"cards": cards, "count": len(cards)}


@app.post("/send-reply")
async def send_reply(data: dict) -> dict[str, Any]:
    """
    Sends or skips an email reply via Composio Gmail.

    When action is 'send', calls GMAIL_SEND_EMAIL with the provided reply text.
    When action is 'skip', returns immediately without sending.

    Args:
        data: Dict with keys: action ('send' | 'skip'), email_id, reply_text,
              to (recipient address), subject.

    Returns:
        Dict with 'status' ('sent' | 'skipped') and optional 'result'.
    """
    action = data.get("action")
    email_id = data.get("email_id", "")
    reply_text = data.get("reply_text", "")
    recipient = data.get("to", "")
    subject = data.get("subject", "")

    if action == "send" and reply_text:
        composio = ComposioClient()
        result = await composio.execute_tool(
            "GMAIL_SEND_EMAIL",
            {
                "to": recipient,
                "subject": subject,
                "body": reply_text,
                "reply_to_id": email_id,
            },
        )
        logger.info("Sent reply for email '%s' to '%s'.", email_id, recipient)
        return {"status": "sent", "result": result}

    logger.info("Skipped email '%s'.", email_id)
    return {"status": "skipped"}


# --- History ---

@app.get("/history")
async def get_history(limit: int = 50) -> dict[str, Any]:
    """
    Returns recent action history (approvals and rejections).

    Args:
        limit: Maximum number of entries to return (default 50).

    Returns:
        Dict with 'history' list and total count.
    """
    history = _runner.get_history(limit=limit)
    return {
        "history": [h.model_dump(by_alias=True) for h in history],
        "total": len(history),
    }
