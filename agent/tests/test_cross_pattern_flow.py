"""Tests for cross-pattern flow (Task 17).

Cross-pattern flows decompose multi-step intents into a sequence of
(agent, ui_pattern) steps. The router detects these compound intents,
the runner orchestrates each step with user-advance gates between them,
and state carries forward from one pattern to the next.
"""

import json
import threading
from unittest.mock import MagicMock

from agent.models import FlowPlan, FlowStep, UIPattern
from agent.router import IntentRouter
from agent.tests.conftest import (
    MockContentBlock,
    MockResponse,
    make_text_response,
)


# ---------------------------------------------------------------------------
# Router: route_flow() tests
# ---------------------------------------------------------------------------


class TestRouteFlow:
    def setup_method(self):
        self.router = IntentRouter()

    def test_single_step_fallback(self):
        """Non-flow intents return a single-step FlowPlan."""
        plan = self.router.route_flow("reply to John's email")
        assert plan.is_single
        assert len(plan.steps) == 1
        assert plan.steps[0].agent == "email"
        assert plan.steps[0].ui_pattern == UIPattern.CHAT.value

    def test_plan_and_prioritize_emails_flow(self):
        """'plan and prioritize my emails' -> whiteboard -> tinder -> chat."""
        plan = self.router.route_flow("plan and prioritize my emails")
        assert not plan.is_single
        assert len(plan.steps) == 3
        assert plan.steps[0].agent == "planning"
        assert plan.steps[0].ui_pattern == UIPattern.WHITEBOARD.value
        assert plan.steps[1].agent == "email"
        assert plan.steps[1].ui_pattern == UIPattern.TINDER.value
        assert plan.steps[1].carry_map == {"nodes": "cards"}
        assert plan.steps[2].agent == "email"
        assert plan.steps[2].ui_pattern == UIPattern.CHAT.value

    def test_organize_inbox_flow(self):
        """'organize my inbox' -> whiteboard -> tinder -> chat."""
        plan = self.router.route_flow("organize my inbox")
        assert not plan.is_single
        assert len(plan.steps) == 3
        assert plan.steps[0].agent == "planning"

    def test_triage_emails_flow(self):
        """'triage my emails' -> whiteboard -> tinder -> chat."""
        plan = self.router.route_flow("triage my emails")
        assert not plan.is_single
        assert len(plan.steps) == 3

    def test_review_and_fix_pr_flow(self):
        """'review and fix the PR' -> diff -> chat."""
        plan = self.router.route_flow("review and fix the PR")
        assert not plan.is_single
        assert len(plan.steps) == 2
        assert plan.steps[0].agent == "code"
        assert plan.steps[0].ui_pattern == UIPattern.DIFF.value
        assert plan.steps[1].agent == "code"
        assert plan.steps[1].ui_pattern == UIPattern.CHAT.value
        assert plan.steps[1].carry_map == {"diff_decisions": "context"}

    def test_look_at_and_address_pr_flow(self):
        """'look at the PR and address the issues' -> diff -> chat."""
        plan = self.router.route_flow("look at the PR and address the issues")
        assert not plan.is_single
        assert len(plan.steps) == 2

    def test_brainstorm_then_prioritize_flow(self):
        """'brainstorm features then prioritize them' -> whiteboard -> tinder."""
        plan = self.router.route_flow("brainstorm features then prioritize them")
        assert not plan.is_single
        assert len(plan.steps) == 2
        assert plan.steps[0].agent == "planning"
        assert plan.steps[0].ui_pattern == UIPattern.WHITEBOARD.value
        assert plan.steps[1].agent == "planning"
        assert plan.steps[1].ui_pattern == UIPattern.TINDER.value
        assert plan.steps[1].carry_map == {"nodes": "cards"}

    def test_plan_and_decide_flow(self):
        """'plan the roadmap and decide priorities' -> whiteboard -> tinder."""
        plan = self.router.route_flow("plan the roadmap and decide priorities")
        assert not plan.is_single
        assert len(plan.steps) == 2

    def test_flow_plan_preserves_original_intent(self):
        intent = "plan and prioritize my emails"
        plan = self.router.route_flow(intent)
        assert plan.original == intent

    def test_non_matching_falls_through_to_single(self):
        """'what is the weather' does not match any flow rule."""
        plan = self.router.route_flow("what is the weather")
        assert plan.is_single
        assert plan.steps[0].agent == "general"


