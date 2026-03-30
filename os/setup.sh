#!/usr/bin/env bash
# setup.sh
#
# Sets up the monet-dev VM environment on Debian 12 (Bookworm) ARM64.
# Installs: Sway (Wayland compositor), Python 3, Flutter/Dart dependencies,
# Node.js LTS, and configures auto-login on tty1 with Sway autostart.
#
# Run inside the VM as root after strip.sh:
#   sudo bash setup.sh
#
# The script is idempotent - safe to re-run.

set -euo pipefail

MONET_USER="${MONET_USER:-monet}"

echo "[setup] Starting environment setup for user: $MONET_USER"

# ---------------------------------------------------------------------------
# 1. System update
# ---------------------------------------------------------------------------
echo "[setup] Updating package index..."
apt-get update -y
apt-get upgrade -y

# ---------------------------------------------------------------------------
# 2. Core utilities
# ---------------------------------------------------------------------------
echo "[setup] Installing core utilities..."
apt-get install -y \
  curl \
  wget \
  git \
  vim \
  htop \
  unzip \
  zip \
  ca-certificates \
  gnupg \
  lsb-release \
  sudo \
  build-essential \
  pkg-config \
  libssl-dev \
  libffi-dev \
  software-properties-common \
  apt-transport-https \
  openssh-server \
  systemd-timesyncd

# ---------------------------------------------------------------------------
# 3. Sway (Wayland compositor) and related tools
# ---------------------------------------------------------------------------
echo "[setup] Installing Sway and Wayland tools..."
apt-get install -y \
  sway \
  swaybg \
  swayidle \
  swaylock \
  xwayland \
  foot \
  grim \
  slurp \
  wl-clipboard \
  dbus-user-session \
  pipewire \
  pipewire-pulse \
  wireplumber

# ---------------------------------------------------------------------------
# 4. Python 3 and pip
# ---------------------------------------------------------------------------
echo "[setup] Installing Python 3..."
apt-get install -y \
  python3 \
  python3-pip \
  python3-venv \
  python3-dev \
  python3-setuptools \
  python3-wheel

# Upgrade pip
python3 -m pip install --upgrade pip --break-system-packages || true

# ---------------------------------------------------------------------------
# 5. Flutter / Dart dependencies
# ---------------------------------------------------------------------------
echo "[setup] Installing Flutter/Dart system dependencies..."
apt-get install -y \
  clang \
  cmake \
  ninja-build \
  libgtk-3-dev \
  liblzma-dev \
  libglib2.0-dev \
  libgles2-mesa-dev \
  libgbm-dev \
  libdrm-dev \
  libinput-dev \
  libudev-dev \
  libxkbcommon-dev \
  libwayland-dev \
  wayland-protocols

# ---------------------------------------------------------------------------
# 6. Node.js LTS (via NodeSource)
# ---------------------------------------------------------------------------
echo "[setup] Installing Node.js LTS..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
  apt-get install -y nodejs
else
  echo "[setup] Node.js already installed: $(node --version)"
fi

# ---------------------------------------------------------------------------
# 7. Flutter SDK
# ---------------------------------------------------------------------------
FLUTTER_DIR="/opt/flutter"
FLUTTER_VERSION="3.29.2"  # Latest stable as of early 2026

if [ ! -d "$FLUTTER_DIR" ]; then
  echo "[setup] Installing Flutter $FLUTTER_VERSION (ARM64)..."
  wget -q "https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_${FLUTTER_VERSION}-stable.tar.xz" \
    -O /tmp/flutter.tar.xz
  tar xf /tmp/flutter.tar.xz -C /opt/
  rm /tmp/flutter.tar.xz
  chown -R "$MONET_USER:$MONET_USER" "$FLUTTER_DIR"
else
  echo "[setup] Flutter already installed at $FLUTTER_DIR"
fi

# Add Flutter to system-wide PATH
if [ ! -f /etc/profile.d/flutter.sh ]; then
  cat > /etc/profile.d/flutter.sh <<'FLUTTER_PROFILE'
export PATH="$PATH:/opt/flutter/bin"
export FLUTTER_ROOT="/opt/flutter"
FLUTTER_PROFILE
fi

# ---------------------------------------------------------------------------
# 8. Ensure monet user exists with sudo access
# ---------------------------------------------------------------------------
if ! id "$MONET_USER" &>/dev/null; then
  echo "[setup] Creating user: $MONET_USER"
  useradd -m -s /bin/bash -G sudo,audio,video,input,render,seat "$MONET_USER"
  echo "${MONET_USER}:monet" | chpasswd
  echo "[setup] WARNING: Default password set to 'monet' - change it immediately!"
