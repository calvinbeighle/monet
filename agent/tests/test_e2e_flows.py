"""End-to-end flow tests - prove the full intent -> agent -> UI -> approve -> execute chains.

These tests verify the complete flows described in Phase 3 of the implementation plan:
- Task 13: Email Single Reply (Chat UI)
- Task 14: Email Batch Inbox (Tinder UI)
- Task 15: Code PR Review (Diff UI)

Each test mocks Claude API responses to simulate realistic multi-tool-call agent loops
and verifies that the runner produces the correct events/outputs for the Flutter shell.
"""

import json
import threading
from unittest.mock import MagicMock

from agent.models import AgentOutput, ApprovalStatus, UIPattern
from agent.tests.conftest import (
    MockContentBlock,
    MockResponse,
    make_text_response,
    make_tool_response,
)


class TestEmailSingleReplyFlow:
    """Task 13: 'Reply to John's email' -> Chat UI -> read -> draft -> approve -> send."""

    def test_routes_to_email_chat(self, runner, mock_anthropic_client):
        """Single email reply intent routes to email agent with chat UI."""
        mock_anthropic_client.messages.create.return_value = make_text_response(
            "I'll help you reply."
        )
        result = runner.run_sync("reply to John's email")
        assert result.agent == "email"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_read_then_draft_tool_chain(self, runner, mock_anthropic_client):
        """Agent reads the email then drafts a reply - two sequential tool calls."""
        # Round 1: Agent calls read_email
        read_response = make_tool_response(
            "read_email",
            {"message_id": "msg_123"},
            text="Let me read John's email first.",
        )
        # Round 2: Agent calls draft_reply after reading
        draft_response = make_tool_response(
            "draft_reply",
            {"message_id": "msg_123", "body": "Hi John, thanks for your email."},
            text="I've drafted a reply.",
        )
        # Round 3: Agent presents the draft and asks for approval via send_email
        send_response = make_tool_response(
            "send_email",
            {
                "to": "john@example.com",
                "subject": "Re: Meeting",
                "body": "Hi John, thanks for your email.",
            },
            text="Here's the draft. Shall I send it?",
        )
        # Round 4: After approval, agent confirms
        final_response = make_text_response("Email sent to John.")

        mock_anthropic_client.messages.create.side_effect = [
            read_response,
            draft_response,
            send_response,
            final_response,
        ]

        email_agent = runner.agents["email"]
        original_execute = email_agent.execute_tool
        call_log = []

        def mock_execute(tool_name, params):
            call_log.append(tool_name)
            if tool_name == "read_email":
                return json.dumps(
                    {
                        "id": "msg_123",
                        "subject": "Meeting",
                        "from": "john@example.com",
                        "body": "Can we meet tomorrow?",
                    }
                )
            elif tool_name == "draft_reply":
                return json.dumps({"draft_id": "draft_456", "status": "created"})
            elif tool_name == "send_email":
                return json.dumps({"status": "sent", "message_id": "msg_789"})
            return json.dumps({"error": f"unexpected tool: {tool_name}"})

        email_agent.execute_tool = mock_execute

        # Auto-approve send_email in background
        def auto_approve():
            import time

            for _ in range(100):
                time.sleep(0.02)
                pending = runner.approval_gate.list_pending()
                if pending:
                    runner.approval_gate.approve(pending[0].id)
                    return

        thread = threading.Thread(target=auto_approve)
        thread.start()

        result = runner.run_sync("reply to John's email")
        thread.join(timeout=5)

        # Verify tool call order: read -> draft -> send
        assert call_log == ["read_email", "draft_reply", "send_email"]
        assert result.agent == "email"

        # Should have an approval_pending output for send_email
        approval_outputs = [o for o in result.outputs if o.status == "pending_approval"]
        assert len(approval_outputs) == 1
        assert approval_outputs[0].metadata["tool_name"] == "send_email"

        email_agent.execute_tool = original_execute

    def test_stream_emits_approval_for_send(self, runner, mock_anthropic_client):
        """Streaming single reply emits approval_request event for send_email."""
        # Round 1: tool call to send_email (simplified - skip read/draft for this test)
        mock_stream = MagicMock()
        mock_stream.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream.__exit__ = MagicMock(return_value=False)

        stream_events = [
            MagicMock(
                type="content_block_start",
                content_block=MockContentBlock(
                    type="tool_use", id="tool_1", name="send_email"
                ),
            ),
            MagicMock(
                type="content_block_delta",
                delta=MagicMock(
                    partial_json='{"to":"john@example.com","subject":"Re: Meeting","body":"Thanks John!"}',
                ),
            ),
            MagicMock(type="content_block_stop"),
        ]
        del stream_events[1].delta.text
        mock_stream.__iter__ = MagicMock(return_value=iter(stream_events))
        mock_stream.get_final_message.return_value = MockResponse(
            content=[
                MockContentBlock(
                    type="tool_use",
                    id="tool_1",
                    name="send_email",
                    input={
                        "to": "john@example.com",
                        "subject": "Re: Meeting",
                        "body": "Thanks John!",
                    },
                )
            ]
        )

        # Round 2: final text
        mock_stream2 = MagicMock()
        mock_stream2.__enter__ = MagicMock(return_value=mock_stream2)
        mock_stream2.__exit__ = MagicMock(return_value=False)
        mock_stream2.__iter__ = MagicMock(return_value=iter([]))
        mock_stream2.get_final_message.return_value = MockResponse(
            content=[MockContentBlock(type="text", text="Sent!")]
        )

        mock_anthropic_client.messages.stream.side_effect = [mock_stream, mock_stream2]

        # Auto-approve
        def auto_approve():
            import time

            for _ in range(100):
                time.sleep(0.02)
                pending = runner.approval_gate.list_pending()
                if pending:
                    runner.approval_gate.approve(pending[0].id)
                    return

        thread = threading.Thread(target=auto_approve)
        thread.start()

        email_agent = runner.agents["email"]
        original_execute = email_agent.execute_tool
        email_agent.execute_tool = MagicMock(return_value='{"status": "sent"}')

        events = list(runner.stream_sync("reply to John's email"))
        thread.join(timeout=5)

        event_types = [e.type for e in events]
        assert "routing" in event_types
        assert "tool_call" in event_types
        assert "approval_request" in event_types
        assert "done" in event_types

        # approval_request should have send_email parameters
        approval_events = [e for e in events if e.type == "approval_request"]
        assert len(approval_events) == 1
        assert approval_events[0].data == "send_email"
        assert approval_events[0].metadata["parameters"]["to"] == "john@example.com"

        email_agent.execute_tool = original_execute

    def test_rejected_send_skips_execution(self, runner, mock_anthropic_client):
        """When user rejects send_email, the tool is not executed."""
        send_response = make_tool_response(
            "send_email",
            {"to": "john@example.com", "subject": "Re: Hi", "body": "Hello"},
        )
        final_response = make_text_response("OK, I won't send it.")

        mock_anthropic_client.messages.create.side_effect = [
            send_response,
            final_response,
        ]

        email_agent = runner.agents["email"]
        original_execute = email_agent.execute_tool
        email_agent.execute_tool = MagicMock(return_value='{"status": "sent"}')

        def auto_reject():
            import time

            for _ in range(100):
                time.sleep(0.02)
                pending = runner.approval_gate.list_pending()
                if pending:
                    runner.approval_gate.reject(pending[0].id)
                    return

        thread = threading.Thread(target=auto_reject)
        thread.start()

        result = runner.run_sync("send email to John")
        thread.join(timeout=5)

        # send_email should NOT have been called (rejected)
        email_agent.execute_tool.assert_not_called()
        email_agent.execute_tool = original_execute


