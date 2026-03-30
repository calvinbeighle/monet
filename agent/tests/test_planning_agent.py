"""Tests for the planning agent."""

import json

from agent.agents.planning import PlanningAgent
from agent.models import UIPattern


class TestPlanningAgent:
    def setup_method(self):
        self.agent = PlanningAgent()

    def test_name(self):
        assert self.agent.name == "planning"

    def test_default_ui_pattern(self):
        assert self.agent.default_ui_pattern == UIPattern.WHITEBOARD

    def test_system_prompt_not_empty(self):
        assert len(self.agent.system_prompt) > 0

    def test_tools_defined(self):
        tools = self.agent.tools
        tool_names = {t["name"] for t in tools}
        assert "create_node" in tool_names
        assert "connect_nodes" in tool_names
        assert "update_node" in tool_names
        assert "remove_node" in tool_names
        assert "get_plan" in tool_names

    def test_tools_have_required_fields(self):
        for tool in self.agent.tools:
            assert "name" in tool
            assert "description" in tool
            assert "input_schema" in tool
            assert tool["input_schema"]["type"] == "object"

    def test_no_approval_required(self):
        """Planning is non-destructive - no tools need approval."""
        assert len(self.agent.approval_required) == 0

    def test_execute_unknown_tool(self):
        result = json.loads(self.agent.execute_tool("nonexistent_tool", {}))
        assert "error" in result

    def test_create_node(self):
        result = json.loads(
            self.agent.execute_tool(
                "create_node", {"title": "Design API", "body": "REST endpoints"}
            )
        )
        assert result["status"] == "created"
        assert result["node"]["title"] == "Design API"
        assert result["node"]["body"] == "REST endpoints"
        assert "id" in result

    def test_create_node_defaults(self):
        result = json.loads(self.agent.execute_tool("create_node", {"title": "Task"}))
        node = result["node"]
        assert node["x"] == 100
        assert node["y"] == 100
        assert node["priority"] == "medium"
        assert node["body"] == ""
        assert node["connections"] == []

    def test_create_node_with_position(self):
        result = json.loads(
            self.agent.execute_tool(
                "create_node", {"title": "Task", "x": 500, "y": 300, "priority": "high"}
            )
        )
        node = result["node"]
        assert node["x"] == 500
        assert node["y"] == 300
        assert node["priority"] == "high"

    def test_connect_nodes(self):
        n1 = json.loads(self.agent.execute_tool("create_node", {"title": "A"}))
        n2 = json.loads(self.agent.execute_tool("create_node", {"title": "B"}))

        result = json.loads(
            self.agent.execute_tool(
                "connect_nodes", {"from_id": n1["id"], "to_id": n2["id"]}
            )
        )
        assert result["status"] == "connected"

        # Verify the connection exists
        plan = json.loads(self.agent.execute_tool("get_plan", {}))
        source = next(n for n in plan["nodes"] if n["id"] == n1["id"])
        assert n2["id"] in source["connections"]

    def test_connect_nodes_idempotent(self):
        """Connecting the same nodes twice should not duplicate."""
        n1 = json.loads(self.agent.execute_tool("create_node", {"title": "A"}))
        n2 = json.loads(self.agent.execute_tool("create_node", {"title": "B"}))

        self.agent.execute_tool(
            "connect_nodes", {"from_id": n1["id"], "to_id": n2["id"]}
        )
        self.agent.execute_tool(
            "connect_nodes", {"from_id": n1["id"], "to_id": n2["id"]}
        )

        plan = json.loads(self.agent.execute_tool("get_plan", {}))
        source = next(n for n in plan["nodes"] if n["id"] == n1["id"])
        assert source["connections"].count(n2["id"]) == 1

    def test_connect_nonexistent_source(self):
        n1 = json.loads(self.agent.execute_tool("create_node", {"title": "A"}))
        result = json.loads(
            self.agent.execute_tool(
                "connect_nodes", {"from_id": "missing", "to_id": n1["id"]}
            )
        )
        assert "error" in result

    def test_connect_nonexistent_target(self):
        n1 = json.loads(self.agent.execute_tool("create_node", {"title": "A"}))
        result = json.loads(
            self.agent.execute_tool(
                "connect_nodes", {"from_id": n1["id"], "to_id": "missing"}
            )
        )
        assert "error" in result

    def test_update_node(self):
        n1 = json.loads(self.agent.execute_tool("create_node", {"title": "Draft"}))
        result = json.loads(
            self.agent.execute_tool(
                "update_node",
                {
                    "node_id": n1["id"],
                    "title": "Final",
                    "body": "Updated description",
                    "priority": "high",
                },
            )
        )
        assert result["status"] == "updated"
        assert result["node"]["title"] == "Final"
        assert result["node"]["body"] == "Updated description"
        assert result["node"]["priority"] == "high"

    def test_update_node_partial(self):
        """Updating only some fields should leave others unchanged."""
        n1 = json.loads(
            self.agent.execute_tool(
                "create_node", {"title": "Task", "body": "Original", "priority": "low"}
            )
        )
        result = json.loads(
            self.agent.execute_tool(
                "update_node", {"node_id": n1["id"], "title": "New Title"}
            )
        )
        assert result["node"]["title"] == "New Title"
        assert result["node"]["body"] == "Original"
        assert result["node"]["priority"] == "low"

    def test_update_nonexistent_node(self):
        result = json.loads(
            self.agent.execute_tool(
                "update_node", {"node_id": "missing", "title": "Nope"}
            )
        )
        assert "error" in result

    def test_remove_node(self):
        n1 = json.loads(self.agent.execute_tool("create_node", {"title": "A"}))
        result = json.loads(
            self.agent.execute_tool("remove_node", {"node_id": n1["id"]})
        )
        assert result["status"] == "removed"

        plan = json.loads(self.agent.execute_tool("get_plan", {}))
        assert plan["count"] == 0

    def test_remove_node_cleans_connections(self):
        """Removing a node should remove connections pointing to it."""
        n1 = json.loads(self.agent.execute_tool("create_node", {"title": "A"}))
        n2 = json.loads(self.agent.execute_tool("create_node", {"title": "B"}))
        self.agent.execute_tool(
            "connect_nodes", {"from_id": n1["id"], "to_id": n2["id"]}
        )

        self.agent.execute_tool("remove_node", {"node_id": n2["id"]})

        plan = json.loads(self.agent.execute_tool("get_plan", {}))
        source = next(n for n in plan["nodes"] if n["id"] == n1["id"])
        assert n2["id"] not in source["connections"]

    def test_remove_nonexistent_node(self):
        result = json.loads(
            self.agent.execute_tool("remove_node", {"node_id": "missing"})
        )
        assert "error" in result

    def test_get_plan_empty(self):
        result = json.loads(self.agent.execute_tool("get_plan", {}))
        assert result["count"] == 0
        assert result["nodes"] == []

    def test_get_plan_with_nodes(self):
        self.agent.execute_tool("create_node", {"title": "A"})
        self.agent.execute_tool("create_node", {"title": "B"})
        self.agent.execute_tool("create_node", {"title": "C"})

        result = json.loads(self.agent.execute_tool("get_plan", {}))
        assert result["count"] == 3
        titles = {n["title"] for n in result["nodes"]}
        assert titles == {"A", "B", "C"}

    def test_full_planning_workflow(self):
        """End-to-end: create nodes, connect them, update, remove, verify."""
        goal = json.loads(
            self.agent.execute_tool(
                "create_node",
                {"title": "Launch MVP", "x": 400, "y": 50, "priority": "high"},
            )
        )
        task1 = json.loads(
            self.agent.execute_tool(
                "create_node", {"title": "Build API", "x": 200, "y": 300}
            )
        )
        task2 = json.loads(
            self.agent.execute_tool(
                "create_node", {"title": "Build UI", "x": 600, "y": 300}
            )
        )

        self.agent.execute_tool(
            "connect_nodes", {"from_id": goal["id"], "to_id": task1["id"]}
        )
        self.agent.execute_tool(
            "connect_nodes", {"from_id": goal["id"], "to_id": task2["id"]}
        )

        self.agent.execute_tool(
            "update_node", {"node_id": task1["id"], "body": "FastAPI + SQLite"}
        )

        plan = json.loads(self.agent.execute_tool("get_plan", {}))
        assert plan["count"] == 3

        goal_node = next(n for n in plan["nodes"] if n["id"] == goal["id"])
        assert len(goal_node["connections"]) == 2

        self.agent.execute_tool("remove_node", {"node_id": task2["id"]})

        plan = json.loads(self.agent.execute_tool("get_plan", {}))
        assert plan["count"] == 2
        goal_node = next(n for n in plan["nodes"] if n["id"] == goal["id"])
        assert task2["id"] not in goal_node["connections"]
