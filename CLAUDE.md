# CLAUDE.md — Hynous Project Guide

> Essential conventions for AI agents working on the `v2` branch.
> Authoritative v2 plan lives in `v2-planning/00-master-plan.md`.

---

## Project Overview

Hynous (v2) is a personal crypto trading system with a mechanical entry/exit
loop and a post-trade LLM analysis pipeline. Python 3.11+.

The v1 LLM-in-the-loop trading agent, TypeScript Nous memory server, and most
memory tooling have been removed. The current system writes every trade
lifecycle event to a local SQLite journal at `storage/v2/journal.db` and
analyzes trades after they close.

**4 runtime components:**

| Component | Port | Language | Purpose |
|-----------|------|----------|---------|
| Reflex Dashboard | `:3000` | Python → React | UI |
| FastAPI Gateway | `:8000` | Python | Agent brain, daemon, journal (in-process), analysis agent |
| Data Layer | `:8100` | Python/FastAPI | Market data collection + analytics |
| Satellite | (in-process) | Python | ML feature engine + XGBoost inference |

---

## Directory Structure

```
hynous/
├── src/hynous/          # Main Python application
│   ├── intelligence/    # Agent brain (agent, daemon, scanner, tools, prompts)
│   ├── journal/         # v2 trade journal (schema, store, capture, counterfactuals, embeddings, migrate_staging)
│   ├── analysis/        # v2 post-trade analysis agent (rules engine + LLM synthesis + wake integration)
│   ├── data/            # Market data providers (Hyperliquid, Coinglass, etc. + WS feed manager)
│   ├── discord/         # Discord bot (chat relay, notifications, stats)
│   └── core/            # Shared utilities (config, types, tracing, trading_settings)
├── dashboard/           # Reflex UI + `/api/v2/journal/*` FastAPI router
├── satellite/           # ML feature engine (XGBoost condition models, walk-forward)
├── data-layer/          # Standalone data collection service
├── config/              # YAML configuration (default.yaml, theme.yaml)
├── deploy/              # VPS deployment (2 systemd services: hynous, hynous-data; setup.sh)
├── scripts/             # Entry points (run_dashboard.py, run_daemon.py)
├── tests/               # Test suites (unit, integration, e2e)
├── docs/                # Documentation hub + archived revisions
├── v2-planning/         # v2 rebuild plan (phase docs, master plan, testing standards)
└── storage/             # Runtime data (gitignored)
    └── v2/              # journal.db + staging.db (migrated then retired)
```

---

## Key Extension Patterns

### Adding a New Tool

1. **Create handler** in `src/hynous/intelligence/tools/my_tool.py`
2. **Register** in `src/hynous/intelligence/tools/registry.py`:
   ```python
   from . import my_tool
   my_tool.register(registry)
   ```
3. **Add to system prompt** in `src/hynous/intelligence/prompts/builder.py` TOOL_STRATEGY section — registering alone is NOT enough; the agent won't know to use a tool without system prompt guidance.

Tools registered in `registry.py` are the canonical surface; keep scope narrow.

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

Top-level dataclasses include AgentConfig, ExecutionConfig, HyperliquidConfig,
MemoryConfig, OrchestratorConfig, SectionsConfig, DaemonConfig, ScannerConfig,
DataLayerConfig, DiscordConfig, SatelliteConfig, V2Config (journal /
analysis_agent / mechanical_entry / consolidation / user_chat sub-configs),
and Config (root).

**Environment variables** (in `.env`, never committed):
```
OPENROUTER_API_KEY=sk-or-...        # LLM providers via OpenRouter
HYPERLIQUID_PRIVATE_KEY=...          # Exchange wallet
OPENAI_API_KEY=...                   # Journal + analysis-agent embeddings (text-embedding-3-small)
DISCORD_BOT_TOKEN=...               # Discord bot (optional)
COINGLASS_API_KEY=...               # Derivatives data (optional)
CRYPTOCOMPARE_API_KEY=...           # News feed (optional)
```

---

## Branches & Deployment

v2 lives on the `v2` branch. It will never merge back into `main` — main
tracks the v1 system and is being retired.

| Branch | Purpose | VPS Path | Deploys to |
|--------|---------|----------|------------|
| `v2` | v2 trading system (mechanical loop + analysis agent) | `/opt/hynous` | Ports 3000 / 8000 |

**Deploy workflow:**
```bash
git push origin v2
ssh vps "cd /opt/hynous && sudo -u hynous git pull && sudo systemctl restart hynous"
```

**VPS services:**
```bash
sudo systemctl restart hynous        # Dashboard + daemon + journal (in-process)
sudo systemctl restart hynous-data   # Data layer (:8100)
```

---

## Running

```bash
# Dashboard (development)
cd dashboard && reflex run

# Daemon (background mechanical loop)
python -m scripts.run_daemon

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
```

During phase 4 a canonical CE-ignore list is used to keep the baseline clean.
See the active phase-4 directive or `v2-planning/07-phase-4-tier1-deletions.md`
for the current list; it shrinks as orphan tests are deleted.

---

## Code Conventions

- **One feature = one module.** Don't mix concerns.
- **No over-engineering.** Only make changes that are directly requested.
- **Tools need system prompt mention.** Registry alone doesn't make the agent use a tool.
- **Config dataclass defaults must match YAML.** If you change one, change the other.
- **Atomic file writes** for persistence: write to temp file, then rename.
- **Thread safety** for shared state: use locks (see `trading_settings.py` pattern).

---

## Documentation

- `v2-planning/00-master-plan.md` — authoritative v2 plan (read first)
- `v2-planning/05-phase-2-journal-module.md` — journal schema, store, migration, embeddings
- `v2-planning/06-phase-3-analysis-agent.md` — post-trade analysis pipeline (rules + LLM + validation)
- `v2-planning/07-phase-4-tier1-deletions.md` — current phase (deletions of v1 infrastructure)
- `ARCHITECTURE.md` — system overview, component responsibilities, data flows
- `docs/README.md` — documentation hub (points at v2-planning for live design docs)
- `docs/integration.md` — cross-system data flows
- `docs/revisions/breakeven-fix/` — two-layer breakeven + dynamic protective SL (vol-regime distances Low 2.5% / Normal 7.0% / High 8.0% / Extreme 3.0% ROE). Capital-BE deprecated, fee-BE active.
- `docs/revisions/trailing-stop-fix/` — Adaptive Trailing Stop v3: continuous exponential retracement `r(p) = 0.20 + 0.30 × exp(-k × p)` with k by vol regime (extreme 0.160 / high 0.100 / normal 0.080 / low 0.040). Replaces v2 tiers.
- `docs/revisions/ws-migration/` — WS migration Phase 1 (market data via `ws_feeds.py`): `allMids`, `l2Book`, `activeAssetCtx`, `candle` (1m/5m), staleness-gated with REST fallback. Phase 2 (account data) deferred.
- `docs/archive/` — completed v1 revision guides, kept for historical reference only
- Each major directory has its own `README.md`

---

Last updated: 2026-04-12 (phase 4 M6a — Nous server + systemd unit deleted, 5→4 component architecture)