class TestEmailBatchInboxFlow:
    """Task 14: 'Handle my inbox' -> Tinder UI -> list -> read -> draft -> approve per email."""

    def test_routes_to_email_tinder(self, runner, mock_anthropic_client):
        """Batch inbox intent routes to email agent with tinder UI."""
        mock_anthropic_client.messages.create.return_value = make_text_response(
            "Checking your inbox."
        )
        result = runner.run_sync("handle my inbox")
        assert result.agent == "email"
        assert result.ui_pattern == UIPattern.TINDER.value

    def test_batch_produces_multiple_approval_requests(
        self, runner, mock_anthropic_client
    ):
        """Batch flow produces one approval_request per email send."""
        # Round 1: list_inbox
        list_response = make_tool_response(
            "list_inbox",
            {"max_results": 10, "unread_only": True},
            text="Let me check your inbox.",
        )
        # Round 2: send_email for first email (approval needed)
        send1_response = make_tool_response(
            "send_email",
            {
                "to": "alice@example.com",
                "subject": "Re: Project update",
                "body": "Thanks Alice!",
            },
            tool_id="tool_send1",
        )
        # Round 3: send_email for second email (approval needed)
        send2_response = make_tool_response(
            "send_email",
            {"to": "bob@example.com", "subject": "Re: Lunch", "body": "Sounds good!"},
            tool_id="tool_send2",
        )
        final_response = make_text_response("All done! 2 emails processed.")

        mock_anthropic_client.messages.create.side_effect = [
            list_response,
            send1_response,
            send2_response,
            final_response,
        ]

        email_agent = runner.agents["email"]
        original_execute = email_agent.execute_tool

        def mock_execute(tool_name, params):
            if tool_name == "list_inbox":
                return json.dumps(
                    {
                        "messages": [
                            {
                                "id": "msg_1",
                                "subject": "Project update",
                                "from": "alice@example.com",
                            },
                            {
                                "id": "msg_2",
                                "subject": "Lunch",
                                "from": "bob@example.com",
                            },
                        ]
                    }
                )
            elif tool_name == "send_email":
                return json.dumps({"status": "sent"})
            return json.dumps({"error": f"unexpected: {tool_name}"})

        email_agent.execute_tool = mock_execute

        # Auto-approve all pending approvals
        approvals_seen = []

        def auto_approve_all():
            import time

            for _ in range(200):
                time.sleep(0.02)
                pending = runner.approval_gate.list_pending()
                for p in pending:
                    if p.id not in approvals_seen:
                        approvals_seen.append(p.id)
                        runner.approval_gate.approve(p.id)

        thread = threading.Thread(target=auto_approve_all)
        thread.start()

        result = runner.run_sync("handle my inbox")
        thread.join(timeout=10)

        # Should have 2 approval outputs (one per email send)
        approval_outputs = [o for o in result.outputs if o.status == "pending_approval"]
        assert len(approval_outputs) == 2
        assert approval_outputs[0].metadata["tool_name"] == "send_email"
        assert approval_outputs[1].metadata["tool_name"] == "send_email"

        email_agent.execute_tool = original_execute

    def test_stream_batch_emits_approval_per_email(self, runner, mock_anthropic_client):
        """Streaming batch inbox emits separate approval_request events per email."""
        # Simplified: one stream round with send_email tool call
        mock_stream = MagicMock()
        mock_stream.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream.__exit__ = MagicMock(return_value=False)

        stream_events = [
            MagicMock(
                type="content_block_start",
                content_block=MockContentBlock(
                    type="tool_use", id="tool_1", name="send_email"
                ),
            ),
            MagicMock(
                type="content_block_delta",
                delta=MagicMock(
                    partial_json='{"to":"alice@example.com","subject":"Re: Update","body":"Thanks!"}',
                ),
            ),
            MagicMock(type="content_block_stop"),
        ]
        del stream_events[1].delta.text
        mock_stream.__iter__ = MagicMock(return_value=iter(stream_events))
        mock_stream.get_final_message.return_value = MockResponse(
            content=[
                MockContentBlock(
                    type="tool_use",
                    id="tool_1",
                    name="send_email",
                    input={
                        "to": "alice@example.com",
                        "subject": "Re: Update",
                        "body": "Thanks!",
                    },
                )
            ]
        )

        mock_stream2 = MagicMock()
        mock_stream2.__enter__ = MagicMock(return_value=mock_stream2)
        mock_stream2.__exit__ = MagicMock(return_value=False)
        mock_stream2.__iter__ = MagicMock(return_value=iter([]))
        mock_stream2.get_final_message.return_value = MockResponse(
            content=[MockContentBlock(type="text", text="Done!")]
        )

        mock_anthropic_client.messages.stream.side_effect = [mock_stream, mock_stream2]

        email_agent = runner.agents["email"]
        original_execute = email_agent.execute_tool
        email_agent.execute_tool = MagicMock(return_value='{"status": "sent"}')

        def auto_approve():
            import time

            for _ in range(100):
                time.sleep(0.02)
                pending = runner.approval_gate.list_pending()
                if pending:
                    runner.approval_gate.approve(pending[0].id)
                    return

        thread = threading.Thread(target=auto_approve)
        thread.start()

        events = list(runner.stream_sync("handle my inbox"))
        thread.join(timeout=5)

        # Should have approval_request with email parameters
        approval_events = [e for e in events if e.type == "approval_request"]
        assert len(approval_events) == 1
        assert approval_events[0].data == "send_email"
        params = approval_events[0].metadata["parameters"]
        assert params["to"] == "alice@example.com"
        assert params["subject"] == "Re: Update"

        email_agent.execute_tool = original_execute

    def test_mixed_approve_reject_in_batch(self, runner, mock_anthropic_client):
        """In batch mode, some emails can be approved and others rejected."""
        # Send email 1 (will be approved)
        send1_response = make_tool_response(
            "send_email",
            {"to": "alice@example.com", "subject": "Re: Hi", "body": "Hello"},
            tool_id="tool_s1",
        )
        # After approval, send email 2 (will be rejected)
        send2_response = make_tool_response(
            "send_email",
            {"to": "bob@example.com", "subject": "Re: Bye", "body": "Goodbye"},
            tool_id="tool_s2",
        )
        final_response = make_text_response("Processed: 1 sent, 1 skipped.")

        mock_anthropic_client.messages.create.side_effect = [
            send1_response,
            send2_response,
            final_response,
        ]

        email_agent = runner.agents["email"]
        original_execute = email_agent.execute_tool
        call_log = []

        def mock_execute(tool_name, params):
            call_log.append((tool_name, params.get("to", "")))
            return json.dumps({"status": "sent"})

        email_agent.execute_tool = mock_execute

        approval_count = [0]

        def auto_approve_reject():
            import time

            seen = set()
            for _ in range(200):
                time.sleep(0.02)
                pending = runner.approval_gate.list_pending()
                for p in pending:
                    if p.id not in seen:
                        seen.add(p.id)
                        approval_count[0] += 1
                        if approval_count[0] == 1:
                            runner.approval_gate.approve(p.id)
                        else:
                            runner.approval_gate.reject(p.id)

        thread = threading.Thread(target=auto_approve_reject)
        thread.start()

        result = runner.run_sync("handle my inbox")
        thread.join(timeout=10)

        # Only the first send_email should have been executed (approved)
        # The second was rejected so execute_tool should not be called for it
        assert len(call_log) == 1
        assert call_log[0] == ("send_email", "alice@example.com")

        email_agent.execute_tool = original_execute


