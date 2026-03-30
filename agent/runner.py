"""Agent runner - orchestrates intent routing, agent execution, and approval gates."""

import json
import logging
import os
import uuid
from typing import Generator, Optional

import anthropic

from agent.agents.base import BaseAgent
from agent.agents.code import CodeAgent
from agent.agents.email import EmailAgent
from agent.approval import ApprovalGate
from agent.models import (
    AgentEvent,
    AgentOutput,
    AgentResult,
    ApprovalStatus,
    UIPattern,
)
from agent.router import IntentRouter
from agent.session_store import SessionStore

logger = logging.getLogger(__name__)

AGENT_MODEL = os.environ.get("MONET_AGENT_MODEL", "claude-sonnet-4-6")
MAX_TOOL_ROUNDS = int(os.environ.get("MONET_MAX_TOOL_ROUNDS", "20"))


def _get_agent_registry() -> dict[str, BaseAgent]:
    return {
        "email": EmailAgent(),
        "code": CodeAgent(),
    }


class AgentRunner:
    """Runs agents end-to-end: routes intent, calls Claude with tools, handles approvals.

    The runner implements the agent loop: send messages to Claude, execute tool calls
    (with approval gates for sensitive actions), and collect results. Session history
    is persisted to SQLite so conversations survive server restarts.
    """

    def __init__(
        self,
        approval_gate: Optional[ApprovalGate] = None,
        router: Optional[IntentRouter] = None,
        client: Optional[anthropic.Anthropic] = None,
        session_store: Optional[SessionStore] = None,
    ) -> None:
        self.approval_gate = approval_gate or ApprovalGate()
        self.router = router or IntentRouter()
        self.client = client or anthropic.Anthropic()
        self.agents = _get_agent_registry()
        self.session_store = session_store or SessionStore()
        # In-memory cache of active sessions for fast access during a request
        self._session_cache: dict[str, list[dict]] = {}

    def _get_or_create_session(
        self, session_id: Optional[str]
    ) -> tuple[str, list[dict]]:
        # Check in-memory cache first
        if session_id and session_id in self._session_cache:
            return session_id, self._session_cache[session_id]

        # Try loading from SQLite
        if session_id and self.session_store.session_exists(session_id):
            history = self.session_store.get_messages(session_id)
            self._session_cache[session_id] = history
            return session_id, history

        # Create new session
        sid = session_id or uuid.uuid4().hex[:12]
        self.session_store.create_session(sid)
        self._session_cache[sid] = []
        return sid, self._session_cache[sid]

    def _persist_message(self, session_id: str, role: str, content) -> None:
        """Persist a message to SQLite."""
        self.session_store.append_message(session_id, role, content)

    def _resolve_agent(self, agent_name: str) -> Optional[BaseAgent]:
        return self.agents.get(agent_name)

    def run_sync(self, intent: str, session_id: Optional[str] = None) -> AgentResult:
        """Run an agent synchronously. Routes intent, executes agent loop, returns result."""
        routed = self.router.route(intent)
        agent = self._resolve_agent(routed.agent)

        if agent is None:
            return AgentResult(
                agent=routed.agent,
                ui_pattern=routed.ui_pattern,
                outputs=[
                    AgentOutput(
                        content=f"No agent available for '{routed.agent}'. "
                        f"Available agents: {list(self.agents.keys())}",
                        status="error",
                    )
                ],
            )

        sid, history = self._get_or_create_session(session_id)

        # Build messages
        user_msg = {"role": "user", "content": intent}
        history.append(user_msg)
        self._persist_message(sid, "user", intent)

        # Convert agent tools to Claude API format
        tools = [
            {
                "name": t["name"],
                "description": t["description"],
                "input_schema": t["input_schema"],
            }
            for t in agent.tools
        ]

        # Agent loop: call Claude, handle tool use, repeat
        outputs: list[AgentOutput] = []

        for _round in range(MAX_TOOL_ROUNDS):
            response = self.client.messages.create(
                model=AGENT_MODEL,
                max_tokens=4096,
                system=agent.system_prompt,
                tools=tools,
                messages=history,
            )

            # Collect text content
            assistant_content = response.content
            text_parts = [
                block.text for block in assistant_content if block.type == "text"
            ]

            if text_parts:
                outputs.append(AgentOutput(content="\n".join(text_parts)))

            # Check for tool use
            tool_use_blocks = [
                block for block in assistant_content if block.type == "tool_use"
            ]

            if not tool_use_blocks:
                # No tool calls - agent is done
                history.append({"role": "assistant", "content": assistant_content})
                self._persist_message(sid, "assistant", assistant_content)
                break

            # Process tool calls
            history.append({"role": "assistant", "content": assistant_content})
            self._persist_message(sid, "assistant", assistant_content)
            tool_results = []

            for tool_block in tool_use_blocks:
                tool_name = tool_block.name
                tool_input = tool_block.input

                # Check approval gate
                if tool_name in agent.approval_required:
                    req = self.approval_gate.create(
                        tool_name=tool_name,
                        parameters=tool_input,
                        session_id=sid,
                    )
                    outputs.append(
                        AgentOutput(
                            content=f"Approval required for {tool_name}",
                            status="pending_approval",
                            metadata={
                                "approval_id": req.id,
                                "tool_name": tool_name,
                                "parameters": tool_input,
                            },
                        )
                    )

                    # Wait for approval
                    status = self.approval_gate.wait_for_resolution(req.id, timeout=300)
                    if status != ApprovalStatus.APPROVED:
                        tool_results.append(
                            {
                                "type": "tool_result",
                                "tool_use_id": tool_block.id,
                                "content": f"User rejected {tool_name}. Do not retry this action.",
                            }
                        )
                        continue

                # Execute tool
                result = agent.execute_tool(tool_name, tool_input)
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_block.id,
                        "content": result,
                    }
                )

            history.append({"role": "user", "content": tool_results})
            self._persist_message(sid, "user", tool_results)

        return AgentResult(
            agent=routed.agent,
            ui_pattern=routed.ui_pattern,
            outputs=outputs,
        )

    def stream_sync(
        self, intent: str, session_id: Optional[str] = None
    ) -> Generator[AgentEvent, None, None]:
        """Stream agent events. Routes intent, executes agent loop, yields events."""
        routed = self.router.route(intent)
        agent = self._resolve_agent(routed.agent)

        sid, history = self._get_or_create_session(session_id)

        yield AgentEvent(
            type="routing",
            data=routed.agent,
            metadata={
                "ui_pattern": routed.ui_pattern,
                "agent": routed.agent,
                "session_id": sid,
            },
        )

        if agent is None:
            yield AgentEvent(
                type="error",
                data=f"No agent available for '{routed.agent}'",
            )
            yield AgentEvent(type="done")
            return
        history.append({"role": "user", "content": intent})
        self._persist_message(sid, "user", intent)

        tools = [
            {
                "name": t["name"],
                "description": t["description"],
                "input_schema": t["input_schema"],
            }
            for t in agent.tools
        ]

        for _round in range(MAX_TOOL_ROUNDS):
            # Stream the Claude response
            collected_content = []
            tool_use_blocks = []

            with self.client.messages.stream(
                model=AGENT_MODEL,
                max_tokens=4096,
                system=agent.system_prompt,
                tools=tools,
                messages=history,
            ) as stream:
                current_tool: Optional[dict] = None

                for event in stream:
                    if event.type == "content_block_start":
                        if event.content_block.type == "text":
                            pass
                        elif event.content_block.type == "tool_use":
                            current_tool = {
                                "id": event.content_block.id,
                                "name": event.content_block.name,
                                "input": "",
                            }
                    elif event.type == "content_block_delta":
                        if hasattr(event.delta, "text"):
                            yield AgentEvent(type="token", data=event.delta.text)
                        elif hasattr(event.delta, "partial_json"):
                            if current_tool:
                                current_tool["input"] += event.delta.partial_json
                    elif event.type == "content_block_stop":
                        if current_tool:
                            try:
                                parsed_input = (
                                    json.loads(current_tool["input"])
                                    if current_tool["input"]
                                    else {}
                                )
                            except json.JSONDecodeError:
                                parsed_input = {}
                            tool_use_blocks.append(
                                {
                                    "id": current_tool["id"],
                                    "name": current_tool["name"],
                                    "input": parsed_input,
                                }
                            )
                            yield AgentEvent(
                                type="tool_call",
                                data=current_tool["name"],
                                metadata={"parameters": parsed_input},
                            )
                            current_tool = None

                # Get the final message for history
                final_message = stream.get_final_message()
                collected_content = final_message.content

            if not tool_use_blocks:
                history.append({"role": "assistant", "content": collected_content})
                self._persist_message(sid, "assistant", collected_content)
                break

            # Process tool calls
            history.append({"role": "assistant", "content": collected_content})
            self._persist_message(sid, "assistant", collected_content)
            tool_results = []

            for tool_block in tool_use_blocks:
                tool_name = tool_block["name"]
                tool_input = tool_block["input"]

                if tool_name in agent.approval_required:
                    req = self.approval_gate.create(
                        tool_name=tool_name,
                        parameters=tool_input,
                        session_id=sid,
                    )
                    yield AgentEvent(
                        type="approval_request",
                        data=tool_name,
                        metadata={"approval_id": req.id, "parameters": tool_input},
                    )

                    status = self.approval_gate.wait_for_resolution(req.id, timeout=300)
                    if status != ApprovalStatus.APPROVED:
                        tool_results.append(
                            {
                                "type": "tool_result",
                                "tool_use_id": tool_block["id"],
                                "content": f"User rejected {tool_name}. Do not retry this action.",
                            }
                        )
                        continue

                result = agent.execute_tool(tool_name, tool_input)
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_block["id"],
                        "content": result,
                    }
                )

            history.append({"role": "user", "content": tool_results})
            self._persist_message(sid, "user", tool_results)

        yield AgentEvent(type="done")
