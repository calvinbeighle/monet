"""Shared test fixtures for the Monet agent backend."""

import json
import os
import tempfile
from dataclasses import dataclass
from typing import Generator
from unittest.mock import MagicMock, patch

import pytest

from agent.approval import ApprovalGate
from agent.router import IntentRouter
from agent.runner import AgentRunner
from agent.session_store import SessionStore


@dataclass
class MockContentBlock:
    type: str
    text: str = ""
    id: str = ""
    name: str = ""
    input: dict = None

    def __post_init__(self):
        if self.input is None:
            self.input = {}


@dataclass
class MockResponse:
    content: list
    stop_reason: str = "end_turn"


def make_text_response(text: str) -> MockResponse:
    """Create a mock Claude response with just text content."""
    return MockResponse(content=[MockContentBlock(type="text", text=text)])


def make_tool_response(
    tool_name: str, tool_input: dict, tool_id: str = "tool_123", text: str = ""
) -> MockResponse:
    """Create a mock Claude response with a tool use block."""
    blocks = []
    if text:
        blocks.append(MockContentBlock(type="text", text=text))
    blocks.append(
        MockContentBlock(type="tool_use", id=tool_id, name=tool_name, input=tool_input)
    )
    return MockResponse(content=blocks)


@pytest.fixture
def approval_gate():
    return ApprovalGate()


@pytest.fixture
def router():
    return IntentRouter()


@pytest.fixture
def mock_anthropic_client():
    """Create a mock Anthropic client that returns configurable responses."""
    client = MagicMock()
    return client


@pytest.fixture
def session_store():
    """Create a session store backed by a temporary database."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        yield SessionStore(db_path=path)
    finally:
        os.unlink(path)


@pytest.fixture
def runner(approval_gate, mock_anthropic_client, session_store):
    """Create an AgentRunner with mocked Anthropic client and temp session store."""
    return AgentRunner(
        approval_gate=approval_gate,
        client=mock_anthropic_client,
        session_store=session_store,
    )
