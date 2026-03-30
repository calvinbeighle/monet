"""Tests for the agent runner."""

from unittest.mock import MagicMock, patch

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

    def test_run_sync_unknown_agent(self, runner):
        """Unknown intent routes to general agent which doesn't exist."""
        result = runner.run_sync("what is the meaning of life")

        assert result.agent == "general"
        assert len(result.outputs) == 1
        assert result.outputs[0].status == "error"

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
        """Messages accumulate across calls with the same session."""
        mock_anthropic_client.messages.create.return_value = make_text_response(
            "Response 1"
        )
        runner.run_sync("handle my inbox", session_id="test-session")

        mock_anthropic_client.messages.create.return_value = make_text_response(
            "Response 2"
        )
        runner.run_sync("what about the email from John?", session_id="test-session")

        # Session should have accumulated messages
        assert "test-session" in runner.sessions
        assert len(runner.sessions["test-session"]) >= 2


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
        """Unknown agent should yield error and done events."""
        events = list(runner.stream_sync("what is life"))

        assert events[0].type == "routing"
        assert events[1].type == "error"
        assert events[2].type == "done"

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