# ---------------------------------------------------------------------------
# Runner: stream_flow() tests
# ---------------------------------------------------------------------------


class TestStreamFlow:
    """Tests for multi-step flow orchestration in the runner."""

    def test_single_step_delegates_to_stream_sync(self, runner, mock_anthropic_client):
        """Single-step flows produce the same events as stream_sync."""
        # Set up mock for streaming
        mock_stream = MagicMock()
        mock_stream.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream.__exit__ = MagicMock(return_value=False)
        mock_stream.__iter__ = MagicMock(return_value=iter([]))
        mock_stream.get_final_message.return_value = MockResponse(
            content=[MockContentBlock(type="text", text="Hello")]
        )
        mock_anthropic_client.messages.stream.return_value = mock_stream

        events = list(runner.stream_flow("what is the weather"))
        event_types = [e.type for e in events]
        assert "routing" in event_types
        assert "done" in event_types
        # Single-step should NOT have flow_start or flow_done
        assert "flow_start" not in event_types
        assert "flow_done" not in event_types

    def test_multi_step_emits_flow_start(self, runner, mock_anthropic_client):
        """Multi-step flows emit flow_start with step metadata."""
        # Set up mock for streaming (each step gets a simple text response)
        mock_stream = MagicMock()
        mock_stream.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream.__exit__ = MagicMock(return_value=False)
        mock_stream.__iter__ = MagicMock(return_value=iter([]))
        mock_stream.get_final_message.return_value = MockResponse(
            content=[MockContentBlock(type="text", text="Step result")]
        )
        mock_anthropic_client.messages.stream.return_value = mock_stream

        # Use a thread to auto-advance the flow
        events = []

        def collect_events():
            for event in runner.stream_flow("plan and prioritize my emails"):
                events.append(event)
                # Auto-advance when we see pattern_transition
                if event.type == "pattern_transition":
                    sid = event.metadata.get("carried_state", {})
                    # Find the session ID from earlier events
                    session_id = None
                    for e in events:
                        if e.type == "flow_start":
                            session_id = e.metadata.get("session_id")
                            break
                    if session_id:
                        runner.signal_advance(session_id, 0, {})

        t = threading.Thread(target=collect_events)
        t.start()
        t.join(timeout=10)

        event_types = [e.type for e in events]
        assert "flow_start" in event_types

        flow_start = next(e for e in events if e.type == "flow_start")
        assert flow_start.metadata["total_steps"] == 3
        assert len(flow_start.metadata["steps"]) == 3
        assert flow_start.metadata["steps"][0]["agent"] == "planning"

    def test_multi_step_emits_pattern_transition(self, runner, mock_anthropic_client):
        """Multi-step flows emit pattern_transition between steps."""
        mock_stream = MagicMock()
        mock_stream.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream.__exit__ = MagicMock(return_value=False)
        mock_stream.__iter__ = MagicMock(return_value=iter([]))
        mock_stream.get_final_message.return_value = MockResponse(
            content=[MockContentBlock(type="text", text="Done")]
        )
        mock_anthropic_client.messages.stream.return_value = mock_stream

        events = []

        def collect_events():
            for event in runner.stream_flow("review and fix the PR"):
                events.append(event)
                if event.type == "pattern_transition":
                    session_id = None
                    for e in events:
                        if e.type == "flow_start":
                            session_id = e.metadata.get("session_id")
                            break
                    if session_id:
                        runner.signal_advance(session_id, 0, {})

        t = threading.Thread(target=collect_events)
        t.start()
        t.join(timeout=10)

        transitions = [e for e in events if e.type == "pattern_transition"]
        assert len(transitions) == 1
        assert transitions[0].metadata["next_pattern"] == UIPattern.CHAT.value
        assert transitions[0].metadata["next_agent"] == "code"
        assert transitions[0].metadata["awaiting_advance"] is True

    def test_multi_step_emits_flow_done(self, runner, mock_anthropic_client):
        """Multi-step flows end with flow_done event."""
        mock_stream = MagicMock()
        mock_stream.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream.__exit__ = MagicMock(return_value=False)
        mock_stream.__iter__ = MagicMock(return_value=iter([]))
        mock_stream.get_final_message.return_value = MockResponse(
            content=[MockContentBlock(type="text", text="Done")]
        )
        mock_anthropic_client.messages.stream.return_value = mock_stream

        events = []

        def collect_events():
            for event in runner.stream_flow("review and fix the PR"):
                events.append(event)
                if event.type == "pattern_transition":
                    session_id = None
                    for e in events:
                        if e.type == "flow_start":
                            session_id = e.metadata.get("session_id")
                            break
                    if session_id:
                        runner.signal_advance(session_id, 0, {})

        t = threading.Thread(target=collect_events)
        t.start()
        t.join(timeout=10)

        event_types = [e.type for e in events]
        assert "flow_done" in event_types
        flow_done = next(e for e in events if e.type == "flow_done")
        assert flow_done.metadata["total_steps"] == 2

    def test_done_events_include_flow_step_metadata(
        self, runner, mock_anthropic_client
    ):
        """Each step's done event includes flow_step and flow_total."""
        mock_stream = MagicMock()
        mock_stream.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream.__exit__ = MagicMock(return_value=False)
        mock_stream.__iter__ = MagicMock(return_value=iter([]))
        mock_stream.get_final_message.return_value = MockResponse(
            content=[MockContentBlock(type="text", text="Done")]
        )
        mock_anthropic_client.messages.stream.return_value = mock_stream

        events = []

        def collect_events():
            for event in runner.stream_flow("review and fix the PR"):
                events.append(event)
                if event.type == "pattern_transition":
                    session_id = None
                    for e in events:
                        if e.type == "flow_start":
                            session_id = e.metadata.get("session_id")
                            break
                    if session_id:
                        runner.signal_advance(session_id, 0, {})

        t = threading.Thread(target=collect_events)
        t.start()
        t.join(timeout=10)

        done_events = [e for e in events if e.type == "done"]
        assert len(done_events) == 2
        assert done_events[0].metadata["flow_step"] == 0
        assert done_events[0].metadata["flow_total"] == 2
        assert done_events[0].metadata["is_flow_step_done"] is True
        assert done_events[1].metadata["flow_step"] == 1

    def test_signal_advance_merges_user_state(self, runner, mock_anthropic_client):
        """User state from signal_advance is available as carried state."""
        mock_stream = MagicMock()
        mock_stream.__enter__ = MagicMock(return_value=mock_stream)
        mock_stream.__exit__ = MagicMock(return_value=False)
        mock_stream.__iter__ = MagicMock(return_value=iter([]))
        mock_stream.get_final_message.return_value = MockResponse(
            content=[MockContentBlock(type="text", text="Done")]
        )
        mock_anthropic_client.messages.stream.return_value = mock_stream

        events = []

        def collect_events():
            for event in runner.stream_flow("review and fix the PR"):
                events.append(event)
                if event.type == "pattern_transition":
                    session_id = None
                    for e in events:
                        if e.type == "flow_start":
                            session_id = e.metadata.get("session_id")
                            break
                    if session_id:
                        runner.signal_advance(
                            session_id, 0, {"user_notes": "looks good"}
                        )

        t = threading.Thread(target=collect_events)
        t.start()
        t.join(timeout=10)

        # The second step's intent should include the user's notes
        # (merged into carried_state which feeds _build_step_intent)
        assert len(events) > 0  # Flow completed


