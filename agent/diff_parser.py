"""Parse unified diff format into structured line data for the Diff UI pattern."""

import re
from typing import Optional


def parse_unified_diff(diff_text: str) -> list[dict]:
    """Parse a unified diff string into structured DiffLine objects.

    Each line becomes a dict with:
        left: str or None (original line content)
        right: str or None (modified line content)
        type: "unchanged" | "added" | "removed" | "modified" | "header"

    Handles multi-file diffs (diff --git), hunk headers (@@ ... @@),
    and context/add/remove lines.
    """
    if not diff_text or not diff_text.strip():
        return []

    lines = diff_text.split("\n")
    result: list[dict] = []

    # Track removed lines to pair with subsequent added lines (modified detection)
    pending_removed: list[str] = []

    for line in lines:
        # File headers
        if line.startswith("diff --git") or line.startswith("index "):
            _flush_removed(pending_removed, result)
            continue
        if line.startswith("--- "):
            _flush_removed(pending_removed, result)
            continue
        if line.startswith("+++ "):
            _flush_removed(pending_removed, result)
            continue

        # Hunk header
        if line.startswith("@@"):
            _flush_removed(pending_removed, result)
            # Extract the hunk header text after the second @@
            match = re.match(r"@@.*?@@\s*(.*)", line)
            header_text = match.group(1) if match else ""
            result.append(
                {
                    "left": line,
                    "right": line,
                    "type": "header",
                }
            )
            continue

        # Removed line
        if line.startswith("-"):
            pending_removed.append(line[1:])
            continue

        # Added line - pair with pending removed if possible (modified)
        if line.startswith("+"):
            if pending_removed:
                removed_content = pending_removed.pop(0)
                result.append(
                    {
                        "left": removed_content,
                        "right": line[1:],
                        "type": "modified",
                    }
                )
            else:
                result.append(
                    {
                        "left": None,
                        "right": line[1:],
                        "type": "added",
                    }
                )
            continue

        # Context line (unchanged) - flush any pending removed first
        _flush_removed(pending_removed, result)
        # Strip leading space if present
        content = line[1:] if line.startswith(" ") else line
        if content or line:  # Don't add empty trailing lines
            result.append(
                {
                    "left": content,
                    "right": content,
                    "type": "unchanged",
                }
            )

    # Flush any remaining removed lines
    _flush_removed(pending_removed, result)

    return result


def _flush_removed(pending: list[str], result: list[dict]) -> None:
    """Emit any pending removed lines that weren't paired with additions."""
    while pending:
        result.append(
            {
                "left": pending.pop(0),
                "right": None,
                "type": "removed",
            }
        )
