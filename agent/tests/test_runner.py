"""Tests for the agent runner."""

from unittest.mock import MagicMock, patch

import anthropic

from agent.models import AgentOutput, UIPattern
from agent.tests.conftest import (
    MockContentBlock,
    MockResponse,
    make_text_response,
    make_tool_response,
)


class TestAgentRunnerSync:
    def test_run_sync_text_response(self, runner, mock_anthropic_client):
        """Agent returns text without tool calls."""
        mock_anthropic_client.messages.create.return_value = make_text_response(
            "I've reviewed your inbox. You have 3 new emails."
        )

        result = runner.run_sync("handle my inbox")

        assert result.agent == "email"
        assert result.ui_pattern == UIPattern.TINDER.value
        assert len(result.outputs) == 1
        assert "3 new emails" in result.outputs[0].content

    def test_run_sync_general_agent(self, runner, mock_anthropic_client):
        """Unknown intent routes to general agent which handles it conversationally."""
        mock_anthropic_client.messages.create.return_value = make_text_response(
            "The meaning of life is a philosophical question that has been debated for centuries."
        )

        result = runner.run_sync("what is the meaning of life")

        assert result.agent == "general"
        assert result.ui_pattern == "chat"
        assert len(result.outputs) == 1
        assert "philosophical" in result.outputs[0].content

    def test_run_sync_planning_agent(self, runner, mock_anthropic_client):
        """Planning intent routes to planning agent with whiteboard pattern."""
        mock_anthropic_client.messages.create.return_value = make_text_response(
            "Here is your sprint plan with 3 key milestones."
        )

        result = runner.run_sync("plan the next sprint")

        assert result.agent == "planning"
        assert result.ui_pattern == UIPattern.WHITEBOARD.value
        assert len(result.outputs) == 1
        assert "sprint plan" in result.outputs[0].content

    def test_run_sync_tool_call_without_approval(self, runner, mock_anthropic_client):
        """Agent makes a tool call that doesn't need approval."""
        # First call: agent wants to use list_inbox
        tool_response = make_tool_response(
            "list_inbox",
            {"max_results": 10},
            text="Let me check your inbox.",
        )
        # Second call: agent gives final text response
        text_response = make_text_response("You have 5 unread emails.")

        mock_anthropic_client.messages.create.side_effect = [
            tool_response,
            text_response,
        ]

        # Mock the email agent's execute_tool
        email_agent = runner.agents["email"]
        original_execute = email_agent.execute_tool
        email_agent.execute_tool = MagicMock(return_value='{"messages": []}')

        result = runner.run_sync("handle my inbox")

        assert result.agent == "email"
        assert len(result.outputs) >= 1
        email_agent.execute_tool.assert_called_once_with(
            "list_inbox", {"max_results": 10}
        )

        email_agent.execute_tool = original_execute

    def test_run_sync_tool_call_with_approval_approved(
        self, runner, mock_anthropic_client, approval_gate
    ):
        """Agent makes a tool call requiring approval, user approves."""
        import threading

        tool_response = make_tool_response(
            "send_email", {"to": "test@example.com", "subject": "Hi", "body": "Hello"}
        )
        text_response = make_text_response("Email sent successfully.")

        mock_anthropic_client.messages.create.side_effect = [
            tool_response,
            text_response,
        ]

        email_agent = runner.agents["email"]
        original_execute = email_agent.execute_tool
        email_agent.execute_tool = MagicMock(return_value='{"status": "sent"}')

        # Auto-approve in a background thread
        def auto_approve():
            import time

            for _ in range(50):
                time.sleep(0.05)
                pending = approval_gate.list_pending()
                if pending:
                    approval_gate.approve(pending[0].id)
                    return

        thread = threading.Thread(target=auto_approve)
        thread.start()

        result = runner.run_sync("send email to test@example.com")

        thread.join(timeout=5)

        assert result.agent == "email"
        # Should have the approval pending output and tool execution
        approval_outputs = [o for o in result.outputs if o.status == "pending_approval"]
        assert len(approval_outputs) == 1

        email_agent.execute_tool = original_execute

    def test_run_sync_tool_call_with_approval_rejected(
        self, runner, mock_anthropic_client, approval_gate
    ):
        """Agent makes a tool call requiring approval, user rejects."""
        import threading

        tool_response = make_tool_response(
            "send_email", {"to": "test@example.com", "subject": "Hi", "body": "Hello"}
        )
        text_response = make_text_response("Understood, I won't send the email.")

        mock_anthropic_client.messages.create.side_effect = [
            tool_response,
            text_response,
        ]

        # Auto-reject in a background thread
        def auto_reject():
            import time

            for _ in range(50):
                time.sleep(0.05)
                pending = approval_gate.list_pending()
                if pending:
                    approval_gate.reject(pending[0].id)
                    return

        thread = threading.Thread(target=auto_reject)
        thread.start()

        result = runner.run_sync("send email to test@example.com")

        thread.join(timeout=5)

        assert result.agent == "email"
        # The email agent's execute_tool should NOT have been called for send_email
        # since it was rejected

    def test_session_continuity(self, runner, mock_anthropic_client):
        """Messages accumulate across calls with the same session, persisted to SQLite."""
        mock_anthropic_client.messages.create.return_value = make_text_response(
            "Response 1"
        )
        runner.run_sync("handle my inbox", session_id="test-session")

        mock_anthropic_client.messages.create.return_value = make_text_response(
            "Response 2"
        )
        runner.run_sync("what about the email from John?", session_id="test-session")

        # Session should have accumulated messages in cache and SQLite
        assert "test-session" in runner._session_cache
        assert len(runner._session_cache["test-session"]) >= 2

        # Messages should also be persisted in SQLite
        stored = runner.session_store.get_messages("test-session")
        assert len(stored) >= 2


