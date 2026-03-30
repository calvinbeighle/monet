"""
agents/base.py - Abstract base class for all Monet background agents.

Provides shared infrastructure for calling OpenRouter (streaming and non-streaming),
tool execution dispatch, and event emission. Concrete agents extend this class
and override `model`, `tools`, and `_execute_tool`.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from typing import Any, AsyncGenerator, Optional

import httpx

import config
from models import AgentEvent, EventType, Suggestion


class BaseAgent(ABC):
    """
    Abstract base agent. Subclasses must implement `run` and `_execute_tool`.

    Provides:
    - `_chat_stream` for SSE-based streaming text generation
    - `_chat` for non-streaming tool call invocations
    - `_emit` helper for building AgentEvent objects
    """

    # --- Abstract Properties ---

    @property
    @abstractmethod
    def agent_id(self) -> str:
        """Unique identifier for this agent type."""
        ...

    @property
    @abstractmethod
    def model(self) -> str:
        """OpenRouter model identifier to use for this agent."""
        ...

    @property
    def tools(self) -> list[dict[str, Any]]:
        """
        OpenAI-format tool definitions to pass to the model.
        Override in subclasses to declare available tools.
        """
        return []

    # --- Abstract Methods ---

    @abstractmethod
    async def run(self, session_id: str) -> list[Suggestion]:
        """
        Execute the agent's primary task for a given session.

        Args:
            session_id: The ID of the active session.

        Returns:
            A list of Suggestion objects produced by this run.
        """
        ...

    @abstractmethod
    async def _execute_tool(self, tool_name: str, tool_input: dict[str, Any]) -> Any:
        """
        Dispatch a tool call to the appropriate integration.

        Args:
            tool_name: The name of the tool to execute.
            tool_input: The arguments for the tool.

        Returns:
            Slim result data safe to pass back to the model.
        """
        ...

    # --- OpenRouter Helpers ---

    async def _chat(
        self,
        messages: list[dict[str, Any]],
        max_tokens: int = 1024,
    ) -> dict[str, Any]:
        """
        Non-streaming OpenRouter completion for tool call handling.

        Handles one round of model inference and returns the raw response dict.
        Does NOT auto-execute tool calls - the caller must loop if needed.

        Args:
            messages: The conversation history in OpenAI chat format.
            max_tokens: Maximum tokens for the completion.

        Returns:
            The parsed JSON response from OpenRouter.

        Raises:
            httpx.HTTPStatusError: If the OpenRouter request fails.
        """
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
        }

        if self.tools:
            payload["tools"] = self.tools
            payload["tool_choice"] = "auto"

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                config.OPENROUTER_BASE_URL,
                headers=_build_headers(),
                json=payload,
            )
            response.raise_for_status()
            return response.json()

    async def _chat_with_tools(
        self,
        messages: list[dict[str, Any]],
        session_id: str,
        max_rounds: int = 5,
    ) -> AsyncGenerator[AgentEvent, None]:
        """
        Agentic loop that iterates tool calls until the model produces a final answer.

        Emits AgentEvents for tool_call, tool_result, and final text. Stops when
        the model produces a non-tool-call message or max_rounds is reached.

        Args:
            messages: Initial conversation history.
            session_id: Session ID to tag events with.
            max_rounds: Maximum tool call rounds before stopping.

        Yields:
            AgentEvent objects for each step of the loop.
        """
        history = list(messages)

        for _ in range(max_rounds):
            response = await self._chat(history)
            choice = response["choices"][0]
            message = choice["message"]
            finish_reason = choice.get("finish_reason", "stop")

            # Tool call round
            if finish_reason == "tool_calls" or message.get("tool_calls"):
                history.append(message)
                for tool_call in message.get("tool_calls", []):
                    fn = tool_call["function"]
                    tool_name = fn["name"]
                    tool_input = json.loads(fn.get("arguments", "{}"))
                    tool_call_id = tool_call["id"]

                    yield self._emit(
                        session_id,
                        EventType.tool_call,
                        tool_name=tool_name,
                        tool_input=tool_input,
                    )

                    result = await self._execute_tool(tool_name, tool_input)

                    yield self._emit(
                        session_id,
                        EventType.tool_result,
                        tool_name=tool_name,
                        tool_result=result,
                    )

                    history.append({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": json.dumps(result),
                    })
                continue

            # Final text response
            content = message.get("content") or ""
            yield self._emit(session_id, EventType.text, text=content)
            break

    async def _chat_stream(
        self,
        messages: list[dict[str, Any]],
        session_id: str,
    ) -> AsyncGenerator[AgentEvent, None]:
        """
        Streaming OpenRouter completion that yields text AgentEvents token by token.

        Used for conversational responses where the model does NOT need tool calls.
        For tool-calling agents, use `_chat_with_tools` instead.

        Args:
            messages: Conversation history in OpenAI chat format.
            session_id: Session ID to tag events with.

        Yields:
            AgentEvent with event_type='text' for each streamed chunk.

        Raises:
            httpx.HTTPStatusError: If the OpenRouter request fails.
        """
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": True,
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                config.OPENROUTER_BASE_URL,
                headers=_build_headers(),
                json=payload,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    raw = line[len("data: "):]
                    if raw.strip() == "[DONE]":
                        break
                    try:
                        chunk = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    delta = chunk["choices"][0].get("delta", {})
                    token = delta.get("content")
                    if token:
                        yield self._emit(session_id, EventType.text, text=token)

    # --- Event Helper ---

    def _emit(
        self,
        session_id: str,
        event_type: EventType,
        *,
        text: Optional[str] = None,
        tool_name: Optional[str] = None,
        tool_input: Optional[dict[str, Any]] = None,
        tool_result: Optional[Any] = None,
        error: Optional[str] = None,
    ) -> AgentEvent:
        """
        Constructs an AgentEvent with this agent's session context.

        Args:
            session_id: ID of the current session.
            event_type: The SSE event type to emit.
            text: Text content (for 'text' events).
            tool_name: Tool name (for 'tool_call'/'tool_result' events).
            tool_input: Tool arguments (for 'tool_call' events).
            tool_result: Tool output (for 'tool_result' events).
            error: Error message (for 'error' events).

        Returns:
            A populated AgentEvent instance.
        """
        return AgentEvent(
            eventType=event_type,
            sessionId=session_id,
            text=text,
            toolName=tool_name,
            toolInput=tool_input,
            toolResult=tool_result,
            error=error,
        )


# --- Internal Helpers ---

def _build_headers() -> dict[str, str]:
    """
    Builds the HTTP headers required for OpenRouter API requests.

    Returns:
        Dict with Authorization and content-type headers.
    """
    return {
        "Authorization": f"Bearer {config.OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://monet.app",
        "X-Title": "Monet",
    }
