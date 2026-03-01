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
│   ├── data/            # Market data providers (6 providers)
│   ├── nous/            # Python HTTP client for Nous API
│   ├── discord/         # Discord bot (chat relay, notifications, stats)
│   └── core/            # Shared utilities (config, types, tracing)
├── dashboard/           # Reflex UI (10 pages, 4 standalone HTML visualizations)
├── satellite/           # ML feature engine (12 features, XGBoost, walk-forward)
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
- `docs/archive/` — Completed revision guides (all resolved, kept for reference)
- Each major directory has its own `README.md`

---

Last updated: 2026-03-01
