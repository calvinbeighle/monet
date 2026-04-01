#!/usr/bin/env python3
"""
Ralph Loop Dashboard - clean, focused view of all running loops.

Usage: python3 ralph-dashboard.py [port]
Default: http://localhost:8111
"""

import json
import os
import subprocess
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from datetime import datetime
import glob as globmod


def find_loops():
    loops = []
    try:
        result = subprocess.run(
            ["ps", "aux"], capture_output=True, text=True, timeout=5
        )
        for line in result.stdout.splitlines():
            if "loop.sh" in line and "grep" not in line and "/bin/bash" in line:
                parts = line.split()
                pid = int(parts[1])
                lsof = subprocess.run(
                    ["lsof", "-p", str(pid)], capture_output=True, text=True, timeout=5
                )
                cwd = ""
                for l in lsof.stdout.splitlines():
                    if "cwd" in l:
                        cwd = l.split()[-1]
                        break
                if cwd:
                    loops.append({"pid": pid, "cwd": cwd, "name": Path(cwd).name})
    except Exception:
        pass
    return loops


def find_output_file(cwd):
    cwd_slug = "-" + cwd.replace("/", "-").lstrip("-")
    base = "/private/tmp"
    candidates = []
    for d in Path(base).glob("claude-*"):
        for session_dir in d.iterdir():
            if not session_dir.is_dir():
                continue
            if session_dir.name == cwd_slug:
                for tasks_dir in session_dir.glob("*/tasks"):
                    for f in tasks_dir.glob("*.output"):
                        if f.stat().st_size > 0:
                            candidates.append(f)
    if not candidates:
        return None
    now = datetime.now().timestamp()
    recent = [f for f in candidates if (now - f.stat().st_mtime) < 1800]
    if not recent:
        recent = candidates
    recent.sort(key=lambda f: f.stat().st_size, reverse=True)
    return str(recent[0])


def parse_events(filepath):
    if not filepath or not os.path.exists(filepath):
        return {}

    try:
        with open(filepath, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            read_size = min(size, 400_000)
            f.seek(max(0, size - read_size))
            raw = f.read().decode("utf-8", errors="replace")
    except Exception:
        return {}

    lines = raw.strip().splitlines()[-600:]

    thinking_lines = []
    total_input = 0
    total_output = 0
    tool_counts = {}
    files_written = []
    files_edited = []
    bash_cmds = []
    subagent_descs = []
    subagent_done = 0
    subagent_total = 0

    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue

        etype = d.get("type", "")
        subtype = d.get("subtype", "")

        if etype == "assistant":
            msg = d.get("message", {})
            usage = msg.get("usage", {})
            total_input += usage.get("input_tokens", 0)
            total_output += usage.get("output_tokens", 0)

            for c in msg.get("content", []):
                if c.get("type") == "text":
                    txt = c.get("text", "").strip()
                    if txt and len(txt) > 20:
                        thinking_lines.append(txt)
                elif c.get("type") == "tool_use":
                    name = c.get("name", "?")
                    tool_counts[name] = tool_counts.get(name, 0) + 1
                    inp = c.get("input", {})
                    if name == "Write":
                        fp = inp.get("file_path", "")
                        if fp:
                            files_written.append(Path(fp).name)
                    elif name == "Edit":
                        fp = inp.get("file_path", "")
                        if fp:
                            files_edited.append(Path(fp).name)
                    elif name == "Bash":
                        cmd = inp.get("command", "")
                        if cmd and not cmd.startswith("cat ") and len(cmd) > 5:
                            bash_cmds.append(cmd[:120])
                    elif name == "Agent":
                        desc = inp.get("description", "")
                        if desc:
                            subagent_descs.append(desc)

        elif etype == "system":
            if subtype == "task_started":
                subagent_total += 1
            elif subtype == "task_notification":
                if d.get("status") == "completed":
                    subagent_done += 1

    # Extract the last few meaningful thinking blocks
    meaningful = [t for t in thinking_lines if not t.startswith("I'll") or len(t) > 50]

    return {
        "thinking": meaningful[-8:] if meaningful else [],
        "tokens": total_input + total_output,
        "tool_calls": sum(tool_counts.values()),
        "files_written": list(dict.fromkeys(files_written[-15:])),
        "files_edited": list(dict.fromkeys(files_edited[-15:])),
        "bash_cmds": bash_cmds[-10:],
        "subagents": f"{subagent_done}/{subagent_total}",
        "last_modified": datetime.fromtimestamp(os.path.getmtime(filepath)).strftime(
            "%H:%M:%S"
        )
        if filepath
        else "",
    }


def get_git_info(cwd):
    try:
        git_root = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            cwd=cwd,
            timeout=5,
        ).stdout.strip()
        if os.path.realpath(cwd) == os.path.realpath(git_root):
            log_cmd = ["git", "log", "--oneline", "-5"]
        else:
            rel = os.path.relpath(cwd, git_root)
            log_cmd = ["git", "log", "--oneline", "-5", "--", rel]
        log = subprocess.run(
            log_cmd, capture_output=True, text=True, cwd=cwd, timeout=5
        )
        return log.stdout.strip().splitlines()[:5]
    except Exception:
        return []


