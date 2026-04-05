#!/usr/bin/env bash
# setup.sh
# Installs xcodegen via Homebrew (if not present) and generates the Xcode project
# from project.yml. Run this once before opening in Xcode.
#
# Usage:
#   ./setup.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Checking for xcodegen..."

if ! command -v xcodegen &> /dev/null; then
    echo "==> xcodegen not found. Installing via Homebrew..."
    if ! command -v brew &> /dev/null; then
        echo "ERROR: Homebrew is required to install xcodegen."
        echo "Install Homebrew first: https://brew.sh"
        exit 1
    fi
    brew install xcodegen
else
    echo "==> xcodegen found at $(which xcodegen)"
fi

echo "==> Generating Xcode project from project.yml..."
xcodegen generate --spec project.yml

echo ""
echo "==> Done! Open Unified.xcodeproj in Xcode to build and run."
echo "    Xcode -> Product -> Run  (or Cmd+R)"