class TestAgentRunnerStream:
    def test_stream_yields_routing_event(self, runner, mock_anthropic_client):
        """Stream should yield a routing event first."""
        # Mock the streaming context manager
        mock_stream = MagicMock()
        mock_stream.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream.__exit__ = MagicMock(return_value=False)
        mock_stream.__iter__ = MagicMock(return_value=iter([]))
        mock_stream.get_final_message.return_value = MockResponse(
            content=[MockContentBlock(type="text", text="done")]
        )

        mock_anthropic_client.messages.stream.return_value = mock_stream

        events = list(runner.stream_sync("handle my inbox"))

        assert events[0].type == "routing"
        assert events[0].metadata["agent"] == "email"
        assert events[0].metadata["ui_pattern"] == UIPattern.TINDER.value

    def test_stream_unknown_agent_yields_error(self, runner):
        """Removed agent from registry should yield error and done events."""
        # Remove the general agent to simulate an unregistered agent name
        del runner.agents["general"]

        events = list(runner.stream_sync("what is life"))

        assert events[0].type == "routing"
        assert events[1].type == "error"
        assert events[2].type == "done"

        # Restore for other tests
        from agent.agents.general import GeneralAgent

        runner.agents["general"] = GeneralAgent()

    def test_stream_yields_done_event(self, runner, mock_anthropic_client):
        """Stream should always end with a done event."""
        mock_stream = MagicMock()
        mock_stream.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream.__exit__ = MagicMock(return_value=False)
        mock_stream.__iter__ = MagicMock(return_value=iter([]))
        mock_stream.get_final_message.return_value = MockResponse(
            content=[MockContentBlock(type="text", text="done")]
        )

        mock_anthropic_client.messages.stream.return_value = mock_stream

        events = list(runner.stream_sync("handle my inbox"))

        assert events[-1].type == "done"

    def test_stream_done_includes_suggestions(self, runner, mock_anthropic_client):
        """Done event should include agent-specific follow-up suggestions."""
        mock_stream = MagicMock()
        mock_stream.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream.__exit__ = MagicMock(return_value=False)
        mock_stream.__iter__ = MagicMock(return_value=iter([]))
        mock_stream.get_final_message.return_value = MockResponse(
            content=[MockContentBlock(type="text", text="Here are your emails.")]
        )
        mock_anthropic_client.messages.stream.return_value = mock_stream

        events = list(runner.stream_sync("handle my inbox"))
        done_event = events[-1]

        assert done_event.type == "done"
        assert "suggestions" in done_event.metadata
        assert isinstance(done_event.metadata["suggestions"], list)
        assert len(done_event.metadata["suggestions"]) > 0

    def test_stream_general_agent(self, runner, mock_anthropic_client):
        """General intent streams through the general agent."""
        mock_stream = MagicMock()
        mock_stream.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream.__exit__ = MagicMock(return_value=False)
        mock_stream.__iter__ = MagicMock(return_value=iter([]))
        mock_stream.get_final_message.return_value = MockResponse(
            content=[MockContentBlock(type="text", text="I can help with that.")]
        )

        mock_anthropic_client.messages.stream.return_value = mock_stream

        events = list(runner.stream_sync("hello there"))

        assert events[0].type == "routing"
        assert events[0].metadata["agent"] == "general"
        assert events[0].metadata["ui_pattern"] == "chat"
        assert events[-1].type == "done"


