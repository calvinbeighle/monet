#!/usr/bin/env bash
# build-image.sh - Build a bootable Monet OS .qcow2 image from a stock Debian 12 cloud image.
#
# Downloads a Debian 12 (Bookworm) generic cloud image, resizes it, then injects
# the Monet agent backend, Flutter shell, and OS configuration using virt-customize.
# The output is a self-contained .qcow2 ready for UTM, QEMU, or any KVM hypervisor.
#
# Requirements (install on the Linux build host):
#   apt-get install -y libguestfs-tools qemu-utils curl
#
# Usage:
#   sudo bash os/build-image.sh [options]
#
# Options:
#   --arch ARCH       Target architecture: arm64 (default) or amd64
#   --output PATH     Output image path (default: build/monet-os.qcow2)
#   --size SIZE       Disk size (default: 8G)
#   --source IMAGE    Use a local Debian cloud image instead of downloading
#   --skip-download   Reuse previously downloaded base image in build/
#   --api-key KEY     Bake in an Anthropic API key (written to /opt/monet/agent/.env)
#   --nango-key KEY   Bake in a Nango secret key
#   --password PASS   Set the monet user password (default: prompt on first boot)
#   --help            Show this help message
#
# The build process:
#   1. Download Debian 12 generic cloud image (qcow2)
#   2. Resize the image to --size
#   3. Inject Monet source tree into /opt/monet
#   4. Run strip.sh inside the image (remove GNOME, X11, desktop bloat)
#   5. Run install.sh inside the image (install Sway, deploy backend + shell, configure boot)
#   6. Optionally bake in API keys and user password
#   7. Output the final .qcow2

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

ARCH="arm64"
OUTPUT=""
DISK_SIZE="8G"
SOURCE_IMAGE=""
SKIP_DOWNLOAD=false
API_KEY=""
NANGO_KEY=""
USER_PASSWORD=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$REPO_DIR/build"

# Debian 12 cloud image URLs (official mirrors)
DEBIAN_BASE_URL="https://cloud.debian.org/images/cloud/bookworm/latest"
DEBIAN_IMAGE_ARM64="debian-12-generic-arm64.qcow2"
DEBIAN_IMAGE_AMD64="debian-12-generic-amd64.qcow2"

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------

usage() {
    head -n 30 "$0" | grep "^#" | sed 's/^# \?//'
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --arch)     ARCH="$2"; shift 2 ;;
        --output)   OUTPUT="$2"; shift 2 ;;
        --size)     DISK_SIZE="$2"; shift 2 ;;
        --source)   SOURCE_IMAGE="$2"; shift 2 ;;
        --skip-download) SKIP_DOWNLOAD=true; shift ;;
        --api-key)  API_KEY="$2"; shift 2 ;;
        --nango-key) NANGO_KEY="$2"; shift 2 ;;
        --password) USER_PASSWORD="$2"; shift 2 ;;
        --help|-h)  usage ;;
        *)          echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# Resolve architecture-specific values
case "$ARCH" in
    arm64|aarch64)
        ARCH="arm64"
        DEBIAN_IMAGE="$DEBIAN_IMAGE_ARM64"
        ;;
    amd64|x86_64|x64)
        ARCH="amd64"
        DEBIAN_IMAGE="$DEBIAN_IMAGE_AMD64"
        ;;
    *)
        echo "Error: unsupported architecture '$ARCH' (use arm64 or amd64)"
        exit 1
        ;;
esac

if [[ -z "$OUTPUT" ]]; then
    OUTPUT="$BUILD_DIR/monet-os-${ARCH}.qcow2"
fi

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------

echo "=== Monet OS Image Builder ==="
echo ""
echo "  Architecture: $ARCH"
echo "  Disk size:    $DISK_SIZE"
echo "  Output:       $OUTPUT"
echo ""

if [[ $EUID -ne 0 ]]; then
    echo "Error: must run as root (sudo bash os/build-image.sh)"
    exit 1
fi

# Check required tools
MISSING_TOOLS=()
for tool in virt-customize qemu-img curl; do
    if ! command -v "$tool" &>/dev/null; then
        MISSING_TOOLS+=("$tool")
    fi
done

