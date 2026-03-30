"""
cli.py

CLI test harness for the Monet agent backend.
Sends an intent to the running server and prints the streamed SSE response.

Usage:
  python cli.py "handle my inbox"
  python cli.py "review the latest PR in acme/backend"
  python cli.py "help me plan our Q3 roadmap"

Requires the server to be running:
  uvicorn main:app --reload

Or set BASE_URL to point at a remote instance:
  BASE_URL=https://your-server.com python cli.py "your intent"
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

import httpx


BASE_URL = os.getenv("BASE_URL", "http://localhost:8420")


def send_intent(text: str) -> dict[str, Any]:
    """
    POST /intent and return the parsed JSON response.

    Args:
        text: The natural language intent to send.

    Returns:
        dict: The parsed IntentResponse JSON.

    Raises:
        SystemExit: If the request fails.
    """
    url = f"{BASE_URL}/intent"
    try:
        resp = httpx.post(url, json={"text": text}, timeout=10.0)
        resp.raise_for_status()
        return resp.json()
    except httpx.ConnectError:
        print(f"ERROR: Could not connect to {url}")
        print("Make sure the server is running: uvicorn main:app --reload")
        sys.exit(1)
    except httpx.HTTPStatusError as exc:
        print(f"ERROR: HTTP {exc.response.status_code} - {exc.response.text}")
        sys.exit(1)


def stream_events(session_id: str) -> None:
    """
    GET /stream/{session_id} and print each SSE event to stdout.

    Renders different event types with distinct formatting so it's easy
    to follow the agent's progress in the terminal.

    Args:
        session_id: The session to stream from.
    """
    url = f"{BASE_URL}/stream/{session_id}"

    print(f"\n--- Streaming session {session_id} ---\n")

    with httpx.stream("GET", url, timeout=None) as resp:
        resp.raise_for_status()

        current_event_type: str | None = None
        data_buffer: list[str] = []

        for line in resp.iter_lines():
            line = line.strip()

            if line.startswith("event:"):
                current_event_type = line[len("event:"):].strip()

            elif line.startswith("data:"):
                raw = line[len("data:"):].strip()
                data_buffer.append(raw)

            elif line == "" and data_buffer:
                # End of this event block - parse and render
                raw_data = " ".join(data_buffer)
                data_buffer = []

                try:
                    payload = json.loads(raw_data)
                except json.JSONDecodeError:
                    payload = {"raw": raw_data}

                _render_event(current_event_type or "unknown", payload)
                current_event_type = None

                # Stop streaming on terminal events
                if current_event_type in ("done", "error"):
                    break


def _render_event(event_type: str, payload: dict[str, Any]) -> None:
    """
    Print a single SSE event to stdout with human-friendly formatting.

    Args:
        event_type: The SSE event type string.
        payload: The parsed JSON payload dict.
    """
    if event_type == "thinking":
        print("[thinking...]", flush=True)

    elif event_type == "text":
        text = payload.get("text", "")
        print(text, end="", flush=True)

    elif event_type == "tool_call":
        tool_name = payload.get("tool_name", "?")
        tool_input = payload.get("tool_input", {})
        print(f"\n[tool call] {tool_name}({json.dumps(tool_input, indent=2)})", flush=True)

    elif event_type == "tool_result":
        tool_name = payload.get("tool_name", "?")
        result = payload.get("tool_result", "")
        print(f"\n[tool result] {tool_name}: {json.dumps(result)}", flush=True)

    elif event_type == "approval_required":
        action_id = payload.get("action_id", "?")
        desc = payload.get("action_description", "?")
        session_id = payload.get("session_id", "?")
        print(f"\n[APPROVAL REQUIRED] {desc}", flush=True)
        print(f"  To approve: POST {BASE_URL}/approve/{session_id}/{action_id}")
        print(f"  To reject:  POST {BASE_URL}/reject/{session_id}/{action_id}")
        print("  Waiting for decision...", flush=True)

    elif event_type == "approval_resolved":
        action_id = payload.get("action_id", "?")
        approved = payload.get("metadata", {}).get("approved")
        status = "APPROVED" if approved else "REJECTED"
        print(f"\n[{status}] action {action_id}", flush=True)

    elif event_type == "done":
        print("\n\n--- Session complete ---", flush=True)

    elif event_type == "error":
        error = payload.get("error", "unknown error")
        print(f"\n[ERROR] {error}", flush=True)

    else:
        print(f"\n[{event_type}] {json.dumps(payload)}", flush=True)


def check_status() -> None:
    """Print the server status to stdout."""
    try:
        resp = httpx.get(f"{BASE_URL}/status", timeout=5.0)
        resp.raise_for_status()
        data = resp.json()
        print(f"Server status: {data['status']}")
        print(f"  Model   : {data['model']}")
        print(f"  Sessions: {data['active_sessions']} active / {data['total_sessions']} total")
    except httpx.ConnectError:
        print(f"ERROR: Could not reach {BASE_URL}")
        sys.exit(1)


def main() -> None:
    """
    Entry point for the CLI test harness.

    Usage:
      python cli.py "your intent here"
      python cli.py --status
    """
    if len(sys.argv) < 2:
        print("Usage: python cli.py \"your intent here\"")
        print("       python cli.py --status")
        sys.exit(1)

    if sys.argv[1] == "--status":
        check_status()
        return

    intent = " ".join(sys.argv[1:])
    print(f"Intent: {intent}")
    print(f"Server: {BASE_URL}")

    # 1. Send the intent
    response = send_intent(intent)
    session_id = response["session_id"]
    agent = response["agent"]
    ui_pattern = response["ui_pattern"]

    print(f"Agent   : {agent}")
    print(f"UI      : {ui_pattern}")
    print(f"Session : {session_id}")

    # 2. Stream the events
    stream_events(session_id)


if __name__ == "__main__":
    main()
