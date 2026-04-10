# 01 — Pre-Implementation Reading

> Every engineer working on any v2 phase reads this document completely, then completes the reading list below, before touching any code. No exceptions. The plan documents assume the reader has this baseline context.

---

## Why This Matters

v2 is a refactor of a live trading system. Getting things wrong in a live trading system is expensive in ways that matter: real orders, real money, real market exposure. Even though v2 ships in paper mode first, the muscle memory of "work safely" needs to be in place from day one.

The reading list below has three categories:
1. **Architecture & orientation** — how the system currently works
2. **Trading mechanics** — how trades actually fire and exit
3. **v2-specific context** — the design discussions that produced v2

Don't skim. Read each file fully. Make notes. If you don't understand something, ask before proceeding.

---

## Category 1: Architecture & Orientation (read first)

These docs explain the v1 system. Even though v2 changes it significantly, you need to understand what you're changing.

> ⚠️ **IMPORTANT — all v1 documentation has a stale v2 notice prepended.**
>
> On the `v2` branch, these v1 docs have a warning block at the top telling you
> they describe v1 and should not be trusted for v2 design decisions. Read them
> for **historical context and orientation** — understanding what v2 is rebuilding
> — NOT as authoritative descriptions of the current v2 target state.
>
> The authoritative source for v2 is `v2-planning/00-master-plan.md` plus your
> assigned phase plan. When v1 docs and v2 plans conflict, v2 plans win.
>
> Phase 4 rewrites these v1 docs to match v2 reality. Until phase 4, the v2
> notice headers remain as a reminder.

### Required

1. **`ARCHITECTURE.md`** (project root) — full read
   - The canonical v1 system overview
   - Component responsibilities, data flows, extension points
   - Read this twice if needed; it's the single most important orientation doc

2. **`CLAUDE.md`** (project root) — full read
   - Project conventions for AI agents (extends to human engineers working on v2)
   - Directory structure, config loading, running, testing conventions
   - Branch and deployment model (note: v2 deviates on this — see `00-master-plan.md`)

3. **`README.md`** (project root) — quick read
   - High-level project status and tech stack

4. **`docs/integration.md`** — full read
   - Cross-system data flows between satellite, data-layer, daemon
   - Critical context for understanding how ML signals reach the daemon and how the daemon pushes historical data to the data-layer

### Recommended

5. **`docs/README.md`** — quick read for the documentation hub layout

6. **`src/hynous/README.md`** if it exists, otherwise skim the top-level docstrings of each subpackage `__init__.py`

---

## Category 2: Trading Mechanics (read second)

This is the code that actually makes trades. Understand it deeply before you change it.

### Required — core trading path

7. **`src/hynous/intelligence/tools/trading.py`** — full read (all ~2500 LOC)
   - The current `execute_trade` function with all its gates
   - `close_position`, `modify_position`, `get_account` tool handlers
   - The `_store_trade_memory` helper (this is being removed/replaced in v2)
   - The `_retry_exchange_call` and `_place_triggers` helpers
   - **Focus points:** the order of gates in `execute_trade`, what's computed from `daemon._latest_predictions`, what's stored in Nous vs what's held in memory