class TestAgentRunnerErrorHandling:
    """Tests for error handling in the agent runner."""

    def test_run_sync_auth_error(self, runner, mock_anthropic_client):
        """Authentication error returns error output."""
        mock_anthropic_client.messages.create.side_effect = (
            anthropic.AuthenticationError(
                message="Invalid API key",
                response=MagicMock(status_code=401),
                body={"error": {"message": "Invalid API key"}},
            )
        )

        result = runner.run_sync("handle my inbox")

        error_outputs = [o for o in result.outputs if o.status == "error"]
        assert len(error_outputs) == 1
        assert "authentication" in error_outputs[0].content.lower()
        assert error_outputs[0].metadata["error_type"] == "auth_error"
        assert error_outputs[0].metadata["retryable"] is False

    def test_run_sync_rate_limit_error(self, runner, mock_anthropic_client):
        """Rate limit error returns retryable error output."""
        mock_anthropic_client.messages.create.side_effect = anthropic.RateLimitError(
            message="Rate limit exceeded",
            response=MagicMock(status_code=429),
            body={"error": {"message": "Rate limit exceeded"}},
        )

        result = runner.run_sync("handle my inbox")

        error_outputs = [o for o in result.outputs if o.status == "error"]
        assert len(error_outputs) == 1
        assert "rate limit" in error_outputs[0].content.lower()
        assert error_outputs[0].metadata["retryable"] is True

    def test_run_sync_connection_error(self, runner, mock_anthropic_client):
        """Connection error returns retryable error output."""
        mock_anthropic_client.messages.create.side_effect = (
            anthropic.APIConnectionError(request=MagicMock())
        )

        result = runner.run_sync("handle my inbox")

        error_outputs = [o for o in result.outputs if o.status == "error"]
        assert len(error_outputs) == 1
        assert "connect" in error_outputs[0].content.lower()
        assert error_outputs[0].metadata["retryable"] is True

    def test_run_sync_tool_execution_error(self, runner, mock_anthropic_client):
        """Tool execution error is caught and fed back to Claude."""
        tool_response = make_tool_response("list_inbox", {"max_results": 10})
        text_response = make_text_response("Sorry, I could not access your inbox.")

        mock_anthropic_client.messages.create.side_effect = [
            tool_response,
            text_response,
        ]

        email_agent = runner.agents["email"]
        original_execute = email_agent.execute_tool
        email_agent.execute_tool = MagicMock(
            side_effect=Exception("Connection refused")
        )

        result = runner.run_sync("handle my inbox")

        # The agent should still complete (Claude gets the error and responds)
        assert result.agent == "email"
        assert any("could not access" in o.content.lower() for o in result.outputs)

        email_agent.execute_tool = original_execute

    def test_run_sync_tool_oauth_error(self, runner, mock_anthropic_client):
        """OAuth error during tool execution is detected and reported."""
        tool_response = make_tool_response("list_inbox", {"max_results": 10})
        text_response = make_text_response("Please reconnect your Gmail.")

        mock_anthropic_client.messages.create.side_effect = [
            tool_response,
            text_response,
        ]

        email_agent = runner.agents["email"]
        original_execute = email_agent.execute_tool
        email_agent.execute_tool = MagicMock(
            side_effect=Exception("HTTP 401 Unauthorized")
        )

        result = runner.run_sync("handle my inbox")

        # Should have an OAuth error output
        oauth_errors = [
            o
            for o in result.outputs
            if o.status == "error" and o.metadata.get("error_type") == "oauth_expired"
        ]
        assert len(oauth_errors) == 1

        email_agent.execute_tool = original_execute

    def test_stream_auth_error(self, runner, mock_anthropic_client):
        """Authentication error during streaming yields error event."""
        mock_anthropic_client.messages.stream.side_effect = (
            anthropic.AuthenticationError(
                message="Invalid API key",
                response=MagicMock(status_code=401),
                body={"error": {"message": "Invalid API key"}},
            )
        )

        events = list(runner.stream_sync("handle my inbox"))

        error_events = [e for e in events if e.type == "error"]
        assert len(error_events) == 1
        assert "authentication" in error_events[0].data.lower()
        # Stream should still end with done
        assert events[-1].type == "done"

    def test_stream_connection_error(self, runner, mock_anthropic_client):
        """Connection error during streaming yields retryable error event."""
        mock_anthropic_client.messages.stream.side_effect = (
            anthropic.APIConnectionError(request=MagicMock())
        )

        events = list(runner.stream_sync("handle my inbox"))

        error_events = [e for e in events if e.type == "error"]
        assert len(error_events) == 1
        assert error_events[0].metadata.get("retryable") is True
        assert events[-1].type == "done"


