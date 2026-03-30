"""
config.py - Environment configuration for Monet backend.

Loads API keys and model identifiers from environment variables (.env file).
Provides a hardcoded fallback for the Anthropic key for dev convenience.
COMPOSIO_API_KEY is optional - Composio runs in stub mode if absent.
"""

import os
from dotenv import load_dotenv

load_dotenv()


# --- API Keys ---

# Load from .env file - never hardcode API keys
ANTHROPIC_API_KEY: str = os.environ.get("ANTHROPIC_API_KEY", "")
"""Required. Used for all LLM calls via the Anthropic SDK."""

COMPOSIO_API_KEY: str = os.environ.get("COMPOSIO_API_KEY", "")
"""Optional. If absent, Composio integration runs in stub mode with mock data."""


# --- Model Identifiers ---

HAIKU_MODEL: str = "claude-haiku-4-5"
"""Cheap, fast model for high-frequency tasks like email triage."""

SONNET_MODEL: str = "claude-sonnet-4-6"
"""Smart model for complex tasks like code review and planning."""

# Aliases used by each agent
EMAIL_MODEL: str = HAIKU_MODEL
"""Model used by the email triage agent (Haiku - cheap and fast)."""

CODE_MODEL: str = SONNET_MODEL
"""Model used by the code review agent (Sonnet - smart)."""


def validate_config() -> None:
    """
    Validates that required configuration values are present.

    Raises:
        ValueError: If ANTHROPIC_API_KEY is not set.
    """
    if not ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY is required but not set in environment.")
