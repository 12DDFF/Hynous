# CLAUDE.md — Hynous Project Guide

> ⚠️ **v2 branch notice — this document describes v1 conventions**
>
> You are reading this on the `v2` branch. The "5 runtime components", "28
> agent tools", Nous memory system, and `python -m scripts.run_daemon`
> references below all describe the v1 system. v2 is a ground-up rebuild
> that deletes ~100K LOC of that infrastructure and replaces it with a
> mechanical trading loop + post-trade analysis agent.
>
> **For v2 conventions, read `v2-planning/00-master-plan.md` instead.**
> Specifically the "Cross-Cutting Conventions" and "Engineer Protocol"
> sections supersede the v1 content below. Phase 4 of the v2 plan rewrites
> this file to reflect v2 reality.
>
> **Phase 1 complete (2026-04-10):** `scripts/run_daemon.py` now exists.
> `src/hynous/journal/` has schema, staging_store, capture, counterfactuals.
> daemon.py emits lifecycle events. trading.py captures entry snapshots.
>
> **Phase 2 complete (2026-04-12):** Full `JournalStore` at
> `src/hynous/journal/store.py` replaces StagingStore. 9-table SQLite schema,
> CRUD, embeddings (OpenAI text-embedding-3-small, matryoshka 512-dim),
> semantic search, FastAPI routes at `/api/v2/journal/*` mounted in
> `dashboard/dashboard/dashboard.py`. Staging→journal migration
> (idempotent, flag-guarded) runs at daemon startup. Daemon now writes to
> `storage/v2/journal.db` directly. 881 tests passing / 1 pre-existing
> failure (baseline 824 + 57 new). Amendments 9 + 10 implemented.
>
> **Phase 3 next:** LLM post-trade analysis agent writing into the
> `trade_analyses` table. See `v2-planning/06-phase-3-analysis-agent.md`.
>
> Known-stale items in this file:
> - The 5-component architecture table (v2 removes Nous, reducing to 4)
> - Memory tool listings (phase 4 deletes 8 of them)
> - "Running" section (partial — dashboard command still works; daemon standalone: `python -m scripts.run_daemon`)

---

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

**Single branch: `main`.** All development and production on `main`.

| Branch | Purpose | VPS Path | Deploys to |
|--------|---------|----------|------------|
| `main` | **Production** — live trading agent | `/opt/hynous` | Ports 3000/8000/3100 |

**Deploy workflow:**
```bash
git push origin main
ssh vps "cd /opt/hynous && sudo -u hynous git pull && sudo systemctl restart hynous"
```

**VPS services:**
```bash
sudo systemctl restart hynous        # Dashboard + daemon
sudo systemctl restart nous          # Memory server
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
- `docs/revisions/breakeven-fix/` — Two-layer breakeven system + Round 3 (stale flag fix, background wakes) + ML-adaptive trailing stop v2 (regime-based activation, tiered retracement, agent exit lockout) + Dynamic Protective SL (2026-03-17, replaces capital-BE: vol-regime distances Low=2.5%/Normal=7.0%/High=8.0%/Extreme=3.0% ROE, placed at entry detection). Capital-BE **DEPRECATED** (`capital_breakeven_enabled: false`). Fee-BE layer remains active. Trailing stop v2 **SUPERSEDED** by v3 (see below).
- `docs/revisions/trailing-stop-fix/` — Adaptive Trailing Stop v3 (2026-03-18): continuous exponential retracement `r(p) = 0.20 + 0.30 × exp(-k × p)` replaces 3-tier discrete system. Vol regime absorbed into decay rate k (extreme=0.160, high=0.100, normal=0.080, low=0.040). Eliminates tier boundary discontinuities and floor violations. 6 new TradingSettings fields: `trail_ret_floor`, `trail_ret_amplitude`, `trail_ret_k_extreme/high/normal/low`. 800 unit tests passing.
- `docs/revisions/ws-migration/` — WebSocket migration: Phase 1 (market data) implemented & verified. `allMids`, `l2Book`, `activeAssetCtx`, `candle` (1m/5m) via `ws_feeds.py`. All 4 channels have staleness gating. Live soak test passed. Phase 2 (account data) planned for live trading.
- `docs/archive/` — Completed revision guides (all resolved, kept for reference)
- Each major directory has its own `README.md`

---

Last updated: 2026-04-12 (phase 2 complete)
