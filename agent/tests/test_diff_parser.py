"""Tests for the unified diff parser."""

from agent.diff_parser import parse_unified_diff


class TestParseDiff:
    def test_empty_input(self):
        assert parse_unified_diff("") == []
        assert parse_unified_diff("   ") == []

    def test_simple_add(self):
        diff = """\
--- a/file.py
+++ b/file.py
@@ -1,3 +1,4 @@
 line1
 line2
+new line
 line3"""
        result = parse_unified_diff(diff)
        types = [r["type"] for r in result]
        assert "header" in types
        assert "added" in types
        added = [r for r in result if r["type"] == "added"]
        assert len(added) == 1
        assert added[0]["right"] == "new line"
        assert added[0]["left"] is None

    def test_simple_remove(self):
        diff = """\
--- a/file.py
+++ b/file.py
@@ -1,3 +1,2 @@
 line1
-removed line
 line3"""
        result = parse_unified_diff(diff)
        removed = [r for r in result if r["type"] == "removed"]
        assert len(removed) == 1
        assert removed[0]["left"] == "removed line"
        assert removed[0]["right"] is None

    def test_modified_line(self):
        """Adjacent remove+add pairs are detected as modifications."""
        diff = """\
--- a/file.py
+++ b/file.py
@@ -1,3 +1,3 @@
 line1
-old content
+new content
 line3"""
        result = parse_unified_diff(diff)
        modified = [r for r in result if r["type"] == "modified"]
        assert len(modified) == 1
        assert modified[0]["left"] == "old content"
        assert modified[0]["right"] == "new content"

    def test_unchanged_lines_preserved(self):
        diff = """\
--- a/file.py
+++ b/file.py
@@ -1,3 +1,3 @@
 line1
-old
+new
 line3"""
        result = parse_unified_diff(diff)
        unchanged = [r for r in result if r["type"] == "unchanged"]
        assert len(unchanged) == 2
        assert unchanged[0]["left"] == "line1"
        assert unchanged[0]["right"] == "line1"

    def test_multi_file_diff(self):
        """Diffs with multiple files produce lines for each file."""
        diff = """\
diff --git a/file1.py b/file1.py
--- a/file1.py
+++ b/file1.py
@@ -1,2 +1,3 @@
 hello
+world
diff --git a/file2.py b/file2.py
--- a/file2.py
+++ b/file2.py
@@ -1,2 +1,2 @@
-old
+new"""
        result = parse_unified_diff(diff)
        added = [r for r in result if r["type"] == "added"]
        modified = [r for r in result if r["type"] == "modified"]
        assert len(added) == 1
        assert added[0]["right"] == "world"
        assert len(modified) == 1
        assert modified[0]["left"] == "old"
        assert modified[0]["right"] == "new"

    def test_hunk_header_included(self):
        diff = """\
--- a/file.py
+++ b/file.py
@@ -10,3 +10,4 @@ def foo():
 pass"""
        result = parse_unified_diff(diff)
        headers = [r for r in result if r["type"] == "header"]
        assert len(headers) == 1
        assert headers[0]["left"].startswith("@@")

    def test_multiple_removes_then_adds(self):
        """Multiple consecutive removes followed by adds pair up correctly."""
        diff = """\
--- a/file.py
+++ b/file.py
@@ -1,4 +1,4 @@
-a
-b
+x
+y
 c
 d"""
        result = parse_unified_diff(diff)
        modified = [r for r in result if r["type"] == "modified"]
        assert len(modified) == 2
        assert modified[0]["left"] == "a"
        assert modified[0]["right"] == "x"
        assert modified[1]["left"] == "b"
        assert modified[1]["right"] == "y"

    def test_more_removes_than_adds(self):
        """Excess removes become standalone removed lines."""
        diff = """\
--- a/file.py
+++ b/file.py
@@ -1,4 +1,2 @@
-a
-b
-c
+x
 d"""
        result = parse_unified_diff(diff)
        modified = [r for r in result if r["type"] == "modified"]
        removed = [r for r in result if r["type"] == "removed"]
        # First remove pairs with the add
        assert len(modified) == 1
        assert modified[0]["left"] == "a"
        assert modified[0]["right"] == "x"
        # Remaining removes are standalone
        assert len(removed) == 2
        assert removed[0]["left"] == "b"
        assert removed[1]["left"] == "c"

    def test_more_adds_than_removes(self):
        """Excess adds become standalone added lines."""
        diff = """\
--- a/file.py
+++ b/file.py
@@ -1,2 +1,4 @@
-a
+x
+y
+z
 d"""
        result = parse_unified_diff(diff)
        modified = [r for r in result if r["type"] == "modified"]
        added = [r for r in result if r["type"] == "added"]
        assert len(modified) == 1
        assert len(added) == 2
