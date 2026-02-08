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
systemctl start hynous
```

## What Gets Started

| Service | What it runs | Port |
|---------|-------------|------|
| `nous` | Nous memory server (Node.js) | 3100 |
| `hynous` | Dashboard + Agent + Daemon + Discord bot (Reflex) | 3000 |

## Managing Services

```bash
# Status
systemctl status hynous
systemctl status nous

# Logs (live)
journalctl -u hynous -f
journalctl -u nous -f

# Restart
systemctl restart hynous

# Stop
systemctl stop hynous nous
```

## Updating

```bash
cd /opt/hynous
git pull
systemctl restart nous hynous
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
