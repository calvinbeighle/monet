#!/usr/bin/env bash
# strip.sh - Strip a stock Debian 12 install down to a minimal base for Monet OS.
#
# Removes GNOME, GDM, X11, desktop apps, and other unnecessary packages.
# Keeps: kernel, systemd, apt, NetworkManager, PipeWire, core utils.
#
# Run as root on a fresh Debian 12 aarch64 install.
# Usage: sudo bash os/strip.sh

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "Error: must run as root (sudo bash os/strip.sh)"
    exit 1
fi

echo "=== Monet OS: Stripping Debian 12 to minimal base ==="

# ---------------------------------------------------------------------------
# 1. Remove GNOME desktop environment and GDM display manager
# ---------------------------------------------------------------------------
echo "[1/6] Removing GNOME, GDM, and desktop environments..."

GNOME_PACKAGES=(
    gnome gnome-shell gnome-session gnome-control-center gnome-tweaks
    gnome-terminal gnome-text-editor gnome-calculator gnome-calendar
    gnome-characters gnome-clocks gnome-contacts gnome-disk-utility
    gnome-font-viewer gnome-logs gnome-maps gnome-music gnome-photos
    gnome-screenshot gnome-software gnome-system-monitor gnome-weather
    gdm3 gnome-shell-extensions gnome-remote-desktop gnome-user-docs
    gnome-initial-setup gnome-online-accounts gnome-keyring
    nautilus evince eog totem baobab cheese yelp
    mutter gjs
)

apt-get remove --purge -y "${GNOME_PACKAGES[@]}" 2>/dev/null || true

# Remove any other desktop environments that might be installed
apt-get remove --purge -y \
    kde-* plasma-* xfce4-* lxde-* lxqt-* cinnamon-* mate-* budgie-* \
    2>/dev/null || true

# ---------------------------------------------------------------------------
# 2. Remove X11/Xorg (Monet uses Wayland via Sway)
# ---------------------------------------------------------------------------
echo "[2/6] Removing X11/Xorg..."

apt-get remove --purge -y \
    xorg xserver-xorg xserver-xorg-core xserver-xorg-video-* \
    xserver-xorg-input-* x11-common x11-utils x11-xkb-utils \
    x11-xserver-utils xdg-desktop-portal-gnome \
    2>/dev/null || true

# ---------------------------------------------------------------------------
# 3. Remove desktop applications and unnecessary services
# ---------------------------------------------------------------------------
echo "[3/6] Removing desktop applications and unnecessary services..."

DESKTOP_APPS=(
    firefox-esr chromium libreoffice* thunderbird
    gimp inkscape vlc rhythmbox transmission-*
    cups cups-browsed cups-daemon avahi-daemon
    bluetooth bluez pulseaudio
    modemmanager
    game-* gnome-games
    ibus fcitx
    flatpak snapd
)

apt-get remove --purge -y "${DESKTOP_APPS[@]}" 2>/dev/null || true

# ---------------------------------------------------------------------------
# 4. Clean up orphaned packages and cached downloads
# ---------------------------------------------------------------------------
echo "[4/6] Cleaning up orphaned packages..."

apt-get autoremove --purge -y
apt-get autoclean -y
apt-get clean

# Remove cached package lists (will be rebuilt on next apt update)
rm -rf /var/cache/apt/archives/*.deb
rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# 5. Verify essential packages are still installed
# ---------------------------------------------------------------------------
echo "[5/6] Verifying essential packages remain..."

ESSENTIAL_PACKAGES=(
    systemd
    apt
    network-manager
    pipewire pipewire-pulse wireplumber
    linux-image-arm64
    sudo
    openssh-server
    curl wget
    python3 python3-pip python3-venv
    sqlite3
    ca-certificates
)

MISSING=()
for pkg in "${ESSENTIAL_PACKAGES[@]}"; do
    if ! dpkg -l "$pkg" 2>/dev/null | grep -q "^ii"; then
        MISSING+=("$pkg")
    fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
    echo "Installing missing essential packages: ${MISSING[*]}"
    apt-get update
    apt-get install -y "${MISSING[@]}"
fi

# ---------------------------------------------------------------------------
# 6. Disable unnecessary systemd services
# ---------------------------------------------------------------------------
echo "[6/6] Disabling unnecessary services..."

DISABLE_SERVICES=(
    gdm3
    ModemManager
    cups cups-browsed
    avahi-daemon
    bluetooth
    accounts-daemon
    power-profiles-daemon
    switcheroo-control
    udisks2
    colord
    packagekit
)

for svc in "${DISABLE_SERVICES[@]}"; do
    systemctl disable "$svc" 2>/dev/null || true
    systemctl stop "$svc" 2>/dev/null || true
    systemctl mask "$svc" 2>/dev/null || true
done

# Enable essential services
systemctl enable NetworkManager
systemctl enable systemd-resolved
systemctl enable pipewire wireplumber 2>/dev/null || true
systemctl enable ssh

echo ""
echo "=== Strip complete ==="
echo "Removed: GNOME, GDM, X11, desktop apps, print/bluetooth services"
echo "Kept: kernel, systemd, apt, NetworkManager, PipeWire, Python3, SSH"
echo ""
echo "Next step: run os/install.sh to install Sway and deploy Monet"
