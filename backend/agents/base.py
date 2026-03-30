"""
agents/base.py - Abstract base class for all Monet background agents.

Provides shared infrastructure for calling the Anthropic SDK (streaming and
non-streaming), running the agentic tool-use loop, and emitting AgentEvents.

Concrete agents extend this class and override `model`, `tools`,
and `_execute_tool`. All tool definitions must use Anthropic format
(input_schema, not parameters).

Agentic loop contract:
  - Send messages with tools to the model
  - If stop_reason == "tool_use", extract tool blocks, execute each, send
    tool_result blocks back, repeat
  - Loop until stop_reason == "end_turn" or max_rounds is reached
  - Tool results are added as {"type": "tool_result", "tool_use_id": id, ...}
    inside a user message (Anthropic format)
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from typing import Any, AsyncGenerator, Optional

import anthropic

import config
from models import AgentEvent, EventType, Suggestion


# Shared Anthropic client - initialized once at module load
_client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)


class BaseAgent(ABC):
    """
    Abstract base agent. Subclasses must implement `run` and `_execute_tool`.

    Provides:
    - `_chat_with_tools` - agentic loop that iterates tool calls until end_turn
    - `_chat_stream` - streaming conversational response (no tools)
    - `_emit` helper for constructing AgentEvent objects
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
        """Anthropic model identifier to use for this agent."""
        ...

    @property
    def tools(self) -> list[dict[str, Any]]:
        """
        Anthropic-format tool definitions to pass to the model.

        Each tool must have: name, description, input_schema.
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
            tool_input: The arguments for the tool (already parsed from JSON).

        Returns:
            Slim result data safe to pass back to the model as a string.
        """
        ...

    # --- Anthropic SDK Helpers ---

    async def _chat_with_tools(
        self,
        messages: list[dict[str, Any]],
        session_id: str,
        max_rounds: int = 5,
    ) -> AsyncGenerator[AgentEvent, None]:
        """
        Agentic loop that drives tool calls until the model reaches end_turn.

        Extracts system messages from the message list if present, then iterates:
          1. Call the model with current history and tools
          2. If stop_reason == "tool_use": execute each tool_use block,
             append assistant message + tool_result user message, repeat
          3. If stop_reason == "end_turn": yield the final text, stop

        Emits tool_call, tool_result, and text AgentEvents throughout.

        Args:
            messages: Initial conversation history. May include a system message
                      as the first entry with role="system".
            session_id: Session ID to tag all emitted events with.
            max_rounds: Maximum tool-call rounds before forcing a stop.

        Yields:
            AgentEvent objects for each step of the agentic loop.
        """
        # Extract system prompt if provided as a system-role message
        system_prompt: Optional[str] = None
        history: list[dict[str, Any]] = []
        for msg in messages:
            if msg.get("role") == "system":
                system_prompt = msg.get("content", "")
            else:
                history.append(msg)

        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": 1024,
            "messages": history,
        }
        if system_prompt:
            kwargs["system"] = system_prompt
        if self.tools:
            kwargs["tools"] = self.tools

        for _ in range(max_rounds):
            response = _client.messages.create(**kwargs)

            # Check if this round has tool_use blocks
            tool_use_blocks = [b for b in response.content if b.type == "tool_use"]

            if response.stop_reason == "tool_use" and tool_use_blocks:
                # Add the assistant's full response to history
                history.append({
                    "role": "assistant",
                    "content": _content_blocks_to_list(response.content),
                })

                # Execute each tool and collect results
                tool_results: list[dict[str, Any]] = []
                for block in tool_use_blocks:
                    tool_name = block.name
                    tool_input = block.input
                    tool_use_id = block.id

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

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": json.dumps(result) if not isinstance(result, str) else result,
                    })

                # Append tool results as a user message (Anthropic format)
                history.append({
                    "role": "user",
                    "content": tool_results,
                })

                # Update kwargs with new history for next round
                kwargs["messages"] = history
                continue

            # end_turn - yield all text content blocks and exit
            text_parts = [
                b.text for b in response.content
                if hasattr(b, "text") and b.text
            ]
            final_text = "".join(text_parts)
            yield self._emit(session_id, EventType.text, text=final_text)
            break

    async def _chat_stream(
        self,
        messages: list[dict[str, Any]],
        session_id: str,
    ) -> AsyncGenerator[AgentEvent, None]:
        """
        Streaming Anthropic completion that yields text AgentEvents token by token.

        Used for conversational responses where the model does NOT need tool calls.
        For tool-calling agents, use `_chat_with_tools` instead.

        Uses `client.messages.stream()` context manager for SSE streaming.

        Args:
            messages: Conversation history. May include a system-role entry first.
            session_id: Session ID to tag emitted events with.

        Yields:
            AgentEvent with event_type='text' for each streamed text delta.
        """
        system_prompt: Optional[str] = None
        history: list[dict[str, Any]] = []
        for msg in messages:
            if msg.get("role") == "system":
                system_prompt = msg.get("content", "")
            else:
                history.append(msg)

        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": 1024,
            "messages": history,
        }
        if system_prompt:
            kwargs["system"] = system_prompt

        with _client.messages.stream(**kwargs) as stream:
            for text_delta in stream.text_stream:
                if text_delta:
                    yield self._emit(session_id, EventType.text, text=text_delta)

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

def _content_blocks_to_list(content_blocks: list[Any]) -> list[dict[str, Any]]:
    """
    Converts Anthropic SDK content block objects to serializable dicts.

    Used when appending an assistant message back into the conversation history.
    Handles both text blocks and tool_use blocks.

    Args:
        content_blocks: List of Anthropic SDK ContentBlock objects.

    Returns:
        List of plain dicts suitable for the messages API.
    """
    result: list[dict[str, Any]] = []
    for block in content_blocks:
        if block.type == "text":
            result.append({"type": "text", "text": block.text})
        elif block.type == "tool_use":
            result.append({
                "type": "tool_use",
                "id": block.id,
                "name": block.name,
                "input": block.input,
            })
    return result
