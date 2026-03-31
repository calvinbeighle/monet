"""Planning agent - handles task planning, sprint organization, and brainstorming."""

import json
import logging
import uuid

from agent.agents.base import BaseAgent
from agent.models import UIPattern

logger = logging.getLogger(__name__)


class PlanningAgent(BaseAgent):
    """Agent for planning and organizing work - sprint planning, brainstorming, task breakdown.

    Outputs structured node data for the whiteboard UI pattern. Each tool call
    produces or modifies nodes that render as draggable cards on the canvas.
    No external API integrations - all planning logic runs through Claude.

    Node state is scoped per session so concurrent planning sessions are isolated.
    """

    name = "planning"
    description = "Plans sprints, brainstorms ideas, and organizes tasks"
    default_ui_pattern = UIPattern.WHITEBOARD

    def __init__(self):
        # Per-session node storage: session_id -> {node_id -> node_dict}
        self._sessions: dict[str, dict[str, dict]] = {}
        self._current_session: str = "default"

    def set_session(self, session_id: str) -> None:
        """Set the active session for subsequent tool calls."""
        self._current_session = session_id
        if session_id not in self._sessions:
            self._sessions[session_id] = {}

    @property
    def _nodes(self) -> dict[str, dict]:
        """Get nodes for the current session."""
        if self._current_session not in self._sessions:
            self._sessions[self._current_session] = {}
        return self._sessions[self._current_session]

    @property
    def system_prompt(self) -> str:
        return (
            "You are Monet's planning assistant. You help users organize work, "
            "plan sprints, brainstorm ideas, and break down projects into tasks.\n\n"
            "Your output renders as a whiteboard with draggable nodes and connections. "
            "Use the tools provided to create structured plans:\n\n"
            "- Use create_node to add tasks, ideas, or milestones to the board\n"
            "- Use connect_nodes to show dependencies or relationships\n"
            "- Use update_node to refine titles, descriptions, or priority\n"
            "- Use remove_node to clean up the board\n"
            "- Use get_plan to see the current state of all nodes\n\n"
            "When planning a sprint or project:\n"
            "1. Start with high-level goals as top nodes\n"
            "2. Break each goal into concrete tasks\n"
            "3. Connect tasks to show dependencies\n"
            "4. Set priorities (high/medium/low) to guide execution order\n\n"
            "Position nodes logically - goals at the top, dependent tasks below. "
            "Space nodes so the board is readable (at least 250px apart vertically, "
            "350px apart horizontally for parallel tracks).\n\n"
            "Keep node titles short (under 50 chars). Use the body for details."
        )

    @property
    def tools(self) -> list[dict]:
        return [
            {
                "name": "create_node",
                "description": "Create a new node on the whiteboard. Returns the node ID.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "Short title for the node (under 50 chars)",
                        },
                        "body": {
                            "type": "string",
                            "description": "Detailed description or notes",
                        },
                        "x": {
                            "type": "number",
                            "description": "X position on canvas (default 100)",
                            "default": 100,
                        },
                        "y": {
                            "type": "number",
                            "description": "Y position on canvas (default 100)",
                            "default": 100,
                        },
                        "priority": {
                            "type": "string",
                            "description": "Priority level",
                            "enum": ["high", "medium", "low"],
                            "default": "medium",
                        },
                    },
                    "required": ["title"],
                },
            },
            {
                "name": "connect_nodes",
                "description": "Create a connection (dependency/relationship) between two nodes.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "from_id": {
                            "type": "string",
                            "description": "Source node ID",
                        },
                        "to_id": {
                            "type": "string",
                            "description": "Target node ID",
                        },
                    },
                    "required": ["from_id", "to_id"],
                },
            },
            {
                "name": "update_node",
                "description": "Update an existing node's title, body, position, or priority.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "node_id": {
                            "type": "string",
                            "description": "ID of the node to update",
                        },
                        "title": {
                            "type": "string",
                            "description": "New title (optional)",
                        },
                        "body": {
                            "type": "string",
                            "description": "New body text (optional)",
                        },
                        "x": {
                            "type": "number",
                            "description": "New X position (optional)",
                        },
                        "y": {
                            "type": "number",
                            "description": "New Y position (optional)",
                        },
                        "priority": {
                            "type": "string",
                            "description": "New priority (optional)",
                            "enum": ["high", "medium", "low"],
                        },
                    },
                    "required": ["node_id"],
                },
            },
            {
                "name": "remove_node",
                "description": "Remove a node and all its connections from the board.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "node_id": {
                            "type": "string",
                            "description": "ID of the node to remove",
                        },
                    },
                    "required": ["node_id"],
                },
            },
            {
                "name": "get_plan",
                "description": "Get the current state of all nodes on the board.",
                "input_schema": {
                    "type": "object",
                    "properties": {},
                    "required": [],
                },
            },
        ]

    @property
    def approval_required(self) -> set[str]:
        # Planning is non-destructive - no approval gates needed
        return set()

    @property
    def suggestions(self) -> list[str]:
        return [
            "Add more details",
            "Break down tasks",
            "Prioritize items",
            "Connect related tasks",
        ]

    def execute_tool(self, tool_name: str, parameters: dict) -> str:
        """Execute a planning tool. All state is held in memory for the session."""
        try:
            handler = getattr(self, f"_tool_{tool_name}", None)
            if handler is None:
                return json.dumps({"error": f"Unknown tool: {tool_name}"})
            return handler(parameters)
        except Exception as e:
            logger.error("Tool execution failed: %s(%s) - %s", tool_name, parameters, e)
            return json.dumps({"error": str(e)})

    def _tool_create_node(self, params: dict) -> str:
        node_id = uuid.uuid4().hex[:8]
        node = {
            "id": node_id,
            "title": params["title"],
            "body": params.get("body", ""),
            "x": params.get("x", 100),
            "y": params.get("y", 100),
            "priority": params.get("priority", "medium"),
            "connections": [],
        }
        self._nodes[node_id] = node
        return json.dumps({"id": node_id, "status": "created", "node": node})

    def _tool_connect_nodes(self, params: dict) -> str:
        from_id = params["from_id"]
        to_id = params["to_id"]

        if from_id not in self._nodes:
            return json.dumps({"error": f"Source node '{from_id}' not found"})
        if to_id not in self._nodes:
            return json.dumps({"error": f"Target node '{to_id}' not found"})

        from_node = self._nodes[from_id]
        if to_id not in from_node["connections"]:
            from_node["connections"].append(to_id)

        return json.dumps(
            {
                "status": "connected",
                "from": from_id,
                "to": to_id,
            }
        )

    def _tool_update_node(self, params: dict) -> str:
        node_id = params["node_id"]
        if node_id not in self._nodes:
            return json.dumps({"error": f"Node '{node_id}' not found"})

        node = self._nodes[node_id]
        for field in ("title", "body", "x", "y", "priority"):
            if field in params:
                node[field] = params[field]

        return json.dumps({"status": "updated", "node": node})

    def _tool_remove_node(self, params: dict) -> str:
        node_id = params["node_id"]
        if node_id not in self._nodes:
            return json.dumps({"error": f"Node '{node_id}' not found"})

        del self._nodes[node_id]
        # Remove connections pointing to this node
        for node in self._nodes.values():
            if node_id in node["connections"]:
                node["connections"].remove(node_id)

        return json.dumps({"status": "removed", "id": node_id})

    def _tool_get_plan(self, params: dict) -> str:
        return json.dumps(
            {
                "nodes": list(self._nodes.values()),
                "count": len(self._nodes),
            }
        )