else
  echo "[setup] User $MONET_USER exists, adding to required groups..."
  usermod -aG sudo,audio,video,input,render,seat "$MONET_USER" 2>/dev/null || true
fi

# Passwordless sudo for monet user (dev VM convenience)
if [ ! -f "/etc/sudoers.d/$MONET_USER" ]; then
  echo "$MONET_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/$MONET_USER"
  chmod 440 "/etc/sudoers.d/$MONET_USER"
fi

# ---------------------------------------------------------------------------
# 9. Auto-login on tty1 using getty override
# ---------------------------------------------------------------------------
echo "[setup] Configuring auto-login on tty1 for $MONET_USER..."
mkdir -p /etc/systemd/system/getty@tty1.service.d/
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf <<AUTOLOGIN
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin ${MONET_USER} --noclear %I \$TERM
AUTOLOGIN

systemctl daemon-reload
systemctl enable getty@tty1

# ---------------------------------------------------------------------------
# 10. Sway auto-start on tty1 login
# ---------------------------------------------------------------------------
echo "[setup] Configuring Sway auto-start on tty1..."
BASH_PROFILE="/home/${MONET_USER}/.bash_profile"
if ! grep -q "exec sway" "$BASH_PROFILE" 2>/dev/null; then
  cat >> "$BASH_PROFILE" <<'SWAY_AUTOSTART'

# Auto-start Sway on tty1
if [ -z "$WAYLAND_DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)"
  export MOZ_ENABLE_WAYLAND=1
  export QT_QPA_PLATFORM=wayland
  export CLUTTER_BACKEND=wayland
  export SDL_VIDEODRIVER=wayland
  exec sway
fi
SWAY_AUTOSTART
  chown "$MONET_USER:$MONET_USER" "$BASH_PROFILE"
fi

# ---------------------------------------------------------------------------
# 11. Basic Sway config for monet user
# ---------------------------------------------------------------------------
SWAY_CONFIG_DIR="/home/${MONET_USER}/.config/sway"
mkdir -p "$SWAY_CONFIG_DIR"
if [ ! -f "$SWAY_CONFIG_DIR/config" ]; then
  cat > "$SWAY_CONFIG_DIR/config" <<'SWAY_CONFIG'
# Monet Sway configuration
# Minimal setup for agent-driven UI

# Use Mod4 (Super/Win) as the modifier
set $mod Mod4

# Default terminal
set $term foot

# Font
font pango:monospace 10

# Auto-float all windows (agent controls layout programmatically)
for_window [app_id=".*"] floating enable

# Wallpaper - solid dark background
output * bg #0d0d0d solid_color

# Key bindings
bindsym $mod+Return exec $term
bindsym $mod+Shift+q kill
bindsym $mod+Shift+e exec swaynag -t warning -m 'Exit Sway?' -b 'Yes' 'swaymsg exit'

# Focus
bindsym $mod+h focus left
bindsym $mod+j focus down
bindsym $mod+k focus up
bindsym $mod+l focus right

# Resize mode
mode "resize" {
  bindsym h resize shrink width 10px
  bindsym j resize grow height 10px
  bindsym k resize shrink height 10px
  bindsym l resize grow width 10px
  bindsym Escape mode "default"
}
bindsym $mod+r mode "resize"

# Input configuration
input "type:keyboard" {
  xkb_layout us
}

# IPC socket for programmatic control
# Accessible at $SWAYSOCK (default: /run/user/<uid>/sway-ipc.sock)

# Status bar
bar {
  position top
  status_command while date +'%Y-%m-%d %H:%M'; do sleep 1; done
  colors {
    statusline #ffffff
    background #1a1a1a
    inactive_workspace #1a1a1a #1a1a1a #888888
  }
}
SWAY_CONFIG
  chown -R "$MONET_USER:$MONET_USER" "$SWAY_CONFIG_DIR"
fi

# ---------------------------------------------------------------------------
# 12. XDG runtime dir for monet user session
# ---------------------------------------------------------------------------
loginctl enable-linger "$MONET_USER" 2>/dev/null || true

# ---------------------------------------------------------------------------
# 13. SSH hardening - allow only key auth (optional, keep password for dev)
# ---------------------------------------------------------------------------
if ! grep -q "^PermitRootLogin no" /etc/ssh/sshd_config; then
  sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
fi
systemctl restart ssh

echo "[setup] Done. Reboot the VM to apply auto-login and Sway autostart."
echo "[setup] Run install-monet.sh after reboot (or directly as monet user)."