class TestPlanningFlowIntegration:
    """Tests for the full planning flow - intent to whiteboard nodes."""

    def test_run_sync_planning_includes_node_data(self, runner, mock_anthropic_client):
        """Planning agent run_sync should include node data in outputs."""
        import json

        # First call: agent uses create_node tool
        tool_response = make_tool_response(
            "create_node",
            {
                "title": "Goal 1",
                "body": "Main objective",
                "x": 100,
                "y": 100,
                "priority": "high",
            },
        )
        # Second call: agent responds with text
        text_response = make_text_response("I've created your plan.")

        mock_anthropic_client.messages.create.side_effect = [
            tool_response,
            text_response,
        ]

        result = runner.run_sync("plan the next sprint")

        assert result.agent == "planning"
        assert result.ui_pattern == "whiteboard"
        # Should have outputs including node data
        node_outputs = [o for o in result.outputs if o.metadata.get("id")]
        assert len(node_outputs) == 1
        assert node_outputs[0].metadata["title"] == "Goal 1"
        assert node_outputs[0].metadata["priority"] == "high"

    def test_stream_planning_emits_whiteboard_updates(
        self, runner, mock_anthropic_client
    ):
        """Streaming planning should emit whiteboard_update events after tool calls."""
        import json

        # Mock streaming with tool calls
        mock_stream = MagicMock()
        mock_stream.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream.__exit__ = MagicMock(return_value=False)

        # Simulate create_node tool call in stream events
        mock_events = [
            MagicMock(
                type="content_block_start",
                content_block=MockContentBlock(
                    type="tool_use", id="tool_1", name="create_node"
                ),
            ),
            MagicMock(
                type="content_block_delta",
                delta=MagicMock(
                    text=None,
                    partial_json='{"title": "Sprint Goal", "x": 200, "y": 100, "priority": "high"}',
                    **{"__class__.__name__": "Delta"},
                ),
            ),
            MagicMock(type="content_block_stop"),
        ]
        # Remove text attr from delta to avoid hasattr confusion
        del mock_events[1].delta.text
        mock_stream.__iter__ = MagicMock(return_value=iter(mock_events))

        # Final message with tool use block
        final_content = [
            MockContentBlock(
                type="tool_use",
                id="tool_1",
                name="create_node",
                input={"title": "Sprint Goal", "x": 200, "y": 100, "priority": "high"},
            )
        ]
        mock_stream.get_final_message.return_value = MockResponse(content=final_content)

        # Second round: text response (no tool calls)
        mock_stream2 = MagicMock()
        mock_stream2.__enter__ = MagicMock(return_value=mock_stream2)
        mock_stream2.__exit__ = MagicMock(return_value=False)
        mock_stream2.__iter__ = MagicMock(return_value=iter([]))
        mock_stream2.get_final_message.return_value = MockResponse(
            content=[MockContentBlock(type="text", text="Plan created.")]
        )

        mock_anthropic_client.messages.stream.side_effect = [mock_stream, mock_stream2]

        events = list(runner.stream_sync("plan the sprint"))

        # Should have routing, tool_call, whiteboard_update, done events
        event_types = [e.type for e in events]
        assert "routing" in event_types
        assert "tool_call" in event_types
        assert "whiteboard_update" in event_types
        assert "done" in event_types

        # whiteboard_update should contain node data
        wb_events = [e for e in events if e.type == "whiteboard_update"]
        assert len(wb_events) >= 1
        nodes = wb_events[-1].metadata["nodes"]
        assert len(nodes) == 1
        assert nodes[0]["title"] == "Sprint Goal"
        assert nodes[0]["priority"] == "high"

    def test_stream_planning_done_includes_node_data(
        self, runner, mock_anthropic_client
    ):
        """Planning stream done event should include final node state in outputs."""
        # Simple: no tool calls, just text (nodes stay empty)
        mock_stream = MagicMock()
        mock_stream.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream.__exit__ = MagicMock(return_value=False)
        mock_stream.__iter__ = MagicMock(return_value=iter([]))
        mock_stream.get_final_message.return_value = MockResponse(
            content=[MockContentBlock(type="text", text="I'll plan your sprint.")]
        )
        mock_anthropic_client.messages.stream.return_value = mock_stream

        events = list(runner.stream_sync("plan the sprint"))

        done_event = events[-1]
        assert done_event.type == "done"
        assert done_event.metadata["agent"] == "planning"
        assert done_event.metadata["ui_pattern"] == "whiteboard"
        # Outputs should be the node list (empty since no tool calls)
        assert isinstance(done_event.metadata["outputs"], list)


