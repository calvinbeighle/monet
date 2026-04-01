"""PTY WebSocket server - spawns real shell processes and pipes I/O over WebSocket.

Each session gets a real PTY (pseudo-terminal) with a shell process.
Supports multiple concurrent sessions, resize, and signal handling.

Usage:
    Register routes with FastAPI:
        from agent.pty_server import make_pty_router
        app.include_router(make_pty_router(), prefix="/api/pty")
"""

import asyncio
import fcntl
import logging
import os
import pty
import signal
import struct
import termios
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

DEFAULT_SHELL = os.environ.get("SHELL", "/bin/zsh")
DEFAULT_COLS = 120
DEFAULT_ROWS = 30


@dataclass
class TerminalSession:
    id: str
    pid: int
    fd: int  # master PTY file descriptor
    cols: int = DEFAULT_COLS
    rows: int = DEFAULT_ROWS
    created_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)
    title: str = "Terminal"
    command: str = ""
    cwd: str = ""
    status: str = "running"  # running, exited
    exit_code: Optional[int] = None
    websocket: Optional[WebSocket] = None


# Global session registry
_sessions: dict[str, TerminalSession] = {}


def _spawn_pty(
    command: str | None = None,
    cwd: str | None = None,
    cols: int = DEFAULT_COLS,
    rows: int = DEFAULT_ROWS,
    env: dict[str, str] | None = None,
) -> tuple[int, int]:
    """Spawn a process in a new PTY. Returns (pid, master_fd)."""
    import shlex

    cmd_str = command or DEFAULT_SHELL
    working_dir = cwd or os.path.expanduser("~")

    # Parse command string into args (handles "claude --print" etc.)
    try:
        args = shlex.split(cmd_str)
    except ValueError:
        args = [cmd_str]
    executable = args[0]

    # Build environment
    child_env = os.environ.copy()
    child_env["TERM"] = "xterm-256color"
    child_env["COLORTERM"] = "truecolor"
    if env:
        child_env.update(env)

    pid, fd = pty.fork()

    if pid == 0:
        # Child process
        os.chdir(working_dir)
        os.execvpe(executable, args, child_env)
    else:
        # Parent - set terminal size
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
        # Set non-blocking
        flags = fcntl.fcntl(fd, fcntl.F_GETFL)
        fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
        return pid, fd

    # Should never reach here
    return -1, -1


def create_session(
    command: str | None = None,
    cwd: str | None = None,
    title: str = "Terminal",
    cols: int = DEFAULT_COLS,
    rows: int = DEFAULT_ROWS,
    env: dict[str, str] | None = None,
) -> TerminalSession:
    """Create a new terminal session with a PTY process."""
    session_id = str(uuid.uuid4())[:8]
    pid, fd = _spawn_pty(command=command, cwd=cwd, cols=cols, rows=rows, env=env)

    session = TerminalSession(
        id=session_id,
        pid=pid,
        fd=fd,
        cols=cols,
        rows=rows,
        title=title,
        command=command or DEFAULT_SHELL,
        cwd=cwd or os.path.expanduser("~"),
    )
    _sessions[session_id] = session
    logger.info(
        f"[PTY] Created session {session_id} (pid={pid}, cmd={session.command})"
    )
    return session


