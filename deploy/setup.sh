#!/bin/bash
# ============================================================
# Hynous VPS Setup Script
# Run on a fresh Ubuntu 24.04 VPS (Hetzner/Hostinger, EU region)
#
# Usage:
#   ssh root@your-vps-ip
#   curl -sL <raw-github-url>/deploy/setup.sh | bash
#   OR
#   git clone git@github.com:12DDFF/Hynous.git && cd Hynous && bash deploy/setup.sh
# ============================================================

set -euo pipefail

APP_USER="hynous"
APP_DIR="/opt/hynous"
REPO="https://github.com/12DDFF/Hynous.git"

echo "=== Hynous VPS Setup ==="
echo ""

# ── 1. System packages ─────────────────────────────────────
echo "[1/5] Installing system packages..."
apt-get update -qq
apt-get install -y -qq \
    build-essential git curl wget \
    software-properties-common \
    python3 python3-pip python3-venv \
    ca-certificates gnupg

# ── 2. Create app user ─────────────────────────────────────
echo "[2/5] Creating app user..."
if ! id "$APP_USER" &>/dev/null; then
    useradd -r -m -s /bin/bash "$APP_USER"
fi

# ── 3. Clone repo ──────────────────────────────────────────
echo "[3/5] Cloning repository..."
if [ -d "$APP_DIR" ]; then
    echo "  $APP_DIR already exists, pulling latest..."
    cd "$APP_DIR" && git pull
else
    git clone "$REPO" "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ── 4. Python venv + dependencies ──────────────────────────
echo "[4/5] Setting up Python environment..."
cd "$APP_DIR"
sudo -u "$APP_USER" bash -c "
    cd $APP_DIR
    python3 -m venv .venv
    source .venv/bin/activate
    pip install --upgrade pip
    pip install -e .
    cd dashboard && pip install -r requirements.txt
"

# ── 5. Create .env (user fills in) ─────────────────────────
echo "[5/5] Setting up configuration..."
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    cp "$APP_DIR/.env.example" "$ENV_FILE"
    chown "$APP_USER:$APP_USER" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    echo ""
    echo "  !! IMPORTANT: Edit $ENV_FILE with your API keys !!"
    echo "  nano $ENV_FILE"
    echo ""
fi

# Storage directories
sudo -u "$APP_USER" mkdir -p "$APP_DIR/storage"

# Install systemd services — all three are required for a working v2 system.
echo "Installing systemd services..."
cp "$APP_DIR/deploy/hynous.service" /etc/systemd/system/
cp "$APP_DIR/deploy/hynous-data.service" /etc/systemd/system/
cp "$APP_DIR/deploy/hynous-daemon.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable hynous hynous-data hynous-daemon

echo ""
echo "============================================"
echo "  Setup complete!"
echo "============================================"
echo ""
echo "  Next steps:"
echo "  1. Edit your API keys:"
echo "     nano $ENV_FILE"
echo ""
echo "  2. Start the services (data-layer first, then daemon, then UI):"
echo "     systemctl start hynous-data hynous-daemon hynous"
echo ""
echo "  3. Check status:"
echo "     systemctl status hynous-data hynous-daemon hynous"
echo "     journalctl -u hynous -f"
echo ""
echo "  Dashboard: http://your-vps-ip:3000"
echo "============================================"
