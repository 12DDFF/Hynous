# Deploying Hynous to a VPS

## Requirements
- Ubuntu 24.04 VPS (EU region for Hyperliquid access)
- 1 vCPU, 2-4GB RAM, 20GB+ SSD
- Recommended: Hetzner CX22 (~$4.50/mo) or Hostinger KVM 1 (~$5/mo)

## Quick Start

```bash
# 1. SSH into your VPS
ssh root@your-vps-ip

# 2. Clone and run setup
git clone https://github.com/12DDFF/Hynous.git /opt/hynous
cd /opt/hynous
bash deploy/setup.sh

# 3. Add your API keys
nano /opt/hynous/.env

# 4. Start everything
systemctl start nous
systemctl start hynous-data
systemctl start hynous
```

## What Gets Started

| Service | What it runs | Port | Unit file |
|---------|-------------|------|-----------|
| `nous` | Nous memory server (Node.js/tsx) | 3100 | `nous.service` |
| `hynous-data` | Data layer — Hyperliquid market intelligence (Python) | 8100 | `hynous-data.service` |
| `hynous` | Dashboard + Agent + Daemon + Discord bot (Reflex) | 3000 | `hynous.service` |

Service dependencies: `hynous` requires `nous` and wants `hynous-data` (see `After=` / `Requires=` / `Wants=` in the unit files).

## Environment Variables

Sensitive values go in `/opt/hynous/.env` (never committed):

```bash
OPENROUTER_API_KEY=sk-or-...        # Single key for all LLM providers via OpenRouter
HYPERLIQUID_PRIVATE_KEY=...          # Hyperliquid wallet private key
OPENAI_API_KEY=sk-...                # OpenAI — required for Nous vector embeddings
DISCORD_BOT_TOKEN=...               # Discord bot token (optional)
COINGLASS_API_KEY=...               # Coinglass derivatives data (optional)
CRYPTOCOMPARE_API_KEY=...           # CryptoCompare news API (optional — works without one at lower rate limits)
```

## What `setup.sh` Installs

The setup script (`deploy/setup.sh`) runs 7 steps:

1. **System packages** — `build-essential`, `git`, `curl`, `python3`, `python3-pip`, `python3-venv`
2. **Node.js 22 LTS** + `pnpm` (via nodesource)
3. **App user** — creates a `hynous` system user
4. **Clone repo** to `/opt/hynous`
5. **Python venv** — creates `.venv`, installs the project (`pip install -e .`) + `discord.py` + dashboard requirements. This includes satellite dependencies: `xgboost>=2.0.0`, `shap>=0.50.0` (required for XGBoost 3.x compatibility), `numpy>=1.24.0` (declared in `pyproject.toml`).
6. **Nous server** — runs `pnpm install` in `nous-server/`
7. **Config** — copies `.env.example` to `.env`, creates `storage/` directory

The `hynous-data.service` unit file is included in `deploy/` but not yet auto-installed by `setup.sh` — copy it manually:

```bash
cp /opt/hynous/deploy/hynous-data.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable hynous-data
```

## Managing Services

```bash
# Status
systemctl status hynous
systemctl status nous
systemctl status hynous-data

# Logs (live)
journalctl -u hynous -f
journalctl -u nous -f
journalctl -u hynous-data -f

# Restart
systemctl restart hynous

# Stop
systemctl stop hynous nous hynous-data
```

## Updating

```bash
cd /opt/hynous
git pull
systemctl restart nous hynous-data hynous
```

## Remote Dashboard Access (Optional)

To access the dashboard from your browser, install Caddy:

```bash
apt install caddy
```

Edit `/etc/caddy/Caddyfile`:
```
your-domain.com {
    reverse_proxy localhost:3000
}
```

Then `systemctl restart caddy`. Caddy auto-provisions HTTPS.

Or just use the Discord bot — it's your main mobile interface anyway.

## Test Instance

A second Hynous instance for A/B testing (e.g., breakeven disabled vs enabled for ML metrics). Shares the data layer with production. All 4 services fit with ~860MB free RAM.

```
┌─────────────┬──────────────────────┬───────────────────────────┐
│             │      Production      │           Test            │
├─────────────┼──────────────────────┼───────────────────────────┤
│ Dashboard   │ :3000                │ :3001                     │
├─────────────┼──────────────────────┼───────────────────────────┤
│ Backend API │ :8000                │ :8001                     │
├─────────────┼──────────────────────┼───────────────────────────┤
│ Nous        │ :3100                │ :3101 (fresh empty DB)    │
├─────────────┼──────────────────────┼───────────────────────────┤
│ Data Layer  │ :8100                │ shared                    │
├─────────────┼──────────────────────┼───────────────────────────┤
│ Path        │ /opt/hynous          │ /opt/hynous-test          │
├─────────────┼──────────────────────┼───────────────────────────┤
│ Storage     │ /opt/hynous/storage/ │ /opt/hynous-test/storage/ │
├─────────────┼──────────────────────┼───────────────────────────┤
│ Services    │ hynous + nous        │ hynous-test + nous-test   │
├─────────────┼──────────────────────┼───────────────────────────┤
│ Discord     │ enabled              │ disabled                  │
└─────────────┴──────────────────────┴───────────────────────────┘
```

### Managing the Test Instance

```bash
# Start
ssh vps "sudo systemctl start hynous-test nous-test"

# Restart
ssh vps "sudo systemctl restart hynous-test"

# Stop (free RAM when not testing)
ssh vps "sudo systemctl stop hynous-test nous-test"
```

### Deploying Changes

```bash
# Deploy to test instance
ssh vps "cd /opt/hynous-test && sudo -u hynous git pull && sudo systemctl restart hynous-test"

# Promote test to production (after validating)
git checkout main && git merge test-env && git push origin main
ssh vps "cd /opt/hynous && sudo -u hynous git pull && sudo systemctl restart hynous"
```

### Branch Mapping

- `main` branch → `/opt/hynous` (production, ports 3000/8000/3100)
- `test-env` branch → `/opt/hynous-test` (testing, ports 3001/8001/3101)

Test services are **disabled** (won't auto-start on reboot) so they don't eat RAM when not in use. Start manually when needed.

---

Last updated: 2026-03-10
