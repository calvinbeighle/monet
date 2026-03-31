"""OS-level keystroke collector daemon for the Monet interaction pipeline.

Reads input events from Linux evdev devices (/dev/input/event*), filters
out sensitive contexts (password fields, auth screens), batches events,
and writes them to the KeystrokeStore via SQLite or HTTP API.

Runs as a separate process alongside the agent backend - either as a
systemd service (os/monet-keystroke.service) or launched manually.

SCOPE.md: "Runs at the OS level. Captures interaction patterns (not
passwords or sensitive input in auth fields)."

Architecture:
- evdev for raw input capture (Linux kernel input subsystem)
- Sway IPC for active window context (what app is focused)
- Batched writes every FLUSH_INTERVAL seconds
- Sensitive context filtering before any data reaches storage

On non-Linux systems (macOS dev), the collector runs in mock mode,
generating no events but keeping the pipeline testable end-to-end.
"""

import json
import logging
import os
import queue
import signal
import subprocess
import threading
import time
from typing import Optional

from agent.keystroke_store import (
    DEFAULT_DB_PATH,
    EVENT_TYPE_KEY_PRESS,
    EVENT_TYPE_KEY_RELEASE,
    EVENT_TYPE_MODIFIER,
    KeystrokeEvent,
    KeystrokeStore,
)

logger = logging.getLogger(__name__)

# How often to flush batched events to the store (seconds)
FLUSH_INTERVAL = 5

# Sensitive window titles/classes that should never be captured
SENSITIVE_CONTEXTS = frozenset(
    {
        "password",
        "passwd",
        "secret",
        "credential",
        "keychain",
        "unlock",
        "sudo",
        "login",
        "auth",
        "gpg",
        "ssh-askpass",
        "pinentry",
    }
)

# Modifier key codes (evdev KEY_* constants)
MODIFIER_CODES = frozenset(
    {
        29,  # KEY_LEFTCTRL
        97,  # KEY_RIGHTCTRL
        42,  # KEY_LEFTSHIFT
        54,  # KEY_RIGHTSHIFT
        56,  # KEY_LEFTALT
        100,  # KEY_RIGHTALT
        125,  # KEY_LEFTMETA
        126,  # KEY_RIGHTMETA
    }
)


def is_sensitive_context(context: str) -> bool:
    """Check if the current window context is sensitive (passwords, auth).

    Returns True if any sensitive keyword appears in the context string,
    meaning events from this context should be suppressed.
    """
    if not context:
        return False
    lower = context.lower()
    return any(kw in lower for kw in SENSITIVE_CONTEXTS)


def get_sway_focused_window() -> str:
    """Get the title of the currently focused window from Sway via IPC.

    Returns empty string if Sway is not running or the query fails.
    This provides the 'context' field for interaction events.
    """
    try:
        result = subprocess.run(
            ["swaymsg", "-t", "get_tree"],
            capture_output=True,
            text=True,
            timeout=2,
        )
        if result.returncode != 0:
            return ""
        tree = json.loads(result.stdout)
        return _find_focused_name(tree)
    except (FileNotFoundError, subprocess.TimeoutExpired, json.JSONDecodeError):
        return ""


def _find_focused_name(node: dict) -> str:
    """Recursively find the focused window's name in a Sway tree."""
    if node.get("focused") and node.get("name"):
        return node["name"]
    for child in node.get("nodes", []) + node.get("floating_nodes", []):
        name = _find_focused_name(child)
        if name:
            return name
    return ""


