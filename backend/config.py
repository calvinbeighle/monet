"""
config.py - Environment configuration for Monet backend.

Loads API keys and model identifiers from environment variables.
OPENROUTER_API_KEY is required; COMPOSIO_API_KEY is optional (enables stub mode if absent).
"""

import os
from dotenv import load_dotenv

load_dotenv()


# --- API Keys ---

OPENROUTER_API_KEY: str = os.environ.get("OPENROUTER_API_KEY", "")
"""Required. Used for all LLM calls via OpenRouter."""

COMPOSIO_API_KEY: str = os.environ.get("COMPOSIO_API_KEY", "")
"""Optional. If absent, Composio integration runs in stub mode with mock data."""


# --- Model Identifiers ---

EMAIL_MODEL: str = "google/gemini-3-flash-preview"
"""Model used by the email triage agent."""

CODE_MODEL: str = "anthropic/claude-sonnet-4-6"
"""Model used by the code review agent."""


# --- OpenRouter ---

OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1/chat/completions"
"""OpenRouter chat completions endpoint."""


def validate_config() -> None:
    """
    Validates that required configuration values are present.

    Raises:
        ValueError: If OPENROUTER_API_KEY is not set.
    """
    if not OPENROUTER_API_KEY:
        raise ValueError("OPENROUTER_API_KEY is required but not set in environment.")
