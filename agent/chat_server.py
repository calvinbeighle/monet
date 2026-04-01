"""Chat WebSocket server - Claude Code style agent with tool use.

Renders like Claude Code: compact tool-use summaries, not raw text dumps.
Each session runs an agentic loop with tools (Write, Bash, Read, etc.).
"""

import asyncio
import json
import logging
import os
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import anthropic
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

AI_MODEL = os.environ.get("TRACE_AI_MODEL", "claude-sonnet-4-6")
_client: anthropic.AsyncAnthropic | None = None


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic()
    return _client


TOOLS = [
    {
        "name": "bash",
        "description": "Run a bash command. Use for any shell operation: installing packages, git, curl, running scripts, etc.",
        "input_schema": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The bash command to execute",
                },
                "timeout": {
                    "type": "integer",
                    "description": "Timeout in seconds (default 60)",
                },
            },
            "required": ["command"],
        },
    },
    {
        "name": "write",
        "description": "Write content to a file. Creates directories as needed.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Absolute file path"},
                "content": {"type": "string", "description": "Content to write"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "read",
        "description": "Read a file's contents.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Absolute file path"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "edit",
        "description": "Replace a specific string in a file with new content. The old_string must match exactly.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Absolute file path"},
                "old_string": {
                    "type": "string",
                    "description": "Exact text to find and replace",
                },
                "new_string": {"type": "string", "description": "Replacement text"},
            },
            "required": ["path", "old_string", "new_string"],
        },
    },
    {
        "name": "glob",
        "description": "Find files matching a glob pattern. Returns file paths.",
        "input_schema": {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Glob pattern like **/*.tsx or src/**/*.py",
                },
                "path": {
                    "type": "string",
                    "description": "Directory to search in (default: home)",
                },
            },
            "required": ["pattern"],
        },
    },
    {
        "name": "grep",
        "description": "Search file contents for a regex pattern. Returns matching lines with file paths.",
        "input_schema": {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Regex pattern to search for",
                },
                "path": {
                    "type": "string",
                    "description": "File or directory to search in",
                },
                "include": {
                    "type": "string",
                    "description": "File glob filter like *.ts",
                },
            },
            "required": ["pattern"],
        },
    },
    {
        "name": "web_search",
        "description": "Search the web for information. Returns search results with titles, URLs, and snippets.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "web_fetch",
        "description": "Fetch the content of a web page. Returns the page text.",
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to fetch"},
            },
            "required": ["url"],
        },
    },
]

SYSTEM_PROMPT = """You are Claude Code, a fully capable AI coding assistant with access to the user's machine and the internet.

You have these tools:
- bash: Run any shell command (curl, git, npm, python, etc.)
- write: Create or overwrite files
- read: Read file contents
- edit: Replace specific text in a file
- glob: Find files by pattern
- grep: Search file contents with regex
- web_search: Search the internet for information
- web_fetch: Fetch and read web page content

USE YOUR TOOLS for everything. Do not output raw code in text - use write to create files, bash to run commands, web_search to find information online.

The user's home directory is /Users/calvinbeighle. Write files under /Users/calvinbeighle/ or /tmp/.

Keep text responses short (1-3 sentences). No emoji. No markdown. State what you did plainly."""


def _run_bash(command: str, timeout: int = 60) -> str:
    """Execute a bash command, return output."""
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd="/Users/calvinbeighle",
            env={
                **os.environ,
                "PATH": os.environ.get("PATH", "")
                + ":/usr/local/bin:/opt/homebrew/bin",
            },
        )
        output = result.stdout
        if result.stderr:
            output += "\n" + result.stderr
        return output.strip()[:8000] or "(no output)"
    except subprocess.TimeoutExpired:
        return f"(command timed out after {timeout}s)"
    except Exception as e:
        return f"(error: {e})"


def _write_file(path: str, content: str) -> str:
    try:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        lines = content.count("\n") + 1
        return f"Wrote {lines} lines to {path}"
    except Exception as e:
        return f"Error writing file: {e}"


def _read_file(path: str) -> str:
    try:
        content = Path(path).read_text()
        return content[:8000]
    except Exception as e:
        return f"Error reading file: {e}"


def _edit_file(path: str, old_string: str, new_string: str) -> str:
    try:
        p = Path(path)
        content = p.read_text()
        if old_string not in content:
            return f"Error: old_string not found in {path}"
        content = content.replace(old_string, new_string, 1)
        p.write_text(content)
        return f"Edited {path}"
    except Exception as e:
        return f"Error editing file: {e}"


def _glob_files(pattern: str, path: str | None = None) -> str:
    import glob as glob_mod

    base = path or "/Users/calvinbeighle"
    full_pattern = os.path.join(base, pattern)
    matches = sorted(glob_mod.glob(full_pattern, recursive=True))[:50]
    if not matches:
        return "No files found"
    return "\n".join(matches)


