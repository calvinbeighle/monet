"""FastAPI server - HTTP API for the Monet agent backend."""

import json
import logging
from dataclasses import asdict
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agent.approval import ApprovalGate
from agent.models import ApprovalStatus
from agent.runner import AgentRunner

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Monet Agent Backend", version="0.1.0")

approval_gate = ApprovalGate()
runner = AgentRunner(approval_gate=approval_gate)


class RunRequest(BaseModel):
    intent: str
    session_id: Optional[str] = None


class ApprovalAction(BaseModel):
    pass


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
    """Run an agent with NDJSON streaming of events."""
    logger.info("Streaming agent for intent: %s", request.intent)

    def event_generator():
        for event in runner.stream_sync(request.intent, session_id=request.session_id):
            yield json.dumps(event.to_dict()) + "\n"

    return StreamingResponse(
        event_generator(),
        media_type="application/x-ndjson",
    )


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
