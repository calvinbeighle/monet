"""CLI test harness - calls agent backend, shows streaming output, prompts for approvals."""

import argparse
import json
import sys
import threading

import httpx

DEFAULT_BASE_URL = "http://localhost:8000"


def run_streaming(base_url: str, intent: str, session_id: str | None = None):
    """Stream agent events and handle approval prompts interactively."""
    payload: dict = {"intent": intent}
    if session_id:
        payload["session_id"] = session_id

    print(f"\n--- Monet Agent ---")
    print(f"Intent: {intent}\n")

    with httpx.stream(
        "POST",
        f"{base_url}/api/stream",
        json=payload,
        timeout=600,
    ) as response:
        response.raise_for_status()

        for line in response.iter_lines():
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue

            event_type = event.get("type", "")

            if event_type == "routing":
                agent = event.get("metadata", {}).get("agent", "unknown")
                pattern = event.get("metadata", {}).get("ui_pattern", "unknown")
                print(f"[Routed to: {agent} agent | UI: {pattern}]")

            elif event_type == "token":
                sys.stdout.write(event.get("data", ""))
                sys.stdout.flush()

            elif event_type == "tool_call":
                tool = event.get("data", "unknown")
                params = event.get("metadata", {}).get("parameters", {})
                print(f"\n[Tool call: {tool}]")
                if params:
                    print(f"  Parameters: {json.dumps(params, indent=2)}")

            elif event_type == "approval_request":
                tool = event.get("data", "unknown")
                approval_id = event.get("metadata", {}).get("approval_id", "")
                params = event.get("metadata", {}).get("parameters", {})

                print(f"\n{'=' * 50}")
                print(f"APPROVAL REQUIRED: {tool}")
                if params:
                    print(f"Parameters: {json.dumps(params, indent=2)}")
                print(f"{'=' * 50}")

                # Prompt user for approval in a separate thread to not block streaming
                _handle_approval_interactive(base_url, approval_id, tool)

            elif event_type == "error":
                print(f"\n[Error: {event.get('data', 'unknown error')}]")

            elif event_type == "done":
                print("\n\n--- Done ---")

    print()


def _handle_approval_interactive(base_url: str, approval_id: str, tool_name: str):
    """Prompt user for approval and send the decision to the backend."""
    while True:
        choice = input(f"Approve '{tool_name}'? [y/n]: ").strip().lower()
        if choice in ("y", "yes"):
            resp = httpx.post(f"{base_url}/api/approvals/{approval_id}/approve")
            if resp.status_code == 200:
                print("[Approved]")
            else:
                print(f"[Approval failed: {resp.text}]")
            break
        elif choice in ("n", "no"):
            resp = httpx.post(f"{base_url}/api/approvals/{approval_id}/reject")
            if resp.status_code == 200:
                print("[Rejected]")
            else:
                print(f"[Rejection failed: {resp.text}]")
            break
        else:
            print("Please enter 'y' or 'n'")


def run_sync(base_url: str, intent: str, session_id: str | None = None):
    """Run agent synchronously and print the result."""
    payload: dict = {"intent": intent}
    if session_id:
        payload["session_id"] = session_id

    print(f"\n--- Monet Agent (sync) ---")
    print(f"Intent: {intent}\n")

    resp = httpx.post(f"{base_url}/api/run", json=payload, timeout=600)
    resp.raise_for_status()
    result = resp.json()

    print(f"Agent: {result.get('agent', 'unknown')}")
    print(f"UI Pattern: {result.get('ui_pattern', 'unknown')}")
    print()

    for output in result.get("outputs", []):
        status = output.get("status", "complete")
        if status == "pending_approval":
            print(f"[Pending approval] {output.get('content', '')}")
            metadata = output.get("metadata", {})
            if metadata.get("approval_id"):
                _handle_approval_interactive(
                    base_url,
                    metadata["approval_id"],
                    metadata.get("tool_name", "unknown"),
                )
        else:
            print(output.get("content", ""))

    print("\n--- Done ---")


def main():
    parser = argparse.ArgumentParser(description="Monet Agent CLI")
    parser.add_argument("intent", nargs="?", help="The intent to send to the agent")
    parser.add_argument("--url", default=DEFAULT_BASE_URL, help="Agent backend URL")
    parser.add_argument(
        "--session", default=None, help="Session ID for conversation continuity"
    )
    parser.add_argument(
        "--sync", action="store_true", help="Use synchronous mode instead of streaming"
    )
    args = parser.parse_args()

    if not args.intent:
        parser.print_help()
        sys.exit(1)

    try:
        if args.sync:
            run_sync(args.url, args.intent, session_id=args.session)
        else:
            run_streaming(args.url, args.intent, session_id=args.session)
    except httpx.ConnectError:
        print(f"Error: Could not connect to agent backend at {args.url}")
        print("Make sure the server is running: uvicorn agent.main:app --port 8000")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nInterrupted.")
        sys.exit(0)


if __name__ == "__main__":
    main()