class KeystrokeCollector:
    """Collects OS-level input events and batches them into the store.

    On Linux with evdev available, captures real keyboard input. On other
    platforms, runs in a no-op mode suitable for testing the pipeline.
    """

    def __init__(
        self,
        store: Optional[KeystrokeStore] = None,
        db_path: str = DEFAULT_DB_PATH,
        flush_interval: float = FLUSH_INTERVAL,
        session_id: str = "",
    ) -> None:
        self.store = store or KeystrokeStore(db_path=db_path)
        self.flush_interval = flush_interval
        self.session_id = session_id
        self._event_queue: queue.Queue = queue.Queue(maxsize=10000)
        self._running = False
        self._capture_thread: Optional[threading.Thread] = None
        self._flush_thread: Optional[threading.Thread] = None
        self._active_modifiers: set[int] = set()
        self._evdev_available = False
        self._check_evdev()

    def _check_evdev(self) -> None:
        """Check if evdev is available (Linux only)."""
        try:
            import evdev  # noqa: F401

            self._evdev_available = True
        except ImportError:
            self._evdev_available = False
            logger.info("evdev not available - collector will run in mock mode")

    def start(self) -> None:
        """Start the collector daemon threads."""
        if self._running:
            return
        self._running = True
        logger.info("Starting keystroke collector (evdev=%s)", self._evdev_available)

        # Flush thread always runs - drains queue to store
        self._flush_thread = threading.Thread(
            target=self._flush_loop, daemon=True, name="keystroke-flush"
        )
        self._flush_thread.start()

        # Capture thread only on Linux with evdev
        if self._evdev_available:
            self._capture_thread = threading.Thread(
                target=self._capture_loop, daemon=True, name="keystroke-capture"
            )
            self._capture_thread.start()

    def stop(self) -> None:
        """Stop the collector and flush remaining events."""
        self._running = False
        # Final flush
        self._flush_queue()
        logger.info("Keystroke collector stopped")

    def enqueue_event(self, event: KeystrokeEvent) -> bool:
        """Manually enqueue an event (for testing or non-evdev sources).

        Returns True if the event was queued, False if the queue is full
        or the context is sensitive.
        """
        if is_sensitive_context(event.context):
            return False
        try:
            self._event_queue.put_nowait(event)
            return True
        except queue.Full:
            logger.warning("Keystroke event queue full, dropping event")
            return False

    @property
    def queue_size(self) -> int:
        """Current number of events waiting to be flushed."""
        return self._event_queue.qsize()

    @property
    def running(self) -> bool:
        return self._running

    def _capture_loop(self) -> None:
        """Read events from evdev devices. Linux only."""
        try:
            import evdev
        except ImportError:
            return

        devices = [evdev.InputDevice(path) for path in evdev.list_devices()]
        keyboards = [d for d in devices if evdev.ecodes.EV_KEY in d.capabilities()]

        if not keyboards:
            logger.warning("No keyboard devices found")
            return

        logger.info("Monitoring %d keyboard device(s)", len(keyboards))

        # Use select-based loop across all keyboards
        try:
            from selectors import DefaultSelector, EVENT_READ

            sel = DefaultSelector()
            for kbd in keyboards:
                sel.register(kbd, EVENT_READ)

            while self._running:
                for key, _mask in sel.select(timeout=1.0):
                    device = key.fileobj
                    for ev in device.read():
                        if ev.type == evdev.ecodes.EV_KEY:
                            self._handle_key_event(ev)
        except Exception as e:
            logger.error("Capture loop error: %s", e)
        finally:
            for kbd in keyboards:
                try:
                    kbd.close()
                except Exception:
                    pass

    def _handle_key_event(self, ev) -> None:
        """Process a single evdev key event."""
        context = get_sway_focused_window()
        if is_sensitive_context(context):
            return

        key_code = ev.code

        # Track modifier state
        if key_code in MODIFIER_CODES:
            if ev.value == 1:  # Key down
                self._active_modifiers.add(key_code)
            elif ev.value == 0:  # Key up
                self._active_modifiers.discard(key_code)
            event_type = EVENT_TYPE_MODIFIER
        elif ev.value == 1:
            event_type = EVENT_TYPE_KEY_PRESS
        elif ev.value == 0:
            event_type = EVENT_TYPE_KEY_RELEASE
        else:
            return  # Ignore key repeat (value == 2)

        modifiers = ",".join(str(m) for m in sorted(self._active_modifiers))

        event = KeystrokeEvent(
            event_type=event_type,
            key_code=key_code,
            timestamp=time.time(),
            context=context,
            modifiers=modifiers,
            session_id=self.session_id,
        )
        self.enqueue_event(event)

    def _flush_loop(self) -> None:
        """Periodically flush queued events to the store."""
        while self._running:
            time.sleep(self.flush_interval)
            self._flush_queue()

    def _flush_queue(self) -> None:
        """Drain the event queue and batch-insert into the store."""
        events = []
        while not self._event_queue.empty():
            try:
                events.append(self._event_queue.get_nowait())
            except queue.Empty:
                break

        if events:
            try:
                count = self.store.ingest(events)
                logger.debug("Flushed %d events to store", count)
            except Exception as e:
                logger.error("Failed to flush events: %s", e)


def main() -> None:
    """Entry point for the keystroke collector daemon.

    Usage: python -m agent.keystroke_collector

    Runs until SIGINT/SIGTERM. Intended to be managed by systemd
    (os/monet-keystroke.service).
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    db_path = os.environ.get("MONET_DB_PATH", DEFAULT_DB_PATH)
    session_id = os.environ.get("MONET_KEYSTROKE_SESSION", "system")

    store = KeystrokeStore(db_path=db_path)
    collector = KeystrokeCollector(
        store=store,
        flush_interval=FLUSH_INTERVAL,
        session_id=session_id,
    )

    # Handle graceful shutdown
    def shutdown_handler(signum, frame):
        logger.info("Received signal %d, shutting down", signum)
        collector.stop()

    signal.signal(signal.SIGINT, shutdown_handler)
    signal.signal(signal.SIGTERM, shutdown_handler)

    collector.start()
    logger.info("Keystroke collector running (db=%s, session=%s)", db_path, session_id)

    # Keep main thread alive
    try:
        while collector.running:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        collector.stop()


if __name__ == "__main__":
    main()