def _grep_files(
    pattern: str, path: str | None = None, include: str | None = None
) -> str:
    cmd = ["grep", "-rn", "--color=never", "-E", pattern]
    if include:
        cmd.extend(["--include", include])
    cmd.append(path or "/Users/calvinbeighle")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        output = result.stdout.strip()
        if not output:
            return "No matches found"
        lines = output.split("\n")
        if len(lines) > 30:
            return "\n".join(lines[:30]) + f"\n... ({len(lines) - 30} more matches)"
        return output
    except Exception as e:
        return f"Error: {e}"


def _web_search(query: str) -> str:
    """Web search via DuckDuckGo HTML (no API key needed)."""
    import urllib.request
    import urllib.parse
    import re

    try:
        url = "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote(query)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        resp = urllib.request.urlopen(req, timeout=10)
        html = resp.read().decode("utf-8", errors="replace")
        # Extract result snippets
        results = []
        for match in re.finditer(
            r'class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>.*?class="result__snippet"[^>]*>(.*?)</span>',
            html,
            re.DOTALL,
        ):
            href, title, snippet = match.groups()
            title = re.sub(r"<[^>]+>", "", title).strip()
            snippet = re.sub(r"<[^>]+>", "", snippet).strip()
            if title:
                results.append(f"- {title}\n  {snippet}\n  {href}")
            if len(results) >= 5:
                break
        return "\n\n".join(results) if results else "No results found"
    except Exception as e:
        return f"Search error: {e}"


def _web_fetch(url: str) -> str:
    """Fetch a web page and return text content."""
    import urllib.request
    import re

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        resp = urllib.request.urlopen(req, timeout=15)
        html = resp.read().decode("utf-8", errors="replace")
        # Strip tags for plain text
        text = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL)
        text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:8000]
    except Exception as e:
        return f"Fetch error: {e}"


def _execute_tool(name: str, input_data: dict) -> str:
    """Execute a tool and return the result."""
    if name == "bash":
        return _run_bash(input_data["command"], input_data.get("timeout", 60))
    elif name == "write":
        return _write_file(input_data["path"], input_data["content"])
    elif name == "read":
        return _read_file(input_data["path"])
    elif name == "edit":
        return _edit_file(
            input_data["path"], input_data["old_string"], input_data["new_string"]
        )
    elif name == "glob":
        return _glob_files(input_data["pattern"], input_data.get("path"))
    elif name == "grep":
        return _grep_files(
            input_data["pattern"], input_data.get("path"), input_data.get("include")
        )
    elif name == "web_search":
        return _web_search(input_data["query"])
    elif name == "web_fetch":
        return _web_fetch(input_data["url"])
    return f"Unknown tool: {name}"


@dataclass
class ChatSession:
    id: str
    title: str = "Claude Code"
    messages: list = field(default_factory=list)  # API message format
    created_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)
    status: str = "active"


_sessions: dict[str, ChatSession] = {}


def make_chat_router() -> APIRouter:
    router = APIRouter()

    @router.get("/sessions")
    async def list_sessions():
        return JSONResponse(
            [
                {
                    "id": s.id,
                    "title": s.title,
                    "status": s.status,
                    "created_at": s.created_at,
                    "last_activity": s.last_activity,
                    "message_count": len(s.messages),
                }
                for s in _sessions.values()
            ]
        )

    @router.post("/sessions")
    async def create_session(request: dict | None = None):
        request = request or {}
        session_id = str(uuid.uuid4())[:8]
        session = ChatSession(
            id=session_id,
            title=request.get("title", "Claude Code"),
        )
        _sessions[session_id] = session
        return JSONResponse(
            {
                "id": session.id,
                "title": session.title,
                "status": session.status,
                "created_at": session.created_at,
            }
        )

    @router.delete("/sessions/{session_id}")
    async def delete_session(session_id: str):
        if session_id in _sessions:
            del _sessions[session_id]
            return JSONResponse({"ok": True})
        return JSONResponse({"error": "Not found"}, status_code=404)

    @router.websocket("/sessions/{session_id}/ws")
    async def chat_ws(websocket: WebSocket, session_id: str):
        session = _sessions.get(session_id)
        if not session:
            await websocket.close(code=4004, reason="Session not found")
            return

        await websocket.accept()
        logger.info(f"[Chat] WebSocket connected for session {session_id}")

        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    msg = {"type": "message", "content": raw}

                if msg.get("type") == "message":
                    user_text = msg.get("content", "").strip()
                    if not user_text:
                        continue

                    session.messages.append({"role": "user", "content": user_text})
                    session.last_activity = time.time()

                    # Agentic loop - keeps going while Claude wants to use tools
                    await _agent_loop(session, websocket)

        except WebSocketDisconnect:
            logger.info(f"[Chat] WebSocket disconnected for session {session_id}")
        except Exception as e:
            logger.error(f"[Chat] Error for session {session_id}: {e}")

    return router


