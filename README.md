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
│   ├── theme/           # Design system
│   ├── components/      # Reusable UI parts
│   ├── pages/           # Dashboard pages
│   └── state/           # Session management
│
├── config/              # All configuration
├── data/                # Databases & storage
├── scripts/             # Entry points
├── tests/               # Test suites
├── docs/                # Documentation
└── revisions/           # Known issues & planned improvements
    ├── revision-exploration.md     # All 19 issues (prioritized P0-P3)
    └── nous-wiring/                # Nous ↔ Python integration issues
        ├── executive-summary.md    # Start here — issue categories overview
        ├── nous-wiring-revisions.md # 10 wiring issues (NW-1 to NW-10) — ALL FIXED
        └── more-functionality.md   # 16 Nous features (MF-0 to MF-15) — 14 DONE, 2 SKIPPED, 0 remaining
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

- [ ] Phase 1: Dashboard skeleton
- [ ] Phase 2: Chat with Hynous
- [ ] Phase 3: Add tools incrementally
- [ ] Phase 4: Paper trading
- [ ] Phase 5: Live trading

---

## Links

- Brainstorms: `../hynous-brainstorm/`
- Hydra (data layer): `../hydra-v2/`
