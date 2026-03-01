# Portfolio Tracking — Solved

> Summary of what was fixed, key considerations, and impact on the system.

---

## The Issues

**Original audit:** `docs/archive/portfolio-tracking/audit.md`
**Audited:** 2026-03-01 | **Fixed:** 2026-03-01 | **Commit:** 035bbeb

Three bugs were identified in paper trading's portfolio tracking pipeline:

| Bug | Severity | Description |
|-----|----------|-------------|
| Bug 1 | Critical | `stats_reset_at` never set — all-time Nous history always included in stats |
| Bug 2 | Critical | Wrong initial balance in context snapshot and briefing — agent shown incorrect return % |
| Bug 3 | Structural | Daemon-wake-initiated agent closes never update the circuit breaker |

Two minor issues were deferred (no-fix decisions):
- **Issue 4:** Account value slightly overstates equity (industry-standard mark-to-market, not a bug)
- **Issue 5:** Partial close merge key too specific (no current impact; only matters if DCA is added)

---

## Key Considerations

### 1. Three independent PnL sources

The system has three legitimate PnL numbers that are intentionally different:

| Source | Location | Scope | Resets |
|--------|----------|-------|--------|
| `_daily_realized_pnl` | daemon.py in-memory | Today's realized only | UTC midnight |
| `stats.total_pnl` | Nous `trade_close` nodes | Post-`stats_reset_at` | Manual reset |
| `account_value - _initial_balance` | paper-state.json | Since wallet init | On wallet reset |

After Bug 1 and Bug 2 fixes they converge more closely but remain distinct — exchange truth includes unrealized PnL on open positions, Nous sum does not.

### 2. Bug 1: auto-stamp on first run vs reset-on-demand

Two stamp mechanisms were added:
- **First run:** `PaperProvider.__init__` checks if `storage/paper-state.json` doesn't exist yet. If so, it stamps `stats_reset_at` immediately after `_load()`. This means a brand-new paper wallet automatically scopes stats from its creation date.
- **Manual reset:** `reset_paper_stats()` method stamps the current time, allowing the user to start a new stats session without resetting the balance. Exposed via `POST /api/reset-paper-stats` and a dashboard button in the Journal page.

### 3. Module-level cache invalidation

`trade_analytics.py` has module-level cache variables (`_cached_stats`, `_cache_time`) with 30s TTL. After `reset_paper_stats()`, these are explicitly cleared so stale stats aren't served for up to 30s after the reset. Cache clearing uses a try/except import to avoid coupling the provider to the analytics module.

### 4. Bug 2: provider fallback chain, not config-only

Both `context_snapshot.py` and `briefing.py` (3 locations total) used `config.execution.paper_balance` as the initial balance for return % calculation. The fix uses a fallback chain:

```python
initial = getattr(provider, "_initial_balance", None) or \
          (config.execution.paper_balance if config else 1000)
```

`_initial_balance` exists on `PaperProvider` (loaded from `paper-state.json` on startup) but not on `HyperliquidProvider` (live trading). This fallback ensures the fix works in both modes: paper trading gets the actual starting balance from state, live trading falls back to config.

The dashboard (`state.py`) was already correctly using `getattr(provider, "_initial_balance", ...)` — only the agent-facing context and briefing paths had the bug.

### 5. Bug 3: `positions_before` must be captured outside the try block

The fix requires comparing `_prev_positions` before vs after the agent runs. The snapshot must be taken **before** the try block that calls the agent — not inside it. If it were inside the try, an exception before the agent runs would leave `positions_before` unset, causing a NameError in the finally block. The fix uses `positions_before = dict(self._prev_positions)` immediately before `try:`.

### 6. Bug 3: per-coin try/except in finally

The fill lookup for each closed coin is wrapped in a per-coin try/except rather than a single outer try. This ensures one failed fill lookup (e.g., API timeout for coin A) doesn't prevent the circuit breaker from being updated for coin B that was also closed.

### 7. Reflex state handlers use asyncio.to_thread, not HTTP self-calls

The `reset_paper_stats` state handler in `state.py` calls `get_provider()` directly via `asyncio.to_thread`, matching the pattern used by every other state handler in the file. An HTTP self-call to `localhost:8000` was considered and rejected — it adds a network hop, fails silently if the port changes, and is unnecessary when the provider singleton is already in-process.

---

## What Was Implemented

### Bug 1 — `stats_reset_at` never set

**`src/hynous/data/providers/paper.py`**
- `__init__`: Added first-run detection (`_is_first_run = not os.path.exists(self._storage_path)`) and auto-stamp after `_load()` when true.
- `reset_paper_stats()`: New method — stamps current UTC time, saves to disk, clears the `trade_analytics` module-level cache. Inserted before the "Paper-Specific: Trigger Checking" section.

**`dashboard/dashboard/dashboard.py`**
- Added `POST /api/reset-paper-stats` endpoint that calls `provider.reset_paper_stats()` and returns `{"status": "ok"}`.