if [[ ${#MISSING_TOOLS[@]} -gt 0 ]]; then
    echo "Error: missing required tools: ${MISSING_TOOLS[*]}"
    echo ""
    echo "Install them with:"
    echo "  apt-get install -y libguestfs-tools qemu-utils curl"
    exit 1
fi

# Verify repo structure
for required in agent/main.py agent/requirements.txt os/strip.sh os/install.sh os/sway.config os/monet-agent.service; do
    if [[ ! -f "$REPO_DIR/$required" ]]; then
        echo "Error: required file not found: $REPO_DIR/$required"
        echo "Run this script from the Monet repo root."
        exit 1
    fi
done

mkdir -p "$BUILD_DIR"

# ---------------------------------------------------------------------------
# Step 1: Obtain the base Debian cloud image
# ---------------------------------------------------------------------------

BASE_IMAGE="$BUILD_DIR/$DEBIAN_IMAGE"

if [[ -n "$SOURCE_IMAGE" ]]; then
    echo "[1/6] Using provided source image: $SOURCE_IMAGE"
    if [[ ! -f "$SOURCE_IMAGE" ]]; then
        echo "Error: source image not found: $SOURCE_IMAGE"
        exit 1
    fi
    BASE_IMAGE="$SOURCE_IMAGE"
elif [[ "$SKIP_DOWNLOAD" == true && -f "$BASE_IMAGE" ]]; then
    echo "[1/6] Reusing cached base image: $BASE_IMAGE"
else
    echo "[1/6] Downloading Debian 12 cloud image ($ARCH)..."
    DOWNLOAD_URL="$DEBIAN_BASE_URL/$DEBIAN_IMAGE"
    echo "  URL: $DOWNLOAD_URL"
    curl -L --progress-bar -o "$BASE_IMAGE" "$DOWNLOAD_URL"
    echo "  Downloaded: $BASE_IMAGE ($(du -h "$BASE_IMAGE" | cut -f1))"
fi

# ---------------------------------------------------------------------------
# Step 2: Create working copy and resize
# ---------------------------------------------------------------------------

echo "[2/6] Creating working copy and resizing to $DISK_SIZE..."

WORK_IMAGE="$BUILD_DIR/monet-work-${ARCH}.qcow2"
cp "$BASE_IMAGE" "$WORK_IMAGE"
qemu-img resize "$WORK_IMAGE" "$DISK_SIZE"
echo "  Image resized to $DISK_SIZE"

# ---------------------------------------------------------------------------
# Step 3: Inject Monet source tree
# ---------------------------------------------------------------------------

echo "[3/6] Injecting Monet source tree into image..."

# Create a temporary staging directory with only what we need
STAGING="$BUILD_DIR/staging"
rm -rf "$STAGING"
mkdir -p "$STAGING/monet"

# Copy agent backend
cp -r "$REPO_DIR/agent" "$STAGING/monet/agent"

# Copy OS configuration
cp -r "$REPO_DIR/os" "$STAGING/monet/os"

# Copy pre-built Flutter shell if available
FLUTTER_BUNDLE=""
for candidate in \
    "$REPO_DIR/shell/build/linux/arm64/release/bundle" \
    "$REPO_DIR/shell/build/linux/x64/release/bundle"; do
    if [[ -d "$candidate" ]]; then
        FLUTTER_BUNDLE="$candidate"
        break
    fi
done

if [[ -n "$FLUTTER_BUNDLE" ]]; then
    cp -r "$FLUTTER_BUNDLE" "$STAGING/monet/shell-bundle"
    echo "  Flutter shell bundle staged from: $FLUTTER_BUNDLE"
else
    echo "  WARNING: No pre-built Flutter shell found."
    echo "  Build it first: cd shell && flutter build linux --release"
    echo "  The image will be built without the shell binary."
fi

# Prepare the .env file if API keys were provided
if [[ -n "$API_KEY" || -n "$NANGO_KEY" ]]; then
    ENV_FILE="$STAGING/monet/agent/.env"
    [[ -n "$API_KEY" ]] && echo "ANTHROPIC_API_KEY=$API_KEY" >> "$ENV_FILE"
    [[ -n "$NANGO_KEY" ]] && echo "NANGO_SECRET_KEY=$NANGO_KEY" >> "$ENV_FILE"
    echo "  API keys baked into agent/.env"
fi

# Build virt-customize commands
VIRT_ARGS=(
    --add "$WORK_IMAGE"

    # Grow the root partition to fill the resized disk
    --run-command "growpart /dev/sda 1 || true"
    --run-command "resize2fs /dev/sda1 || true"

    # Inject the Monet source tree
    --mkdir /opt/monet
    --copy-in "$STAGING/monet/agent:/opt/monet"
    --copy-in "$STAGING/monet/os:/opt/monet"
)

# Copy Flutter shell bundle if available
if [[ -n "$FLUTTER_BUNDLE" ]]; then
    VIRT_ARGS+=(--copy-in "$STAGING/monet/shell-bundle:/opt/monet")
    # Rename to expected path after copy
    VIRT_ARGS+=(--run-command "mv /opt/monet/shell-bundle /opt/monet/shell-prebuilt")
fi

# Copy .env if it exists
if [[ -f "$STAGING/monet/agent/.env" ]]; then
    VIRT_ARGS+=(--copy-in "$STAGING/monet/agent/.env:/opt/monet/agent/")
fi

echo "  Source tree staged"

# ---------------------------------------------------------------------------
# Step 4: Run strip.sh inside the image
# ---------------------------------------------------------------------------

echo "[4/6] Running strip.sh inside image (removing desktop bloat)..."

VIRT_ARGS+=(
    --run "/opt/monet/os/strip.sh"
)

# ---------------------------------------------------------------------------
# Step 5: Run install.sh inside the image
# ---------------------------------------------------------------------------

echo "[5/6] Running install.sh inside image (installing Sway, deploying Monet)..."

# Create a wrapper script that sets up the environment for install.sh.
# install.sh expects the repo structure - we create symlinks so it finds
# the Flutter shell bundle in the expected location.
INSTALL_WRAPPER="$STAGING/install-wrapper.sh"
cat > "$INSTALL_WRAPPER" << 'WRAPPER'
#!/bin/bash
set -euo pipefail

# install.sh looks for shell/build/linux/arm64/release/bundle relative to the repo.
# We already staged the bundle at /opt/monet/shell-prebuilt - create the expected path.
if [ -d /opt/monet/shell-prebuilt ]; then
    mkdir -p /opt/monet/shell/build/linux/arm64/release
    ln -sf /opt/monet/shell-prebuilt /opt/monet/shell/build/linux/arm64/release/bundle
fi

# Run install.sh - it derives REPO_DIR from its own location
bash /opt/monet/os/install.sh

# Clean up the symlink scaffolding
rm -rf /opt/monet/shell/build
# The real shell binary is now at /opt/monet/shell/ (copied by install.sh)
rm -rf /opt/monet/shell-prebuilt
WRAPPER
chmod +x "$INSTALL_WRAPPER"

VIRT_ARGS+=(
    --copy-in "$INSTALL_WRAPPER:/tmp"
    --run "/tmp/install-wrapper.sh"
)

# Set monet user password if provided
if [[ -n "$USER_PASSWORD" ]]; then
    VIRT_ARGS+=(--password "monet:password:$USER_PASSWORD")
    echo "  monet user password set"
fi

# Create data directory
VIRT_ARGS+=(
    --mkdir /var/lib/monet
    --run-command "chown -R monet:monet /var/lib/monet 2>/dev/null || true"
)

# ---------------------------------------------------------------------------
# Execute virt-customize
# ---------------------------------------------------------------------------

echo ""
echo "Running virt-customize (this may take several minutes)..."
echo ""

virt-customize "${VIRT_ARGS[@]}"

# ---------------------------------------------------------------------------
# Step 6: Finalize the image
# ---------------------------------------------------------------------------

echo "[6/6] Finalizing image..."

# Compact the image (reclaim unused space)
echo "  Compacting image..."
qemu-img convert -O qcow2 -c "$WORK_IMAGE" "$OUTPUT"

# Clean up working files
rm -f "$WORK_IMAGE"
rm -rf "$STAGING"

# Output stats
IMAGE_SIZE=$(du -h "$OUTPUT" | cut -f1)
VIRTUAL_SIZE=$(qemu-img info "$OUTPUT" | grep "virtual size" | awk '{print $3, $4}')

echo ""
echo "=== Build complete ==="
echo ""
echo "  Image:        $OUTPUT"
echo "  File size:    $IMAGE_SIZE"
echo "  Virtual size: $VIRTUAL_SIZE"
echo ""
echo "To run with QEMU (arm64):"
echo "  qemu-system-aarch64 \\"
echo "    -machine virt -cpu cortex-a72 -m 2G \\"
echo "    -bios /usr/share/qemu-efi-aarch64/QEMU_EFI.fd \\"
echo "    -drive file=$OUTPUT,format=qcow2 \\"
echo "    -device virtio-net-pci,netdev=net0 \\"
echo "    -netdev user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::8000-:8000 \\"
echo "    -nographic"
echo ""
echo "To run with UTM (macOS):"
echo "  1. Create new VM -> Custom -> skip ISO"
echo "  2. Set architecture to ARM64 (aarch64)"
echo "  3. Import $OUTPUT as the disk image"
echo "  4. Set RAM to 2GB+, enable hardware acceleration"
echo "  5. Boot the VM"
echo ""
echo "SSH access (if port-forwarded): ssh monet@localhost -p 2222"
echo "Agent backend: http://localhost:8000/api/health"
echo ""
if [[ -z "$USER_PASSWORD" ]]; then
    echo "NOTE: No password set for monet user."
    echo "  Set one via: sudo virt-customize -a $OUTPUT --password monet:password:YOUR_PASSWORD"
    echo "  Or create an account through the Monet onboarding UI on first boot."
fi
