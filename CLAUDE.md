# CLAUDE.md — Hynous Project Guide

> Essential conventions for AI agents working on this codebase.
> For detailed knowledge, see `~/.claude/projects/.../memory/MEMORY.md`.

---

## Project Overview

Hynous is a personal crypto intelligence system with an autonomous LLM trading agent. Python 3.11+.

**5 runtime components:**

| Component | Port | Language | Purpose |
|-----------|------|----------|---------|
| Reflex Dashboard | `:3000` | Python → React | UI (10 pages) |
| FastAPI Gateway | `:8000` | Python | Agent brain, daemon, tools |
| Nous API | `:3100` | TypeScript/Hono | Memory system (SSA, FSRS, embeddings) |
| Data Layer | `:8100` | Python/FastAPI | Market data collection + analytics |
| Satellite | (in-process) | Python | ML feature engine + XGBoost inference |

---

## Directory Structure

```
hynous/
├── src/hynous/          # Main Python application
│   ├── intelligence/    # Agent brain (agent, daemon, scanner, tools, prompts)
│   ├── data/            # Market data providers (6 providers + WS feed manager)
│   ├── nous/            # Python HTTP client for Nous API
│   ├── discord/         # Discord bot (chat relay, notifications, stats)
│   └── core/            # Shared utilities (config, types, tracing)
├── dashboard/           # Reflex UI (10 pages, 4 standalone HTML visualizations)
├── satellite/           # ML feature engine (28 features, 14 condition models, XGBoost, walk-forward)
├── data-layer/          # Standalone data collection service
├── nous-server/         # TypeScript memory system monorepo
├── config/              # YAML configuration (default.yaml, theme.yaml)
├── deploy/              # VPS deployment (3 systemd services, setup.sh)
├── scripts/             # Entry points (run_dashboard.py, shell scripts)
├── tests/               # Test suites (unit, integration, e2e)
├── docs/                # Documentation hub + archived revisions
└── storage/             # Runtime data (gitignored)
```

---

## Key Extension Patterns

### Adding a New Tool

Three steps — all three are required:

1. **Create handler** in `src/hynous/intelligence/tools/my_tool.py`
2. **Register** in `src/hynous/intelligence/tools/registry.py`:
   ```python
   from . import my_tool
   my_tool.register(registry)
   ```
3. **Add to system prompt** in `src/hynous/intelligence/prompts/builder.py` TOOL_STRATEGY section — registering alone is NOT enough; the agent won't know to use a tool without system prompt guidance.

### Adding a New Dashboard Page

1. Create page in `dashboard/dashboard/pages/my_page.py`
2. Add route in `dashboard/dashboard/dashboard.py`
3. Add nav item in `dashboard/dashboard/components/nav.py`
4. Add state vars in `dashboard/dashboard/state.py` if needed

### Adding a New Data Provider

1. Create provider in `src/hynous/data/providers/my_provider.py`
2. Export in `src/hynous/data/__init__.py`
3. Create corresponding tool in `src/hynous/intelligence/tools/`

---

## Configuration

All config in `config/default.yaml`. Loaded by `src/hynous/core/config.py` → `load_config()`.

**13 config dataclasses:** AgentConfig, NousConfig, ExecutionConfig, HyperliquidConfig, MemoryConfig, OrchestratorConfig, SectionsConfig, DaemonConfig, ScannerConfig, DataLayerConfig, DiscordConfig, SatelliteConfig, Config (root).

**Environment variables** (in `.env`, never committed):
```
OPENROUTER_API_KEY=sk-or-...        # LLM providers via OpenRouter
HYPERLIQUID_PRIVATE_KEY=...          # Exchange wallet
OPENAI_API_KEY=...                   # Nous vector embeddings
DISCORD_BOT_TOKEN=...               # Discord bot (optional)
COINGLASS_API_KEY=...               # Derivatives data (optional)
CRYPTOCOMPARE_API_KEY=...           # News feed (optional)
```

---

## Branches & Deployment

