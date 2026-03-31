"""Tests for the Monet agent data models."""

from agent.models import (
    AgentEvent,
    AgentOutput,
    AgentResult,
    ApprovalRequest,
    ApprovalStatus,
    FlowPlan,
    FlowStep,
    RoutedIntent,
    UIPattern,
)


class TestUIPattern:
    def test_values(self):
        assert UIPattern.TINDER == "tinder"
        assert UIPattern.CHAT == "chat"
        assert UIPattern.DIFF == "diff"
        assert UIPattern.WHITEBOARD == "whiteboard"

    def test_is_str_enum(self):
        assert isinstance(UIPattern.CHAT, str)
        assert UIPattern.CHAT == "chat"

    def test_all_members(self):
        assert len(UIPattern) == 4


class TestApprovalStatus:
    def test_values(self):
        assert ApprovalStatus.PENDING == "pending"
        assert ApprovalStatus.APPROVED == "approved"
        assert ApprovalStatus.REJECTED == "rejected"

    def test_is_str_enum(self):
        assert isinstance(ApprovalStatus.PENDING, str)

    def test_all_members(self):
        assert len(ApprovalStatus) == 3


class TestAgentOutput:
    def test_defaults(self):
        output = AgentOutput(content="hello")
        assert output.content == "hello"
        assert output.status == "complete"
        assert output.metadata == {}

    def test_custom_status(self):
        output = AgentOutput(content="x", status="error", metadata={"key": "val"})
        assert output.status == "error"
        assert output.metadata["key"] == "val"

    def test_metadata_isolation(self):
        a = AgentOutput(content="a")
        b = AgentOutput(content="b")
        a.metadata["x"] = 1
        assert "x" not in b.metadata


class TestAgentResult:
    def test_defaults(self):
        result = AgentResult(agent="email", ui_pattern="tinder")
        assert result.agent == "email"
        assert result.ui_pattern == "tinder"
        assert result.outputs == []

    def test_with_outputs(self):
        out = AgentOutput(content="done")
        result = AgentResult(agent="code", ui_pattern="diff", outputs=[out])
        assert len(result.outputs) == 1
        assert result.outputs[0].content == "done"


class TestAgentEvent:
    def test_defaults(self):
        event = AgentEvent(type="token")
        assert event.type == "token"
        assert event.data == ""
        assert event.metadata == {}

    def test_to_dict(self):
        event = AgentEvent(type="done", data="ok", metadata={"k": 1})
        d = event.to_dict()
        assert d == {"type": "done", "data": "ok", "metadata": {"k": 1}}

    def test_to_dict_empty(self):
        event = AgentEvent(type="token")
        d = event.to_dict()
        assert d["type"] == "token"
        assert d["data"] == ""
        assert d["metadata"] == {}

    def test_metadata_isolation(self):
        a = AgentEvent(type="x")
        b = AgentEvent(type="y")
        a.metadata["z"] = 1
        assert "z" not in b.metadata


class TestFlowStep:
    def test_defaults(self):
        step = FlowStep(agent="email", ui_pattern="tinder", label="Swipe emails")
        assert step.agent == "email"
        assert step.ui_pattern == "tinder"
        assert step.label == "Swipe emails"
        assert step.carry_map == {}

    def test_carry_map(self):
        step = FlowStep(
            agent="planning",
            ui_pattern="whiteboard",
            label="Plan",
            carry_map={"nodes": "cards"},
        )
        assert step.carry_map == {"nodes": "cards"}


class TestFlowPlan:
    def test_empty_is_single(self):
        plan = FlowPlan()
        assert plan.is_single is True

    def test_one_step_is_single(self):
        plan = FlowPlan(
            steps=[FlowStep(agent="email", ui_pattern="chat", label="Chat")]
        )
        assert plan.is_single is True

    def test_two_steps_not_single(self):
        plan = FlowPlan(
            steps=[
                FlowStep(agent="planning", ui_pattern="whiteboard", label="Plan"),
                FlowStep(agent="email", ui_pattern="tinder", label="Triage"),
            ],
            original="plan and triage",
        )
        assert plan.is_single is False
        assert plan.original == "plan and triage"

    def test_defaults(self):
        plan = FlowPlan()
        assert plan.steps == []
        assert plan.original == ""


class TestRoutedIntent:
    def test_fields(self):
        r = RoutedIntent(agent="email", ui_pattern="chat", original="reply to john")
        assert r.agent == "email"
        assert r.ui_pattern == "chat"
        assert r.original == "reply to john"


class TestApprovalRequest:
    def test_defaults(self):
        req = ApprovalRequest()
        assert len(req.id) == 8
        assert req.tool_name == ""
        assert req.parameters == {}
        assert req.status == ApprovalStatus.PENDING
        assert req.session_id is None

    def test_custom_fields(self):
        req = ApprovalRequest(
            id="abc12345",
            tool_name="send_email",
            parameters={"to": "test@example.com"},
            status=ApprovalStatus.APPROVED,
            session_id="sess1",
        )
        assert req.id == "abc12345"
        assert req.tool_name == "send_email"
        assert req.parameters["to"] == "test@example.com"
        assert req.status == ApprovalStatus.APPROVED
        assert req.session_id == "sess1"

    def test_unique_ids(self):
        a = ApprovalRequest()
        b = ApprovalRequest()
        assert a.id != b.id

    def test_parameters_isolation(self):
        a = ApprovalRequest()
        b = ApprovalRequest()
        a.parameters["x"] = 1
        assert "x" not in b.parameters