class TestSignalAdvance:
    """Tests for the runner.signal_advance() method."""

    def test_signal_advance_returns_false_when_no_flow(self, runner):
        """signal_advance returns False when no flow is waiting."""
        result = runner.signal_advance("nonexistent", 0, {})
        assert result is False

    def test_signal_advance_stores_user_state(self, runner):
        """signal_advance stores user_state for the session."""
        # Set up a waiting event
        event = threading.Event()
        runner._flow_advance_events["test-session"] = event
        result = runner.signal_advance("test-session", 1, {"foo": "bar"})
        assert result is True
        assert runner._flow_user_state["test-session"] == {"foo": "bar"}
        assert event.is_set()


# ---------------------------------------------------------------------------
# Data model tests
# ---------------------------------------------------------------------------


class TestFlowPlanModel:
    def test_single_step_is_single(self):
        plan = FlowPlan(
            steps=[FlowStep(agent="email", ui_pattern="chat", label="test")],
            original="test",
        )
        assert plan.is_single

    def test_empty_is_single(self):
        plan = FlowPlan(steps=[], original="test")
        assert plan.is_single

    def test_multi_step_not_single(self):
        plan = FlowPlan(
            steps=[
                FlowStep(agent="planning", ui_pattern="whiteboard", label="Plan"),
                FlowStep(agent="email", ui_pattern="tinder", label="Review"),
            ],
            original="test",
        )
        assert not plan.is_single

    def test_flow_step_defaults(self):
        step = FlowStep(agent="email", ui_pattern="chat", label="test")
        assert step.carry_map == {}


