"""Tests for agent.system - SystemManager WiFi, volume, brightness, power controls."""

from unittest.mock import MagicMock, patch

import pytest

from agent.system import (
    BrightnessState,
    SystemManager,
    SystemState,
    VolumeState,
    WifiNetwork,
    WifiStatus,
    _run,
)


@pytest.fixture
def mgr():
    return SystemManager()


# ---------------------------------------------------------------------------
# _run helper
# ---------------------------------------------------------------------------


class TestRunHelper:
    def test_run_success(self):
        result = _run(["echo", "hello"])
        assert result == "hello"

    def test_run_nonexistent_command(self):
        result = _run(["__nonexistent_command_xyz__"])
        assert result is None

    def test_run_failed_command(self):
        result = _run(["false"])
        assert result is None

    def test_run_timeout(self):
        # sleep 10 with a 1s timeout should time out
        result = _run(["sleep", "10"], timeout=1)
        assert result is None


# ---------------------------------------------------------------------------
# WiFi
# ---------------------------------------------------------------------------


class TestWifiStatus:
    @patch("agent.system._has_tool", return_value=False)
    def test_no_nmcli(self, mock_has, mgr):
        status = mgr.wifi_status()
        assert not status.connected
        assert status.ssid is None

    @patch("agent.system._run")
    @patch("agent.system._has_tool", return_value=True)
    def test_connected(self, mock_has, mock_run, mgr):
        mock_run.side_effect = [
            "yes:MyNetwork:85",  # wifi status
            "IP4.ADDRESS[1]:192.168.1.42/24",  # IP lookup
        ]
        status = mgr.wifi_status()
        assert status.connected
        assert status.ssid == "MyNetwork"
        assert status.signal == 85
        assert status.ip_address == "192.168.1.42"

    @patch("agent.system._run", return_value="no:SomeNetwork:50")
    @patch("agent.system._has_tool", return_value=True)
    def test_disconnected(self, mock_has, mock_run, mgr):
        status = mgr.wifi_status()
        assert not status.connected

    @patch("agent.system._run", return_value=None)
    @patch("agent.system._has_tool", return_value=True)
    def test_nmcli_fails(self, mock_has, mock_run, mgr):
        status = mgr.wifi_status()
        assert not status.connected


class TestWifiScan:
    @patch("agent.system._has_tool", return_value=False)
    def test_no_nmcli(self, mock_has, mgr):
        assert mgr.wifi_scan() == []

    @patch("agent.system._run")
    @patch("agent.system._has_tool", return_value=True)
    def test_scan_results(self, mock_has, mock_run, mgr):
        mock_run.side_effect = [
            None,  # rescan (best-effort)
            "HomeNet:90:WPA2:yes\nCoffeeShop:60:WPA2:no\nOpenNet:30::no",
        ]
        networks = mgr.wifi_scan()
        assert len(networks) == 3
        assert networks[0].ssid == "HomeNet"
        assert networks[0].signal == 90
        assert networks[0].connected
        assert networks[1].ssid == "CoffeeShop"
        assert networks[1].security == "WPA2"
        assert not networks[1].connected
        assert networks[2].ssid == "OpenNet"
        assert networks[2].security == "Open"

    @patch("agent.system._run")
    @patch("agent.system._has_tool", return_value=True)
    def test_deduplicates_ssids(self, mock_has, mock_run, mgr):
        mock_run.side_effect = [
            None,  # rescan
            "NetA:80:WPA2:no\nNetA:60:WPA2:no\nNetB:40:WPA2:no",
        ]
        networks = mgr.wifi_scan()
        ssids = [n.ssid for n in networks]
        assert ssids == ["NetA", "NetB"]

    @patch("agent.system._run")
    @patch("agent.system._has_tool", return_value=True)
    def test_skips_empty_ssid(self, mock_has, mock_run, mgr):
        mock_run.side_effect = [None, ":50:WPA2:no\nRealNet:80:WPA2:no"]
        networks = mgr.wifi_scan()
        assert len(networks) == 1
        assert networks[0].ssid == "RealNet"


