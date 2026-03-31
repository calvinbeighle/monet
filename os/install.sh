#!/usr/bin/env bash
# install.sh - Install Sway compositor, deploy Monet agent backend and Flutter shell.
#
# Run as root after strip.sh on a Debian 12 aarch64 system.
# Usage: sudo bash os/install.sh
#
# Expects the Monet repo to be at /opt/monet (or copies from current location).

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "Error: must run as root (sudo bash os/install.sh)"
    exit 1
fi

MONET_USER="${MONET_USER:-monet}"
MONET_DIR="/opt/monet"
MONET_DATA="/var/lib/monet"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Monet OS: Installing components ==="

# ---------------------------------------------------------------------------
# 1. Install Sway and Wayland dependencies
# ---------------------------------------------------------------------------
echo "[1/7] Installing Sway and Wayland stack..."

apt-get update
apt-get install -y \
    sway swaybg swayidle swaylock \
    wlroots \
    xwayland \
    foot \
    grim slurp \
    wl-clipboard \
    libgtk-3-0 libglib2.0-0 \
    fonts-noto fonts-noto-color-emoji \
    dbus-x11 \
    brightnessctl \
    plymouth plymouth-themes

# ---------------------------------------------------------------------------
# 2. Create monet user if it does not exist
# ---------------------------------------------------------------------------
echo "[2/7] Setting up monet user..."

if ! id "$MONET_USER" &>/dev/null; then
    useradd -m -s /bin/bash -G sudo,video,audio,input "$MONET_USER"
    echo "Created user: $MONET_USER"
    echo "Set a password: passwd $MONET_USER"
else
    # Ensure user is in required groups
    usermod -aG sudo,video,audio,input "$MONET_USER"
    echo "User $MONET_USER already exists, updated groups"
fi

# ---------------------------------------------------------------------------
# 3. Deploy Monet agent backend
# ---------------------------------------------------------------------------
echo "[3/7] Deploying agent backend..."

mkdir -p "$MONET_DIR"
mkdir -p "$MONET_DATA"

# Copy agent backend
cp -r "$REPO_DIR/agent" "$MONET_DIR/agent"

# Create Python virtual environment and install dependencies
python3 -m venv "$MONET_DIR/venv"
"$MONET_DIR/venv/bin/pip" install --upgrade pip
"$MONET_DIR/venv/bin/pip" install -r "$MONET_DIR/agent/requirements.txt"

# Set ownership
chown -R "$MONET_USER:$MONET_USER" "$MONET_DIR"
chown -R "$MONET_USER:$MONET_USER" "$MONET_DATA"

echo "Agent backend deployed to $MONET_DIR/agent"

# ---------------------------------------------------------------------------
# 4. Deploy pre-built Flutter shell
# ---------------------------------------------------------------------------
echo "[4/7] Deploying Flutter shell..."

FLUTTER_BUILD="$REPO_DIR/shell/build/linux/arm64/release/bundle"

if [[ -d "$FLUTTER_BUILD" ]]; then
    cp -r "$FLUTTER_BUILD" "$MONET_DIR/shell"
    chmod +x "$MONET_DIR/shell/shell"
    chown -R "$MONET_USER:$MONET_USER" "$MONET_DIR/shell"
    echo "Flutter shell deployed from pre-built bundle"
else
    echo "WARNING: Pre-built Flutter bundle not found at $FLUTTER_BUILD"
    echo "Build the shell first: cd shell && flutter build linux --release"
    echo "Then re-run this script."

    # Try x64 as fallback (for dev/testing on non-ARM)
    FLUTTER_BUILD_X64="$REPO_DIR/shell/build/linux/x64/release/bundle"
    if [[ -d "$FLUTTER_BUILD_X64" ]]; then
        cp -r "$FLUTTER_BUILD_X64" "$MONET_DIR/shell"
        chmod +x "$MONET_DIR/shell/shell"
        chown -R "$MONET_USER:$MONET_USER" "$MONET_DIR/shell"
        echo "Deployed x64 bundle as fallback (for dev/testing only)"
    fi
fi

# ---------------------------------------------------------------------------
# 5. Install systemd service for agent backend
# ---------------------------------------------------------------------------
echo "[5/7] Installing systemd service..."

cp "$SCRIPT_DIR/monet-agent.service" /etc/systemd/system/monet-agent.service
systemctl daemon-reload
systemctl enable monet-agent.service
echo "monet-agent.service installed and enabled"

# ---------------------------------------------------------------------------
# 6. Configure Sway for monet user
# ---------------------------------------------------------------------------
echo "[6/7] Configuring Sway..."

SWAY_CONFIG_DIR="/home/$MONET_USER/.config/sway"
mkdir -p "$SWAY_CONFIG_DIR"
cp "$SCRIPT_DIR/sway.config" "$SWAY_CONFIG_DIR/config"
chown -R "$MONET_USER:$MONET_USER" "/home/$MONET_USER/.config"

