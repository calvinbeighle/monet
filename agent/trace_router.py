"""Trace Messaging data endpoints - factory-function router pattern.

Exposes local data sources (Arc browser, git history, Claude sessions,
calendar), proxies Gmail API calls through Nango, and proxies Claude AI
calls for workstream detection, context linking, and summarization.

Register with:
    from agent.trace_router import make_trace_router
    app.include_router(make_trace_router(nango_mgr), prefix="/api/trace")
"""

import asyncio
import json
import logging
import os
import sqlite3
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import anthropic
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from agent.nango import nango_proxy_request

# Global rate limiter for Claude AI calls (max 3 concurrent)
_ai_semaphore = asyncio.Semaphore(3)
_ai_client: anthropic.AsyncAnthropic | None = None

AI_MODEL = os.environ.get("TRACE_AI_MODEL", "claude-sonnet-4-6")


def _get_ai_client() -> anthropic.AsyncAnthropic:
    """Lazily create the async Anthropic client."""
    global _ai_client
    if _ai_client is None:
        _ai_client = anthropic.AsyncAnthropic()
    return _ai_client


logger = logging.getLogger(__name__)

# Apple Core Data epoch offset: seconds from 1970-01-01 to 2001-01-01
CORE_DATA_OFFSET = 978307200

# Windows FILETIME epoch offset: microseconds from 1601-01-01 to 1970-01-01
FILETIME_OFFSET_US = 11644473600000000


def _core_data_to_unix_ms(ts: float) -> int:
    """Convert Apple Core Data timestamp (seconds since 2001-01-01) to Unix epoch ms."""
    return int((ts + CORE_DATA_OFFSET) * 1000)


def _filetime_to_unix_ms(filetime: int) -> int:
    """Convert Windows FILETIME (microseconds since 1601-01-01) to Unix epoch ms."""
    return int((filetime - FILETIME_OFFSET_US) / 1000)


def _extract_domain(url: str) -> str:
    """Extract domain (netloc) from a URL string."""
    try:
        return urlparse(url).netloc
    except Exception:
        return ""


def _load_sidebar_spaces(sidebar_path: Path) -> dict[str, str]:
    """Return a mapping of containerID -> spaceName from the Arc sidebar file.

    Only reads the spaces list from sidebar.containers[1]; safe to call
    independently so archive endpoint can reuse it.
    """
    if not sidebar_path.exists():
        return {}
    try:
        data = json.loads(sidebar_path.read_text(encoding="utf-8"))
        containers = data.get("sidebar", {}).get("containers", [])
        if len(containers) < 2:
            return {}
        container = containers[1]
        spaces_raw = container.get("spaces", [])

        # spaces[] alternates: UUID string, then object with title/containerIDs
        space_map: dict[str, str] = {}  # containerID -> spaceName
        i = 0
        while i + 1 < len(spaces_raw):
            space_obj = spaces_raw[i + 1]
            if isinstance(space_obj, dict):
                title = space_obj.get("title", "Unknown Space")
                for cid in space_obj.get("containerIDs", []):
                    space_map[cid] = title
            i += 2
        return space_map
    except Exception as e:
        logger.warning("Failed to load Arc sidebar spaces: %s", e)
        return {}


