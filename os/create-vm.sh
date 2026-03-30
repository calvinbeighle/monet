#!/usr/bin/env bash
# create-vm.sh
#
# Documents the manual steps to create the monet-dev UTM VM on macOS (Apple Silicon).
# utmctl (bundled inside UTM.app) can manage existing VMs but cannot create new ones,
# so initial VM creation must be done through the UTM GUI.
#
# After creating the VM manually, use this script to verify it is registered and
# optionally start it headlessly via utmctl.
#
# REQUIREMENTS
#   - UTM 4.x installed at /Applications/UTM.app
#   - Debian 12 ARM64 netinst ISO at ~/Downloads/debian-12.9.0-arm64-netinst.iso
#     (download with: curl -L https://cdimage.debian.org/cdimage/archive/12.9.0/arm64/iso-cd/debian-12.9.0-arm64-netinst.iso -o ~/Downloads/debian-12.9.0-arm64-netinst.iso)

UTMCTL="/Applications/UTM.app/Contents/MacOS/utmctl"
VM_NAME="monet-dev"

# ---------------------------------------------------------------------------
# SECTION 1 - MANUAL GUI STEPS (do these once in UTM before running section 2)
# ---------------------------------------------------------------------------
#
# 1. Open UTM (/Applications/UTM.app).
#
# 2. Click the "+" button (Create a New Virtual Machine).
#
# 3. Choose "Virtualize" (NOT Emulate) - this uses Apple Hypervisor for ARM64.
#
# 4. Select "Linux" as the operating system.
#
# 5. On the "Linux" screen:
#    - Enable "Use Apple Virtualization" (checked)
#    - Boot ISO Image: Browse to ~/Downloads/debian-12.9.0-arm64-netinst.iso
#
# 6. Hardware settings:
#    - Memory:  4096 MB
#    - CPU Cores: 4
#    - Leave "Enable hardware OpenGL acceleration" unchecked (headless server)
#
# 7. Storage:
#    - Size: 20 GB
#    - Leave default VirtIO storage interface
#
# 8. Shared Directory: skip (optional, can add later)
#
# 9. Summary:
#    - Name: monet-dev
#    - Click "Save"
#
# 10. Before first boot, open VM settings -> Network:
#    - Network Mode: Emulated VLAN (or Shared Network)
#    - Click "New" under Port Forwarding and add:
#        Protocol: TCP
#        Guest Address: (leave blank)
#        Guest Port: 22
#        Host Address: 127.0.0.1
#        Host Port: 2222
#    This maps host localhost:2222 -> guest port 22 (SSH).
#
# 11. Install Debian inside the VM:
#    - Boot the ISO, choose "Install" (text) or "Graphical Install"
#    - Hostname: monet-dev
#    - Create user: monet / choose a password
#    - Partition: use entire disk, single partition (no LVM needed)
#    - Software selection: UNCHECK everything EXCEPT "SSH server" and
#      "standard system utilities"
#    - Install GRUB to /dev/vda when prompted
#    - Reboot; the ISO will be auto-ejected by UTM on next boot
#
# 12. Once Debian boots to login prompt, SSH in:
#    ssh -p 2222 monet@localhost
#    (accept host key, enter password set during install)
#
# 13. Copy setup scripts into the VM and run them in order:
#    scp -P 2222 strip.sh setup.sh install-monet.sh monet@localhost:~
#    ssh -p 2222 monet@localhost "sudo bash ~/strip.sh && sudo bash ~/setup.sh && sudo bash ~/install-monet.sh"

# ---------------------------------------------------------------------------
# SECTION 2 - OPTIONAL CLI HELPERS (run after GUI setup is complete)
# ---------------------------------------------------------------------------

list_vms() {
  echo "Registered UTM VMs:"
  "$UTMCTL" list
}

start_vm() {
  echo "Starting VM: $VM_NAME"
  "$UTMCTL" start "$VM_NAME"
}

stop_vm() {
  echo "Stopping VM: $VM_NAME (graceful)"
  "$UTMCTL" stop "$VM_NAME"
}

status_vm() {
  "$UTMCTL" status "$VM_NAME"
}

case "${1:-help}" in
  list)   list_vms ;;
  start)  start_vm ;;
  stop)   stop_vm ;;
  status) status_vm ;;
  *)
    echo "Usage: $0 {list|start|stop|status}"
    echo ""
    echo "Read the comments inside this script for manual VM creation steps."
    ;;
esac