8. **`src/hynous/intelligence/daemon.py`** — targeted read
   - Do NOT read the whole file (it's ~5000+ LOC). Read these specific sections:
   - Class header and `__init__` method (understand the state dicts: `_peak_roe`, `_trailing_active`, `_trailing_stop_px`, `_breakeven_set`, `_dynamic_sl_set`, `_prev_positions`, `_latest_predictions`)
   - `_fast_trigger_check` in full — this is the exit loop
   - `_poll_derivatives` in full — this is what computes ML signals and caches them
   - `_update_peaks_from_candles` — candle-based peak tracking
   - `_persist_mechanical_state` + `_load_mechanical_state` — state durability
   - `_override_sl_classification` — how exits are categorized
   - All `_wake_for_*` methods — catalog them (you'll see some deleted in phase 4)

9. **`src/hynous/core/trading_settings.py`** — full read
   - The `TradingSettings` dataclass and its 70+ fields
   - The atomic write pattern
   - How settings are loaded and cached
   - **Focus points:** which fields are load-bearing for mechanical exits (trail_ret_*, dynamic_sl_*, fee-BE buffers)

10. **`src/hynous/data/providers/hyperliquid.py`** — targeted read
    - The `HyperliquidProvider` class methods, especially:
      - `market_open`, `market_close`, `limit_open`
      - `place_trigger_order`, `cancel_order`, `cancel_all_orders`
      - `update_leverage`
      - `get_user_state`, `get_open_orders`, `get_trigger_orders`, `get_user_fills`
      - `get_all_prices`, `get_price`, `get_l2_book`, `get_asset_context`, `get_multi_asset_contexts`, `get_candles`, `get_funding_history`
    - `check_triggers` if present (or understand that it lives in `paper.py` for paper mode)

11. **`src/hynous/data/providers/ws_feeds.py`** — full read
    - `MarketDataFeed` class
    - The four channels: `allMids`, `l2Book`, `activeAssetCtx`, `candle` (1m and 5m)
    - Staleness gating, reconnection logic, candle rolling windows
    - **Focus points:** how providers fall back to REST if WS is stale

12. **`src/hynous/data/providers/paper.py`** — full read
    - `PaperProvider` class — the simulated trading layer used in paper mode
    - `check_triggers` implementation (paper-mode SL/TP/liquidation simulation)
    - State persistence to `storage/paper-state.json`
    - **Focus points:** how paper mode reuses real mainnet prices from `HyperliquidProvider` while simulating fills locally

### Required — ML signal path

13. **`satellite/__init__.py`** + **`satellite/features.py`** + **`satellite/conditions.py`** + **`satellite/inference.py`** — targeted read
    - `satellite.tick()` entry point and how it's called by the daemon
    - The 28 structural features in `FEATURE_NAMES`
    - How `ConditionEngine` loads the 14 condition models
    - `InferenceEngine.predict()` output shape — this is what populates `daemon._latest_predictions`
    - **Focus points:** the exact structure of the prediction dict that lands in `_latest_predictions[symbol]`

14. **`satellite/entry_score.py`** if present — full read
    - The composite entry score computation (6-signal weighted composite)
    - How weights are loaded and updated
    - This becomes the primary entry gate in v2

15. **`satellite/safety.py`** — full read (but remember: kill switches are disabled in v2 paper mode per plan)
    - Understand what the kill switch checks so you know why it's intentionally not engaged in v2

### Recommended — data layer context

16. **`data-layer/README.md`** + **`src/hynous/data/providers/hynous_data.py`** — skim
    - The data-layer service lives on port 8100 and provides heatmap, order flow, HLP, whale, smart money data
    - v2 doesn't fundamentally change the data-layer, but the analysis agent queries it for historical snapshots during post-trade analysis
    - **Focus points:** which endpoints the agent will call during analysis

---

## Category 3: v2 Design Context (read third)

This is the conversation that produced v2. Read it so you understand the *why* behind decisions, not just the *what*.

### Required

17. **`v2-planning/00-master-plan.md`** — full read
    - The v2 mission, non-goals, phase structure, terminology, conventions, engineer protocol
    - You cannot start a phase without reading this

18. **`v2-planning/02-testing-standards.md`** — full read
    - The static + dynamic test protocol applied to every phase
    - Acceptance criteria format and reporting requirements

19. **Your assigned phase's plan document** — full read
    - E.g., if you're on phase 3, read `06-phase-3-analysis-agent.md` in full
    - Do not start implementation until you understand the full scope of your phase

20. **All phase plan documents that precede yours** — full read or careful skim
    - If you're on phase 5, you need to have read phases 0–4 to understand what state the codebase is in when your phase starts
    - Dependencies matter

### Context from v1 docs — selective reading

Reading the v1 revision docs is not required but is strongly recommended for engineers working on phases 1, 4, and 5 (data capture, deletions, mechanical entry). These explain why certain v1 components exist and what they were trying to solve — useful for knowing what to preserve vs. delete.

21. **`docs/revisions/trailing-stop-fix/`** — all files
    - Explains the v3 exponential trailing stop implementation
    - Trail v3 is kept as-is in v2 but you should understand how it works before touching adjacent code

22. **`docs/revisions/breakeven-fix/dynamic-protective-sl.md`** — full read
    - The Dynamic Protective SL design (Layer 1 of mechanical exits)
    - Still active in v2; do not modify

23. **`docs/revisions/breakeven-fix/README.md`** — full read
    - The three-round breakeven fix history
    - Context for why the daemon has so much mechanical state tracking

24. **`docs/revisions/trade-mechanism-debug/README.md`** — full read
    - The 5 bug fixes for mechanical exits (T1, T2, T3, B1, B2, B3, S1)
    - Important: these bugs will reappear if you carelessly refactor `_fast_trigger_check` or the trigger cache

25. **`docs/revisions/entry-quality-rework/README.md`** — full read
    - The composite entry score + entry-outcome feedback loop design
    - v2 makes composite score the primary entry gate — understand how it was built

26. **`docs/revisions/tick-system-audit/README.md`** — full read (if you're on phase 8)
    - The tick model train/inference mismatch bug
    - Phase 8 fixes this

27. **`docs/revisions/mc-fixes/implementation-guide.md`** — full read (if you're on phase 8)
    - The Monte Carlo feature corruption guard, bias score, feature list consolidation
    - Phase 8 implements these

### Conversational context — the v2 design discussions

The conversation that produced these plans covered trade-offs you should understand even if they're not explicitly in the plan docs. The essentials to know:

- **The LLM is being removed from trading decisions.** This is because audit showed the LLM's `reasoning` field was never read back and its `confidence` was overridden by ML multiplication. The user wants a mechanical system that the LLM *narrates post-hoc*, not drives.
- **Nous is being deleted.** Not kept, not stripped, not forked — fully deleted. It's being replaced with ~800 LOC of Python + SQLite. The motivation is that Nous is 91K LOC of TypeScript designed for cognitive memory, and v2 only needs a trade journal.
- **Fresh start, no v1 data migration.** The user explicitly chose to clear v1 memory. Don't write migration scripts.
- **Paper mode has no kill switches.** The user wants to observe failures, not suppress them.
- **BTC-only first.** Schema keeps `symbol` as a column because ETH/SOL come later, but the mechanical entry logic is BTC-only for v1.
- **One concurrent position per symbol.** Mechanical exits aren't designed for overlapping positions on the same coin.
- **Evidence-backed analysis.** Every LLM narrative claim must cite structured evidence. Unverified claims are flagged in the output.
- **New branch, no merge.** v2 lives on a separate branch forever. Main is frozen for v2 purposes.

---

## Reading Checklist (by phase)

Use this as a personal checklist. Check off each item before proceeding.

### Required for every engineer (any phase)

- [ ] 1. ARCHITECTURE.md
- [ ] 2. CLAUDE.md
- [ ] 3. README.md
- [ ] 4. docs/integration.md
- [ ] 17. v2-planning/00-master-plan.md
- [ ] 18. v2-planning/02-testing-standards.md
- [ ] 19. Your assigned phase's plan document
- [ ] 20. All phase plans that precede yours

### Phase 0 engineer

- [ ] 9. core/trading_settings.py (to understand what config changes are needed)
- [ ] Config files: `config/default.yaml`, `src/hynous/core/config.py`

### Phase 1 engineer (data capture)

- [ ] 7. intelligence/tools/trading.py (full)
- [ ] 8. intelligence/daemon.py (targeted)
- [ ] 9. core/trading_settings.py
- [ ] 10. data/providers/hyperliquid.py (targeted)
- [ ] 11. data/providers/ws_feeds.py
- [ ] 12. data/providers/paper.py
- [ ] 13. satellite modules (ML signal path)
- [ ] 14. satellite/entry_score.py
- [ ] 22. docs/revisions/breakeven-fix/dynamic-protective-sl.md
- [ ] 23. docs/revisions/breakeven-fix/README.md
- [ ] 24. docs/revisions/trade-mechanism-debug/README.md

### Phase 2 engineer (journal module)

- [ ] Full v1 Nous client for context: `src/hynous/nous/client.py` (you're replacing this)
- [ ] `src/hynous/nous/sections.py` (understand section concept so you know why v2 removes it)
- [ ] 5. docs/README.md (for documentation conventions)

### Phase 3 engineer (analysis agent)

- [ ] 7. trading.py (understand what data is captured at trade time)
- [ ] 8. daemon.py targeted (understand wake mechanism)
- [ ] 13. satellite modules (understand what ML signals exist to reason about)
- [ ] 14. satellite/entry_score.py
- [ ] Current coach.py: `src/hynous/intelligence/coach.py` (you're deleting this; understand what it was doing)
- [ ] Current consolidation.py: `src/hynous/intelligence/consolidation.py` (you're deleting this; understand the lesson extraction pattern because the analysis agent subsumes it)
- [ ] Current agent.py: `src/hynous/intelligence/agent.py` (to understand LLM calling patterns you'll reuse)
- [ ] Current briefing.py: `src/hynous/intelligence/briefing.py` (to understand the data flow into an LLM prompt)

### Phase 4 engineer (deletions)

- [ ] Full list of files to delete per phase 4 plan
- [ ] Every file you delete — read it first to confirm you understand what it does and what depends on it
- [ ] Search the codebase for imports of each file before deleting (`grep -r "from hynous.intelligence.coach"`)

### Phase 5 engineer (mechanical entry)

- [ ] 7. trading.py (full — you're refactoring execute_trade from tool to function)
- [ ] 8. daemon.py (targeted — scanner wake path, _wake_for_scanner)
- [ ] 13. satellite modules (ML signals are now the primary entry gate)
- [ ] 14. satellite/entry_score.py
- [ ] 25. docs/revisions/entry-quality-rework/README.md

### Phase 6 engineer (consolidation & patterns)

- [ ] Phase 2 plan (journal schema — you're adding tables to it)
- [ ] Phase 3 plan (analysis agent output — you're aggregating its findings)

### Phase 7 engineer (dashboard rework)

- [ ] `dashboard/dashboard/state.py` (full — you'll be cutting memory-related state)
- [ ] `dashboard/dashboard/pages/home.py`, `chat.py`, `journal.py`, `memory.py`, `graph.py`, `settings.py`, `debug.py`
- [ ] `dashboard/dashboard/dashboard.py` (API proxy routes — you'll be replacing `/api/nous/*` with `/api/v2/journal/*`)
- [ ] `dashboard/dashboard/components/` (for reusable UI patterns)

### Phase 8 engineer (quantitative improvements)

- [ ] 14. satellite/entry_score.py
- [ ] `satellite/training/` (especially train_tick_direction.py and feature_sets.py)
- [ ] `satellite/tick_features.py` + `satellite/tick_inference.py`
- [ ] `scripts/monte_carlo_server.py` + `scripts/monte_carlo.html`
- [ ] 26. docs/revisions/tick-system-audit/README.md
- [ ] 27. docs/revisions/mc-fixes/implementation-guide.md

---

## What to Do If Something Doesn't Match the Plan

The plans are written with care but they can't anticipate everything. If you find that reality doesn't match what a plan document says:

1. **Don't assume the plan is wrong.** First, confirm you're looking at the right file, the right line numbers, the right branch.
2. **Don't assume you're wrong.** If after double-checking you're confident there's a discrepancy, it's a real discrepancy.
3. **Pause and report.** Describe what the plan says, what the code says, and what you think the correct resolution is. Wait for direction.
4. **Do not silently fix it.** Even if the fix seems obvious. The plan is a contract; deviations need approval.

This is especially important for phases 1, 5, and 7 which modify existing code. The codebase may have drifted between when the plan was written and when you're implementing it — raise the drift explicitly.

---

## Tools Engineers Should Have Configured

Before starting any phase:

- **Python 3.11+** with the project's virtual environment activated (`source .venv/bin/activate`)
- **mypy** for type checking (`pip install mypy` or via project deps)
- **ruff** for linting (`pip install ruff` or via project deps)
- **pytest** for running tests (`pip install pytest` or via project deps)
- **VS Code or similar editor** with Python language server (pylsp, pyright, or pylance)
- **git** configured with your name and email

Verify your environment works before starting:

```bash
cd /Users/bauthoi/Documents/Hynous  # or your checkout location
source .venv/bin/activate
python -c "import hynous; print('import ok')"
# NOTE: --ignore=tests/e2e is required until phase 4 (see master plan Amendment 2)
pytest tests/ --ignore=tests/e2e --collect-only > /dev/null && echo "pytest collection ok"
mypy src/hynous/ --no-error-summary > /dev/null 2>&1; echo "mypy exit: $?"
ruff check src/hynous/ > /dev/null 2>&1; echo "ruff exit: $?"
```

Establish a **baseline** of mypy and ruff errors on the v2 branch before making changes so you can verify your changes don't introduce new errors. Phase 0 covers the initial baseline capture.

---

## One Final Note

v2 is a rebuild, not a patch. The mental model shift is: "the LLM doesn't trade, it journals." Carry that through every design decision. If you find yourself writing LLM-in-the-loop trading logic, stop and re-read the master plan. If you find yourself adding kill switches in paper mode, stop and re-read the master plan. If you find yourself preserving v1 Nous data, stop and re-read the master plan.

When the plans conflict with your instincts, follow the plans — or pause and raise the conflict. Don't improvise.
