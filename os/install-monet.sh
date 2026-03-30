#!/usr/bin/env bash
# install-monet.sh
#
# Deploys the Monet shell and agent backend inside the VM.
# This script:
#   - Installs Python agent backend dependencies
#   - Installs the Monet Flutter shell (builds from source or extracts bundle)
#   - Sets up environment variables from .env
#   - Registers monet-agent as a systemd user service
#   - Registers monet-shell as a Sway autostart app
#
# Run inside the VM as the monet user after setup.sh and reboot:
#   bash ~/install-monet.sh
#
# Requires ~/monet/ directory to be present (cloned or scp'd from host).

set -euo pipefail

MONET_USER="${SUDO_USER:-${USER:-monet}}"
MONET_HOME="/home/$MONET_USER"
MONET_DIR="$MONET_HOME/monet"
ENV_FILE="$MONET_DIR/.env"
VENV_DIR="$MONET_DIR/agent/.venv"

echo "[install-monet] Starting Monet installation for user: $MONET_USER"

# ---------------------------------------------------------------------------
# 1. Verify monet source directory exists
# ---------------------------------------------------------------------------
if [ ! -d "$MONET_DIR" ]; then
  echo "[install-monet] ERROR: $MONET_DIR not found."
  echo "[install-monet] Copy the monet project into the VM first:"
  echo "  scp -P 2222 -r /path/to/monet monet@localhost:~/"
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Load environment variables
# ---------------------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$MONET_DIR/.env.example" ]; then
    echo "[install-monet] .env not found - copying from .env.example"
    cp "$MONET_DIR/.env.example" "$ENV_FILE"
    echo "[install-monet] WARNING: Edit $ENV_FILE and fill in real API keys before starting the agent."
  else
    echo "[install-monet] ERROR: Neither .env nor .env.example found in $MONET_DIR"
    exit 1
  fi
fi

# Source the env file (strip comments and blank lines)
set -a
# shellcheck disable=SC1090
source <(grep -v '^\s*#' "$ENV_FILE" | grep -v '^\s*$') 2>/dev/null || true
set +a

# ---------------------------------------------------------------------------
# 3. Python agent backend - install dependencies
# ---------------------------------------------------------------------------
AGENT_DIR="$MONET_DIR/agent"
if [ -d "$AGENT_DIR" ]; then
  echo "[install-monet] Setting up Python virtual environment for agent..."
  python3 -m venv "$VENV_DIR"
  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"

  if [ -f "$AGENT_DIR/requirements.txt" ]; then
    pip install --upgrade pip
    pip install -r "$AGENT_DIR/requirements.txt"
  else
    echo "[install-monet] No requirements.txt found - installing base dependencies..."
    pip install --upgrade pip
    pip install \
      openai \
      httpx \
      websockets \
      fastapi \
      uvicorn[standard] \
      python-dotenv \
      pydantic \
      rich
  fi
  deactivate
else
  echo "[install-monet] WARNING: agent/ directory not found in $MONET_DIR - skipping Python setup"
fi

# ---------------------------------------------------------------------------
# 4. Flutter shell - build or use prebuilt bundle
# ---------------------------------------------------------------------------
SHELL_DIR="$MONET_DIR/shell"
if [ -d "$SHELL_DIR" ]; then
  echo "[install-monet] Building Flutter shell..."
  export PATH="$PATH:/opt/flutter/bin"

  # Run flutter pub get and build for Linux (Wayland via GTK)
  cd "$SHELL_DIR"
  flutter pub get
  flutter build linux --release
  echo "[install-monet] Flutter shell built at $SHELL_DIR/build/linux/arm64/release/bundle/"
else
  echo "[install-monet] WARNING: shell/ directory not found in $MONET_DIR - skipping Flutter build"
fi

# ---------------------------------------------------------------------------
# 5. Systemd user service for monet-agent
# ---------------------------------------------------------------------------
echo "[install-monet] Registering monet-agent systemd user service..."
USER_SERVICE_DIR="$MONET_HOME/.config/systemd/user"
mkdir -p "$USER_SERVICE_DIR"

cat > "$USER_SERVICE_DIR/monet-agent.service" <<AGENT_SERVICE
[Unit]
Description=Monet Agent Backend
After=network.target

[Service]
Type=simple
WorkingDirectory=${AGENT_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${VENV_DIR}/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8765 --reload
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
AGENT_SERVICE

# Enable the user service (requires linger to be enabled - done in setup.sh)
systemctl --user daemon-reload
systemctl --user enable monet-agent.service
echo "[install-monet] monet-agent service enabled (start with: systemctl --user start monet-agent)"

# ---------------------------------------------------------------------------
# 6. Sway autostart for monet shell
# ---------------------------------------------------------------------------
SWAY_CONFIG="$MONET_HOME/.config/sway/config"
SHELL_BUNDLE="$SHELL_DIR/build/linux/arm64/release/bundle/monet_shell"

if [ -f "$SWAY_CONFIG" ] && [ -f "$SHELL_BUNDLE" ]; then
  if ! grep -q "monet_shell" "$SWAY_CONFIG"; then
    echo "[install-monet] Adding monet shell to Sway autostart..."
    cat >> "$SWAY_CONFIG" <<SWAY_EXEC

# Monet Shell - launch on Sway start
exec ${SHELL_BUNDLE}
SWAY_EXEC
  fi
else
  echo "[install-monet] NOTE: Sway config or shell bundle not found - skipping Sway autostart."
  echo "[install-monet] Add 'exec $SHELL_BUNDLE' to $SWAY_CONFIG manually once built."
fi

# ---------------------------------------------------------------------------
# 7. Verify installation
# ---------------------------------------------------------------------------
echo ""
echo "[install-monet] Installation summary:"
echo "  Agent dir:     $AGENT_DIR"
echo "  Venv:          $VENV_DIR"
echo "  Shell dir:     $SHELL_DIR"
echo "  Env file:      $ENV_FILE"
echo ""
echo "[install-monet] Next steps:"
echo "  1. Edit $ENV_FILE with your real API keys"
echo "  2. systemctl --user start monet-agent"
echo "  3. Reboot (or sway msg exec $SHELL_BUNDLE) to launch the shell"
echo ""
echo "[install-monet] Done."