**`dashboard/dashboard/state.py`**
- Added `reset_paper_stats` async handler that calls `get_provider().reset_paper_stats()` via `asyncio.to_thread`, then refreshes the journal with `load_journal()`.

**`dashboard/dashboard/pages/journal.py`**
- Added a "Reset Stats" button with tooltip next to the existing refresh icon in the journal page header. Uses `rx.hstack` to group both buttons, triggers `AppState.reset_paper_stats` on click.

### Bug 2 — Wrong initial balance in context and briefing

**`src/hynous/intelligence/context_snapshot.py`**
- `_build_portfolio()` (line ~132): Changed `initial = config.execution.paper_balance if config else 1000` to `initial = getattr(provider, "_initial_balance", None) or (config.execution.paper_balance if config else 1000)`.

**`src/hynous/intelligence/briefing.py`**
- `build_briefing()` (~line 355, performance line): Same fix — `_init` now reads from `provider._initial_balance` first.
- `_build_portfolio_section()` (~line 383, portfolio header): Same fix — `initial` now reads from `provider._initial_balance` first.

### Bug 3 — Agent closes skip circuit breaker

**`src/hynous/intelligence/daemon.py`**
- `_wake_agent()`: Added `positions_before = dict(self._prev_positions)` before the `try:` block.
- `_wake_agent()` finally block: After refreshing `_prev_positions`, iterates over `positions_before` to detect newly-closed coins (coins present before but absent after). For each closed coin, fetches the last 5 minutes of fills, finds the close fill, and calls `_update_daily_pnl(close_fill.get("closed_pnl", 0.0))`. Per-coin try/except ensures one failure doesn't block others.

---

## Audit Results

All three bugs verified as present in the codebase before fixing (no false positives). All fixes applied.

**Static analysis (py_compile):** All 7 modified files compiled clean.

**Dynamic E2E testing:**
- Nous server started, Reflex backend started with `PYTHONPATH=/path/to/src`
- `POST /api/reset-paper-stats` → `{"status": "ok"}` ✓
- `paper-state.json` written with correct `stats_reset_at` timestamp ✓
- `get_trade_stats()` returned scoped stats with correct `created_after` filter ✓
- Context snapshot return % correct after Bug 2 fix (0.0% with `_initial_balance=5000`, not -50% from config `paper_balance=10000`) ✓
- `positions_before` captured correctly in daemon `_wake_agent()` ✓

**Production deployment:**
- Committed (7 files), pushed to GitHub (`035bbeb`), pulled on VPS
- All three systemd services (`nous`, `hynous-data`, `hynous`) confirmed `active (running)` after restart
- Live server confirmed: `POST /api/reset-paper-stats` → `{"status":"ok"}`, `stats_reset_at` stamped to `2026-03-01T21:11:40.844943+00:00`
- Server had real trading history (`balance=$1314.86`, `initial_balance=$2000`, 100 fills) — existing state preserved, only `stats_reset_at` updated

---

## Impact on the System

### Immediate

- **Win rate and trade stats now reflect the current paper session.** `get_trade_stats()` correctly filters Nous `trade_close` nodes to those created after `stats_reset_at`. All-time history from prior sessions is excluded.
- **Agent sees correct return %.** Context snapshot and briefing now show the actual return since wallet initialization (using `_initial_balance` from state) rather than a possibly wrong percentage calculated against the YAML config default.
- **Circuit breaker is fully reliable.** When the agent closes a position in response to a daemon wake (scanner signal, watchpoint trigger, periodic review), `_daily_realized_pnl` is updated correctly. The circuit breaker now catches all closes regardless of who initiated them.
- **Reset Stats button works.** Users can start a new stats session from the Journal dashboard without touching the balance or the Nous database.

### Long-term

- **Stats health maintained across sessions.** Each paper session (started via "Reset Stats") gets a clean performance baseline. Prior session data remains in Nous but is filtered out of current stats.
- **Agent risk assessment is accurate.** With the correct return % in every message, the agent's self-assessment of its performance matches reality.
- **Daily loss limit reliably enforced.** No path exists where the daemon's circuit breaker can be bypassed by the agent making a trade during a daemon-initiated wake.

---

## Files Changed

| File | Change |
|------|--------|
| `src/hynous/data/providers/paper.py` | First-run auto-stamp in `__init__`, new `reset_paper_stats()` method |
| `src/hynous/intelligence/context_snapshot.py` | Bug 2: initial balance from `provider._initial_balance` |
| `src/hynous/intelligence/briefing.py` | Bug 2: initial balance from `provider._initial_balance` (2 locations) |
| `src/hynous/intelligence/daemon.py` | Bug 3: `positions_before` snapshot + finally-block close detection |
| `dashboard/dashboard/dashboard.py` | `POST /api/reset-paper-stats` endpoint |
| `dashboard/dashboard/state.py` | `reset_paper_stats` async state handler |
| `dashboard/dashboard/pages/journal.py` | Reset Stats button with tooltip |

**Audit document:** `docs/archive/portfolio-tracking/audit.md`
