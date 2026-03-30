"""
integrations/__init__.py

Public surface for the integrations package.

Exports the main integration classes so callers can import directly
from `integrations` rather than from individual submodules.

Usage:
    from integrations import ComposioClient, GmailIntegration, GitHubIntegration, OAuthManager
"""

from .composio_client import ComposioClient
from .github import GitHubIntegration
from .gmail import GmailIntegration
from .oauth import OAuthManager

__all__ = [
    "ComposioClient",
    "GmailIntegration",
    "GitHubIntegration",
    "OAuthManager",
]
