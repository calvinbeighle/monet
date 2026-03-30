"""
config.py

Configuration management for the Monet agent backend.
Loads settings from environment variables with sensible defaults.
All secrets must be provided via environment variables - never hardcoded.
"""

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Config:
    """Immutable configuration container loaded from environment variables."""

    openrouter_api_key: str
    openrouter_base_url: str
    model: str
    host: str
    port: int
    debug: bool
    # Composio integration - optional. When absent the system runs in stub mode.
    composio_api_key: str
    stub_mode: bool


def load_config() -> Config:
    """
    Load and validate configuration from environment variables.

    Raises:
        ValueError: If required environment variables are missing.

    Returns:
        Config: Validated, immutable configuration object.
    """
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    if not api_key:
        raise ValueError(
            "OPENROUTER_API_KEY environment variable is required. "
            "Set it in your .env file or shell environment."
        )

    composio_api_key = os.getenv("COMPOSIO_API_KEY", "").strip()

    return Config(
        openrouter_api_key=api_key,
        openrouter_base_url=os.getenv(
            "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
        ),
        model=os.getenv("MODEL", "anthropic/claude-sonnet-4-6"),
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        debug=os.getenv("DEBUG", "false").lower() == "true",
        # Composio is optional - absent key means stub mode is active.
        composio_api_key=composio_api_key,
        stub_mode=not composio_api_key,
    )


# Module-level singleton - lazily initialized so tests can patch env vars
_config: Config | None = None


def get_config() -> Config:
    """
    Get the singleton Config instance, initializing it on first call.

    Returns:
        Config: The application configuration.
    """
    global _config
    if _config is None:
        _config = load_config()
    return _config
