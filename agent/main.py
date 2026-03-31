"""FastAPI server - HTTP API for the Monet agent backend."""

import json
import logging
from dataclasses import asdict
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agent.approval import ApprovalGate
from agent.auth import AuthStore, UserExistsError
from agent.models import ApprovalStatus
from agent.runner import AgentRunner
from agent.session_store import DEFAULT_DB_PATH

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Monet Agent Backend", version="0.1.0")

approval_gate = ApprovalGate()
runner = AgentRunner(approval_gate=approval_gate)
auth_store = AuthStore(db_path=DEFAULT_DB_PATH)


class RunRequest(BaseModel):
    intent: str
    session_id: Optional[str] = None


class AuthRequest(BaseModel):
    username: str
    password: str


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "0.1.0"}


@app.post("/api/run")
def run_agent(request: RunRequest):
    """Run an agent synchronously and return the structured result."""
    logger.info("Running agent for intent: %s", request.intent)
    result = runner.run_sync(request.intent, session_id=request.session_id)
    return asdict(result)


@app.post("/api/stream")
def stream_agent(request: RunRequest):
    """Run an agent with NDJSON streaming of events.

    Uses stream_flow() which transparently handles both single-step
    and multi-step cross-pattern flows.
    """
    logger.info("Streaming agent for intent: %s", request.intent)

    def event_generator():
        for event in runner.stream_flow(request.intent, session_id=request.session_id):
            yield json.dumps(event.to_dict()) + "\n"

    return StreamingResponse(
        event_generator(),
        media_type="application/x-ndjson",
    )


class FlowAdvanceRequest(BaseModel):
    session_id: str
    step_index: int
    user_state: dict = {}


@app.post("/api/flow/advance")
def advance_flow(request: FlowAdvanceRequest):
    """Signal that the user has finished interacting with the current
    pattern and is ready for the next flow step."""
    logger.info(
        "Advancing flow for session %s to step %d",
        request.session_id,
        request.step_index,
    )
    found = runner.signal_advance(
        request.session_id, request.step_index, request.user_state
    )
    if not found:
        raise HTTPException(
            status_code=404, detail="No active flow found for this session"
        )
    return {"status": "advancing", "step_index": request.step_index}


@app.get("/api/approvals")
def list_approvals(session_id: Optional[str] = None):
    """List pending approval requests."""
    pending = approval_gate.list_pending(session_id=session_id)
    return [asdict(r) for r in pending]


@app.post("/api/approvals/{request_id}/approve")
def approve_request(request_id: str):
    """Approve a pending approval request."""
    req = approval_gate.approve(request_id)
    if req is None:
        raise HTTPException(
            status_code=404, detail="Approval request not found or already resolved"
        )
    return asdict(req)


@app.post("/api/approvals/{request_id}/reject")
def reject_request(request_id: str):
    """Reject a pending approval request."""
    req = approval_gate.reject(request_id)
    if req is None:
        raise HTTPException(
            status_code=404, detail="Approval request not found or already resolved"
        )
    return asdict(req)


@app.get("/api/sessions")
def list_sessions():
    """List all sessions with metadata."""
    return runner.session_store.list_sessions()


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str):
    """Delete a session and all its messages."""
    deleted = runner.session_store.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    # Also clear from cache
    runner._session_cache.pop(session_id, None)
    return {"status": "deleted", "session_id": session_id}


# --- Auth routes ---


@app.get("/api/auth/status")
def auth_status():
    """Check if any user exists (first-boot detection) and list usernames."""
    return {
        "has_users": auth_store.has_users(),
        "users": auth_store.list_users(),
    }


@app.post("/api/auth/create")
def create_user(request: AuthRequest):
    """Create a new user account and issue a session token."""
    try:
        auth_store.create_user(request.username, request.password)
    except UserExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    token = auth_store.create_token(request.username)
    return {"status": "created", "username": request.username, "token": token}


@app.post("/api/auth/login")
def login(request: AuthRequest):
    """Authenticate a user and issue a persistent session token."""
    if auth_store.authenticate(request.username, request.password):
        token = auth_store.create_token(request.username)
        return {"authenticated": True, "username": request.username, "token": token}
    raise HTTPException(status_code=401, detail="Invalid username or password")


@app.get("/api/auth/verify")
def verify_token(token: str):
    """Verify a session token. Returns username if valid, 401 if not."""
    username = auth_store.verify_token(token)
    if username is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return {"authenticated": True, "username": username}


@app.post("/api/auth/logout")
def logout(token: str):
    """Revoke a session token (logout)."""
    revoked = auth_store.revoke_token(token)
    if not revoked:
        raise HTTPException(status_code=404, detail="Token not found")
    return {"status": "logged_out"}