class TestWifiConnect:
    @patch("agent.system._has_tool", return_value=False)
    def test_no_nmcli(self, mock_has, mgr):
        assert not mgr.wifi_connect("test")

    @patch("agent.system._run", return_value="Device 'wlan0' successfully activated")
    @patch("agent.system._has_tool", return_value=True)
    def test_connect_success(self, mock_has, mock_run, mgr):
        assert mgr.wifi_connect("MyNet", "password123")
        mock_run.assert_called_with(
            ["nmcli", "dev", "wifi", "connect", "MyNet", "password", "password123"],
            timeout=30,
        )

    @patch("agent.system._run", return_value="Error: connection failed")
    @patch("agent.system._has_tool", return_value=True)
    def test_connect_failure(self, mock_has, mock_run, mgr):
        assert not mgr.wifi_connect("BadNet")

    @patch("agent.system._run", return_value="Device 'wlan0' successfully activated")
    @patch("agent.system._has_tool", return_value=True)
    def test_connect_no_password(self, mock_has, mock_run, mgr):
        assert mgr.wifi_connect("OpenNet")
        mock_run.assert_called_with(
            ["nmcli", "dev", "wifi", "connect", "OpenNet"],
            timeout=30,
        )


class TestWifiDisconnect:
    @patch("agent.system._has_tool", return_value=False)
    def test_no_nmcli(self, mock_has, mgr):
        assert not mgr.wifi_disconnect()

    @patch(
        "agent.system._run", return_value="Device 'wlan0' successfully disconnected."
    )
    @patch("agent.system._has_tool", return_value=True)
    def test_disconnect_success(self, mock_has, mock_run, mgr):
        assert mgr.wifi_disconnect()


# ---------------------------------------------------------------------------
# Volume
# ---------------------------------------------------------------------------


class TestVolumeGet:
    @patch("agent.system._has_tool", return_value=False)
    def test_no_wpctl(self, mock_has, mgr):
        vol = mgr.volume_get()
        assert vol.level == 50
        assert not vol.muted

    @patch("agent.system._run", return_value="Volume: 0.75")
    @patch("agent.system._has_tool", return_value=True)
    def test_normal_volume(self, mock_has, mock_run, mgr):
        vol = mgr.volume_get()
        assert vol.level == 75
        assert not vol.muted

    @patch("agent.system._run", return_value="Volume: 0.30 [MUTED]")
    @patch("agent.system._has_tool", return_value=True)
    def test_muted(self, mock_has, mock_run, mgr):
        vol = mgr.volume_get()
        assert vol.level == 30
        assert vol.muted

    @patch("agent.system._run", return_value=None)
    @patch("agent.system._has_tool", return_value=True)
    def test_wpctl_fails(self, mock_has, mock_run, mgr):
        vol = mgr.volume_get()
        assert vol.level == 50  # default


class TestVolumeSet:
    @patch("agent.system._has_tool", return_value=False)
    def test_no_wpctl(self, mock_has, mgr):
        vol = mgr.volume_set(80)
        assert vol.level == 80

    @patch("agent.system._run")
    @patch("agent.system._has_tool", return_value=True)
    def test_set_volume(self, mock_has, mock_run, mgr):
        mock_run.side_effect = [
            "",  # set-volume
            "Volume: 0.60",  # get-volume (re-read)
        ]
        vol = mgr.volume_set(60)
        assert vol.level == 60

    @patch("agent.system._run")
    @patch("agent.system._has_tool", return_value=True)
    def test_clamps_above_100(self, mock_has, mock_run, mgr):
        mock_run.side_effect = ["", "Volume: 1.00"]
        vol = mgr.volume_set(150)
        # Should clamp to 100
        first_call = mock_run.call_args_list[0]
        assert "1.00" in first_call[0][0][-1]

    @patch("agent.system._run")
    @patch("agent.system._has_tool", return_value=True)
    def test_clamps_below_0(self, mock_has, mock_run, mgr):
        mock_run.side_effect = ["", "Volume: 0.00"]
        vol = mgr.volume_set(-10)
        first_call = mock_run.call_args_list[0]
        assert "0.00" in first_call[0][0][-1]


class TestVolumeMuteToggle:
    @patch("agent.system._has_tool", return_value=False)
    def test_no_wpctl(self, mock_has, mgr):
        vol = mgr.volume_mute_toggle()
        assert vol.level == 50

    @patch("agent.system._run")
    @patch("agent.system._has_tool", return_value=True)
    def test_toggle(self, mock_has, mock_run, mgr):
        mock_run.side_effect = ["", "Volume: 0.50 [MUTED]"]
        vol = mgr.volume_mute_toggle()
        assert vol.muted


# ---------------------------------------------------------------------------
# Brightness
# ---------------------------------------------------------------------------


