"""
agents/base.py

Abstract base agent that all specialized agents inherit from.
Defines the common interface for:
  - Streaming LLM responses via OpenRouter (OpenAI-compatible chat/completions API)
  - Emitting typed SSE events to the session store
  - Pausing execution at approval gates before destructive tool calls
  - Resuming after an approval decision is recorded

OpenRouter uses the OpenAI-compatible API format (chat/completions endpoint),
not the Anthropic SDK format. This module uses httpx directly to call the
OpenRouter chat/completions endpoint.

- Streaming (text-only responses): uses SSE via httpx with stream=True
- Non-streaming (tool call responses): uses a regular POST when tools are defined,
  then parses tool_calls from the OpenAI-format response

All agents are stateless functions wrapped in a thin class for dependency
injection of the config and session store. No mutable class-level state.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from abc import ABC, abstractmethod
from typing import Any, AsyncIterator

import httpx

from config import get_config
from models import (
    AgentEvent,
    AgentType,
    EventType,
    PendingAction,
    SessionState,
    SessionStatus,
)

# OpenRouter chat/completions endpoint path
_CHAT_COMPLETIONS_PATH = "/chat/completions"

# Timeout in seconds for OpenRouter API calls before emitting a timeout error
_OPENROUTER_TIMEOUT_SECS = 30


class BaseAgent(ABC):
    """
    Abstract base for all Monet agents.

    Subclasses must implement:
        - agent_type: AgentType property
        - system_prompt: str property
        - tools: list[dict] property (OpenAI function format)
        - requires_approval(tool_name: str) -> bool

    The run() method drives the full LLM loop and streams events into the
    provided SessionState. Callers subscribe to the session's event queue
    via the /stream/{session_id} SSE endpoint.
    """

    def __init__(self, session: SessionState) -> None:
        self._session = session
        self._cfg = get_config()
        # Asyncio event used to signal approval decisions to the running loop
        self._approval_events: dict[str, asyncio.Event] = {}

    # ------------------------------------------------------------------
    # Abstract interface
    # ------------------------------------------------------------------

    @property
    @abstractmethod
    def agent_type(self) -> AgentType:
        """The AgentType enum value for this agent."""
        ...

    @property
    @abstractmethod
    def system_prompt(self) -> str:
        """System prompt injected at the start of every conversation."""
        ...

    @property
    @abstractmethod
    def tools(self) -> list[dict[str, Any]]:
        """
        OpenAI function format tool definitions passed to the chat/completions API.
        Each dict must have keys: type ("function"), function (name, description, parameters).
        """
        ...

    @abstractmethod
    def requires_approval(self, tool_name: str) -> bool:
        """
        Return True if this tool call must pause for human approval
        before execution (e.g. send_email, merge_pr).

        Args:
            tool_name: The name of the tool the LLM wants to invoke.

        Returns:
            bool: True if an approval gate should be inserted.
        """
        ...

    @property
    def model(self) -> str:
        """Model to use. Subclasses can override for cheaper/faster models."""
        return self._cfg.model

    # ------------------------------------------------------------------
    # Core run loop
    # ------------------------------------------------------------------

    async def run(self, user_message: str) -> None:
        """
        Execute the agent loop for a single user intent.

        Drives a multi-turn conversation with the model via OpenRouter until
        the model stops requesting tool calls. Emits AgentEvents into the
        session for consumption by the SSE stream.

        The conversation history is maintained in OpenAI message format:
          - Text responses from the assistant are appended as role=assistant messages
          - Tool call responses from the assistant are appended as role=assistant with tool_calls
          - Tool results are appended as role=tool messages with tool_call_id

        Args:
            user_message: The original intent text from the user.
        """
        self._session.status = SessionStatus.RUNNING
        await self._emit(EventType.THINKING)

        messages: list[dict[str, Any]] = [
            {"role": "user", "content": user_message}
        ]

        # Agentic loop - continues until no more tool calls
        while True:
            response_text = ""
            tool_calls: list[dict[str, Any]] = []

            try:
                if self.tools:
                    # Non-streaming path: tools present, parse tool_calls from response
                    async for chunk in self._call_with_tools(messages):
                        if chunk["type"] == "text":
                            response_text += chunk["text"]
                            await self._emit(EventType.TEXT, text=chunk["text"])
                        elif chunk["type"] == "tool_use":
                            tool_calls.append(chunk)
                else:
                    # Streaming path: no tools, stream text tokens via SSE
                    async for chunk in self._stream_text(messages):
                        response_text += chunk["text"]
                        await self._emit(EventType.TEXT, text=chunk["text"])

            except httpx.TimeoutException:
                err_msg = (
                    f"OpenRouter did not respond within {_OPENROUTER_TIMEOUT_SECS}s. "
                    "Check your API key and network connection."
                )
                self._session.status = SessionStatus.ERROR
                self._session.error = err_msg
                await self._emit(EventType.ERROR, error=err_msg)
                return
            except Exception as exc:
                err_msg = str(exc) or f"Unexpected error: {type(exc).__name__}"
                self._session.status = SessionStatus.ERROR
                self._session.error = err_msg
                await self._emit(EventType.ERROR, error=err_msg)
                return

            # Build the assistant turn to append to message history
            if tool_calls:
                # Reconstruct OpenAI-format tool_calls list for the assistant message
                openai_tool_calls = [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": tc["name"],
                            "arguments": json.dumps(tc["input"]),
                        },
                    }
                    for tc in tool_calls
                ]
                assistant_msg: dict[str, Any] = {
                    "role": "assistant",
                    "content": response_text or None,
                    "tool_calls": openai_tool_calls,
                }
            elif response_text:
                assistant_msg = {"role": "assistant", "content": response_text}
            else:
                # Nothing from the model - break to avoid infinite loop
                break

            messages.append(assistant_msg)

            if not tool_calls:
                # No tool calls - agent is done
                break

            # Process each tool call, inserting approval gates as needed,
            # then append tool result messages for the next LLM turn
            for tc in tool_calls:
                result = await self._handle_tool_call(tc)
                result_str = str(result) if result is not None else "rejected"
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result_str,
                })

        self._session.status = SessionStatus.DONE
        await self._emit(EventType.DONE)

    # ------------------------------------------------------------------
    # OpenRouter API calls
    # ------------------------------------------------------------------

    def _build_headers(self) -> dict[str, str]:
        """
        Build HTTP headers for OpenRouter API requests.

        Returns:
            dict: Authorization and Content-Type headers.
        """
        return {
            "Authorization": f"Bearer {self._cfg.openrouter_api_key}",
            "Content-Type": "application/json",
        }

    def _build_url(self) -> str:
        """
        Construct the full OpenRouter chat/completions URL.

        Returns:
            str: Full URL for the chat/completions endpoint.
        """
        base = self._cfg.openrouter_base_url.rstrip("/")
        return f"{base}{_CHAT_COMPLETIONS_PATH}"

    async def _stream_text(
        self, messages: list[dict[str, Any]]
    ) -> AsyncIterator[dict[str, Any]]:
        """
        Stream a text completion from OpenRouter via SSE (no tools).

        Uses httpx streaming to consume the OpenAI-format SSE stream:
          data: {"choices":[{"delta":{"content":"Hello"}}]}
          data: [DONE]

        Raises a TimeoutError if the first token is not received within
        _OPENROUTER_TIMEOUT_SECS seconds.

        Args:
            messages: The full conversation history in OpenAI message format.

        Yields:
            dict with "type": "text" and "text" key containing the delta.

        Raises:
            TimeoutError: If OpenRouter does not respond within the timeout.
            httpx.HTTPStatusError: If OpenRouter returns a non-2xx status.
            RuntimeError: If OpenRouter returns an error payload in the response body.
        """
        payload: dict[str, Any] = {
            "model": self.model,
            "max_tokens": 4096,
            "messages": [
                {"role": "system", "content": self.system_prompt},
                *messages,
            ],
            "stream": True,
        }

        url = self._build_url()
        headers = self._build_headers()

        timeout = httpx.Timeout(
            connect=10.0,
            read=_OPENROUTER_TIMEOUT_SECS,
            write=10.0,
            pool=5.0,
        )

        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST", url, headers=headers, json=payload
            ) as response:
                if response.status_code >= 400:
                    body = await response.aread()
                    try:
                        err_data = json.loads(body)
                        err_msg = (
                            err_data.get("error", {}).get("message")
                            or err_data.get("message")
                            or body.decode("utf-8", errors="replace")
                        )
                    except (json.JSONDecodeError, AttributeError):
                        err_msg = body.decode("utf-8", errors="replace")
                    raise RuntimeError(
                        f"OpenRouter returned HTTP {response.status_code}: {err_msg}"
                    )

                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data_str = line[len("data: "):]
                    if data_str.strip() == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    # Surface API-level errors embedded in the SSE stream
                    if "error" in data:
                        err = data["error"]
                        err_msg = (
                            err.get("message") if isinstance(err, dict) else str(err)
                        )
                        raise RuntimeError(f"OpenRouter stream error: {err_msg}")

                    choices = data.get("choices", [])
                    if not choices:
                        continue
                    delta = choices[0].get("delta", {})
                    content = delta.get("content")
                    if content:
                        yield {"type": "text", "text": content}

    async def _call_with_tools(
        self, messages: list[dict[str, Any]]
    ) -> AsyncIterator[dict[str, Any]]:
        """
        Make a non-streaming request to OpenRouter with tools defined.

        OpenRouter does not reliably support tool_use blocks in streaming mode,
        so when tools are present we use a regular (non-streaming) POST and
        parse the OpenAI-format tool_calls from the response.

        Response format for tool calls:
          {
            "choices": [{
              "message": {
                "content": "...",
                "tool_calls": [{
                  "id": "call_xxx",
                  "function": {"name": "tool_name", "arguments": "{...}"}
                }]
              }
            }]
          }

        Args:
            messages: The full conversation history in OpenAI message format.

        Yields:
            dict with "type": "text" or "type": "tool_use" and relevant fields.

        Raises:
            TimeoutError: If OpenRouter does not respond within the timeout.
            RuntimeError: If OpenRouter returns an error response or error payload.
        """
        payload: dict[str, Any] = {
            "model": self.model,
            "max_tokens": 4096,
            "messages": [
                {"role": "system", "content": self.system_prompt},
                *messages,
            ],
            "tools": self.tools,
            "stream": False,
        }

        url = self._build_url()
        headers = self._build_headers()

        timeout = httpx.Timeout(
            connect=10.0,
            read=_OPENROUTER_TIMEOUT_SECS,
            write=10.0,
            pool=5.0,
        )

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, headers=headers, json=payload)

        # Surface HTTP-level errors with the response body included in the message
        if response.status_code >= 400:
            try:
                err_data = response.json()
                err_msg = (
                    err_data.get("error", {}).get("message")
                    or err_data.get("message")
                    or response.text
                )
            except (json.JSONDecodeError, AttributeError):
                err_msg = response.text or f"HTTP {response.status_code}"
            raise RuntimeError(
                f"OpenRouter returned HTTP {response.status_code}: {err_msg}"
            )

        data = response.json()

        # Surface API-level errors in a successful HTTP response body
        if "error" in data:
            err = data["error"]
            err_msg = err.get("message") if isinstance(err, dict) else str(err)
            raise RuntimeError(f"OpenRouter API error: {err_msg}")

        choices = data.get("choices", [])
        if not choices:
            return

        message = choices[0].get("message", {})

        # Yield any text content first
        content = message.get("content")
        if content:
            yield {"type": "text", "text": content}

        # Yield tool calls as tool_use chunks
        raw_tool_calls = message.get("tool_calls") or []
        for raw_tc in raw_tool_calls:
            fn = raw_tc.get("function", {})
            tool_name = fn.get("name", "")
            arguments_str = fn.get("arguments", "{}")
            try:
                tool_input = json.loads(arguments_str)
            except json.JSONDecodeError:
                tool_input = {}
            yield {
                "type": "tool_use",
                "id": raw_tc.get("id", str(uuid.uuid4())),
                "name": tool_name,
                "input": tool_input,
            }

    # ------------------------------------------------------------------
    # Tool call handling with approval gates
    # ------------------------------------------------------------------

    async def _handle_tool_call(
        self, tool_call: dict[str, Any]
    ) -> Any:
        """
        Process a single tool call, inserting an approval gate if required.

        If the tool requires approval, execution pauses until approve() or
        reject() is called externally (via the HTTP endpoint).

        Args:
            tool_call: dict with id, name, input keys.

        Returns:
            The tool result, or None if the action was rejected.
        """
        tool_name = tool_call["name"]
        tool_input = tool_call.get("input", {})

        await self._emit(
            EventType.TOOL_CALL,
            tool_name=tool_name,
            tool_input=tool_input,
        )

        if self.requires_approval(tool_name):
            action_id = str(uuid.uuid4())
            pending = PendingAction(
                action_id=action_id,
                tool_name=tool_name,
                tool_input=tool_input,
                description=f"Execute {tool_name} with: {tool_input}",
            )
            self._session.pending_actions[action_id] = pending
            self._session.status = SessionStatus.AWAITING_APPROVAL

            gate = asyncio.Event()
            self._approval_events[action_id] = gate

            await self._emit(
                EventType.APPROVAL_REQUIRED,
                tool_name=tool_name,
                tool_input=tool_input,
                action_id=action_id,
                action_description=pending.description,
            )

            # Block until a decision is recorded
            await gate.wait()
            del self._approval_events[action_id]
            self._session.status = SessionStatus.RUNNING

            action = self._session.pending_actions[action_id]
            approved = action.approved

            await self._emit(
                EventType.APPROVAL_RESOLVED,
                action_id=action_id,
                metadata={"approved": approved},
            )

            if not approved:
                return None

        # Execute the tool (stub - subclasses override _execute_tool)
        # Wrap in try/except so a single tool failure does not crash the whole run
        try:
            result = await self._execute_tool(tool_name, tool_input)
        except Exception as exc:
            err_msg = str(exc) or f"Tool {tool_name} failed with an unknown error"
            await self._emit(
                EventType.TOOL_RESULT,
                tool_name=tool_name,
                tool_result={"error": err_msg},
            )
            return {"error": err_msg}

        await self._emit(EventType.TOOL_RESULT, tool_name=tool_name, tool_result=result)
        return result

    async def _execute_tool(
        self, tool_name: str, tool_input: dict[str, Any]
    ) -> Any:
        """
        Execute a tool and return its result.

        Base implementation is a no-op stub that returns a placeholder.
        Subclasses should override this to call real APIs (Gmail, GitHub, etc.).

        Args:
            tool_name: The name of the tool to execute.
            tool_input: The structured input for the tool.

        Returns:
            Any: Tool execution result (stringified before sending to the LLM).
        """
        return f"[stub] {tool_name} executed with input: {tool_input}"

    # ------------------------------------------------------------------
    # Approval gate control (called by FastAPI endpoints)
    # ------------------------------------------------------------------

    def approve_action(self, action_id: str, reason: str | None = None) -> None:
        """
        Approve a pending action, releasing its gate.

        Args:
            action_id: The action_id from the APPROVAL_REQUIRED event.
            reason: Optional human-readable reason for approval.

        Raises:
            KeyError: If action_id is not a known pending action.
        """
        if action_id not in self._session.pending_actions:
            raise KeyError(f"Unknown action_id: {action_id}")
        self._session.pending_actions[action_id].approved = True
        if action_id in self._approval_events:
            self._approval_events[action_id].set()

    def reject_action(self, action_id: str, reason: str | None = None) -> None:
        """
        Reject a pending action, releasing its gate with a rejection signal.

        Args:
            action_id: The action_id from the APPROVAL_REQUIRED event.
            reason: Optional human-readable reason for rejection.

        Raises:
            KeyError: If action_id is not a known pending action.
        """
        if action_id not in self._session.pending_actions:
            raise KeyError(f"Unknown action_id: {action_id}")
        self._session.pending_actions[action_id].approved = False
        if action_id in self._approval_events:
            self._approval_events[action_id].set()

    # ------------------------------------------------------------------
    # Event emission
    # ------------------------------------------------------------------

    async def _emit(
        self,
        event_type: EventType,
        *,
        text: str | None = None,
        tool_name: str | None = None,
        tool_input: dict[str, Any] | None = None,
        tool_result: Any | None = None,
        action_id: str | None = None,
        action_description: str | None = None,
        error: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """
        Create an AgentEvent and append it to the session event log.

        Args:
            event_type: The type of event to emit.
            text: Optional text token for TEXT events.
            tool_name: Tool name for TOOL_CALL / TOOL_RESULT events.
            tool_input: Tool input dict for TOOL_CALL events.
            tool_result: Tool result for TOOL_RESULT events.
            action_id: Action ID for approval gate events.
            action_description: Human description for APPROVAL_REQUIRED events.
            error: Error message for ERROR events.
            metadata: Arbitrary key-value metadata.
        """
        event = AgentEvent(
            event_type=event_type,
            session_id=self._session.session_id,
            sequence=self._session.next_sequence(),
            text=text,
            tool_name=tool_name,
            tool_input=tool_input,
            tool_result=tool_result,
            action_id=action_id,
            action_description=action_description,
            error=error,
            metadata=metadata or {},
        )
        self._session.add_event(event)
        # Yield control so SSE consumers can pick up the event immediately
        await asyncio.sleep(0)
