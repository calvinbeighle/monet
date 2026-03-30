#!/usr/bin/env bash
# strip.sh
#
# Removes desktop/GUI packages and unnecessary services from a fresh Debian 12
# (Bookworm) ARM64 installation, leaving a minimal headless base.
#
# Run this FIRST inside the VM as root (or via sudo) before any other setup:
#   sudo bash strip.sh
#
# The script is idempotent - safe to re-run.

set -euo pipefail

echo "[strip] Starting desktop/bloat removal on Debian 12 ARM64..."

# ---------------------------------------------------------------------------
# Remove desktop environments and display managers if somehow present
# (Debian netinst with no desktop selection should be clean, but be safe)
# ---------------------------------------------------------------------------
DESKTOP_PKGS=(
  task-gnome-desktop
  task-kde-desktop
  task-lxde-desktop
  task-lxqt-desktop
  task-xfce-desktop
  task-mate-desktop
  task-cinnamon-desktop
  gnome-shell
  gnome-session
  gdm3
  lightdm
  sddm
  xdm
  xorg
  xserver-xorg
  xserver-xorg-core
  x11-common
  pulseaudio
  avahi-daemon
  cups
  cups-daemon
  bluetooth
  bluez
  modemmanager
  wpa-supplicant
  wpasupplicant
)

echo "[strip] Removing desktop/GUI packages (ignore 'not installed' warnings)..."
apt-get remove --purge -y "${DESKTOP_PKGS[@]}" 2>/dev/null || true
apt-get autoremove --purge -y
apt-get autoclean -y

# ---------------------------------------------------------------------------
# Disable and mask services that are not needed on a headless dev VM
# ---------------------------------------------------------------------------
DISABLE_SERVICES=(
  bluetooth
  cups
  cups-browsed
  avahi-daemon
  ModemManager
)

for svc in "${DISABLE_SERVICES[@]}"; do
  if systemctl list-unit-files "${svc}.service" &>/dev/null; then
    echo "[strip] Masking service: $svc"
    systemctl disable --now "$svc" 2>/dev/null || true
    systemctl mask "$svc" 2>/dev/null || true
  fi
done

# ---------------------------------------------------------------------------
# Keep SSH enabled and running
# ---------------------------------------------------------------------------
systemctl enable ssh
systemctl start ssh

echo "[strip] Done. Debian is now a minimal headless base."
echo "[strip] Run setup.sh next."