class TestBrightnessGet:
    @patch("agent.system._has_tool", return_value=False)
    def test_no_brightnessctl(self, mock_has, mgr):
        br = mgr.brightness_get()
        assert br.level == 100

    @patch("agent.system._run", return_value="intel_backlight,backlight,750,75%,1000")
    @patch("agent.system._has_tool", return_value=True)
    def test_normal(self, mock_has, mock_run, mgr):
        br = mgr.brightness_get()
        assert br.level == 75
        assert br.max_brightness == 1000

    @patch("agent.system._run", return_value=None)
    @patch("agent.system._has_tool", return_value=True)
    def test_fails(self, mock_has, mock_run, mgr):
        br = mgr.brightness_get()
        assert br.level == 100  # default


class TestBrightnessSet:
    @patch("agent.system._has_tool", return_value=False)
    def test_no_brightnessctl(self, mock_has, mgr):
        br = mgr.brightness_set(50)
        assert br.level == 50

    @patch("agent.system._run")
    @patch("agent.system._has_tool", return_value=True)
    def test_set(self, mock_has, mock_run, mgr):
        mock_run.side_effect = ["", "intel_backlight,backlight,500,50%,1000"]
        br = mgr.brightness_set(50)
        assert br.level == 50

    @patch("agent.system._run")
    @patch("agent.system._has_tool", return_value=True)
    def test_clamps_to_1_percent_minimum(self, mock_has, mock_run, mgr):
        mock_run.side_effect = ["", "intel_backlight,backlight,10,1%,1000"]
        br = mgr.brightness_set(0)
        first_call = mock_run.call_args_list[0]
        assert "1%" in first_call[0][0][-1]


# ---------------------------------------------------------------------------
# Power
# ---------------------------------------------------------------------------


class TestPower:
    @patch("agent.system._has_tool", return_value=False)
    def test_shutdown_no_systemctl(self, mock_has, mgr):
        assert not mgr.power_shutdown()

    @patch("agent.system._run", return_value=None)
    @patch("agent.system._has_tool", return_value=True)
    def test_shutdown(self, mock_has, mock_run, mgr):
        assert mgr.power_shutdown()
        mock_run.assert_called_with(["systemctl", "poweroff"])

    @patch("agent.system._has_tool", return_value=False)
    def test_restart_no_systemctl(self, mock_has, mgr):
        assert not mgr.power_restart()

    @patch("agent.system._run", return_value=None)
    @patch("agent.system._has_tool", return_value=True)
    def test_restart(self, mock_has, mock_run, mgr):
        assert mgr.power_restart()
        mock_run.assert_called_with(["systemctl", "reboot"])

    @patch("agent.system._has_tool", return_value=False)
    def test_suspend_no_systemctl(self, mock_has, mgr):
        assert not mgr.power_suspend()

    @patch("agent.system._run", return_value="")
    @patch("agent.system._has_tool", return_value=True)
    def test_suspend(self, mock_has, mock_run, mgr):
        assert mgr.power_suspend()


# ---------------------------------------------------------------------------
# Aggregate state
# ---------------------------------------------------------------------------


class TestGetState:
    @patch("agent.system._has_tool", return_value=False)
    def test_no_tools(self, mock_has, mgr):
        state = mgr.get_state()
        assert isinstance(state, SystemState)
        assert not state.wifi.connected
        assert state.volume.level == 50
        assert state.brightness.level == 100

    @patch("agent.system._run")
    @patch("agent.system._has_tool", return_value=True)
    def test_full_state(self, mock_has, mock_run, mgr):
        mock_run.side_effect = [
            "yes:HomeNet:90",  # wifi status
            "IP4.ADDRESS[1]:10.0.0.5/24",  # IP
            "Volume: 0.65",  # volume
            "intel_backlight,backlight,800,80%,1000",  # brightness
        ]
        state = mgr.get_state()
        assert state.wifi.connected
        assert state.wifi.ssid == "HomeNet"
        assert state.volume.level == 65
        assert state.brightness.level == 80


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


class TestDataModels:
    def test_wifi_network(self):
        n = WifiNetwork(ssid="Test", signal=80, security="WPA2")
        assert n.ssid == "Test"
        assert not n.connected

    def test_wifi_status_defaults(self):
        s = WifiStatus()
        assert not s.connected
        assert s.ssid is None

    def test_volume_state_defaults(self):
        v = VolumeState()
        assert v.level == 50
        assert not v.muted

    def test_brightness_state_defaults(self):
        b = BrightnessState()
        assert b.level == 100