**CRITICAL: Check which branch you're on before pushing.**

| Branch | Purpose | VPS Path | Deploys to |
|--------|---------|----------|------------|
| `main` | **Production** — live trading agent | `/opt/hynous` | Ports 3000/8000/3100 |
| `test-env` | **Testing** — experimental changes | `/opt/hynous-test` | Ports 3001/8001/3101 |

**Rules:**
- **NEVER push experimental/untested code to `main`.** Production runs on `main`.
- Develop on `test` branch, verify on test instance, then merge to `main`.
- Always confirm the current branch before `git push`: `git branch --show-current`
- The test instance shares the data-layer (`:8100`) but has isolated Nous memory and storage.

**Deploy workflow:**
```bash
# Deploy to TEST
git checkout test-env
# ... make changes ...
git push origin test-env
ssh vps "cd /opt/hynous-test && sudo -u hynous git pull && sudo systemctl restart hynous-test"

# Promote to PRODUCTION (after verifying on test)
git checkout main && git merge test && git push origin main
ssh vps "cd /opt/hynous && sudo -u hynous git pull && sudo systemctl restart hynous"
```

**VPS services:**
```bash
# Production (auto-starts on boot)
sudo systemctl restart hynous        # Dashboard + daemon
sudo systemctl restart nous          # Memory server

# Test (manual start/stop — doesn't auto-start)
sudo systemctl start hynous-test     # Test dashboard + daemon
sudo systemctl start nous-test       # Test memory server
sudo systemctl stop hynous-test nous-test  # Free RAM when not testing
```

---

## Running

```bash
# Dashboard (development)
cd dashboard && reflex run

# Daemon (background agent)
python -m scripts.run_daemon

# Nous server
cd nous-server && pnpm --filter server start

# Data layer
cd data-layer && make run
```

---

## Testing

```bash
# Python tests (requires PYTHONPATH=src)
PYTHONPATH=src pytest tests/

# Satellite tests
PYTHONPATH=. pytest satellite/tests/

# Data layer tests
cd data-layer && pytest tests/

# TypeScript tests (Nous)
cd nous-server && pnpm test
```

---

## Code Conventions

- **One feature = one module.** Don't mix concerns.
- **No over-engineering.** Only make changes that are directly requested.
- **Tools need system prompt mention.** Registry alone doesn't make the agent use a tool.
- **Config dataclass defaults must match YAML.** If you change one, change the other.
- **Nous dist must be rebuilt** when `core/src/` exports change: `cd nous-server/core && pnpm build`
- **Atomic file writes** for persistence: write to temp file, then rename.
- **Thread safety** for shared state: use locks (see `trading_settings.py` pattern).

---

## Documentation

- `ARCHITECTURE.md` — System overview, component responsibilities, data flows
- `docs/README.md` — Central documentation hub
- `docs/integration.md` — Cross-system data flows (satellite ↔ data-layer ↔ daemon)
- `docs/revisions/trade-mechanism-debug/` — 5 fix guides for mechanical exit bugs (implemented)
- `docs/revisions/breakeven-fix/` — Two-layer breakeven system + Round 3 (stale flag fix, background wakes) + ML-adaptive trailing stop v2 (regime-based activation, tiered retracement, agent exit lockout) + Dynamic Protective SL (2026-03-17, replaces capital-BE: vol-regime distances Low=2.5%/Normal=7.0%/High=8.0%/Extreme=3.0% ROE, placed at entry detection). Capital-BE **DEPRECATED** (`capital_breakeven_enabled: false`). Fee-BE layer remains active.
- `docs/revisions/ws-migration/` — WebSocket migration: Phase 1 (market data) implemented & verified. `allMids`, `l2Book`, `activeAssetCtx`, `candle` (1m/5m) via `ws_feeds.py`. All 4 channels have staleness gating. Live soak test passed. Phase 2 (account data) planned for live trading.
- `docs/archive/` — Completed revision guides (all resolved, kept for reference)
- Each major directory has its own `README.md`

---

Last updated: 2026-03-17
