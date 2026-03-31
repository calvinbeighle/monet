import 'package:flutter/material.dart';

import 'monet_theme.dart';

class ConnectedTool {
  final String name;
  final bool connected;

  const ConnectedTool({required this.name, required this.connected});
}

class SystemStatus {
  final bool wifiConnected;
  final String? wifiSsid;
  final int wifiSignal;
  final int volumeLevel;
  final bool volumeMuted;
  final int brightnessLevel;

  const SystemStatus({
    this.wifiConnected = false,
    this.wifiSsid,
    this.wifiSignal = 0,
    this.volumeLevel = 50,
    this.volumeMuted = false,
    this.brightnessLevel = 100,
  });

  factory SystemStatus.fromJson(Map<String, dynamic> json) {
    final wifi = json['wifi'] as Map<String, dynamic>? ?? {};
    final volume = json['volume'] as Map<String, dynamic>? ?? {};
    final brightness = json['brightness'] as Map<String, dynamic>? ?? {};
    return SystemStatus(
      wifiConnected: wifi['connected'] as bool? ?? false,
      wifiSsid: wifi['ssid'] as String?,
      wifiSignal: wifi['signal'] as int? ?? 0,
      volumeLevel: volume['level'] as int? ?? 50,
      volumeMuted: volume['muted'] as bool? ?? false,
      brightnessLevel: brightness['level'] as int? ?? 100,
    );
  }
}

class StatusBar extends StatelessWidget {
  final List<ConnectedTool> tools;
  final String? activeAgent;
  final String? activePattern;
  final VoidCallback? onLogout;
  final SystemStatus systemStatus;
  final VoidCallback? onWifiTap;
  final VoidCallback? onVolumeTap;
  final ValueChanged<int>? onVolumeChanged;
  final ValueChanged<int>? onBrightnessChanged;
  final VoidCallback? onPowerTap;
  final VoidCallback? onAgentsTap;
  final bool isDarkTheme;
  final VoidCallback? onThemeToggle;

  const StatusBar({
    super.key,
    this.tools = const [],
    this.activeAgent,
    this.activePattern,
    this.onLogout,
    this.systemStatus = const SystemStatus(),
    this.onWifiTap,
    this.onVolumeTap,
    this.onVolumeChanged,
    this.onBrightnessChanged,
    this.onPowerTap,
    this.onAgentsTap,
    this.isDarkTheme = true,
    this.onThemeToggle,
  });

