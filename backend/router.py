"""
router.py - Intent classification for Monet command bar input.

Routes raw user text to the appropriate agent type and UI pattern
using simple keyword heuristics. Can be swapped for an LLM classifier later.
"""

from models import UiPattern


# --- Agent Type Constants ---

AGENT_EMAIL = "email"
AGENT_CODE = "code"
AGENT_GENERAL = "general"


# --- Keyword Maps ---

EMAIL_KEYWORDS = [
    "email", "inbox", "mail", "message", "reply", "draft", "send",
    "unread", "gmail", "triage", "compose", "thread",
]

CODE_KEYWORDS = [
    "pr", "pull request", "review", "code", "diff", "github", "commit",
    "branch", "merge", "repo", "repository", "bug", "lint", "test",
]

CONFIRM_KEYWORDS = [
    "approve", "reject", "delete", "remove", "cancel", "confirm",
]

CODE_UI_KEYWORDS = [
    "diff", "code", "snippet", "function", "class", "file",
]


def classify_intent(text: str) -> dict:
    """
    Classifies the user's intent from raw command bar text.

    Returns a dict with 'agent_type' and 'ui_pattern' keys.
    Uses keyword matching against known agent domains.

    Args:
        text: Raw input string from the command bar.

    Returns:
        dict with keys: agent_type (str), ui_pattern (UiPattern).
    """
    normalized = text.lower().strip()

    agent_type = _detect_agent_type(normalized)
    ui_pattern = _detect_ui_pattern(normalized, agent_type)

    return {
        "agent_type": agent_type,
        "ui_pattern": ui_pattern,
    }


def _detect_agent_type(text: str) -> str:
    """
    Determines which agent should handle this request.

    Checks for email-related keywords first, then code-related keywords.
    Falls back to 'general' if no match is found.

    Args:
        text: Lowercased, stripped user input.

    Returns:
        One of 'email', 'code', or 'general'.
    """
    for keyword in EMAIL_KEYWORDS:
        if keyword in text:
            return AGENT_EMAIL

    for keyword in CODE_KEYWORDS:
        if keyword in text:
            return AGENT_CODE

    return AGENT_GENERAL


def _detect_ui_pattern(text: str, agent_type: str) -> UiPattern:
    """
    Determines which frontend UI pattern should render the response.

    Args:
        text: Lowercased, stripped user input.
        agent_type: The classified agent type.

    Returns:
        A UiPattern enum value.
    """
    for keyword in CONFIRM_KEYWORDS:
        if keyword in text:
            return UiPattern.confirm

    if agent_type == AGENT_CODE:
        for keyword in CODE_UI_KEYWORDS:
            if keyword in text:
                return UiPattern.code
        return UiPattern.detail

    if agent_type == AGENT_EMAIL:
        return UiPattern.list

    return UiPattern.chat
