# Hynous Documentation

> Central navigation hub for all Hynous project documentation.

Hynous is a personal crypto intelligence system with an autonomous LLM trading agent. It combines real-time market data ingestion, a knowledge-graph memory system, ML-based feature computation, and an event-driven agent that reasons about trades using Claude.

---

## Quick Links

| Document | Purpose |
|----------|---------|
| [ARCHITECTURE.md](../ARCHITECTURE.md) | System architecture (4-layer stack, component diagram) |
| [CLAUDE.md](../CLAUDE.md) | Agent instructions for working in this codebase |
| [config/README.md](../config/README.md) | Configuration reference (`default.yaml`, `theme.yaml`) |
| [integration.md](./integration.md) | Cross-system data flows (daemon, satellite, data-layer, dashboard) |
| [archive/](./archive/) | Historical revision guides (all completed) |
| [documentation-updating/](./documentation-updating/) | Current documentation audit and update tracking |

---

## Per-Component Documentation

### Intelligence (Agent Brain)

| Document | Contents |
|----------|----------|
| [src/hynous/intelligence/README.md](../src/hynous/intelligence/README.md) | Agent architecture, module list, event-driven wake system |
| [src/hynous/intelligence/tools/README.md](../src/hynous/intelligence/tools/README.md) | Tool registry, tool module pattern, all registered tools |
| [src/hynous/intelligence/prompts/README.md](../src/hynous/intelligence/prompts/README.md) | System prompt builder, context snapshot, tool strategy |

### Data Layer & Market Data

| Document | Contents |
|----------|----------|
| [src/hynous/data/README.md](../src/hynous/data/README.md) | Market data providers (Hyperliquid, Coinglass, hynous-data) |
| [data-layer/README.md](../data-layer/README.md) | hynous-data service (`:8100`): heatmaps, order flow, whales, smart money |

### Satellite (ML Feature Engine)

| Document | Contents |
|----------|----------|
| [satellite/README.md](../satellite/README.md) | ML feature computation engine, 12 structural features |
| [satellite/training/README.md](../satellite/training/README.md) | Model training pipeline |
| [satellite/artemis/README.md](../satellite/artemis/README.md) | Historical data backfill from Artemis |

### Memory System (Nous)

| Document | Contents |
|----------|----------|
| [src/hynous/nous/README.md](../src/hynous/nous/README.md) | Python HTTP client for Nous API |
| [nous-server/README.md](../nous-server/README.md) | TypeScript Nous monorepo (Hono server + @nous/core library) |

### Dashboard

| Document | Contents |
|----------|----------|
| [src/hynous/core/README.md](../src/hynous/core/README.md) | Shared utilities (config, logging, trading settings, tracing) |

### Discord Bot

| Document | Contents |
|----------|----------|
| [src/hynous/discord/README.md](../src/hynous/discord/README.md) | Chat relay + daemon notifications via Discord |

### Deployment

| Document | Contents |
|----------|----------|
| [deploy/README.md](../deploy/README.md) | VPS deployment (systemd, Caddy, setup.sh) |

---

## Cross-System Integration

The most important undocumented relationships in this project are the data flows between the daemon, satellite, data-layer, and dashboard. These are documented in:

**[integration.md](./integration.md)** -- 10 data flow diagrams covering every cross-system boundary.

---

## For Agents

If you are an AI agent working on this codebase, read in this order:

1. **[CLAUDE.md](../CLAUDE.md)** -- Codebase conventions and agent instructions
2. **[ARCHITECTURE.md](../ARCHITECTURE.md)** -- The 4-layer stack and how components connect
3. **[integration.md](./integration.md)** -- Cross-system data flows (daemon, satellite, data-layer, dashboard)
4. **[config/README.md](../config/README.md)** -- All configuration sections in `default.yaml`
5. **Component READMEs** -- Drill into whichever subsystem you are modifying
6. **[archive/](./archive/)** -- Historical revision guides if you need to understand past design decisions

Key conventions:
- New tools go in `src/hynous/intelligence/tools/` AND must be added to `prompts/builder.py` TOOL_STRATEGY
- New pages go in `dashboard/dashboard/pages/` and are registered in `dashboard.py`
- Config changes go in `config/default.yaml` and are modeled in `src/hynous/core/config.py`
- All revisions are complete. There is no pending implementation work in `docs/archive/`.

---

## Archive

Historical revision and implementation guides live in [archive/](./archive/). All 10 revision tracks are fully implemented:

- Nous wiring (10 issues)
- Memory functionality (16 items)
- Memory search (orchestrator)
- Trade recall (3 issues)
- Token optimization (4 items)
- Trade debug interface
- Debug dashboard
- Memory pruning
- Memory sections (7 issues + brain visualization)
- Portfolio tracking (3 bugs: stats_reset_at, initial balance, circuit breaker)

See [archive/README.md](./archive/README.md) for a complete index.

---

Last updated: 2026-03-01
