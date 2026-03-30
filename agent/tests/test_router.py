"""Tests for the intent router."""

from agent.models import UIPattern
from agent.router import IntentRouter


class TestIntentRouter:
    def setup_method(self):
        self.router = IntentRouter()

    def test_email_batch_routes_to_tinder(self):
        result = self.router.route("handle my inbox")
        assert result.agent == "email"
        assert result.ui_pattern == UIPattern.TINDER.value

    def test_email_batch_triage(self):
        result = self.router.route("triage my emails")
        assert result.agent == "email"
        assert result.ui_pattern == UIPattern.TINDER.value

    def test_email_single_reply_routes_to_chat(self):
        result = self.router.route("reply to John's email")
        assert result.agent == "email"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_email_draft_routes_to_chat(self):
        result = self.router.route("draft an email to Sarah")
        assert result.agent == "email"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_email_send_routes_to_chat(self):
        result = self.router.route("send a follow-up email")
        assert result.agent == "email"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_code_review_routes_to_diff(self):
        result = self.router.route("review the open PR")
        assert result.agent == "code"
        assert result.ui_pattern == UIPattern.DIFF.value

    def test_code_pr_routes_to_diff(self):
        result = self.router.route("check the pull request")
        assert result.agent == "code"
        assert result.ui_pattern == UIPattern.DIFF.value

    def test_code_diff_routes_to_diff(self):
        result = self.router.route("show me the diff")
        assert result.agent == "code"
        assert result.ui_pattern == UIPattern.DIFF.value

    def test_code_write_routes_to_chat(self):
        result = self.router.route("write a function to parse JSON")
        assert result.agent == "code"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_code_fix_routes_to_chat(self):
        result = self.router.route("fix the authentication bug")
        assert result.agent == "code"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_planning_routes_to_whiteboard(self):
        result = self.router.route("plan the next sprint")
        assert result.agent == "planning"
        assert result.ui_pattern == UIPattern.WHITEBOARD.value

    def test_brainstorm_routes_to_whiteboard(self):
        result = self.router.route("brainstorm ideas for the new feature")
        assert result.agent == "planning"
        assert result.ui_pattern == UIPattern.WHITEBOARD.value

    def test_unknown_routes_to_general_chat(self):
        result = self.router.route("what is the meaning of life")
        assert result.agent == "general"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_empty_routes_to_general_chat(self):
        result = self.router.route("")
        assert result.agent == "general"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_original_intent_preserved(self):
        intent = "handle my inbox please"
        result = self.router.route(intent)
        assert result.original == intent

    def test_case_insensitive(self):
        result = self.router.route("HANDLE MY INBOX")
        assert result.agent == "email"
        assert result.ui_pattern == UIPattern.TINDER.value

    def test_first_match_wins(self):
        # "review" matches code/diff before "plan" matches planning/whiteboard
        result = self.router.route("review the plan")
        assert result.agent == "code"
        assert result.ui_pattern == UIPattern.DIFF.value
