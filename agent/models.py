"""Data models for the Monet agent backend."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
import uuid


class UIPattern(str, Enum):
    TINDER = "tinder"
    CHAT = "chat"
    DIFF = "diff"
    WHITEBOARD = "whiteboard"


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


@dataclass
class AgentOutput:
    content: str
    status: str = "complete"
    metadata: dict = field(default_factory=dict)


@dataclass
class AgentResult:
    agent: str
    ui_pattern: str
    outputs: list[AgentOutput] = field(default_factory=list)


@dataclass
class AgentEvent:
    type: (
        str  # "token" | "tool_call" | "approval_request" | "whiteboard_update" | "done"
    )
    data: str = ""
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "type": self.type,
            "data": self.data,
            "metadata": self.metadata,
        }


@dataclass
class RoutedIntent:
    agent: str
    ui_pattern: str
    original: str


@dataclass
class ApprovalRequest:
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    tool_name: str = ""
    parameters: dict = field(default_factory=dict)
    status: ApprovalStatus = ApprovalStatus.PENDING
    session_id: Optional[str] = None