def _esc(s):
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def fmt_tokens(n):
    if n > 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n > 1_000:
        return f"{n / 1_000:.0f}k"
    return str(n)


def render_card(d):
    ev = d.get("events", {})
    commits = d.get("commits", [])

    # Current focus - last meaningful thinking
    thinking_html = ""
    for t in ev.get("thinking", []):
        thinking_html += f'<div class="thinking-line">{_esc(t[:300])}</div>'

    # Files changed
    written = ev.get("files_written", [])
    edited = ev.get("files_edited", [])
    all_files = []
    for f in written:
        all_files.append(f'<span class="file new">{_esc(f)}</span>')
    for f in edited:
        if f not in written:
            all_files.append(f'<span class="file edit">{_esc(f)}</span>')
    files_html = (
        " ".join(all_files) if all_files else '<span class="muted">none yet</span>'
    )

    # Commands run
    cmds_html = ""
    for cmd in ev.get("bash_cmds", []):
        cmds_html += f'<div class="cmd">$ {_esc(cmd)}</div>'

    # Commits
    commits_html = ""
    for c in commits:
        commits_html += f'<div class="commit">{_esc(c)}</div>'

    tokens = ev.get("tokens", 0)
    tools = ev.get("tool_calls", 0)
    updated = ev.get("last_modified", "?")

    return f"""
    <div class="card">
        <div class="header">
            <div class="left">
                <span class="dot"></span>
                <span class="name">{_esc(d["name"])}</span>
            </div>
            <div class="right">
                <span class="meta">{fmt_tokens(tokens)} tok</span>
                <span class="meta">{tools} calls</span>
                <span class="meta">{ev.get("subagents", "0/0")} agents</span>
                <span class="meta dim">{updated}</span>
            </div>
        </div>

        <div class="section">
            <div class="label">What it's doing</div>
            <div class="thinking">{thinking_html or '<span class="muted">starting up...</span>'}</div>
        </div>

        <div class="section">
            <div class="label">Files touched</div>
            <div class="files">{files_html}</div>
        </div>

        <div class="section">
            <div class="label">Commands</div>
            <div class="cmds">{cmds_html or '<span class="muted">none</span>'}</div>
        </div>

        <div class="section">
            <div class="label">Commits</div>
            <div class="commits">{commits_html or '<span class="muted">none yet this iteration</span>'}</div>
        </div>
    </div>"""


HTML = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Ralph Loops</title>
<meta http-equiv="refresh" content="5">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    background: #000;
    color: #999;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 13px;
    padding: 24px;
}
h1 {
    color: #555;
    font-size: 11px;
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 2px;
    margin-bottom: 20px;
}
h1 span { color: #333; }
.grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
    gap: 12px;
}
.card {
    background: #0a0a0a;
    border: 1px solid #1a1a1a;
    border-radius: 4px;
    padding: 14px 16px;
}
.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
    padding-bottom: 10px;
    border-bottom: 1px solid #1a1a1a;
}
.left { display: flex; align-items: center; gap: 8px; }
.right { display: flex; gap: 12px; align-items: center; }
.dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: #fff;
    animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.2} }
.name { color: #fff; font-size: 14px; font-weight: 600; }
.meta { color: #555; font-size: 11px; }
.meta.dim { color: #333; }
.section { margin-bottom: 10px; }
.label {
    color: #444;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 4px;
}
.thinking {
    background: #050505;
    border-radius: 3px;
    padding: 8px 10px;
    max-height: none;
    overflow: visible;
}
.thinking-line {
    color: #ccc;
    font-size: 12px;
    line-height: 1.5;
    margin-bottom: 4px;
}
.files {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}
.file {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
}
.file.new { background: #1a1a1a; color: #bbb; }
.file.edit { background: #151515; color: #888; }
.cmd {
    color: #666;
    font-size: 11px;
    padding: 2px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.commit {
    font-size: 11px;
    color: #555;
    padding: 1px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.commit:first-child { color: #999; }
.muted { color: #555; font-size: 11px; }
.empty {
    color: #333;
    text-align: center;
    padding: 80px 20px;
}
</style>
</head>
<body>
<h1>Ralph Loops <span>%TIMESTAMP%</span></h1>
%CONTENT%
</body>
</html>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        loops = find_loops()
        dashboard = []
        for loop in loops:
            output_file = find_output_file(loop["cwd"])
            events = parse_events(output_file)
            commits = get_git_info(loop["cwd"])
            dashboard.append({**loop, "events": events, "commits": commits})

        if self.path == "/api/data":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(dashboard, default=str).encode())
            return

        if not dashboard:
            content = '<div class="empty">No running Ralph loops found.</div>'
        else:
            content = (
                '<div class="grid">'
                + "".join(render_card(d) for d in dashboard)
                + "</div>"
            )

        html = HTML.replace("%CONTENT%", content).replace(
            "%TIMESTAMP%", datetime.now().strftime("%H:%M:%S")
        )
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(html.encode())

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8111
    server = HTTPServer(("0.0.0.0", port), Handler)
    print(f"Ralph Loops: http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