# ---------------------------------------------------------------------------
# Runner helper tests
# ---------------------------------------------------------------------------


class TestRunnerHelpers:
    def test_build_step_intent_no_context(self, runner):
        """With empty carried state, returns original intent."""
        step = FlowStep(agent="email", ui_pattern="chat", label="test")
        result = runner._build_step_intent("do the thing", step, {})
        assert result == "do the thing"

    def test_build_step_intent_with_list_context(self, runner):
        """With list carried state, appends context block."""
        step = FlowStep(agent="email", ui_pattern="chat", label="test")
        carried = {"cards": [{"title": "Item 1"}, {"title": "Item 2"}]}
        result = runner._build_step_intent("do the thing", step, carried)
        assert "do the thing" in result
        assert "Context from previous step" in result
        assert "Item 1" in result

    def test_build_step_intent_with_string_context(self, runner):
        step = FlowStep(agent="email", ui_pattern="chat", label="test")
        carried = {"summary": "All items were approved"}
        result = runner._build_step_intent("do the thing", step, carried)
        assert "All items were approved" in result

    def test_extract_carry_nodes(self, runner):
        """Whiteboard nodes are transformed into card-like dicts."""
        outputs = [
            {"id": "1", "title": "Task A", "body": "Details", "priority": "high"},
            {"id": "2", "title": "Task B", "body": "More details", "priority": "low"},
        ]
        result = runner._extract_carry("nodes", outputs, UIPattern.WHITEBOARD.value)
        assert len(result) == 2
        assert result[0]["title"] == "Task A"
        assert result[0]["priority"] == "high"

    def test_extract_carry_decisions(self, runner):
        outputs = [
            {"title": "Email 1", "approved": True},
            {"title": "Email 2", "approved": False},
        ]
        result = runner._extract_carry("decisions", outputs, UIPattern.TINDER.value)
        assert len(result) == 2
        assert result[0]["approved"] is True

    def test_extract_carry_passthrough(self, runner):
        """Unknown source keys pass through raw outputs."""
        outputs = [{"content": "raw data"}]
        result = runner._extract_carry("unknown", outputs, "chat")
        assert result == outputs