  @override
  Widget build(BuildContext context) {
    final c = MonetColors.of(context);
    return Container(
      height: 36,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: c.scaffoldBg,
        border: Border(
          top: BorderSide(color: c.border),
        ),
      ),
      child: Row(
        children: [
          ...tools.map((tool) => _buildToolIndicator(tool, c)),
          if (onAgentsTap != null) _buildAgentsButton(c),
          const Spacer(),
          _buildThemeToggle(c),
          const SizedBox(width: 12),
          _buildWifiIndicator(c),
          const SizedBox(width: 12),
          _buildVolumeIndicator(c),
          const SizedBox(width: 12),
          _buildBrightnessIndicator(c),
          if (activeAgent != null) ...[
            const SizedBox(width: 12),
            _buildAgentIndicator(c),
          ],
          if (activePattern != null) ...[
            const SizedBox(width: 12),
            _buildPatternBadge(c),
          ],
          const SizedBox(width: 12),
          _buildPowerButton(c),
          if (onLogout != null) ...[
            const SizedBox(width: 12),
            _buildLogoutButton(c),
          ],
        ],
      ),
    );
  }

  Widget _buildThemeToggle(MonetColors c) {
    return GestureDetector(
      onTap: onThemeToggle,
      child: Tooltip(
        message: isDarkTheme ? 'Switch to light theme' : 'Switch to dark theme',
        child: Icon(
          isDarkTheme ? Icons.light_mode_outlined : Icons.dark_mode_outlined,
          size: 14,
          color: c.textTertiary,
        ),
      ),
    );
  }

  Widget _buildAgentsButton(MonetColors c) {
    return GestureDetector(
      onTap: onAgentsTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(4),
          color: c.hoverOverlay,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.smart_toy_outlined,
              size: 13,
              color: c.textTertiary,
            ),
            const SizedBox(width: 4),
            Text(
              'Agents',
              style: TextStyle(
                color: c.textTertiary,
                fontSize: 11,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildToolIndicator(ConnectedTool tool, MonetColors c) {
    return Padding(
      padding: const EdgeInsets.only(right: 12),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: tool.connected ? c.success : Colors.grey,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            tool.name,
            style: TextStyle(
              color: c.textTertiary,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWifiIndicator(MonetColors c) {
    final connected = systemStatus.wifiConnected;
    final signal = systemStatus.wifiSignal;
    IconData icon;
    if (!connected) {
      icon = Icons.wifi_off;
    } else if (signal >= 70) {
      icon = Icons.wifi;
    } else if (signal >= 40) {
      icon = Icons.wifi_2_bar;
    } else {
      icon = Icons.wifi_1_bar;
    }

    return GestureDetector(
      onTap: onWifiTap,
      child: Tooltip(
        message: connected
            ? 'WiFi: ${systemStatus.wifiSsid ?? "Connected"} (${signal}%)'
            : 'WiFi: Disconnected',
        child: Icon(
          icon,
          size: 14,
          color: connected ? c.textSecondary : c.textMeta,
        ),
      ),
    );
  }

  Widget _buildVolumeIndicator(MonetColors c) {
    final muted = systemStatus.volumeMuted;
    final level = systemStatus.volumeLevel;
    IconData icon;
    if (muted || level == 0) {
      icon = Icons.volume_off;
    } else if (level < 50) {
      icon = Icons.volume_down;
    } else {
      icon = Icons.volume_up;
    }

    return GestureDetector(
      onTap: onVolumeTap,
      child: Tooltip(
        message: muted ? 'Volume: Muted' : 'Volume: $level%',
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 14,
              color: muted ? c.textMeta : c.textSecondary,
            ),
            const SizedBox(width: 4),
            Text(
              muted ? 'Mute' : '$level%',
              style: TextStyle(
                color: c.textTertiary,
                fontSize: 11,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBrightnessIndicator(MonetColors c) {
    final level = systemStatus.brightnessLevel;
    return GestureDetector(
      onTap: () => onBrightnessChanged?.call(level),
      child: Tooltip(
        message: 'Brightness: $level%',
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              level > 50 ? Icons.brightness_high : Icons.brightness_low,
              size: 14,
              color: c.textSecondary,
            ),
            const SizedBox(width: 4),
            Text(
              '$level%',
              style: TextStyle(
                color: c.textTertiary,
                fontSize: 11,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAgentIndicator(MonetColors c) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 12,
          height: 12,
          child: CircularProgressIndicator(
            strokeWidth: 1.5,
            color: c.primary,
          ),
        ),
        const SizedBox(width: 8),
        Text(
          activeAgent!,
          style: TextStyle(
            color: c.primary,
            fontSize: 12,
          ),
        ),
      ],
    );
  }

  Widget _buildPatternBadge(MonetColors c) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(4),
        color: c.activeOverlay,
      ),
      child: Text(
        activePattern!,
        style: TextStyle(
          color: c.textTertiary,
          fontSize: 11,
        ),
      ),
    );
  }

  Widget _buildPowerButton(MonetColors c) {
    return GestureDetector(
      onTap: onPowerTap,
      child: Tooltip(
        message: 'Power',
        child: Icon(
          Icons.power_settings_new,
          size: 14,
          color: c.textTertiary,
        ),
      ),
    );
  }

  Widget _buildLogoutButton(MonetColors c) {
    return GestureDetector(
      onTap: onLogout,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.logout, size: 14, color: c.textTertiary),
          const SizedBox(width: 4),
          Text(
            'Logout',
            style: TextStyle(
              color: c.textTertiary,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}