def kill_session(session_id: str) -> bool:
    """Kill a terminal session and clean up."""
    session = _sessions.get(session_id)
    if not session:
        return False

    try:
        os.kill(session.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass

    try:
        os.close(session.fd)
    except OSError:
        pass

    try:
        os.waitpid(session.pid, os.WNOHANG)
    except ChildProcessError:
        pass

    session.status = "exited"
    del _sessions[session_id]
    logger.info(f"[PTY] Killed session {session_id}")
    return True


def resize_session(session_id: str, cols: int, rows: int) -> bool:
    """Resize a terminal session."""
    session = _sessions.get(session_id)
    if not session or session.status != "running":
        return False

    try:
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(session.fd, termios.TIOCSWINSZ, winsize)
        os.kill(session.pid, signal.SIGWINCH)
        session.cols = cols
        session.rows = rows
        return True
    except OSError:
        return False


def _check_process(session: TerminalSession) -> None:
    """Check if process is still alive, update status."""
    try:
        pid, status = os.waitpid(session.pid, os.WNOHANG)
        if pid != 0:
            session.status = "exited"
            session.exit_code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else -1
    except ChildProcessError:
        session.status = "exited"
        session.exit_code = -1


async def _read_pty_output(session: TerminalSession, websocket: WebSocket) -> None:
    """Read PTY output and send to WebSocket. Runs until session exits."""
    loop = asyncio.get_event_loop()
    fd = session.fd

    while session.status == "running":
        try:
            data = await loop.run_in_executor(None, lambda: _blocking_read(fd))
            if data is None:
                # True EOF - process exited
                _check_process(session)
                try:
                    await websocket.send_json(
                        {
                            "type": "exit",
                            "code": session.exit_code,
                        }
                    )
                except Exception:
                    pass
                break
            elif len(data) > 0:
                session.last_activity = time.time()
                try:
                    await websocket.send_bytes(data)
                except Exception:
                    break
            # Empty bytes = timeout, just loop again
        except asyncio.CancelledError:
            break
        except OSError as e:
            logger.debug(f"[PTY] OSError in read loop {session.id}: {e}")
            _check_process(session)
            break
        except Exception as e:
            logger.error(f"[PTY] Read error session {session.id}: {e}")
            break


def _blocking_read(fd: int) -> bytes | None:
    """Read from PTY fd with a short timeout. Returns None on true EOF, b'' on timeout."""
    import select

    try:
        readable, _, _ = select.select([fd], [], [], 0.1)
    except (ValueError, OSError):
        return None

    if readable:
        try:
            data = os.read(fd, 65536)
            if len(data) == 0:
                return None  # True EOF
            return data
        except OSError:
            return None
    return b""  # Timeout, no data yet


def make_pty_router() -> APIRouter:
    """Create FastAPI router for PTY terminal endpoints."""
    router = APIRouter()

    @router.get("/sessions")
    async def list_sessions():
        """List all terminal sessions."""
        # Check process status for each
        for s in _sessions.values():
            if s.status == "running":
                _check_process(s)

        return JSONResponse(
            [
                {
                    "id": s.id,
                    "title": s.title,
                    "command": s.command,
                    "cwd": s.cwd,
                    "status": s.status,
                    "exit_code": s.exit_code,
                    "cols": s.cols,
                    "rows": s.rows,
                    "created_at": s.created_at,
                    "last_activity": s.last_activity,
                }
                for s in _sessions.values()
            ]
        )

    @router.post("/sessions")
    async def create_session_endpoint(request: dict | None = None):
        """Create a new terminal session."""
        request = request or {}
        session = create_session(
            command=request.get("command"),
            cwd=request.get("cwd"),
            title=request.get("title", "Terminal"),
            cols=request.get("cols", DEFAULT_COLS),
            rows=request.get("rows", DEFAULT_ROWS),
            env=request.get("env"),
        )
        return JSONResponse(
            {
                "id": session.id,
                "title": session.title,
                "command": session.command,
                "cwd": session.cwd,
                "status": session.status,
                "cols": session.cols,
                "rows": session.rows,
                "created_at": session.created_at,
            }
        )

    @router.delete("/sessions/{session_id}")
    async def delete_session(session_id: str):
        """Kill and remove a terminal session."""
        if kill_session(session_id):
            return JSONResponse({"ok": True})
        return JSONResponse({"error": "Session not found"}, status_code=404)

    @router.post("/sessions/{session_id}/resize")
    async def resize_session_endpoint(session_id: str, request: dict):
        """Resize a terminal session."""
        cols = request.get("cols", DEFAULT_COLS)
        rows = request.get("rows", DEFAULT_ROWS)
        if resize_session(session_id, cols, rows):
            return JSONResponse({"ok": True})
        return JSONResponse(
            {"error": "Session not found or not running"}, status_code=404
        )

    @router.post("/sessions/{session_id}/signal")
    async def signal_session(session_id: str, request: dict):
        """Send a signal to a terminal session's process."""
        session = _sessions.get(session_id)
        if not session:
            return JSONResponse({"error": "Session not found"}, status_code=404)

        sig_name = request.get("signal", "SIGINT")
        sig = getattr(signal, sig_name, None)
        if sig is None:
            return JSONResponse(
                {"error": f"Unknown signal: {sig_name}"}, status_code=400
            )

        try:
            os.kill(session.pid, sig)
            return JSONResponse({"ok": True})
        except ProcessLookupError:
            return JSONResponse({"error": "Process not found"}, status_code=404)

    @router.websocket("/sessions/{session_id}/ws")
    async def websocket_terminal(websocket: WebSocket, session_id: str):
        """WebSocket endpoint for terminal I/O."""
        session = _sessions.get(session_id)
        if not session or session.status != "running":
            await websocket.close(code=4004, reason="Session not found or not running")
            return

        await websocket.accept()
        session.websocket = websocket
        logger.info(f"[PTY] WebSocket connected for session {session_id}")

        # Start reading PTY output in background
        read_task = asyncio.create_task(_read_pty_output(session, websocket))

        try:
            while True:
                message = await websocket.receive()

                if "bytes" in message:
                    # Raw terminal input
                    data = message["bytes"]
                    try:
                        os.write(session.fd, data)
                        session.last_activity = time.time()
                    except OSError:
                        break

                elif "text" in message:
                    # JSON control messages
                    import json

                    try:
                        msg = json.loads(message["text"])
                    except json.JSONDecodeError:
                        # Treat as raw text input
                        os.write(session.fd, message["text"].encode())
                        continue

                    if msg.get("type") == "resize":
                        resize_session(
                            session_id,
                            msg.get("cols", session.cols),
                            msg.get("rows", session.rows),
                        )
                    elif msg.get("type") == "signal":
                        sig_name = msg.get("signal", "SIGINT")
                        sig = getattr(signal, sig_name, None)
                        if sig:
                            try:
                                os.kill(session.pid, sig)
                            except ProcessLookupError:
                                pass
                    elif msg.get("type") == "input":
                        # Text input as JSON
                        text = msg.get("data", "")
                        os.write(session.fd, text.encode())

        except WebSocketDisconnect:
            logger.info(f"[PTY] WebSocket disconnected for session {session_id}")
        except Exception as e:
            logger.error(f"[PTY] WebSocket error for session {session_id}: {e}")
        finally:
            read_task.cancel()
            session.websocket = None

    return router
