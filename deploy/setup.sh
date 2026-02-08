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
echo "[1/7] Installing system packages..."
apt-get update -qq
apt-get install -y -qq \
    build-essential git curl wget \
    software-properties-common \
    python3 python3-pip python3-venv \
    ca-certificates gnupg

# ── 2. Node.js 22 LTS ──────────────────────────────────────
echo "[2/7] Installing Node.js 22..."
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs
fi
npm install -g pnpm
echo "  Node: $(node --version), pnpm: $(pnpm --version)"

# ── 3. Create app user ─────────────────────────────────────
echo "[3/7] Creating app user..."
if ! id "$APP_USER" &>/dev/null; then
    useradd -r -m -s /bin/bash "$APP_USER"
fi

# ── 4. Clone repo ──────────────────────────────────────────
echo "[4/7] Cloning repository..."
if [ -d "$APP_DIR" ]; then
    echo "  $APP_DIR already exists, pulling latest..."
    cd "$APP_DIR" && git pull
else
    git clone "$REPO" "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ── 5. Python venv + dependencies ──────────────────────────
echo "[5/7] Setting up Python environment..."
cd "$APP_DIR"
sudo -u "$APP_USER" bash -c "
    cd $APP_DIR
    python3 -m venv .venv
    source .venv/bin/activate
    pip install --upgrade pip
    pip install -e .
    pip install discord.py
    cd dashboard && pip install -r requirements.txt
"

# ── 6. Nous server dependencies ────────────────────────────
echo "[6/7] Installing Nous server dependencies..."
sudo -u "$APP_USER" bash -c "
    cd $APP_DIR/nous-server
    pnpm install
"

# ── 7. Create .env (user fills in) ─────────────────────────
echo "[7/7] Setting up configuration..."
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

# ── 8. Storage directories ─────────────────────────────────
sudo -u "$APP_USER" mkdir -p "$APP_DIR/storage"

# ── 9. Install systemd services ────────────────────────────
echo "Installing systemd services..."
cp "$APP_DIR/deploy/hynous.service" /etc/systemd/system/
cp "$APP_DIR/deploy/nous.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable nous hynous

echo ""
echo "============================================"
echo "  Setup complete!"
echo "============================================"
echo ""
echo "  Next steps:"
echo "  1. Edit your API keys:"
echo "     nano $ENV_FILE"
echo ""
echo "  2. Start the services:"
echo "     systemctl start nous"
echo "     systemctl start hynous"
echo ""
echo "  3. Check status:"
echo "     systemctl status hynous"
echo "     journalctl -u hynous -f"
echo ""
echo "  Dashboard: http://your-vps-ip:3000"
echo "  Discord bot starts automatically."
echo "============================================"
