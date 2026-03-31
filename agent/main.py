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
from agent.nango import NangoManager
from agent.runner import AgentRunner
from agent.session_store import DEFAULT_DB_PATH
from agent.system import SystemManager

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Monet Agent Backend", version="0.1.0")

approval_gate = ApprovalGate()
runner = AgentRunner(approval_gate=approval_gate)
auth_store = AuthStore(db_path=DEFAULT_DB_PATH)
system_mgr = SystemManager()
nango_mgr = NangoManager()


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


# --- Tool connection routes ---


@app.get("/api/tools/status")
def tools_status():
    """Get connection status for all configured tools (Gmail, GitHub).

    Queries Nango to check if each OAuth connection is active.
    Returns a list of tools with their connection state so the
    Flutter shell can show real green/grey indicators.
    """
    from dataclasses import asdict as _asdict

    statuses = nango_mgr.get_all_statuses()
    return {"tools": [_asdict(s) for s in statuses], "configured": nango_mgr.configured}


@app.get("/api/tools/connect/{provider}")
def tool_connect_url(provider: str):
    """Get an OAuth connect URL for a specific provider.

    Creates a Nango connect session and returns a URL the Flutter
    shell can open in a webview or browser to initiate OAuth.
    """
    session = nango_mgr.create_connect_session(provider)
    if session is None:
        if provider not in ("gmail", "github"):
            raise HTTPException(status_code=404, detail=f"Unknown provider: {provider}")
        raise HTTPException(
            status_code=503,
            detail="Nango is not configured. Set NANGO_SECRET_KEY environment variable.",
        )
    return {"url": session.url, "token": session.token, "provider": session.provider}


# --- System integration routes ---


@app.get("/api/system/state")
def system_state():
    """Get full system state (WiFi, volume, brightness)."""
    from dataclasses import asdict as _asdict

    return _asdict(system_mgr.get_state())


@app.get("/api/system/wifi/status")
def wifi_status():
    """Get current WiFi connection status."""
    from dataclasses import asdict as _asdict

    return _asdict(system_mgr.wifi_status())


@app.get("/api/system/wifi/scan")
def wifi_scan():
    """Scan for available WiFi networks."""
    from dataclasses import asdict as _asdict

    return [_asdict(n) for n in system_mgr.wifi_scan()]


class WifiConnectRequest(BaseModel):
    ssid: str
    password: Optional[str] = None


@app.post("/api/system/wifi/connect")
def wifi_connect(request: WifiConnectRequest):
    """Connect to a WiFi network."""
    success = system_mgr.wifi_connect(request.ssid, request.password)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to connect to WiFi network")
    return {"status": "connected", "ssid": request.ssid}


@app.post("/api/system/wifi/disconnect")
def wifi_disconnect():
    """Disconnect from the current WiFi network."""
    success = system_mgr.wifi_disconnect()
    return {"status": "disconnected" if success else "failed"}


@app.get("/api/system/volume")
def volume_get():
    """Get current volume level and mute state."""
    from dataclasses import asdict as _asdict

    return _asdict(system_mgr.volume_get())


class VolumeSetRequest(BaseModel):
    level: int


@app.post("/api/system/volume")
def volume_set(request: VolumeSetRequest):
    """Set volume to a percentage (0-100)."""
    from dataclasses import asdict as _asdict

    return _asdict(system_mgr.volume_set(request.level))


@app.post("/api/system/volume/mute")
def volume_mute_toggle():
    """Toggle mute on the default audio sink."""
    from dataclasses import asdict as _asdict

    return _asdict(system_mgr.volume_mute_toggle())


@app.get("/api/system/brightness")
def brightness_get():
    """Get current display brightness."""
    from dataclasses import asdict as _asdict

    return _asdict(system_mgr.brightness_get())


class BrightnessSetRequest(BaseModel):
    level: int


@app.post("/api/system/brightness")
def brightness_set(request: BrightnessSetRequest):
    """Set brightness to a percentage (0-100)."""
    from dataclasses import asdict as _asdict

    return _asdict(system_mgr.brightness_set(request.level))


class PowerAction(BaseModel):
    action: str  # "shutdown", "restart", "suspend"


@app.post("/api/system/power")
def power_action(request: PowerAction):
    """Execute a power action (shutdown, restart, suspend)."""
    actions = {
        "shutdown": system_mgr.power_shutdown,
        "restart": system_mgr.power_restart,
        "suspend": system_mgr.power_suspend,
    }
    fn = actions.get(request.action)
    if fn is None:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid power action: {request.action}. Use: shutdown, restart, suspend",
        )
    success = fn()
    if not success:
        raise HTTPException(status_code=500, detail="Power action failed")
    return {"status": request.action}
