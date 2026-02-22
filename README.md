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
├── storage/             # Runtime data (traces, payloads) — .gitignored
├── deploy/              # VPS deployment (systemd, Caddy)
├── scripts/             # Entry points
├── tests/               # Test suites
├── docs/                # Documentation
└── revisions/           # Known issues & planned improvements
    ├── revision-exploration.md     # All 21 issues (prioritized P0-P3, all resolved)
    ├── nous-wiring/                # Nous ↔ Python integration — ALL RESOLVED
    │   ├── executive-summary.md    # Start here — issue categories overview
    │   ├── nous-wiring-revisions.md # 10 wiring issues (NW-1 to NW-10) — ALL FIXED
    │   └── more-functionality.md   # 16 Nous features (MF-0 to MF-15) — 14 DONE, 2 SKIPPED
    ├── memory-search/                # Intelligent Retrieval Orchestrator — IMPLEMENTED
    │   ├── design-plan.md            # Architecture design and rationale
    │   └── implementation-guide.md   # Detailed implementation guide (diverged in some areas)
    ├── trade-recall/               # Trade retrieval issues — ALL FIXED
    │   ├── retrieval-issues.md       # Root cause analysis + resolution (event_time, memory_type, thesis retrieval)
    │   └── implementation-guide.md   # Step-by-step implementation guide (9 steps)
    ├── trade-debug-interface/      # Trade execution telemetry — IMPLEMENTED
    │   ├── analysis.md              # Sub-span instrumentation proposal for trade debugging
    │   └── implementation-guide.md  # Step-by-step implementation guide (6 chunks)
    ├── graph-changes/              # Graph visualization enhancements
    │   └── cluster-visualization.md # Deterministic cluster layout in force-graph — DONE
    ├── token-optimization/         # Token cost reduction — TO-1 through TO-4 DONE
    │   ├── executive-summary.md    # Overview of 8 TOs (4 implemented, 4 deferred)
    │   ├── TO-1-dynamic-max-tokens.md
    │   ├── TO-2-schema-trimming.md
    │   ├── TO-3-stale-tool-truncation.md
    │   └── TO-4-window-size.md
    ├── memory-pruning/             # Memory pruning tools — IMPLEMENTED
    │   └── implementation-guide.md # Two-phase pruning (analyze + batch_prune)
    └── memory-sections/            # Brain-inspired memory sectioning — GUIDES COMPLETE
        ├── executive-summary.md    # Theory, 6 issues, section model, design constraints
        ├── issue-0-section-foundation.md  # Shared types, mapping, config
        ├── issue-1-retrieval-weights.md   # Per-section SSA reranking
        ├── issue-2-decay-curves.md        # Per-section FSRS decay
        ├── issue-3-generalization.md      # Cross-episode consolidation
        ├── issue-4-stakes-weighting.md    # Salience-modulated encoding
        ├── issue-5-procedural-memory.md   # Playbook matcher + scanner integration
        └── issue-6-retrieval-bias.md      # Intent classification + section boost
```

See `ARCHITECTURE.md` for detailed component documentation.

---

## For Agents

If you're an AI agent working on this project:

1. **Read first:** `ARCHITECTURE.md` explains how everything connects
2. **Check revisions:** `revisions/` has known issues and planned improvements — start with `revisions/nous-wiring/executive-summary.md` for the Nous integration status
3. **All revisions complete** — Nous wiring, memory search, trade recall, trade debug interface, token optimization, memory pruning, and memory sections all fully implemented. See `revisions/README.md` for details
4. **Check brainstorms:** `../hynous-brainstorm/` has all design decisions
5. **Follow patterns:** Each directory has a README explaining conventions
6. **Stay modular:** One feature = one module. Don't mix concerns.

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
- [x] Phase 3: Add tools incrementally (25 tools, market scanner, Discord bot)
- [x] Phase 4: Paper trading (conviction-sized, micro/swing types)
- [ ] Phase 5: Live trading

---

## Links

- Brainstorms: `../hynous-brainstorm/`
- Hydra (data layer): `../hydra-v2/`
