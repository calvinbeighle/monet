#!/usr/bin/env python3
"""
Monet Agent Server - lightweight orchestrator for AI agents.

Each agent works on a task, then proposes next steps.
The frontend shows agents as creatures. User swipes yes/no on suggestions.
"""

import asyncio
import json
import os
import subprocess
import time
import uuid
from enum import Enum
from typing import Optional

import anthropic
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


# ---- API key from 1Password ----
def get_api_key():
    """Fetch Anthropic API key from 1Password."""
    try:
        r = subprocess.run(
            ["op", "item", "get", "Anthropic API Key", "--format", "json"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        data = json.loads(r.stdout)
        for f in data.get("fields", []):
            if f.get("label") == "credential":
                return f["value"]
    except Exception:
        pass
    # Fallback to env
    return os.environ.get("ANTHROPIC_API_KEY", "")


# ---- Models ----
class AgentState(str, Enum):
    WORKING = "working"  # agent is thinking
    SUGGESTING = "suggesting"  # agent has proposed next steps, waiting for user
    EXECUTING = "executing"  # user approved, agent is acting
    DONE = "done"  # agent finished
    ERROR = "error"


class Suggestion(BaseModel):
    id: str
    text: str
    action_type: str = "general"  # general, code, email, research


class Agent(BaseModel):
    id: str
    name: str
    kind: str  # "email", "code", "research", "planning"
    task: str
    state: AgentState = AgentState.WORKING
    progress: str = ""  # short status text
    suggestions: list[Suggestion] = []
    history: list[str] = []  # log of what the agent has done
    created_at: float = 0
    color: str = "#7c5cfc"


class CreateAgentRequest(BaseModel):
    name: str
    kind: str
    task: str


class RespondRequest(BaseModel):
    suggestion_id: str
    approved: bool
    feedback: str = ""


# ---- State ----
agents: dict[str, Agent] = {}
client: Optional[anthropic.Anthropic] = None

# ---- FastAPI ----
app = FastAPI(title="Monet Agent Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


COLORS = {
    "email": "#5c8afc",
    "code": "#5cfca8",
    "research": "#fcd85c",
    "planning": "#fc5cb8",
}

SYSTEM_PROMPTS = {
    "email": """You are an email agent. You help the user manage their inbox.
After analyzing a situation, ALWAYS propose 2-3 specific next steps the user can approve or reject.
Format your suggestions as a JSON array at the end of your response:
SUGGESTIONS: [{"text": "Draft a reply to X saying Y", "action_type": "email"}, ...]""",
    "code": """You are a coding agent. You help the user write, review, and debug code.
After analyzing a situation, ALWAYS propose 2-3 specific next steps the user can approve or reject.
Format your suggestions as a JSON array at the end of your response:
SUGGESTIONS: [{"text": "Refactor the auth module to use JWT", "action_type": "code"}, ...]""",
    "research": """You are a research agent. You investigate topics and summarize findings.
After analyzing a situation, ALWAYS propose 2-3 specific next steps the user can approve or reject.
SUGGESTIONS: [{"text": "Deep dive into competitor X's pricing model", "action_type": "research"}, ...]""",
    "planning": """You are a planning agent. You help break down goals into actionable tasks.
After analyzing a situation, ALWAYS propose 2-3 specific next steps the user can approve or reject.
SUGGESTIONS: [{"text": "Create a sprint backlog for the auth feature", "action_type": "planning"}, ...]""",
}


def parse_suggestions(text: str) -> list[Suggestion]:
    """Extract suggestions from agent response."""
    suggestions = []
    if "SUGGESTIONS:" in text:
        try:
            json_str = text.split("SUGGESTIONS:")[-1].strip()
            # Find the JSON array
            start = json_str.index("[")
            depth = 0
            end = start
            for i, ch in enumerate(json_str[start:], start):
                if ch == "[":
                    depth += 1
                elif ch == "]":
                    depth -= 1
                    if depth == 0:
                        end = i + 1
                        break
            raw = json.loads(json_str[start:end])
            for item in raw:
                suggestions.append(
                    Suggestion(
                        id=str(uuid.uuid4())[:8],
                        text=item.get("text", ""),
                        action_type=item.get("action_type", "general"),
                    )
                )
        except (json.JSONDecodeError, ValueError):
            pass

    # Fallback: if no suggestions parsed, create a generic one
    if not suggestions:
        suggestions.append(
            Suggestion(
                id=str(uuid.uuid4())[:8],
                text="Continue working on this task",
                action_type="general",
            )
        )

    return suggestions


async def run_agent_turn(agent_id: str, user_message: Optional[str] = None):
    """Run one turn of an agent conversation."""
    agent = agents.get(agent_id)
    if not agent:
        return

    # Use Claude Code CLI for code agents, API for others
    if agent.kind == "code":
        await run_claude_code_turn(agent, user_message)
    else:
        await run_api_turn(agent, user_message)


async def run_claude_code_turn(agent: Agent, user_message: Optional[str] = None):
    """Run a turn using Claude Code CLI - real agentic coding."""
    agent.state = AgentState.WORKING
    agent.progress = "Claude Code is working..."

    prompt = user_message or agent.task
    # Append suggestion format instruction
    prompt += """

After completing your work, propose 2-3 specific next steps.
Format as a JSON array on its own line starting with SUGGESTIONS:
SUGGESTIONS: [{"text": "description of next step", "action_type": "code"}, ...]"""

    try:
        proc = await asyncio.create_subprocess_exec(
            "claude",
            "-p",
            "--output-format",
            "json",
            "--max-turns",
            "5",
            prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=os.path.expanduser("~/Monet"),
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
        result = json.loads(stdout.decode())

        text = result.get("result", "")
        cost = result.get("total_cost_usd", 0)
        agent.history.append(text)
        agent.suggestions = parse_suggestions(text)

        clean = (
            text.split("SUGGESTIONS:")[0].strip() if "SUGGESTIONS:" in text else text
        )
        cost_str = f" (${cost:.4f})" if cost else ""
        agent.progress = clean[:200] + cost_str
        agent.state = AgentState.SUGGESTING

    except asyncio.TimeoutError:
        agent.state = AgentState.ERROR
        agent.progress = "Claude Code timed out (120s limit)"
    except Exception as e:
        agent.state = AgentState.ERROR
        agent.progress = f"Claude Code error: {str(e)[:100]}"


async def run_api_turn(agent: Agent, user_message: Optional[str] = None):
    """Run a turn using Anthropic API directly."""
    if not client:
        agent.state = AgentState.ERROR
        agent.progress = "No API key configured"
        return

    agent.state = AgentState.WORKING
    agent.progress = "Thinking..."

    try:
        messages = []

        if agent.history:
            messages.append({"role": "user", "content": agent.task})
            for i, entry in enumerate(agent.history):
                role = "assistant" if i % 2 == 0 else "user"
                messages.append({"role": role, "content": entry})

        if user_message:
            messages.append({"role": "user", "content": user_message})
        elif not messages:
            messages.append({"role": "user", "content": agent.task})

        system = SYSTEM_PROMPTS.get(agent.kind, SYSTEM_PROMPTS["planning"])

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=system,
            messages=messages,
        )

        text = response.content[0].text
        agent.history.append(text)
        agent.suggestions = parse_suggestions(text)

        clean = (
            text.split("SUGGESTIONS:")[0].strip() if "SUGGESTIONS:" in text else text
        )
        agent.progress = clean[:200] + ("..." if len(clean) > 200 else "")
        agent.state = AgentState.SUGGESTING

    except Exception as e:
        agent.state = AgentState.ERROR
        agent.progress = f"Error: {str(e)[:100]}"


# ---- Endpoints ----


@app.on_event("startup")
async def startup():
    global client
    key = get_api_key()
    if key:
        client = anthropic.Anthropic(api_key=key)
    else:
        print("WARNING: No Anthropic API key found")


@app.get("/agents")
async def list_agents():
    return {"agents": [a.model_dump() for a in agents.values()]}


@app.post("/agents")
async def create_agent(req: CreateAgentRequest):
    agent_id = str(uuid.uuid4())[:8]
    agent = Agent(
        id=agent_id,
        name=req.name,
        kind=req.kind,
        task=req.task,
        created_at=time.time(),
        color=COLORS.get(req.kind, "#7c5cfc"),
    )
    agents[agent_id] = agent

    # Start the agent working in the background
    asyncio.create_task(run_agent_turn(agent_id))

    return agent.model_dump()


@app.post("/agents/{agent_id}/respond")
async def respond_to_agent(agent_id: str, req: RespondRequest):
    agent = agents.get(agent_id)
    if not agent:
        return {"error": "Agent not found"}

    if req.approved:
        # Find the approved suggestion
        approved = next(
            (s for s in agent.suggestions if s.id == req.suggestion_id), None
        )
        if approved:
            msg = f"Approved: {approved.text}"
            if req.feedback:
                msg += f"\nUser feedback: {req.feedback}"
            agent.history.append(msg)
            agent.suggestions = []
            # Run next turn
            asyncio.create_task(run_agent_turn(agent_id, msg))
    else:
        # Rejected
        rejected = next(
            (s for s in agent.suggestions if s.id == req.suggestion_id), None
        )
        if rejected:
            msg = f"Rejected: {rejected.text}. Please suggest something different."
            if req.feedback:
                msg += f"\nUser feedback: {req.feedback}"
            agent.history.append(msg)
            agent.suggestions = []
            asyncio.create_task(run_agent_turn(agent_id, msg))

    return {"status": "ok"}


@app.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str):
    if agent_id in agents:
        del agents[agent_id]
    return {"status": "deleted"}


@app.post("/agents/{agent_id}/done")
async def mark_done(agent_id: str):
    agent = agents.get(agent_id)
    if agent:
        agent.state = AgentState.DONE
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=9001)
