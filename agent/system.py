"""System integration - WiFi, volume, brightness, and power management.

Wraps OS-level tools (nmcli, wpctl, brightnessctl, systemctl) behind a
clean Python API. All methods are safe to call on dev machines - they
return sensible defaults when the underlying tool is missing.
"""

import logging
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import List, Optional

logger = logging.getLogger(__name__)


@dataclass
class WifiNetwork:
    ssid: str
    signal: int  # 0-100
    security: str  # "WPA2", "WPA3", "Open", etc.
    connected: bool = False


@dataclass
class WifiStatus:
    connected: bool = False
    ssid: Optional[str] = None
    ip_address: Optional[str] = None
    signal: int = 0


@dataclass
class VolumeState:
    level: int = 50  # 0-100
    muted: bool = False


@dataclass
class BrightnessState:
    level: int = 100  # 0-100
    max_brightness: int = 100


@dataclass
class SystemState:
    wifi: WifiStatus = field(default_factory=WifiStatus)
    volume: VolumeState = field(default_factory=VolumeState)
    brightness: BrightnessState = field(default_factory=BrightnessState)


def _run(cmd: List[str], timeout: int = 10) -> Optional[str]:
    """Run a command and return stdout, or None on failure."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode == 0:
            return result.stdout.strip()
        logger.warning(
            "Command %s failed (rc=%d): %s",
            cmd,
            result.returncode,
            result.stderr.strip(),
        )
        return None
    except FileNotFoundError:
        logger.debug("Command not found: %s", cmd[0])
        return None
    except subprocess.TimeoutExpired:
        logger.warning("Command timed out: %s", cmd)
        return None


def _has_tool(name: str) -> bool:
    return shutil.which(name) is not None


class SystemManager:
    """Manages system-level hardware controls for the Monet OS."""

    # --- WiFi (nmcli) ---

    def wifi_status(self) -> WifiStatus:
        """Get current WiFi connection status."""
        if not _has_tool("nmcli"):
            return WifiStatus()

        # Check if WiFi is connected
        out = _run(["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL", "dev", "wifi"])
        if out is None:
            return WifiStatus()

        for line in out.splitlines():
            parts = line.split(":")
            if len(parts) >= 3 and parts[0] == "yes":
                ssid = parts[1]
                signal = int(parts[2]) if parts[2].isdigit() else 0
                # Get IP address
                ip_out = _run(
                    ["nmcli", "-t", "-f", "IP4.ADDRESS", "dev", "show", "wlan0"]
                )
                ip_addr = None
                if ip_out:
                    for ip_line in ip_out.splitlines():
                        if ":" in ip_line:
                            ip_addr = ip_line.split(":", 1)[1].split("/")[0]
                            break
                return WifiStatus(
                    connected=True, ssid=ssid, signal=signal, ip_address=ip_addr
                )

        return WifiStatus(connected=False)

    def wifi_scan(self) -> List[WifiNetwork]:
        """Scan for available WiFi networks."""
        if not _has_tool("nmcli"):
            return []

        # Trigger a rescan (best-effort)
        _run(["nmcli", "dev", "wifi", "rescan"])

        out = _run(
            ["nmcli", "-t", "-f", "SSID,SIGNAL,SECURITY,ACTIVE", "dev", "wifi", "list"]
        )
        if out is None:
            return []

        networks: List[WifiNetwork] = []
        seen_ssids: set = set()
        for line in out.splitlines():
            parts = line.split(":")
            if len(parts) >= 4:
                ssid = parts[0]
                if not ssid or ssid in seen_ssids:
                    continue
                seen_ssids.add(ssid)
                signal = int(parts[1]) if parts[1].isdigit() else 0
                security = parts[2] if parts[2] else "Open"
                connected = parts[3] == "yes"
                networks.append(
                    WifiNetwork(
                        ssid=ssid, signal=signal, security=security, connected=connected
                    )
                )

        networks.sort(key=lambda n: n.signal, reverse=True)
        return networks

    def wifi_connect(self, ssid: str, password: Optional[str] = None) -> bool:
        """Connect to a WiFi network. Returns True on success."""
        if not _has_tool("nmcli"):
            return False

        cmd = ["nmcli", "dev", "wifi", "connect", ssid]
        if password:
            cmd.extend(["password", password])

        out = _run(cmd, timeout=30)
        return out is not None and "successfully" in out.lower()

    def wifi_disconnect(self) -> bool:
        """Disconnect from the current WiFi network."""
        if not _has_tool("nmcli"):
            return False
        out = _run(["nmcli", "dev", "disconnect", "wlan0"])
        return out is not None

    # --- Volume (wpctl / PipeWire) ---

    def volume_get(self) -> VolumeState:
        """Get current volume level and mute state."""
        if not _has_tool("wpctl"):
            return VolumeState()

        out = _run(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"])
        if out is None:
            return VolumeState()

        # Output format: "Volume: 0.50" or "Volume: 0.50 [MUTED]"
        muted = "[MUTED]" in out
        try:
            vol_str = out.split(":")[1].strip().split()[0]
            level = int(float(vol_str) * 100)
        except (IndexError, ValueError):
            level = 50

        return VolumeState(level=max(0, min(100, level)), muted=muted)

    def volume_set(self, level: int) -> VolumeState:
        """Set volume to a percentage (0-100)."""
        if not _has_tool("wpctl"):
            return VolumeState(level=level)

        clamped = max(0, min(100, level))
        _run(["wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", f"{clamped / 100:.2f}"])
        return self.volume_get()

    def volume_mute_toggle(self) -> VolumeState:
        """Toggle mute on the default audio sink."""
        if not _has_tool("wpctl"):
            return VolumeState()
        _run(["wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "toggle"])
        return self.volume_get()

    # --- Brightness (brightnessctl) ---

    def brightness_get(self) -> BrightnessState:
        """Get current display brightness."""
        if not _has_tool("brightnessctl"):
            return BrightnessState()

        out = _run(["brightnessctl", "-m"])
        if out is None:
            return BrightnessState()

        # Machine-readable output: device,class,current,percentage,max
        parts = out.split(",")
        if len(parts) >= 5:
            try:
                current = int(parts[2])
                max_br = int(parts[4])
                level = int((current / max_br) * 100) if max_br > 0 else 100
                return BrightnessState(level=level, max_brightness=max_br)
            except (ValueError, ZeroDivisionError):
                pass

        return BrightnessState()

    def brightness_set(self, level: int) -> BrightnessState:
        """Set brightness to a percentage (0-100)."""
        if not _has_tool("brightnessctl"):
            return BrightnessState(level=level)

        clamped = max(1, min(100, level))  # min 1% to avoid blanking
        _run(["brightnessctl", "set", f"{clamped}%"])
        return self.brightness_get()

    # --- Power (systemctl) ---

    def power_shutdown(self) -> bool:
        """Initiate system shutdown."""
        if not _has_tool("systemctl"):
            return False
        out = _run(["systemctl", "poweroff"])
        # systemctl poweroff does not return on success (system is shutting down)
        # so any non-exception means the command was accepted
        return True

    def power_restart(self) -> bool:
        """Initiate system restart."""
        if not _has_tool("systemctl"):
            return False
        _run(["systemctl", "reboot"])
        return True

    def power_suspend(self) -> bool:
        """Suspend the system."""
        if not _has_tool("systemctl"):
            return False
        out = _run(["systemctl", "suspend"])
        return out is not None or True  # suspend may not return stdout

    # --- Aggregate state ---

    def get_state(self) -> SystemState:
        """Get full system state (WiFi + volume + brightness)."""
        return SystemState(
            wifi=self.wifi_status(),
            volume=self.volume_get(),
            brightness=self.brightness_get(),
        )
