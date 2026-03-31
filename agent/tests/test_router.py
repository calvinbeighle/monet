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

    def test_write_a_plan_routes_to_planning(self):
        # "plan" should match planning before "write" matches code
        result = self.router.route("write a plan for the sprint")
        assert result.agent == "planning"
        assert result.ui_pattern == UIPattern.WHITEBOARD.value

    def test_design_routes_to_planning(self):
        result = self.router.route("design the new feature architecture")
        assert result.agent == "planning"
        assert result.ui_pattern == UIPattern.WHITEBOARD.value

    def test_prioritize_routes_to_planning(self):
        result = self.router.route("prioritize the backlog items")
        assert result.agent == "planning"
        assert result.ui_pattern == UIPattern.WHITEBOARD.value

    def test_organize_routes_to_planning(self):
        result = self.router.route("organize the project tasks")
        assert result.agent == "planning"
        assert result.ui_pattern == UIPattern.WHITEBOARD.value

    def test_write_code_still_routes_to_code(self):
        result = self.router.route("write a function to parse JSON")
        assert result.agent == "code"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_build_still_routes_to_code(self):
        result = self.router.route("build a REST API endpoint")
        assert result.agent == "code"
        assert result.ui_pattern == UIPattern.CHAT.value

    # Writing agent routing tests

    def test_document_routes_to_writing(self):
        result = self.router.route("write a document about the project")
        assert result.agent == "writing"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_google_doc_routes_to_writing(self):
        result = self.router.route("create a google doc for the meeting")
        assert result.agent == "writing"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_article_routes_to_writing(self):
        result = self.router.route("write an article about AI")
        assert result.agent == "writing"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_blog_routes_to_writing(self):
        result = self.router.route("write a blog post")
        assert result.agent == "writing"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_essay_routes_to_writing(self):
        result = self.router.route("write an essay on climate change")
        assert result.agent == "writing"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_report_routes_to_writing(self):
        result = self.router.route("create a report on Q1 sales")
        assert result.agent == "writing"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_memo_routes_to_writing(self):
        result = self.router.route("write a memo to the team")
        assert result.agent == "writing"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_notes_routes_to_writing(self):
        result = self.router.route("take notes from the meeting")
        assert result.agent == "writing"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_summarize_routes_to_writing(self):
        result = self.router.route("summarize this text for me")
        assert result.agent == "writing"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_rewrite_routes_to_writing(self):
        result = self.router.route("rewrite this paragraph")
        assert result.agent == "writing"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_proofread_routes_to_writing(self):
        result = self.router.route("proofread my document")
        assert result.agent == "writing"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_write_function_still_routes_to_code(self):
        """'write a function' has no writing keywords, falls through to code."""
        result = self.router.route("write a function to parse JSON")
        assert result.agent == "code"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_write_a_doc_routes_to_writing(self):
        """'write a doc' should route to writing, not code."""
        result = self.router.route("write a doc about the API")
        assert result.agent == "writing"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_write_an_essay_routes_to_writing(self):
        """'write an essay' should route to writing, not code."""
        result = self.router.route("write an essay about history")
        assert result.agent == "writing"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_write_a_report_routes_to_writing(self):
        """'write a report' should route to writing, not code."""
        result = self.router.route("write a report on quarterly earnings")
        assert result.agent == "writing"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_summary_routes_to_writing(self):
        """'summary' keyword should route to writing."""
        result = self.router.route("give me a summary of the meeting")
        assert result.agent == "writing"
        assert result.ui_pattern == UIPattern.CHAT.value

    def test_write_a_blog_routes_to_writing(self):
        """'write a blog' should route to writing via compound pattern."""
        result = self.router.route("write a blog about productivity")
        assert result.agent == "writing"
        assert result.ui_pattern == UIPattern.CHAT.value
