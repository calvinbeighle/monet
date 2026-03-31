"""Agent runner - orchestrates intent routing, agent execution, and approval gates."""

import json
import logging
import os
import threading
import uuid
from typing import Generator, Optional

import anthropic

from agent.agents.base import BaseAgent
from agent.agents.code import CodeAgent
from agent.agents.custom import CustomAgent
from agent.agents.email import EmailAgent
from agent.agents.general import GeneralAgent
from agent.agents.planning import PlanningAgent
from agent.agents.writing import WritingAgent
from agent.approval import ApprovalGate
from agent.custom_agent_store import CustomAgentStore, CustomAgentConfig
from agent.diff_parser import parse_unified_diff
from agent.models import (
    AgentEvent,
    AgentOutput,
    AgentResult,
    ApprovalStatus,
    FlowPlan,
    RoutedIntent,
    UIPattern,
)
from agent.activity_store import ActivityStore
from agent.router import IntentRouter
from agent.session_store import SessionStore

logger = logging.getLogger(__name__)

AGENT_MODEL = os.environ.get("MONET_AGENT_MODEL", "claude-sonnet-4-6")
MAX_TOOL_ROUNDS = int(os.environ.get("MONET_MAX_TOOL_ROUNDS", "20"))


def _get_agent_registry() -> dict[str, BaseAgent]:
    return {
        "email": EmailAgent(),
        "code": CodeAgent(),
        "general": GeneralAgent(),
        "planning": PlanningAgent(),
        "writing": WritingAgent(),
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
        activity_store: Optional[ActivityStore] = None,
        custom_agent_store: Optional[CustomAgentStore] = None,
    ) -> None:
        self.approval_gate = approval_gate or ApprovalGate()
        self.router = router or IntentRouter()
        self.client = client or anthropic.Anthropic()
        self.agents = _get_agent_registry()
        self.session_store = session_store or SessionStore()
        self.activity_store = activity_store or ActivityStore(
            db_path=self.session_store.db_path
        )
        self.custom_agent_store = custom_agent_store or CustomAgentStore(
            db_path=self.session_store.db_path
        )
        # Load persisted custom agents into the registry
        self._load_custom_agents()
        # In-memory cache of active sessions for fast access during a request
        self._session_cache: dict[str, list[dict]] = {}
        # Flow advancement signals: session_id -> threading.Event
        self._flow_advance_events: dict[str, threading.Event] = {}
        self._flow_user_state: dict[str, dict] = {}

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

    def _load_custom_agents(self) -> None:
        """Load all user-created agents from SQLite into the runtime registry."""
        for config in self.custom_agent_store.list_all():
            try:
                self.agents[config.name] = CustomAgent(config)
                logger.info("Loaded custom agent: %s", config.name)
            except Exception as e:
                logger.error("Failed to load custom agent %s: %s", config.name, e)

    def register_custom_agent(self, config: CustomAgentConfig) -> CustomAgentConfig:
        """Create and register a new custom agent. Persists to SQLite."""
        config = self.custom_agent_store.create(config)
        self.agents[config.name] = CustomAgent(config)
        logger.info("Registered custom agent: %s", config.name)
        return config

    def update_custom_agent(
        self, config: CustomAgentConfig
    ) -> Optional[CustomAgentConfig]:
        """Update an existing custom agent. Returns None if not found."""
        updated = self.custom_agent_store.update(config)
        if updated is None:
            return None
        self.agents[config.name] = CustomAgent(updated)
        logger.info("Updated custom agent: %s", config.name)
        return updated

    def unregister_custom_agent(self, name: str) -> bool:
        """Remove a custom agent from the registry and delete from SQLite."""
        deleted = self.custom_agent_store.delete(name)
        if deleted:
            self.agents.pop(name, None)
            logger.info("Unregistered custom agent: %s", name)
        return deleted

    def is_custom_agent(self, name: str) -> bool:
        """Check if an agent name refers to a user-created agent."""
        return isinstance(self.agents.get(name), CustomAgent)

    def _resolve_agent(self, agent_name: str) -> Optional[BaseAgent]:
        return self.agents.get(agent_name)

    def describe_agents(self) -> list[dict]:
        """Return metadata for all registered agents - powers the See Agents dashboard."""
        result = []
        for name, agent in self.agents.items():
            stats = self.activity_store.get_agent_stats(name)
            tool_names = [t["name"] for t in agent.tools] if agent.tools else []
            entry = {
                "name": name,
                "description": agent.description,
                "default_ui_pattern": agent.default_ui_pattern.value,
                "tools": tool_names,
                "approval_required": list(agent.approval_required),
                "suggestions": agent.suggestions,
                "stats": stats,
                "custom": isinstance(agent, CustomAgent),
            }
            result.append(entry)
        return result

    def describe_agent(self, agent_name: str) -> Optional[dict]:
        """Return detailed metadata for a single agent including recent activity."""
        agent = self.agents.get(agent_name)
        if agent is None:
            return None
        stats = self.activity_store.get_agent_stats(agent_name)
        activity = self.activity_store.get_agent_activity(agent_name, limit=20)
        tool_details = agent.tools if agent.tools else []
        return {
            "name": agent_name,
            "description": agent.description,
            "default_ui_pattern": agent.default_ui_pattern.value,
            "tools": tool_details,
            "approval_required": list(agent.approval_required),
            "suggestions": agent.suggestions,
            "stats": stats,
            "recent_activity": activity,
            "custom": isinstance(agent, CustomAgent),
        }

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

        # Track activity
        activity_id = self.activity_store.record_start(
            agent_name=routed.agent,
            intent=intent,
            session_id=sid,
            ui_pattern=routed.ui_pattern,
        )

        # Set session context on agents that need it
        if hasattr(agent, "set_session"):
            agent.set_session(sid)

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

        # For agents with no tools, pass tools=[] to Claude (it handles this fine)
        create_kwargs = {
            "model": AGENT_MODEL,
            "max_tokens": 4096,
            "system": agent.system_prompt,
            "messages": history,
        }
        if tools:
            create_kwargs["tools"] = tools

        activity_recorded = False
        try:
            for _round in range(MAX_TOOL_ROUNDS):
                try:
                    response = self.client.messages.create(**create_kwargs)
                except anthropic.AuthenticationError:
                    outputs.append(
                        AgentOutput(
                            content="Authentication failed. Please check your API key.",
                            status="error",
                            metadata={"error_type": "auth_error", "retryable": False},
                        )
                    )
                    break
                except anthropic.RateLimitError:
                    outputs.append(
                        AgentOutput(
                            content="Rate limit exceeded. Please try again in a moment.",
                            status="error",
                            metadata={"error_type": "rate_limit", "retryable": True},
                        )
                    )
                    break
                except (anthropic.APIConnectionError, anthropic.APITimeoutError) as e:
                    logger.error("API connection error: %s", e)
                    outputs.append(
                        AgentOutput(
                            content="Failed to connect to AI service. Please check your network.",
                            status="error",
                            metadata={
                                "error_type": "connection_error",
                                "retryable": True,
                            },
                        )
                    )
                    break
                except anthropic.APIError as e:
                    logger.error("API error: %s", e)
                    outputs.append(
                        AgentOutput(
                            content=f"AI service error: {e.message}",
                            status="error",
                            metadata={"error_type": "api_error", "retryable": True},
                        )
                    )
                    break

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
                    self.activity_store.record_tool_call(activity_id)

                    # Check approval gate
                    if tool_name in agent.approval_required:
                        self.activity_store.record_approval(activity_id)
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
                        status = self.approval_gate.wait_for_resolution(
                            req.id, timeout=300
                        )
                        if status != ApprovalStatus.APPROVED:
                            tool_results.append(
                                {
                                    "type": "tool_result",
                                    "tool_use_id": tool_block.id,
                                    "content": f"User rejected {tool_name}. Do not retry this action.",
                                }
                            )
                            continue

                    # Execute tool with error handling
                    try:
                        result = agent.execute_tool(tool_name, tool_input)
                    except Exception as e:
                        logger.error("Tool execution failed: %s - %s", tool_name, e)
                        error_msg = str(e)
                        # Detect OAuth/auth errors from integration APIs
                        if (
                            "401" in error_msg
                            or "403" in error_msg
                            or "unauthorized" in error_msg.lower()
                        ):
                            result = json.dumps(
                                {
                                    "error": f"Authentication failed for {tool_name}. "
                                    "The OAuth token may have expired - please reconnect the integration.",
                                    "error_type": "oauth_expired",
                                }
                            )
                            outputs.append(
                                AgentOutput(
                                    content=f"OAuth token expired for {tool_name}. Please reconnect.",
                                    status="error",
                                    metadata={
                                        "error_type": "oauth_expired",
                                        "tool_name": tool_name,
                                    },
                                )
                            )
                        else:
                            result = json.dumps(
                                {"error": f"Tool {tool_name} failed: {error_msg}"}
                            )
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_block.id,
                            "content": result,
                        }
                    )

                # Update create_kwargs messages for next round
                history.append({"role": "user", "content": tool_results})
                self._persist_message(sid, "user", tool_results)
                create_kwargs["messages"] = history
            else:
                # Loop exhausted without break - MAX_TOOL_ROUNDS reached
                logger.warning(
                    "Agent loop exhausted MAX_TOOL_ROUNDS (%d) for intent: %s",
                    MAX_TOOL_ROUNDS,
                    intent[:200],
                )
                outputs.append(
                    AgentOutput(
                        content=f"Agent reached maximum tool execution rounds ({MAX_TOOL_ROUNDS}). The task may be incomplete.",
                        status="error",
                    )
                )

            # Include planning node data as outputs for whiteboard pattern
            if hasattr(agent, "_nodes") and routed.ui_pattern == UIPattern.WHITEBOARD:
                for node in agent._nodes.values():
                    outputs.append(
                        AgentOutput(
                            content=node.get("title", ""),
                            status="complete",
                            metadata=node,
                        )
                    )

            # Record activity completion
            has_error = any(o.status == "error" for o in outputs)
            if has_error:
                error_msgs = [o.content for o in outputs if o.status == "error"]
                self.activity_store.record_error(activity_id, "; ".join(error_msgs))
            else:
                summary_parts = [o.content for o in outputs if o.status == "complete"]
                summary = summary_parts[0][:200] if summary_parts else None
                self.activity_store.record_finish(activity_id, summary=summary)
            activity_recorded = True
        finally:
            if not activity_recorded:
                self.activity_store.record_error(
                    activity_id, "Unexpected error during agent execution"
                )

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

        # Track activity
        activity_id = self.activity_store.record_start(
            agent_name=routed.agent,
            intent=intent,
            session_id=sid,
            ui_pattern=routed.ui_pattern,
        )

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
            self.activity_store.record_error(
                activity_id, f"No agent for '{routed.agent}'"
            )
            yield AgentEvent(
                type="error",
                data=f"No agent available for '{routed.agent}'",
            )
            yield AgentEvent(type="done")
            return

        # Set session context on agents that need it
        if hasattr(agent, "set_session"):
            agent.set_session(sid)

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

        # Collect outputs for the done event
        stream_outputs: list[dict] = []
        stream_had_error: Optional[str] = None

        # For agents with no tools, omit tools parameter
        stream_kwargs = {
            "model": AGENT_MODEL,
            "max_tokens": 4096,
            "system": agent.system_prompt,
            "messages": history,
        }
        if tools:
            stream_kwargs["tools"] = tools

        activity_recorded = False
        try:
            for _round in range(MAX_TOOL_ROUNDS):
                # Stream the Claude response
                collected_content = []
                tool_use_blocks = []

                try:
                    with self.client.messages.stream(**stream_kwargs) as stream:
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
                                    yield AgentEvent(
                                        type="token", data=event.delta.text
                                    )
                                elif hasattr(event.delta, "partial_json"):
                                    if current_tool:
                                        current_tool["input"] += (
                                            event.delta.partial_json
                                        )
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

                except anthropic.AuthenticationError:
                    stream_had_error = "Authentication failed"
                    yield AgentEvent(
                        type="error",
                        data="Authentication failed. Please check your API key.",
                        metadata={"error_type": "auth_error", "retryable": False},
                    )
                    break
                except anthropic.RateLimitError:
                    stream_had_error = "Rate limit exceeded"
                    yield AgentEvent(
                        type="error",
                        data="Rate limit exceeded. Please try again in a moment.",
                        metadata={"error_type": "rate_limit", "retryable": True},
                    )
                    break
                except (anthropic.APIConnectionError, anthropic.APITimeoutError) as e:
                    logger.error("API connection error during stream: %s", e)
                    stream_had_error = f"Connection error: {e}"
                    yield AgentEvent(
                        type="error",
                        data="Failed to connect to AI service. Please check your network.",
                        metadata={"error_type": "connection_error", "retryable": True},
                    )
                    break
                except anthropic.APIError as e:
                    logger.error("API error during stream: %s", e)
                    stream_had_error = f"API error: {e.message}"
                    yield AgentEvent(
                        type="error",
                        data=f"AI service error: {e.message}",
                        metadata={"error_type": "api_error", "retryable": True},
                    )
                    break

                # Collect text outputs for the done event
                text_parts = [
                    block.text
                    for block in collected_content
                    if hasattr(block, "type")
                    and block.type == "text"
                    and hasattr(block, "text")
                ]
                if text_parts:
                    stream_outputs.append(
                        {"content": "\n".join(text_parts), "status": "complete"}
                    )

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
                    self.activity_store.record_tool_call(activity_id)

                    if tool_name in agent.approval_required:
                        self.activity_store.record_approval(activity_id)
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

                        status = self.approval_gate.wait_for_resolution(
                            req.id, timeout=300
                        )
                        if status != ApprovalStatus.APPROVED:
                            tool_results.append(
                                {
                                    "type": "tool_result",
                                    "tool_use_id": tool_block["id"],
                                    "content": f"User rejected {tool_name}. Do not retry this action.",
                                }
                            )
                            continue

                    # Execute tool with error handling
                    try:
                        result = agent.execute_tool(tool_name, tool_input)
                    except Exception as e:
                        logger.error(
                            "Tool execution failed in stream: %s - %s", tool_name, e
                        )
                        error_msg = str(e)
                        if (
                            "401" in error_msg
                            or "403" in error_msg
                            or "unauthorized" in error_msg.lower()
                        ):
                            result = json.dumps(
                                {
                                    "error": f"Authentication failed for {tool_name}. "
                                    "The OAuth token may have expired - please reconnect.",
                                    "error_type": "oauth_expired",
                                }
                            )
                            yield AgentEvent(
                                type="error",
                                data=f"OAuth token expired for {tool_name}. Please reconnect.",
                                metadata={
                                    "error_type": "oauth_expired",
                                    "tool_name": tool_name,
                                    "retryable": False,
                                },
                            )
                        else:
                            result = json.dumps(
                                {"error": f"Tool {tool_name} failed: {error_msg}"}
                            )

                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_block["id"],
                            "content": result,
                        }
                    )

                    # Emit whiteboard_update after planning tool calls so UI can render incrementally
                    if (
                        hasattr(agent, "_nodes")
                        and routed.ui_pattern == UIPattern.WHITEBOARD
                    ):
                        yield AgentEvent(
                            type="whiteboard_update",
                            data="",
                            metadata={"nodes": list(agent._nodes.values())},
                        )

                    # Emit diff_update after read_diff tool so Diff UI renders during streaming
                    if (
                        tool_name == "read_diff"
                        and routed.ui_pattern == UIPattern.DIFF
                        and isinstance(result, str)
                        and not result.startswith('{"error')
                    ):
                        diff_lines = parse_unified_diff(result)
                        yield AgentEvent(
                            type="diff_update",
                            data="",
                            metadata={"lines": diff_lines},
                        )

                history.append({"role": "user", "content": tool_results})
                self._persist_message(sid, "user", tool_results)
                stream_kwargs["messages"] = history
            else:
                # Loop exhausted without break - MAX_TOOL_ROUNDS reached
                logger.warning(
                    "Stream agent loop exhausted MAX_TOOL_ROUNDS (%d) for intent: %s",
                    MAX_TOOL_ROUNDS,
                    intent[:200],
                )
                stream_had_error = f"Max tool rounds ({MAX_TOOL_ROUNDS}) exhausted"
                yield AgentEvent(
                    type="error",
                    data=f"Agent reached maximum tool execution rounds ({MAX_TOOL_ROUNDS}). The task may be incomplete.",
                    metadata={"error_type": "max_rounds_exhausted"},
                )

            # Include planning node data in done event for whiteboard pattern
            if hasattr(agent, "_nodes") and routed.ui_pattern == UIPattern.WHITEBOARD:
                stream_outputs = list(agent._nodes.values())

            # Record activity completion
            if stream_had_error:
                self.activity_store.record_error(activity_id, stream_had_error)
            else:
                summary = None
                if stream_outputs:
                    first = stream_outputs[0]
                    if isinstance(first, dict) and "content" in first:
                        summary = first["content"][:200]
                    elif isinstance(first, dict) and "title" in first:
                        summary = first["title"][:200]
                self.activity_store.record_finish(activity_id, summary=summary)
            activity_recorded = True
        except Exception as exc:
            logger.error("Unexpected error in stream_sync: %s", exc, exc_info=True)
            if not activity_recorded:
                self.activity_store.record_error(
                    activity_id, "Unexpected error during agent execution"
                )
            yield AgentEvent(
                type="error",
                data="An unexpected error occurred during agent execution.",
                metadata={"error_type": "unexpected_error"},
            )
            yield AgentEvent(type="done")
            return

        yield AgentEvent(
            type="done",
            metadata={
                "agent": routed.agent,
                "ui_pattern": routed.ui_pattern,
                "session_id": sid,
                "outputs": stream_outputs,
                "suggestions": agent.suggestions if agent else [],
            },
        )

    def stream_flow(
        self, intent: str, session_id: Optional[str] = None
    ) -> Generator[AgentEvent, None, None]:
        """Stream a multi-step flow. Each step runs its agent, then emits
        a pattern_transition event before the next step begins.

        For single-step plans, delegates to stream_sync (zero overhead).
        For multi-step plans, orchestrates each step with user-advance gates.
        """
        plan = self.router.route_flow(intent)

        if plan.is_single:
            yield from self.stream_sync(intent, session_id=session_id)
            return

        sid, history = self._get_or_create_session(session_id)
        carried_state: dict = {}

        yield AgentEvent(
            type="flow_start",
            data=plan.original,
            metadata={
                "total_steps": len(plan.steps),
                "steps": [
                    {
                        "agent": s.agent,
                        "ui_pattern": s.ui_pattern,
                        "label": s.label,
                    }
                    for s in plan.steps
                ],
                "session_id": sid,
            },
        )

        for i, step in enumerate(plan.steps):
            step_intent = (
                intent
                if i == 0
                else self._build_step_intent(intent, step, carried_state)
            )

            forced_routed = RoutedIntent(
                agent=step.agent,
                ui_pattern=step.ui_pattern,
                original=step_intent,
            )

            step_outputs: list = []
            step_had_error = False
            for event in self._stream_step(forced_routed, step_intent, sid, history):
                if event.type == "done":
                    step_outputs = event.metadata.get("outputs", [])
                    event.metadata["flow_step"] = i
                    event.metadata["flow_total"] = len(plan.steps)
                    event.metadata["is_flow_step_done"] = True
                    yield event
                elif event.type == "error":
                    step_had_error = True
                    yield event
                else:
                    yield event

            if step_had_error:
                yield AgentEvent(
                    type="flow_done",
                    data="Flow stopped due to error",
                    metadata={
                        "stopped_at_step": i,
                        "total_steps": len(plan.steps),
                        "session_id": sid,
                    },
                )
                return

            # Apply carry_map to transform outputs for next step
            if step.carry_map:
                for source_key, target_key in step.carry_map.items():
                    carried_state[target_key] = self._extract_carry(
                        source_key, step_outputs, step.ui_pattern
                    )
            else:
                carried_state["previous_outputs"] = step_outputs

            # Emit transition and wait for user advance (except after last step)
            if i < len(plan.steps) - 1:
                next_step = plan.steps[i + 1]
                advance_event = threading.Event()
                self._flow_advance_events[sid] = advance_event

                yield AgentEvent(
                    type="pattern_transition",
                    data=next_step.label,
                    metadata={
                        "step_index": i + 1,
                        "total_steps": len(plan.steps),
                        "next_pattern": next_step.ui_pattern,
                        "next_agent": next_step.agent,
                        "carried_state": carried_state,
                        "awaiting_advance": True,
                    },
                )

                if not advance_event.wait(timeout=600):
                    yield AgentEvent(
                        type="error",
                        data="Flow timed out waiting for user to advance.",
                    )
                    yield AgentEvent(
                        type="flow_done",
                        data="Flow timed out",
                        metadata={
                            "stopped_at_step": i,
                            "total_steps": len(plan.steps),
                            "session_id": sid,
                        },
                    )
                    self._flow_advance_events.pop(sid, None)
                    return

                # Merge user modifications into carried state
                user_mods = self._flow_user_state.pop(sid, {})
                carried_state.update(user_mods)
                self._flow_advance_events.pop(sid, None)

        yield AgentEvent(
            type="flow_done",
            data="Flow complete",
            metadata={
                "total_steps": len(plan.steps),
                "session_id": sid,
            },
        )

    def _stream_step(
        self,
        routed: RoutedIntent,
        intent: str,
        session_id: str,
        history: list[dict],
    ) -> Generator[AgentEvent, None, None]:
        """Run a single step within a flow. Uses the same core logic as stream_sync
        but with pre-resolved routing and shared session state."""
        agent = self._resolve_agent(routed.agent)

        yield AgentEvent(
            type="routing",
            data=routed.agent,
            metadata={
                "ui_pattern": routed.ui_pattern,
                "agent": routed.agent,
                "session_id": session_id,
            },
        )

        if agent is None:
            yield AgentEvent(
                type="error",
                data=f"No agent available for '{routed.agent}'",
            )
            yield AgentEvent(
                type="done",
                metadata={
                    "agent": routed.agent,
                    "ui_pattern": routed.ui_pattern,
                    "session_id": session_id,
                    "outputs": [],
                    "suggestions": [],
                },
            )
            return

        if hasattr(agent, "set_session"):
            agent.set_session(session_id)

        history.append({"role": "user", "content": intent})
        self._persist_message(session_id, "user", intent)

        tools = [
            {
                "name": t["name"],
                "description": t["description"],
                "input_schema": t["input_schema"],
            }
            for t in agent.tools
        ]

        stream_outputs: list[dict] = []
        stream_kwargs = {
            "model": AGENT_MODEL,
            "max_tokens": 4096,
            "system": agent.system_prompt,
            "messages": history,
        }
        if tools:
            stream_kwargs["tools"] = tools

        for _round in range(MAX_TOOL_ROUNDS):
            collected_content = []
            tool_use_blocks = []

            try:
                with self.client.messages.stream(**stream_kwargs) as stream:
                    current_tool: Optional[dict] = None

                    for event in stream:
                        if event.type == "content_block_start":
                            if event.content_block.type == "tool_use":
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

                    final_message = stream.get_final_message()
                    collected_content = final_message.content

            except anthropic.AuthenticationError:
                yield AgentEvent(
                    type="error",
                    data="Authentication failed. Please check your API key.",
                    metadata={"error_type": "auth_error", "retryable": False},
                )
                break
            except anthropic.RateLimitError:
                yield AgentEvent(
                    type="error",
                    data="Rate limit exceeded. Please try again in a moment.",
                    metadata={"error_type": "rate_limit", "retryable": True},
                )
                break
            except (anthropic.APIConnectionError, anthropic.APITimeoutError) as e:
                logger.error("API connection error during stream step: %s", e)
                yield AgentEvent(
                    type="error",
                    data="Failed to connect to AI service. Please check your network.",
                    metadata={"error_type": "connection_error", "retryable": True},
                )
                break
            except anthropic.APIError as e:
                logger.error("API error during stream step: %s", e)
                yield AgentEvent(
                    type="error",
                    data=f"AI service error: {e.message}",
                    metadata={"error_type": "api_error", "retryable": True},
                )
                break

            text_parts = [
                block.text
                for block in collected_content
                if hasattr(block, "type")
                and block.type == "text"
                and hasattr(block, "text")
            ]
            if text_parts:
                stream_outputs.append(
                    {"content": "\n".join(text_parts), "status": "complete"}
                )

            if not tool_use_blocks:
                history.append({"role": "assistant", "content": collected_content})
                self._persist_message(session_id, "assistant", collected_content)
                break

            history.append({"role": "assistant", "content": collected_content})
            self._persist_message(session_id, "assistant", collected_content)
            tool_results = []

            for tool_block in tool_use_blocks:
                tool_name = tool_block["name"]
                tool_input = tool_block["input"]

                if tool_name in agent.approval_required:
                    req = self.approval_gate.create(
                        tool_name=tool_name,
                        parameters=tool_input,
                        session_id=session_id,
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

                try:
                    result = agent.execute_tool(tool_name, tool_input)
                except Exception as e:
                    logger.error(
                        "Tool execution failed in stream step: %s - %s", tool_name, e
                    )
                    error_msg = str(e)
                    if (
                        "401" in error_msg
                        or "403" in error_msg
                        or "unauthorized" in error_msg.lower()
                    ):
                        result = json.dumps(
                            {
                                "error": f"Authentication failed for {tool_name}. "
                                "The OAuth token may have expired - please reconnect.",
                                "error_type": "oauth_expired",
                            }
                        )
                        yield AgentEvent(
                            type="error",
                            data=f"OAuth token expired for {tool_name}. Please reconnect.",
                            metadata={
                                "error_type": "oauth_expired",
                                "tool_name": tool_name,
                                "retryable": False,
                            },
                        )
                    else:
                        result = json.dumps(
                            {"error": f"Tool {tool_name} failed: {error_msg}"}
                        )

                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_block["id"],
                        "content": result,
                    }
                )

                if (
                    hasattr(agent, "_nodes")
                    and routed.ui_pattern == UIPattern.WHITEBOARD
                ):
                    yield AgentEvent(
                        type="whiteboard_update",
                        data="",
                        metadata={"nodes": list(agent._nodes.values())},
                    )

                if (
                    tool_name == "read_diff"
                    and routed.ui_pattern == UIPattern.DIFF
                    and isinstance(result, str)
                    and not result.startswith('{"error')
                ):
                    diff_lines = parse_unified_diff(result)
                    yield AgentEvent(
                        type="diff_update",
                        data="",
                        metadata={"lines": diff_lines},
                    )

            history.append({"role": "user", "content": tool_results})
            self._persist_message(session_id, "user", tool_results)
            stream_kwargs["messages"] = history
        else:
            # Loop exhausted without break - MAX_TOOL_ROUNDS reached
            logger.warning(
                "Stream step loop exhausted MAX_TOOL_ROUNDS (%d) for intent: %s",
                MAX_TOOL_ROUNDS,
                intent[:200],
            )
            yield AgentEvent(
                type="error",
                data=f"Agent reached maximum tool execution rounds ({MAX_TOOL_ROUNDS}). The task may be incomplete.",
                metadata={"error_type": "max_rounds_exhausted"},
            )

        # Include planning node data in done event for whiteboard pattern
        if hasattr(agent, "_nodes") and routed.ui_pattern == UIPattern.WHITEBOARD:
            stream_outputs = list(agent._nodes.values())

        yield AgentEvent(
            type="done",
            metadata={
                "agent": routed.agent,
                "ui_pattern": routed.ui_pattern,
                "session_id": session_id,
                "outputs": stream_outputs,
                "suggestions": agent.suggestions if agent else [],
            },
        )

    def _build_step_intent(
        self, original: str, step: "FlowStep", carried_state: dict
    ) -> str:
        """Build the intent string for a non-first step by injecting
        carried state as context."""
        from agent.models import FlowStep as _FS  # noqa: F811

        context_parts = []
        for key, value in carried_state.items():
            if isinstance(value, list) and len(value) > 0:
                context_parts.append(
                    f"[Context from previous step - {key}: "
                    f"{json.dumps(value, default=str)[:2000]}]"
                )
            elif isinstance(value, str):
                context_parts.append(
                    f"[Context from previous step - {key}: {value[:2000]}]"
                )

        context_block = "\n".join(context_parts)
        return f"{original}\n\n{context_block}" if context_block else original

    def _extract_carry(
        self, source_key: str, outputs: list, ui_pattern: str
    ) -> list | str:
        """Extract carried state from step outputs based on source_key."""
        if source_key == "nodes" and ui_pattern == UIPattern.WHITEBOARD.value:
            return [
                {
                    "title": node.get("title", ""),
                    "body": node.get("body", ""),
                    "priority": node.get("priority", "medium"),
                    "id": node.get("id", ""),
                }
                for node in outputs
                if isinstance(node, dict) and "title" in node
            ]
        elif source_key == "decisions":
            return [
                {
                    "title": o.get("title", ""),
                    "approved": o.get("approved", False),
                }
                for o in outputs
                if isinstance(o, dict)
            ]
        elif source_key == "diff_decisions":
            return outputs
        else:
            return outputs

    def signal_advance(
        self, session_id: str, step_index: int, user_state: dict
    ) -> bool:
        """Signal that the user is ready for the next flow step.
        Returns True if a waiting flow was found and signaled."""
        self._flow_user_state[session_id] = user_state
        event = self._flow_advance_events.get(session_id)
        if event:
            event.set()
            return True
        return False