echo "Sway config deployed to $SWAY_CONFIG_DIR/config"

# ---------------------------------------------------------------------------
# 7. Configure Plymouth boot splash and quiet boot
# ---------------------------------------------------------------------------
echo "[7/9] Configuring Plymouth boot splash..."

# Deploy Monet Plymouth theme
PLYMOUTH_THEME_DIR="/usr/share/plymouth/themes/monet"
mkdir -p "$PLYMOUTH_THEME_DIR"
cp "$SCRIPT_DIR/plymouth/monet.plymouth" "$PLYMOUTH_THEME_DIR/monet.plymouth"
cp "$SCRIPT_DIR/plymouth/monet.script" "$PLYMOUTH_THEME_DIR/monet.script"

# Set Monet as default Plymouth theme
plymouth-set-default-theme monet
update-initramfs -u 2>/dev/null || true

echo "Plymouth theme installed"

echo "[8/9] Configuring quiet boot..."

# Add quiet boot parameters to GRUB
GRUB_DEFAULT="/etc/default/grub"
if [[ -f "$GRUB_DEFAULT" ]]; then
    # Set quiet boot parameters
    sed -i 's/^GRUB_CMDLINE_LINUX_DEFAULT=.*/GRUB_CMDLINE_LINUX_DEFAULT="quiet splash loglevel=0 vt.global_cursor_default=0"/' "$GRUB_DEFAULT"
    # Hide GRUB menu (boot directly)
    sed -i 's/^GRUB_TIMEOUT=.*/GRUB_TIMEOUT=0/' "$GRUB_DEFAULT"
    update-grub 2>/dev/null || true
    echo "GRUB configured for quiet boot"
else
    echo "WARNING: /etc/default/grub not found - skipping GRUB config"
fi

# Suppress kernel messages
cat > /etc/sysctl.d/99-monet-quiet.conf << EOF
# Suppress kernel messages on console (Monet OS)
kernel.printk = 1 1 1 1
EOF

# ---------------------------------------------------------------------------
# 8. Configure polkit for unprivileged power management
# ---------------------------------------------------------------------------
echo "[8.5/9] Configuring polkit for power management..."

# Allow monet user to shutdown/restart/suspend without password
mkdir -p /etc/polkit-1/rules.d
cat > /etc/polkit-1/rules.d/50-monet-power.rules << 'POLKIT'
// Allow monet user to manage power without authentication
polkit.addRule(function(action, subject) {
    if ((action.id == "org.freedesktop.login1.power-off" ||
         action.id == "org.freedesktop.login1.power-off-multiple-sessions" ||
         action.id == "org.freedesktop.login1.reboot" ||
         action.id == "org.freedesktop.login1.reboot-multiple-sessions" ||
         action.id == "org.freedesktop.login1.suspend" ||
         action.id == "org.freedesktop.login1.suspend-multiple-sessions") &&
        subject.user == "monet") {
        return polkit.Result.YES;
    }
});
POLKIT

echo "Polkit rules installed for power management"

# ---------------------------------------------------------------------------
# 9. Configure auto-login via systemd getty override
# ---------------------------------------------------------------------------
echo "[9/9] Configuring auto-login..."

GETTY_DIR="/etc/systemd/system/getty@tty1.service.d"
mkdir -p "$GETTY_DIR"
cat > "$GETTY_DIR/autologin.conf" << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $MONET_USER --noclear %I \$TERM
EOF

# Add Sway auto-start to user's bash profile (only on tty1)
BASH_PROFILE="/home/$MONET_USER/.bash_profile"
if ! grep -q "exec sway" "$BASH_PROFILE" 2>/dev/null; then
    cat >> "$BASH_PROFILE" << 'PROFILE'

# Auto-start Sway on tty1 (Monet OS)
if [ "$(tty)" = "/dev/tty1" ]; then
    export XDG_SESSION_TYPE=wayland
    export XDG_CURRENT_DESKTOP=sway
    export MOZ_ENABLE_WAYLAND=1
    exec sway
fi
PROFILE
    chown "$MONET_USER:$MONET_USER" "$BASH_PROFILE"
fi

systemctl daemon-reload

echo ""
echo "=== Installation complete ==="
echo ""
echo "Boot flow: power on -> Debian -> auto-login ($MONET_USER) -> Sway -> Monet shell"
echo ""
echo "Remaining steps:"
echo "  1. Set the monet user password: passwd $MONET_USER"
echo "  2. Configure API keys in /opt/monet/agent/.env:"
echo "     ANTHROPIC_API_KEY=..."
echo "     NANGO_SECRET_KEY=..."
echo "  3. Reboot to test: sudo reboot"
