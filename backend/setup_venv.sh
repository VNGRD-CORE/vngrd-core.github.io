#!/bin/bash
# VNGRD// Backend — one-time venv setup
# Run once: bash backend/setup_venv.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[VNGRD] Creating isolated Python venv..."
python3 -m venv venv

echo "[VNGRD] Activating venv and installing dependencies..."
source venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt

echo ""
echo "✅  VNGRD backend dependencies installed."
echo "    Run VANGUARD_START.command from your Desktop to launch."