def make_trace_router(nango_mgr) -> APIRouter:
    """Factory function - returns a configured APIRouter for Trace data endpoints.

    Args:
        nango_mgr: A NangoManager instance (from agent.nango) used for Gmail proxying.

    Returns:
        APIRouter with all /arc, /git, /claude-sessions, /calendar, and /gmail routes.
        Register with prefix="/api/trace".
    """
    router = APIRouter()

    # -------------------------------------------------------------------------
    # GET /arc/sidebar
    # -------------------------------------------------------------------------

    @router.get("/arc/sidebar")
    async def arc_sidebar():
        """Read Arc browser sidebar tabs from StorableSidebar.json.

        Uses only containers[1] (the non-sync container). Resolves each tab's
        space by walking up the parentID chain. Folders are skipped in output
        but used for space resolution. Returns tabs sorted by timeLastActiveAt
        descending.
        """
        sidebar_path = (
            Path.home()
            / "Library"
            / "Application Support"
            / "Arc"
            / "StorableSidebar.json"
        )
        if not sidebar_path.exists():
            return []

        try:
            raw = json.loads(sidebar_path.read_text(encoding="utf-8"))
        except Exception as e:
            logger.warning("Failed to read Arc sidebar: %s", e)
            return []

        try:
            containers = raw.get("sidebar", {}).get("containers", [])
            if len(containers) < 2:
                return []
            container = containers[1]

            # Build space map: containerID -> spaceName
            spaces_raw = container.get("spaces", [])
            space_container_map: dict[str, str] = {}  # containerID -> spaceName
            i = 0
            while i + 1 < len(spaces_raw):
                space_obj = spaces_raw[i + 1]
                if isinstance(space_obj, dict):
                    title = space_obj.get("title", "Unknown Space")
                    for cid in space_obj.get("containerIDs", []):
                        space_container_map[cid] = title
                i += 2

            # Build items map: UUID -> object
            items_raw = container.get("items", [])
            items_map: dict[str, dict] = {}
            i = 0
            while i + 1 < len(items_raw):
                uuid = items_raw[i]
                obj = items_raw[i + 1]
                if isinstance(uuid, str) and isinstance(obj, dict):
                    items_map[uuid] = obj
                i += 2

            def resolve_space(item_uuid: str) -> str:
                """Walk parentID chain to find which space this item belongs to."""
                visited: set[str] = set()
                current_id = item_uuid
                for _ in range(20):  # guard against cycles
                    if current_id in visited:
                        break
                    visited.add(current_id)
                    # Check if current_id is a space containerID
                    if current_id in space_container_map:
                        return space_container_map[current_id]
                    # Walk up via items
                    item = items_map.get(current_id)
                    if item is None:
                        break
                    parent = item.get("parentID")
                    if not parent:
                        break
                    current_id = parent
                return "Unknown Space"

            results = []
            for uuid, item in items_map.items():
                data = item.get("data", {})
                tab = data.get("tab")
                if tab is None:
                    # Could be a folder - skip for output
                    continue

                saved_url = tab.get("savedURL", "")
                saved_title = tab.get("savedTitle", "")
                time_last_active = tab.get("timeLastActiveAt")
                created_at = item.get("createdAt")
                parent_id = item.get("parentID", "")

                unix_ms: Optional[int] = None
                if time_last_active is not None:
                    try:
                        unix_ms = _core_data_to_unix_ms(float(time_last_active))
                    except (ValueError, TypeError):
                        pass

                # isPinned: check if item lives directly under a "pinned" container.
                # Arc marks pinned items with parentID pointing to a pinned section.
                # We approximate: if the parent resolves without traversal to a
                # space containerID, it may be pinned. Use a dedicated field if present.
                is_pinned = bool(item.get("isPinned", False))

                space_name = resolve_space(uuid)

                results.append(
                    {
                        "url": saved_url,
                        "title": saved_title,
                        "spaceName": space_name,
                        "domain": _extract_domain(saved_url),
                        "isPinned": is_pinned,
                        "timeLastActiveAt": unix_ms,
                        "dataSource": "sidebar",
                    }
                )

            # Sort by timeLastActiveAt descending (None values last)
            results.sort(
                key=lambda x: (
                    x["timeLastActiveAt"] if x["timeLastActiveAt"] is not None else 0
                ),
                reverse=True,
            )
            return results

        except Exception as e:
            logger.exception("Error parsing Arc sidebar: %s", e)
            return []

    # -------------------------------------------------------------------------
    # GET /arc/archive
    # -------------------------------------------------------------------------

    @router.get("/arc/archive")
    async def arc_archive():
        """Read Arc browser archived tabs from StorableArchiveItems.json.

        Filters to items archived within the past 7 days. Resolves space names
        using the sidebar spaces map loaded from StorableSidebar.json.
        """
        archive_path = (
            Path.home()
            / "Library"
            / "Application Support"
            / "Arc"
            / "StorableArchiveItems.json"
        )
        sidebar_path = (
            Path.home()
            / "Library"
            / "Application Support"
            / "Arc"
            / "StorableSidebar.json"
        )

        if not archive_path.exists():
            return []

        # Load sidebar spaces map for space resolution
        # space_container_map: containerID -> spaceName (already built)
        # For archive we need spaceUUID -> spaceName directly
        # The archive stores source.space._0 which is the space UUID.
        # Build spaceUUID -> spaceName from the sidebar spaces list.
        space_uuid_map: dict[str, str] = {}
        if sidebar_path.exists():
            try:
                raw_sidebar = json.loads(sidebar_path.read_text(encoding="utf-8"))
                containers = raw_sidebar.get("sidebar", {}).get("containers", [])
                if len(containers) >= 2:
                    container = containers[1]
                    spaces_raw = container.get("spaces", [])
                    i = 0
                    while i + 1 < len(spaces_raw):
                        space_uuid = spaces_raw[i]
                        space_obj = spaces_raw[i + 1]
                        if isinstance(space_uuid, str) and isinstance(space_obj, dict):
                            space_uuid_map[space_uuid] = space_obj.get(
                                "title", "Unknown Space"
                            )
                        i += 2
            except Exception as e:
                logger.warning("Failed to load sidebar spaces for archive: %s", e)

        try:
            raw = json.loads(archive_path.read_text(encoding="utf-8"))
        except Exception as e:
            logger.warning("Failed to read Arc archive: %s", e)
            return []

        try:
            items_raw = raw.get("items", [])
            cutoff_unix_ms = int((time.time() - 7 * 86400) * 1000)

            results = []
            i = 0
            while i + 1 < len(items_raw):
                item = items_raw[i + 1]
                i += 2
                if not isinstance(item, dict):
                    continue

                archived_at_raw = item.get("archivedAt")
                if archived_at_raw is None:
                    continue

                try:
                    archived_at_ms = _core_data_to_unix_ms(float(archived_at_raw))
                except (ValueError, TypeError):
                    continue

                if archived_at_ms < cutoff_unix_ms:
                    continue

                sidebar_item = item.get("sidebarItem", {})
                data = sidebar_item.get("data", {})
                tab = data.get("tab", {})

                saved_url = tab.get("savedURL", "")
                saved_title = tab.get("savedTitle", "")
                time_last_active = tab.get("timeLastActiveAt")

                time_last_active_ms: Optional[int] = None
                if time_last_active is not None:
                    try:
                        time_last_active_ms = _core_data_to_unix_ms(
                            float(time_last_active)
                        )
                    except (ValueError, TypeError):
                        pass

                # Resolve space from source.space._0
                source = item.get("source", {})
                space_ref = source.get("space", {})
                space_uuid = (
                    space_ref.get("_0", "") if isinstance(space_ref, dict) else ""
                )
                space_name = space_uuid_map.get(space_uuid, "Unknown Space")

                results.append(
                    {
                        "url": saved_url,
                        "title": saved_title,
                        "spaceName": space_name,
                        "domain": _extract_domain(saved_url),
                        "archivedAt": archived_at_ms,
                        "dataSource": "archive",
                    }
                )

            results.sort(key=lambda x: x["archivedAt"], reverse=True)
            return results

        except Exception as e:
            logger.exception("Error parsing Arc archive: %s", e)
            return []

    # -------------------------------------------------------------------------
    # GET /arc/history
    # -------------------------------------------------------------------------

    @router.get("/arc/history")
    async def arc_history():
        """Read Arc browsing history from the Chromium History SQLite database.

        Opens the database in immutable read-only mode to avoid locking the
        live browser. Filters to visits in the past 7 days and converts
        Windows FILETIME timestamps to Unix epoch milliseconds.
        """
        history_path = (
            Path.home()
            / "Library"
            / "Application Support"
            / "Arc"
            / "User Data"
            / "Profile 13"
            / "History"
        )
        if not history_path.exists():
            return []

        cutoff_unix_s = time.time() - 7 * 86400
        # Convert cutoff to FILETIME microseconds for the WHERE clause
        cutoff_filetime = int(cutoff_unix_s * 1_000_000) + FILETIME_OFFSET_US

        db_uri = f"file:///{history_path}?immutable=1&mode=ro"

        def _query_history():
            try:
                conn = sqlite3.connect(db_uri, uri=True)
                try:
                    conn.row_factory = sqlite3.Row
                    cur = conn.cursor()
                    cur.execute(
                        """
                        SELECT u.url, u.title, u.visit_count, v.visit_time
                        FROM urls u
                        JOIN visits v ON u.id = v.url_id
                        WHERE v.visit_time > ?
                        ORDER BY v.visit_time DESC
                        """,
                        (cutoff_filetime,),
                    )
                    rows = cur.fetchall()
                    results = []
                    for row in rows:
                        visit_ms = _filetime_to_unix_ms(row["visit_time"])
                        results.append(
                            {
                                "url": row["url"] or "",
                                "title": row["title"] or "",
                                "visitCount": row["visit_count"] or 0,
                                "visitTime": visit_ms,
                                "domain": _extract_domain(row["url"] or ""),
                                "dataSource": "history",
                            }
                        )
                    return results
                finally:
                    conn.close()
            except Exception as e:
                logger.warning("Arc history query failed: %s", e)
                return []

        # Run blocking SQLite call in a thread pool
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _query_history)

    # -------------------------------------------------------------------------
    # GET /git/commits
    # -------------------------------------------------------------------------

    @router.get("/git/commits")
    async def git_commits():
        """Return git commits from the Monet monorepo for the past 14 days.

        Filters to commits authored by the current git user (matched by email).
        Each commit includes the list of changed files with insertion/deletion counts.
        Uses asyncio.create_subprocess_exec for non-blocking subprocess execution.
        """
        repo_path = Path.home() / "Monet"
        if not repo_path.exists():
            return []

        async def run_git(*args: str) -> str:
            proc = await asyncio.create_subprocess_exec(
                "git",
                *args,
                cwd=str(repo_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            if proc.returncode != 0:
                logger.warning(
                    "git %s failed (rc=%d): %s",
                    " ".join(args),
                    proc.returncode,
                    stderr.decode(errors="replace").strip(),
                )
                return ""
            return stdout.decode(errors="replace")

        # Get current user email to filter commits
        user_email = (await run_git("config", "user.email")).strip()

        # Fetch commits with numstat in one pass.
        # Format: hash|subject|author|email|ISO date|refs
        # Followed by numstat lines: insertions<TAB>deletions<TAB>path
        log_output = await run_git(
            "log",
            "--since=14 days ago",
            "--all",
            "--format=%H|%s|%an|%ae|%aI|%D",
            "--numstat",
        )

        if not log_output.strip():
            return []

        results = []
        current_commit: Optional[dict] = None
        current_files: list[dict] = []

        def flush_commit():
            if current_commit is None:
                return
            # Filter by user email if we have one
            if user_email and current_commit.get("email") != user_email:
                return
            current_commit["filesChanged"] = list(current_files)
            results.append(current_commit)

        for line in log_output.splitlines():
            # Commit header lines contain exactly 5 pipe separators
            parts = line.split("|", 5)
            if (
                len(parts) == 6
                and len(parts[0]) == 40
                and all(c in "0123456789abcdef" for c in parts[0])
            ):
                flush_commit()
                current_files = []
                raw_refs = parts[5].strip()
                # Parse branch name from refs (take first entry that looks like a branch)
                branch = ""
                if raw_refs:
                    for ref in raw_refs.split(","):
                        ref = ref.strip()
                        if ref.startswith("HEAD -> "):
                            branch = ref[len("HEAD -> ") :]
                            break
                        if ref and not ref.startswith("tag:") and not ref == "HEAD":
                            branch = ref
                current_commit = {
                    "hash": parts[0],
                    "message": parts[1],
                    "author": parts[2],
                    "email": parts[3],
                    "timestamp": parts[4],
                    "branch": branch,
                    "filesChanged": [],
                    "dataSource": "git",
                }
                continue

            # Numstat lines: insertions<TAB>deletions<TAB>path
            if current_commit is not None and line.strip() and "\t" in line:
                tab_parts = line.split("\t", 2)
                if len(tab_parts) == 3:
                    ins_raw, del_raw, path = tab_parts
                    # Binary files show "-" for counts
                    try:
                        insertions = int(ins_raw)
                    except ValueError:
                        insertions = 0
                    try:
                        deletions = int(del_raw)
                    except ValueError:
                        deletions = 0
                    current_files.append(
                        {
                            "path": path,
                            "insertions": insertions,
                            "deletions": deletions,
                        }
                    )

        flush_commit()
        return results

    # -------------------------------------------------------------------------
    # GET /claude-sessions
    # -------------------------------------------------------------------------

    @router.get("/claude-sessions")
    async def claude_sessions():
        """Return Claude Code sessions from the past 14 days.

        Joins session metadata from ~/.claude/sessions/*.json with the
        corresponding JSONL conversation files under ~/.claude/projects/.
        Extracts the first user message as the session title and counts turns.
        """
        sessions_dir = Path.home() / ".claude" / "sessions"
        projects_dir = Path.home() / ".claude" / "projects"

        if not sessions_dir.exists():
            return []

        cutoff_ms = int((time.time() - 14 * 86400) * 1000)

        results = []

        def _load_session(session_file: Path) -> Optional[dict]:
            try:
                meta = json.loads(session_file.read_text(encoding="utf-8"))
            except Exception as e:
                logger.warning("Failed to read session file %s: %s", session_file, e)
                return None

            session_id = meta.get("sessionId", "")
            cwd = meta.get("cwd", "")
            started_at = meta.get("startedAt")  # Unix epoch milliseconds

            if started_at is None:
                return None

            try:
                started_at_ms = int(started_at)
            except (ValueError, TypeError):
                return None

            if started_at_ms < cutoff_ms:
                return None

            # Encode cwd path: absolute path with slashes replaced by hyphens
            # e.g. /Users/calvinbeighle/Monet -> -Users-calvinbeighle-Monet
            encoded_path = cwd.replace("/", "-") if cwd else ""

            # Find the JSONL file
            jsonl_path = projects_dir / encoded_path / f"{session_id}.jsonl"

            title = ""
            turn_count = 0

            if jsonl_path.exists():
                try:
                    lines = jsonl_path.read_text(encoding="utf-8").splitlines()
                    turn_count = len(lines)
                    # Find first user message for title
                    for line in lines[:20]:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            entry = json.loads(line)
                            msg = entry.get("message", {})
                            role = msg.get("role", "")
                            if role == "user":
                                content = msg.get("content", "")
                                if isinstance(content, list):
                                    # content blocks
                                    for block in content:
                                        if (
                                            isinstance(block, dict)
                                            and block.get("type") == "text"
                                        ):
                                            title = block.get("text", "")[:100]
                                            break
                                elif isinstance(content, str):
                                    title = content[:100]
                                if title:
                                    break
                        except Exception:
                            continue
                except Exception as e:
                    logger.warning("Failed to read JSONL %s: %s", jsonl_path, e)

            return {
                "sessionId": session_id,
                "projectPath": cwd,
                "title": title,
                "startedAt": started_at_ms,
                "turnCount": turn_count,
                "dataSource": "claude-sessions",
            }

        loop = asyncio.get_event_loop()

        def _load_all():
            items = []
            for f in sessions_dir.glob("*.json"):
                result = _load_session(f)
                if result is not None:
                    items.append(result)
            items.sort(key=lambda x: x["startedAt"], reverse=True)
            return items

        return await loop.run_in_executor(None, _load_all)

    # -------------------------------------------------------------------------
    # GET /calendar/events
    # -------------------------------------------------------------------------

    @router.get("/calendar/events")
    async def calendar_events():
        """Return calendar events within a 14-day past/future window.

        Reads ~/BridgeIntelligence/GTM/calendar_events.json. Excludes
        cancelled events (case-insensitive match on summary).
        """
        cal_path = Path.home() / "BridgeIntelligence" / "GTM" / "calendar_events.json"
        if not cal_path.exists():
            return []

        try:
            events = json.loads(cal_path.read_text(encoding="utf-8"))
        except Exception as e:
            logger.warning("Failed to read calendar events: %s", e)
            return []

        today = datetime.now(tz=timezone.utc).date()
        window_start = today - timedelta(days=14)
        window_end = today + timedelta(days=14)

        results = []
        for event in events:
            if not isinstance(event, dict):
                continue

            summary = event.get("summary", "")
            # Exclude cancelled events
            if "cancelled" in summary.lower():
                continue

            start_raw = event.get("start", "")
            if not start_raw:
                continue

            try:
                event_date = datetime.strptime(start_raw, "%Y-%m-%d").date()
            except ValueError:
                continue

            if not (window_start <= event_date <= window_end):
                continue

            results.append(
                {
                    "summary": summary,
                    "start": start_raw,
                    "calendar": event.get("calendar", ""),
                    "account": event.get("account", ""),
                    "attendees": event.get("attendees", []),
                    "dataSource": "calendar",
                }
            )

        return results

    # -------------------------------------------------------------------------
    # Gmail proxy endpoints
    # -------------------------------------------------------------------------

    GMAIL_CONFIG_KEY = "google-mail"
    GMAIL_CONNECTION_ID = "gmail-default"

    def _gmail_proxy(
        method: str,
        path: str,
        params: Optional[dict] = None,
        json_body: Optional[dict] = None,
    ) -> JSONResponse:
        """Make a proxied request to the Gmail API through Nango.

        nango_proxy_request is synchronous; FastAPI runs sync endpoints in a
        threadpool automatically, so this is safe to call from async handlers
        via run_in_executor or directly (FastAPI handles it).
        """
        try:
            resp = nango_proxy_request(
                method=method,
                path=path,
                provider_config_key=GMAIL_CONFIG_KEY,
                connection_id=GMAIL_CONNECTION_ID,
                params=params,
                json_body=json_body,
            )
            try:
                body = resp.json()
            except Exception:
                body = {"raw": resp.text}
            return JSONResponse(content=body, status_code=resp.status_code)
        except Exception as e:
            logger.exception("Gmail proxy error for %s %s: %s", method, path, e)
            return JSONResponse(
                content={"error": f"Gmail proxy error: {type(e).__name__}: {e}"},
                status_code=502,
            )

    @router.get("/gmail/threads")
    async def gmail_threads(q: Optional[str] = None, maxResults: Optional[int] = None):
        """List Gmail threads, with optional search query and result limit."""
        params: dict = {}
        if q is not None:
            params["q"] = q
        if maxResults is not None:
            params["maxResults"] = maxResults
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            _gmail_proxy,
            "GET",
            "gmail/v1/users/me/threads",
            params or None,
            None,
        )

    @router.get("/gmail/threads/{thread_id}")
    async def gmail_thread(thread_id: str):
        """Get a full Gmail thread by ID."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            _gmail_proxy,
            "GET",
            f"gmail/v1/users/me/threads/{thread_id}",
            {"format": "full"},
            None,
        )

    @router.get("/gmail/messages")
    async def gmail_messages(q: Optional[str] = None, maxResults: Optional[int] = None):
        """List Gmail messages, with optional search query and result limit."""
        params: dict = {}
        if q is not None:
            params["q"] = q
        if maxResults is not None:
            params["maxResults"] = maxResults
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            _gmail_proxy,
            "GET",
            "gmail/v1/users/me/messages",
            params or None,
            None,
        )

    @router.get("/gmail/messages/{message_id}")
    async def gmail_message(message_id: str):
        """Get a full Gmail message by ID."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            _gmail_proxy,
            "GET",
            f"gmail/v1/users/me/messages/{message_id}",
            {"format": "full"},
            None,
        )

    @router.get("/gmail/history")
    async def gmail_history(startHistoryId: Optional[str] = None):
        """Get Gmail history changes since a given history ID."""
        params: dict = {}
        if startHistoryId is not None:
            params["startHistoryId"] = startHistoryId
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            _gmail_proxy,
            "GET",
            "gmail/v1/users/me/history",
            params or None,
            None,
        )

    @router.post("/gmail/drafts")
    async def gmail_create_draft(request: Request):
        """Create a Gmail draft. Body should be a Gmail API draft resource."""
        try:
            body = await request.json()
        except Exception:
            body = {}
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            _gmail_proxy,
            "POST",
            "gmail/v1/users/me/drafts",
            None,
            body,
        )

    @router.post("/gmail/send")
    async def gmail_send(request: Request):
        """Send a Gmail message. Body should be a Gmail API message resource."""
        try:
            body = await request.json()
        except Exception:
            body = {}
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            _gmail_proxy,
            "POST",
            "gmail/v1/users/me/messages/send",
            None,
            body,
        )

    @router.post("/gmail/messages/{message_id}/modify")
    async def gmail_modify_message(message_id: str, request: Request):
        """Modify a Gmail message (add/remove labels). Body is a ModifyMessageRequest."""
        try:
            body = await request.json()
        except Exception:
            body = {}
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            _gmail_proxy,
            "POST",
            f"gmail/v1/users/me/messages/{message_id}/modify",
            None,
            body,
        )

    # -------------------------------------------------------------------------
    # AI Proxy Endpoints (2.0c) - Claude API for workstream intelligence
    # -------------------------------------------------------------------------

    async def _call_claude(system: str, user_msg: str) -> str:
        """Rate-limited Claude API call. Returns the text content of the response.

        Raises on failure with structured error info.
        """
        client = _get_ai_client()
        async with _ai_semaphore:
            response = await client.messages.create(
                model=AI_MODEL,
                max_tokens=4096,
                system=system,
                messages=[{"role": "user", "content": user_msg}],
            )
            # Extract text from content blocks
            for block in response.content:
                if block.type == "text":
                    return block.text
            return ""

    @router.post("/ai/detect")
    async def ai_detect(request: Request):
        """Workstream detection - cluster activities into workstreams.

        Accepts: { activities: [{activityId, source, title, participants, timestamp, labels, preview, metadata}] }
        Returns: { workstreams: [{name, description, activityIds, confidence, rationale, participants}] }
        """
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "Invalid JSON body"}, status_code=400)

        activities = body.get("activities", [])
        if not activities:
            return {"workstreams": []}

        # Token limit guard: cap at 200 activities, prioritize recent
        if len(activities) > 200:
            activities = sorted(
                activities, key=lambda a: a.get("timestamp", 0), reverse=True
            )[:200]

        # Build compact representation for Claude (titles/participants/timestamps only)
        activity_lines = []
        for a in activities:
            participants = ", ".join(
                p.get("email", p.get("displayName", "unknown"))
                for p in a.get("participants", [])
            )
            labels = ", ".join(a.get("labels", []))
            source = a.get("source", "unknown")
            line = (
                f"- [{a.get('activityId', '')}] ({source}) "
                f"{a.get('title', 'Untitled')} | "
                f"participants: {participants or 'none'} | "
                f"labels: {labels or 'none'} | "
                f"ts: {a.get('timestamp', 0)}"
            )
            if a.get("preview"):
                line += f" | preview: {a['preview'][:100]}"
            activity_lines.append(line)

        system_prompt = """You are a workstream detection engine for a productivity tool. Your job is to cluster activity records from multiple sources (email, calendar, browser, git, Claude Code sessions, CRM) into coherent workstreams.

A workstream is a cluster of activities that relate to the same project, relationship, or initiative. Signal weights (highest to lowest):
1. Participant overlap (shared email addresses are the strongest signal)
2. Topic/keyword overlap in titles and previews
3. Project association (same git repo, Arc space, Claude project)
4. Temporal proximity (same day/hour biases grouping)
5. CRM association (same deal/company)
6. Label/tag overlap

Rules:
- Minimum cluster: 2 activities from 2+ different sources
- Generate a descriptive name for each workstream (e.g., "Acme Corp Proposal", "tracemessaging Development")
- Generate a one-sentence description
- Assign a confidence score 0-1 for each cluster
- Provide a one-sentence rationale for why these activities belong together
- Activities that don't fit any cluster should NOT be included in any workstream
- If two potential workstreams share >60% participants and >40% topic keywords, consider merging them

Respond with ONLY valid JSON, no markdown formatting."""

        user_msg = f"""Cluster these {len(activities)} activities into workstreams:

{chr(10).join(activity_lines)}

Respond with this exact JSON structure:
{{
  "workstreams": [
    {{
      "name": "Descriptive Workstream Name",
      "description": "One sentence describing this workstream",
      "activityIds": ["id1", "id2"],
      "confidence": 0.85,
      "rationale": "One sentence explaining the clustering",
      "participants": ["email1@example.com", "email2@example.com"]
    }}
  ]
}}"""

        try:
            raw = await _call_claude(system_prompt, user_msg)
            # Strip markdown code fences if present
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()
            result = json.loads(cleaned)
            return result
        except anthropic.RateLimitError as e:
            logger.warning("AI detect rate limited: %s", e)
            return JSONResponse(
                {"error": "rate_limited", "retry_after": 30},
                status_code=429,
            )
        except anthropic.APIError as e:
            logger.error("AI detect API error: %s", e)
            return JSONResponse(
                {"error": "ai_unavailable", "message": str(e)},
                status_code=502,
            )
        except json.JSONDecodeError as e:
            logger.error("AI detect returned invalid JSON: %s (raw: %s)", e, raw[:500])
            return JSONResponse(
                {"error": "parse_error", "message": "AI returned invalid JSON"},
                status_code=502,
            )
        except Exception as e:
            logger.exception("AI detect unexpected error: %s", e)
            return JSONResponse(
                {"error": "internal", "message": str(e)},
                status_code=500,
            )

    @router.post("/ai/link")
    async def ai_link(request: Request):
        """Context linking - assign a new activity to an existing workstream.

        Accepts: {
            activity: {activityId, source, title, participants, timestamp, labels, preview},
            candidates: [{workstreamId, name, description, recentActivityTitles, participants}]
        }
        Returns: { workstreamId: string|null, confidence: number, rationale: string }
        """
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "Invalid JSON body"}, status_code=400)

        activity = body.get("activity")
        candidates = body.get("candidates", [])

        if not activity:
            return JSONResponse({"error": "activity is required"}, status_code=400)
        if not candidates:
            return {
                "workstreamId": None,
                "confidence": 0,
                "rationale": "No candidate workstreams available",
            }

        # Cap candidates at 5
        candidates = candidates[:5]

        activity_desc = (
            f"[{activity.get('activityId', '')}] ({activity.get('source', 'unknown')}) "
            f"{activity.get('title', 'Untitled')} | "
            f"participants: {', '.join(p.get('email', '') for p in activity.get('participants', []))} | "
            f"labels: {', '.join(activity.get('labels', []))}"
        )
        if activity.get("preview"):
            activity_desc += f" | preview: {activity['preview'][:200]}"

        candidate_lines = []
        for c in candidates:
            participants = ", ".join(c.get("participants", [])[:10])
            recent = "; ".join(c.get("recentActivityTitles", [])[:5])
            candidate_lines.append(
                f"- workstreamId: {c.get('workstreamId', '')} | "
                f"name: {c.get('name', '')} | "
                f"description: {c.get('description', '')} | "
                f"participants: {participants} | "
                f"recent activities: {recent}"
            )

        system_prompt = """You are a context linking engine. Given a new activity and candidate workstreams, determine which workstream (if any) the activity belongs to.

Evaluate based on:
1. Participant overlap (strongest signal)
2. Topic/keyword match with workstream name, description, and recent activities
3. Source-level associations (same repo, same calendar series, same email thread)

Confidence scoring:
- >= 0.7: strong match, auto-assign
- 0.4-0.7: uncertain, flag for review
- < 0.4: no good match, leave unassigned

If no workstream is a good fit, return null for workstreamId with confidence < 0.4.

Respond with ONLY valid JSON, no markdown formatting."""

        user_msg = f"""New activity:
{activity_desc}

Candidate workstreams:
{chr(10).join(candidate_lines)}

Respond with this exact JSON structure:
{{
  "workstreamId": "the-matching-workstream-id-or-null",
  "confidence": 0.85,
  "rationale": "One sentence explaining the assignment decision"
}}"""

        try:
            raw = await _call_claude(system_prompt, user_msg)
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()
            result = json.loads(cleaned)
            return result
        except anthropic.RateLimitError:
            return JSONResponse(
                {"error": "rate_limited", "retry_after": 30}, status_code=429
            )
        except anthropic.APIError as e:
            logger.error("AI link API error: %s", e)
            return JSONResponse(
                {"error": "ai_unavailable", "message": str(e)}, status_code=502
            )
        except json.JSONDecodeError:
            logger.error("AI link returned invalid JSON: %s", raw[:500])
            return JSONResponse({"error": "parse_error"}, status_code=502)
        except Exception as e:
            logger.exception("AI link unexpected error: %s", e)
            return JSONResponse(
                {"error": "internal", "message": str(e)}, status_code=500
            )

    @router.post("/ai/summarize")
    async def ai_summarize(request: Request):
        """Generate AI summary for a workstream.

        Accepts: {
            workstream: {name, description, participants},
            activities: [{activityId, source, title, timestamp, preview, participants}],
            previousSummary: string|null,
            crmContext: [{email, company, dealNames, lifecycleStage}]
        }
        Returns: {
            statusSummary: string,
            keyDevelopments: [string],
            recommendedAction: {type, description, targetActivityId, confidence},
            urgency: "low"|"medium"|"high",
            generatedAt: number
        }
        """
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "Invalid JSON body"}, status_code=400)

        workstream = body.get("workstream", {})
        activities = body.get("activities", [])
        previous_summary = body.get("previousSummary")
        crm_context = body.get("crmContext", [])

        if not activities:
            return {
                "statusSummary": "No activities in this workstream yet.",
                "keyDevelopments": [],
                "recommendedAction": {
                    "type": "no-action",
                    "description": "No activities to act on",
                    "targetActivityId": None,
                    "confidence": 1.0,
                },
                "urgency": "low",
                "generatedAt": int(time.time() * 1000),
            }

        # Token limit guard: cap at 100 activities
        if len(activities) > 100:
            sorted_acts = sorted(
                activities, key=lambda a: a.get("timestamp", 0), reverse=True
            )
            activities = sorted_acts[:100]
            omitted = len(sorted_acts) - 100
        else:
            omitted = 0

        activity_lines = []
        for a in activities:
            participants = ", ".join(
                p.get("email", p.get("displayName", ""))
                for p in a.get("participants", [])
            )
            ts = a.get("timestamp", 0)
            ts_str = (
                datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime(
                    "%Y-%m-%d %H:%M UTC"
                )
                if ts
                else "unknown"
            )
            line = (
                f"- [{a.get('activityId', '')}] ({a.get('source', 'unknown')}) "
                f"{ts_str}: {a.get('title', 'Untitled')}"
            )
            if participants:
                line += f" | from: {participants}"
            if a.get("preview"):
                line += f" | {a['preview'][:150]}"
            activity_lines.append(line)

        crm_lines = []
        for c in crm_context:
            deals = ", ".join(c.get("dealNames", []))
            crm_lines.append(
                f"- {c.get('email', 'unknown')}: {c.get('company', 'unknown')} | "
                f"deals: {deals or 'none'} | stage: {c.get('lifecycleStage', 'unknown')}"
            )

        system_prompt = """You are a workstream summary engine for a productivity tool. Generate a concise, actionable summary for the given workstream.

Output requirements:
- statusSummary: 2-3 sentences describing current state
- keyDevelopments: up to 3 bullet points of what changed recently (or empty if no notable changes)
- recommendedAction: the single most important next action. Types: reply-email, schedule-meeting, review-document, follow-up, archive-workstream, no-action. Must reference a specific activityId when applicable.
- urgency: low (informational), medium (needs attention within 24h), high (overdue or time-sensitive)

Urgency signals:
- Time since last response in email threads
- Upcoming deadlines from calendar events
- Deal stage progression from CRM
- Explicit urgency in message content

If a previous summary is provided, highlight what CHANGED since then (don't repeat the same observations).

Respond with ONLY valid JSON, no markdown formatting."""

        prev_context = ""
        if previous_summary:
            prev_context = f"\nPrevious summary (highlight changes since this):\n{previous_summary}\n"

        omitted_note = ""
        if omitted > 0:
            omitted_note = f"\n(Note: {omitted} older activities omitted for brevity)\n"

        user_msg = f"""Workstream: {workstream.get("name", "Unknown")}
Description: {workstream.get("description", "No description")}
{prev_context}{omitted_note}
Activities ({len(activities)} shown):
{chr(10).join(activity_lines)}

{"CRM context:" + chr(10) + chr(10).join(crm_lines) if crm_lines else ""}

Respond with this exact JSON structure:
{{
  "statusSummary": "2-3 sentence summary",
  "keyDevelopments": ["bullet 1", "bullet 2"],
  "recommendedAction": {{
    "type": "reply-email|schedule-meeting|review-document|follow-up|archive-workstream|no-action",
    "description": "Specific action description",
    "targetActivityId": "activity-id-or-null",
    "confidence": 0.8
  }},
  "urgency": "low|medium|high"
}}"""

        try:
            raw = await _call_claude(system_prompt, user_msg)
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()
            result = json.loads(cleaned)
            result["generatedAt"] = int(time.time() * 1000)
            return result
        except anthropic.RateLimitError:
            return JSONResponse(
                {"error": "rate_limited", "retry_after": 30}, status_code=429
            )
        except anthropic.APIError as e:
            logger.error("AI summarize API error: %s", e)
            return JSONResponse(
                {"error": "ai_unavailable", "message": str(e)}, status_code=502
            )
        except json.JSONDecodeError:
            logger.error("AI summarize returned invalid JSON: %s", raw[:500])
            return JSONResponse({"error": "parse_error"}, status_code=502)
        except Exception as e:
            logger.exception("AI summarize unexpected error: %s", e)
            return JSONResponse(
                {"error": "internal", "message": str(e)}, status_code=500
            )

    return router