async def _agent_loop(session: ChatSession, websocket: WebSocket):
    """Run the agentic tool-use loop until Claude gives a final text response."""
    client = _get_client()
    max_iterations = 10

    for _ in range(max_iterations):
        try:
            # Use streaming to show text as it arrives
            response = await client.messages.create(
                model=AI_MODEL,
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                tools=TOOLS,
                messages=session.messages,
                stream=True,
            )
        except anthropic.APIError as e:
            await websocket.send_json(
                {"type": "error", "content": f"API error: {e.message}"}
            )
            return

        # Collect the full response while streaming text deltas
        assistant_content = []
        has_tool_use = False
        full_text = ""
        current_tool_input = ""
        current_tool_name = ""
        current_tool_id = ""
        in_tool = False
        tool_results_cache: dict[str, str] = {}

        async for event in response:
            if event.type == "content_block_start":
                block = event.content_block
                if block.type == "text":
                    in_tool = False
                elif block.type == "tool_use":
                    in_tool = True
                    current_tool_name = block.name
                    current_tool_id = block.id
                    current_tool_input = ""

            elif event.type == "content_block_delta":
                delta = event.delta
                if hasattr(delta, "text") and not in_tool:
                    full_text += delta.text
                    await websocket.send_json({"type": "delta", "content": delta.text})
                elif hasattr(delta, "partial_json"):
                    current_tool_input += delta.partial_json

            elif event.type == "content_block_stop":
                if in_tool:
                    has_tool_use = True
                    try:
                        tool_input = json.loads(current_tool_input)
                    except json.JSONDecodeError:
                        tool_input = {}

                    assistant_content.append(
                        {
                            "type": "tool_use",
                            "id": current_tool_id,
                            "name": current_tool_name,
                            "input": tool_input,
                        }
                    )

                    # Send tool_call to frontend
                    summary = _tool_summary(current_tool_name, tool_input)
                    await websocket.send_json(
                        {
                            "type": "tool_call",
                            "tool": current_tool_name,
                            "summary": summary,
                        }
                    )

                    # Execute tool
                    result = await asyncio.get_event_loop().run_in_executor(
                        None, _execute_tool, current_tool_name, tool_input
                    )
                    tool_results_cache[current_tool_id] = result

                    await websocket.send_json(
                        {
                            "type": "tool_result",
                            "tool": current_tool_name,
                            "result": result[:200],
                        }
                    )
                    in_tool = False
                else:
                    if full_text:
                        assistant_content.append({"type": "text", "text": full_text})

            elif event.type == "message_stop":
                break

        # Make sure text is captured
        if full_text and not any(b.get("type") == "text" for b in assistant_content):
            assistant_content.append({"type": "text", "text": full_text})

        # Store assistant message
        session.messages.append({"role": "assistant", "content": assistant_content})

        # If tool use, add results and continue loop
        if has_tool_use:
            tool_results = []
            for block in assistant_content:
                if block.get("type") == "tool_use":
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block["id"],
                            "content": tool_results_cache.get(block["id"], "")[:4000],
                        }
                    )
            session.messages.append({"role": "user", "content": tool_results})
            continue

        # No tool use - done
        await websocket.send_json({"type": "done", "content": full_text or "Done."})
        return

    await websocket.send_json({"type": "done", "content": "Reached tool use limit."})


def _tool_summary(name: str, input_data: dict) -> str:
    """Generate a Claude Code style one-line summary for a tool call."""
    if name == "bash":
        cmd = input_data.get("command", "")
        if len(cmd) > 80:
            cmd = cmd[:77] + "..."
        return f"$ {cmd}"
    elif name == "write":
        path = input_data.get("path", "")
        content = input_data.get("content", "")
        lines = content.count("\n") + 1
        return f"Write({path}) +{lines} lines"
    elif name == "read":
        return f"Read({input_data.get('path', '')})"
    elif name == "edit":
        return f"Edit({input_data.get('path', '')})"
    elif name == "glob":
        return f"Glob({input_data.get('pattern', '')})"
    elif name == "grep":
        return f"Grep({input_data.get('pattern', '')})"
    elif name == "web_search":
        return f"Search: {input_data.get('query', '')}"
    elif name == "web_fetch":
        url = input_data.get("url", "")
        if len(url) > 60:
            url = url[:57] + "..."
        return f"Fetch: {url}"
    return f"{name}(...)"