class TestCodePRReviewFlow:
    """Task 15: 'Review the open PR' -> Diff UI -> list_prs -> read_diff -> review -> approve."""

    def test_routes_to_code_diff(self, runner, mock_anthropic_client):
        """PR review intent routes to code agent with diff UI."""
        mock_anthropic_client.messages.create.return_value = make_text_response(
            "Let me review that PR."
        )
        result = runner.run_sync("review the open PR")
        assert result.agent == "code"
        assert result.ui_pattern == UIPattern.DIFF.value

    def test_list_read_review_tool_chain(self, runner, mock_anthropic_client):
        """Agent lists PRs, reads diff, posts review - full tool chain."""
        # Round 1: list_prs
        list_response = make_tool_response(
            "list_prs",
            {"repo": "owner/repo"},
            text="Let me check the open PRs.",
        )
        # Round 2: read_diff
        diff_response = make_tool_response(
            "read_diff",
            {"repo": "owner/repo", "pr_number": 42},
            text="Reading the diff now.",
        )
        # Round 3: post_review (no approval needed)
        review_response = make_tool_response(
            "post_review",
            {
                "repo": "owner/repo",
                "pr_number": 42,
                "body": "LGTM! Clean implementation.",
                "event": "COMMENT",
            },
            text="Here's my review.",
        )
        # Round 4: final text
        final_response = make_text_response("Review posted. Looks good overall.")

        mock_anthropic_client.messages.create.side_effect = [
            list_response,
            diff_response,
            review_response,
            final_response,
        ]

        code_agent = runner.agents["code"]
        original_execute = code_agent.execute_tool
        call_log = []

        def mock_execute(tool_name, params):
            call_log.append(tool_name)
            if tool_name == "list_prs":
                return json.dumps(
                    [
                        {
                            "number": 42,
                            "title": "Add feature X",
                            "user": {"login": "dev1"},
                        },
                    ]
                )
            elif tool_name == "read_diff":
                return "--- a/src/main.py\n+++ b/src/main.py\n@@ -1,3 +1,4 @@\n import os\n+import sys\n \n def main():\n"
            elif tool_name == "post_review":
                return json.dumps({"id": 1, "state": "COMMENTED"})
            return json.dumps({"error": f"unexpected: {tool_name}"})

        code_agent.execute_tool = mock_execute

        result = runner.run_sync("review the open PR")

        assert call_log == ["list_prs", "read_diff", "post_review"]
        assert result.agent == "code"
        assert result.ui_pattern == "diff"

        code_agent.execute_tool = original_execute

    def test_stream_emits_diff_update(self, runner, mock_anthropic_client):
        """Streaming PR review emits diff_update event when read_diff returns."""
        # Round 1: read_diff tool call
        mock_stream = MagicMock()
        mock_stream.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream.__exit__ = MagicMock(return_value=False)

        stream_events = [
            MagicMock(
                type="content_block_start",
                content_block=MockContentBlock(
                    type="tool_use", id="tool_1", name="read_diff"
                ),
            ),
            MagicMock(
                type="content_block_delta",
                delta=MagicMock(
                    partial_json='{"repo":"owner/repo","pr_number":42}',
                ),
            ),
            MagicMock(type="content_block_stop"),
        ]
        del stream_events[1].delta.text
        mock_stream.__iter__ = MagicMock(return_value=iter(stream_events))
        mock_stream.get_final_message.return_value = MockResponse(
            content=[
                MockContentBlock(
                    type="tool_use",
                    id="tool_1",
                    name="read_diff",
                    input={"repo": "owner/repo", "pr_number": 42},
                )
            ]
        )

        # Round 2: text response
        mock_stream2 = MagicMock()
        mock_stream2.__enter__ = MagicMock(return_value=mock_stream2)
        mock_stream2.__exit__ = MagicMock(return_value=False)
        mock_stream2.__iter__ = MagicMock(return_value=iter([]))
        mock_stream2.get_final_message.return_value = MockResponse(
            content=[MockContentBlock(type="text", text="The PR looks good.")]
        )

        mock_anthropic_client.messages.stream.side_effect = [mock_stream, mock_stream2]

        # Mock the code agent's execute_tool to return a real diff
        code_agent = runner.agents["code"]
        original_execute = code_agent.execute_tool
        code_agent.execute_tool = MagicMock(
            return_value="--- a/file.py\n+++ b/file.py\n@@ -1,3 +1,4 @@\n import os\n+import sys\n \n def main():\n"
        )

        events = list(runner.stream_sync("review the open PR"))

        event_types = [e.type for e in events]
        assert "routing" in event_types
        assert "tool_call" in event_types
        assert "diff_update" in event_types
        assert "done" in event_types

        # diff_update should contain parsed diff lines
        diff_events = [e for e in events if e.type == "diff_update"]
        assert len(diff_events) == 1
        lines = diff_events[0].metadata["lines"]
        assert len(lines) > 0

        # Should have added, unchanged, and header types
        line_types = {l["type"] for l in lines}
        assert "added" in line_types
        assert "unchanged" in line_types

        # The added line should be "import sys"
        added = [l for l in lines if l["type"] == "added"]
        assert any("import sys" in (l["right"] or "") for l in added)

        code_agent.execute_tool = original_execute

    def test_merge_requires_approval(self, runner, mock_anthropic_client):
        """merge_pr tool requires user approval before execution."""
        merge_response = make_tool_response(
            "merge_pr",
            {"repo": "owner/repo", "pr_number": 42, "merge_method": "squash"},
            text="Ready to merge.",
        )
        final_response = make_text_response("PR merged.")

        mock_anthropic_client.messages.create.side_effect = [
            merge_response,
            final_response,
        ]

        code_agent = runner.agents["code"]
        original_execute = code_agent.execute_tool
        code_agent.execute_tool = MagicMock(
            return_value='{"merged": true, "sha": "abc123"}'
        )

        def auto_approve():
            import time

            for _ in range(100):
                time.sleep(0.02)
                pending = runner.approval_gate.list_pending()
                if pending:
                    runner.approval_gate.approve(pending[0].id)
                    return

        thread = threading.Thread(target=auto_approve)
        thread.start()

        result = runner.run_sync("review the open PR")
        thread.join(timeout=5)

        # Should have an approval output for merge_pr
        approval_outputs = [o for o in result.outputs if o.status == "pending_approval"]
        assert len(approval_outputs) == 1
        assert approval_outputs[0].metadata["tool_name"] == "merge_pr"

        # merge_pr should have been executed (approved)
        code_agent.execute_tool.assert_called_once_with(
            "merge_pr",
            {"repo": "owner/repo", "pr_number": 42, "merge_method": "squash"},
        )

        code_agent.execute_tool = original_execute

    def test_diff_update_not_emitted_on_error(self, runner, mock_anthropic_client):
        """diff_update should not be emitted when read_diff returns an error."""
        mock_stream = MagicMock()
        mock_stream.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream.__exit__ = MagicMock(return_value=False)

        stream_events = [
            MagicMock(
                type="content_block_start",
                content_block=MockContentBlock(
                    type="tool_use", id="tool_1", name="read_diff"
                ),
            ),
            MagicMock(
                type="content_block_delta",
                delta=MagicMock(
                    partial_json='{"repo":"owner/repo","pr_number":99}',
                ),
            ),
            MagicMock(type="content_block_stop"),
        ]
        del stream_events[1].delta.text
        mock_stream.__iter__ = MagicMock(return_value=iter(stream_events))
        mock_stream.get_final_message.return_value = MockResponse(
            content=[
                MockContentBlock(
                    type="tool_use",
                    id="tool_1",
                    name="read_diff",
                    input={"repo": "owner/repo", "pr_number": 99},
                )
            ]
        )

        mock_stream2 = MagicMock()
        mock_stream2.__enter__ = MagicMock(return_value=mock_stream2)
        mock_stream2.__exit__ = MagicMock(return_value=False)
        mock_stream2.__iter__ = MagicMock(return_value=iter([]))
        mock_stream2.get_final_message.return_value = MockResponse(
            content=[MockContentBlock(type="text", text="PR not found.")]
        )

        mock_anthropic_client.messages.stream.side_effect = [mock_stream, mock_stream2]

        # Return an error from the tool
        code_agent = runner.agents["code"]
        original_execute = code_agent.execute_tool
        code_agent.execute_tool = MagicMock(side_effect=Exception("Not found"))

        events = list(runner.stream_sync("review the open PR"))

        # diff_update should NOT be in events (tool errored)
        event_types = [e.type for e in events]
        assert "diff_update" not in event_types

        code_agent.execute_tool = original_execute