class TestPlanningAgentSessionIsolation:
    """Tests that planning agent state is isolated per session."""

    def test_per_session_node_isolation(self, runner, mock_anthropic_client):
        """Nodes created in one session should not appear in another."""
        planning_agent = runner.agents["planning"]

        # Simulate session 1
        planning_agent.set_session("session-1")
        planning_agent.execute_tool("create_node", {"title": "Session 1 Node"})

        # Simulate session 2
        planning_agent.set_session("session-2")
        planning_agent.execute_tool("create_node", {"title": "Session 2 Node"})

        # Check session 1 only has its node
        planning_agent.set_session("session-1")
        import json

        plan1 = json.loads(planning_agent.execute_tool("get_plan", {}))
        assert plan1["count"] == 1
        assert plan1["nodes"][0]["title"] == "Session 1 Node"

        # Check session 2 only has its node
        planning_agent.set_session("session-2")
        plan2 = json.loads(planning_agent.execute_tool("get_plan", {}))
        assert plan2["count"] == 1
        assert plan2["nodes"][0]["title"] == "Session 2 Node"

    def test_session_state_persists_across_set_session_calls(self, runner):
        """Setting session back should restore previous state."""
        planning_agent = runner.agents["planning"]
        import json

        planning_agent.set_session("s1")
        planning_agent.execute_tool("create_node", {"title": "A"})
        planning_agent.execute_tool("create_node", {"title": "B"})

        planning_agent.set_session("s2")
        planning_agent.execute_tool("create_node", {"title": "C"})

        # Switch back to s1
        planning_agent.set_session("s1")
        plan = json.loads(planning_agent.execute_tool("get_plan", {}))
        assert plan["count"] == 2
        titles = {n["title"] for n in plan["nodes"]}
        assert titles == {"A", "B"}

    def test_runner_sets_session_on_planning_agent(self, runner, mock_anthropic_client):
        """Runner should call set_session on the planning agent before executing."""
        mock_anthropic_client.messages.create.return_value = make_text_response(
            "Here is your plan."
        )

        runner.run_sync("plan the sprint", session_id="my-session")

        planning_agent = runner.agents["planning"]
        assert planning_agent._current_session == "my-session"
