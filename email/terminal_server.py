#!/usr/bin/env python3
"""
WebSocket PTY server with named sessions.
Each agent gets its own persistent PTY running Claude Code.
Reconnecting to the same session reattaches with full scrollback.

ws://localhost:8765/<session_id>
ws://localhost:8765/<session_id>?cmd=bash
"""

import asyncio
import fcntl
import json
import os
import pty
import select
import signal
import struct
import termios
from urllib.parse import parse_qs

import websockets

sessions = {}  # session_id -> {master_fd, pid, subscribers, buffer}

CLAUDE_PATH = os.path.expanduser("~/.local/bin/claude")
BUFFER_MAX = 131072  # 128KB scrollback


def create_session(session_id, cmd="claude"):
    master_fd, slave_fd = pty.openpty()

    # Set reasonable initial size
    winsize = struct.pack("HHHH", 30, 120, 0, 0)
    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)

    pid = os.fork()
    if pid == 0:
        # Child
        os.setsid()
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        os.close(master_fd)
        os.close(slave_fd)
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        if cmd == "claude":
            os.execve(CLAUDE_PATH, ["claude"], env)
        else:
            shell = os.environ.get("SHELL", "/bin/zsh")
            os.execve(shell, [os.path.basename(shell)], env)

    # Parent
    os.close(slave_fd)

    session = {
        "master_fd": master_fd,
        "pid": pid,
        "subscribers": set(),
        "buffer": bytearray(),
        "cmd": cmd,
    }
    sessions[session_id] = session
    print(f"[{session_id}] started {cmd} (pid {pid})")
    return session


async def pty_reader(session_id):
    """Read from PTY using select() and broadcast to WebSocket clients."""
    session = sessions.get(session_id)
    if not session:
        return

    fd = session["master_fd"]
    loop = asyncio.get_event_loop()

    while session_id in sessions:
        # Use select with a timeout to check if data is available
        try:
            readable, _, _ = select.select([fd], [], [], 0.05)
        except (ValueError, OSError):
            break

        if readable:
            try:
                data = os.read(fd, 16384)
            except OSError:
                break

            if not data:
                break

            # Buffer for reattach
            session["buffer"].extend(data)
            if len(session["buffer"]) > BUFFER_MAX:
                session["buffer"] = session["buffer"][-BUFFER_MAX:]

            # Broadcast
            dead = set()
            for ws in session["subscribers"]:
                try:
                    await ws.send(data)
                except Exception:
                    dead.add(ws)
            session["subscribers"] -= dead
        else:
            # Yield to event loop
            await asyncio.sleep(0)

    # Cleanup
    print(f"[{session_id}] process ended")
    if session_id in sessions:
        try:
            os.close(fd)
        except OSError:
            pass
        del sessions[session_id]


async def handler(websocket):
    path = websocket.request.path if hasattr(websocket, "request") else "/"
    parts = path.strip("/").split("?")
    session_id = parts[0] or "default"

    cmd = "claude"
    if "?" in path:
        qs = parse_qs(path.split("?", 1)[1])
        cmd = qs.get("cmd", ["claude"])[0]

    # Get or create session
    if session_id not in sessions:
        create_session(session_id, cmd)
        asyncio.create_task(pty_reader(session_id))

    session = sessions[session_id]
    session["subscribers"].add(websocket)
    print(f"[{session_id}] client attached ({len(session['subscribers'])} total)")

    # Send scrollback
    if session["buffer"]:
        try:
            await websocket.send(bytes(session["buffer"]))
        except Exception:
            return

    try:
        async for message in websocket:
            if session_id not in sessions:
                break
            if isinstance(message, str):
                try:
                    msg = json.loads(message)
                    if msg.get("type") == "resize":
                        ws_data = struct.pack("HHHH", msg["rows"], msg["cols"], 0, 0)
                        fcntl.ioctl(session["master_fd"], termios.TIOCSWINSZ, ws_data)
                        os.kill(session["pid"], signal.SIGWINCH)
                        continue
                except (json.JSONDecodeError, KeyError):
                    pass
                os.write(session["master_fd"], message.encode())
            else:
                os.write(session["master_fd"], message)
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        if session_id in sessions:
            sessions[session_id]["subscribers"].discard(websocket)
            print(
                f"[{session_id}] client detached ({len(sessions[session_id]['subscribers'])} left)"
            )


async def main():
    print("Terminal server on ws://localhost:8765/<session_id>")
    async with websockets.serve(handler, "0.0.0.0", 8765):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
