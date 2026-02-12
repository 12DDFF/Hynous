# Hynous

> Personal crypto intelligence system with an autonomous LLM trading agent.

---

## Quick Start

```bash
# Install dependencies
pip install -e .

# Run dashboard
python -m scripts.run_dashboard

# Run daemon (background agent)
python -m scripts.run_daemon
```

---

## Project Structure

```
hynous/
├── src/hynous/          # Core source code
│   ├── intelligence/    # LLM agent (brain)
│   ├── nous/            # Memory system (knowledge)
│   ├── data/            # Market data providers
│   └── core/            # Shared utilities
│
├── dashboard/           # Reflex UI (Python → React)
│   ├── assets/          # Static files (graph.html force-graph viz)
│   ├── components/      # Reusable UI parts
│   ├── pages/           # Dashboard pages (home, chat, memory, graph, debug)
│   └── state/           # Session management
│
├── config/              # All configuration
├── deploy/              # VPS deployment (systemd, Caddy)
├── scripts/             # Entry points
├── tests/               # Test suites
├── docs/                # Documentation
└── revisions/           # Known issues & planned improvements
    ├── revision-exploration.md     # All 19 issues (prioritized P0-P3)
    ├── nous-wiring/                # Nous ↔ Python integration — ALL RESOLVED
    │   ├── executive-summary.md    # Start here — issue categories overview
    │   ├── nous-wiring-revisions.md # 10 wiring issues (NW-1 to NW-10) — ALL FIXED
    │   └── more-functionality.md   # 16 Nous features (MF-0 to MF-15) — 14 DONE, 2 SKIPPED
    ├── graph-changes/              # Graph visualization enhancements
    │   └── cluster-visualization.md # Deterministic cluster layout in force-graph — DONE
    └── token-optimization/         # Token cost reduction — TO-1 through TO-4 DONE
        ├── executive-summary.md    # Overview of 8 TOs (4 implemented, 4 deferred)
        ├── TO-1-dynamic-max-tokens.md
        ├── TO-2-schema-trimming.md
        ├── TO-3-stale-tool-truncation.md
        └── TO-4-window-size.md
```

See `ARCHITECTURE.md` for detailed component documentation.

---

## For Agents

If you're an AI agent working on this project:

1. **Read first:** `ARCHITECTURE.md` explains how everything connects
2. **Check revisions:** `revisions/` has known issues and planned improvements — start with `revisions/nous-wiring/executive-summary.md` for the Nous integration status
3. **Check brainstorms:** `../hynous-brainstorm/` has all design decisions
4. **Follow patterns:** Each directory has a README explaining conventions
5. **Stay modular:** One feature = one module. Don't mix concerns.

---

## Key Files

| File | Purpose |
|------|---------|
| `config/default.yaml` | Main configuration |
| `config/theme.yaml` | UI colors and styling |
| `src/hynous/intelligence/agent.py` | Hynous agent core |
| `dashboard/app.py` | Dashboard entry point |
| `revisions/nous-wiring/executive-summary.md` | Nous integration issue overview |

---

## Status

- [x] Phase 1: Dashboard skeleton
- [x] Phase 2: Chat with Hynous
- [x] Phase 3: Add tools incrementally (23 tools, market scanner, Discord bot)
- [x] Phase 4: Paper trading (conviction-sized, micro/swing types)
- [ ] Phase 5: Live trading

---

## Links

- Brainstorms: `../hynous-brainstorm/`
- Hydra (data layer): `../hydra-v2/`
