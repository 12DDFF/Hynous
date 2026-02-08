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
└── docs/                # Documentation
```

See `ARCHITECTURE.md` for detailed component documentation.

---

## For Agents

If you're an AI agent working on this project:

1. **Read first:** `docs/ARCHITECTURE.md` explains how everything connects
2. **Check brainstorms:** `../hynous-brainstorm/` has all design decisions
3. **Follow patterns:** Each directory has a README explaining conventions
4. **Stay modular:** One feature = one module. Don't mix concerns.

---

## Key Files

| File | Purpose |
|------|---------|
| `config/default.yaml` | Main configuration |
| `config/theme.yaml` | UI colors and styling |
| `src/hynous/intelligence/agent.py` | Hynous agent core |
| `dashboard/app.py` | Dashboard entry point |

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
