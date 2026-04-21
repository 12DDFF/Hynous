# Phase 4: LLM Lookahead — Staged Entries (ARCHIVED)

> **Status:** RETIRED — feature was specified but never implemented.
> The `staged_entries` module referenced throughout this doc never existed
> in the codebase; the daemon stub that tried to import it was removed in
> the v2-debug H1 fix. Kept for historical context only.
>
> Original status header (retained verbatim below):
>
> **Status:** DEFERRED — pending paper trading data from Phases 1-3
> **Depends on:** Phase 3 feedback data (IC results, composite score validation)
> **Design:** Will be revised based on paper trading results. Current guide is the original concept; the architecture may change to Option B (LLM provides direction + conviction only, mechanical system handles timing/levels/risk).
> **Supersedes:** `docs/revisions/llm-lookahead-trade/README.md` (concept doc)

---

## What to Check Before Starting Phase 4

Phase 4 should NOT begin until the following data exists from paper trading with Phases 1-3:

1. **Entry score IC from feedback loop** (`entry_snapshots` table in satellite.db): Does the composite score correlate with trade outcomes? Run `SELECT composite_score, outcome_roe, outcome_won FROM entry_snapshots WHERE outcome_won IS NOT NULL` — need 30+ closed trades.
2. **Per-signal IC** (daemon logs, "Rolling IC:"): Which signals predict winners? If entry_quality IC is high, the composite score is working. If all ICs are near zero, the signals don't predict outcomes and Phase 4 won't help.
3. **Latency impact assessment**: Are entries consistently late (price moved >0.3% between wake and execution)? If yes, Phase 4 is justified. If entries are on time but wrong direction, Phase 4 won't help — the problem is signal quality, not speed.
4. **Weight convergence** (`storage/entry_score_weights.json`): Have the adaptive weights stabilized or are they still shifting? Unstable weights mean the score isn't reliable enough to gate staged entries.

### Architecture Decision: Option A vs Option B

**Option A (current guide below):** LLM stages a fully specified trade (price, SL, TP, size, leverage). Daemon fires mechanically when price hits target. Risk: stale thesis — the specific price level may be irrelevant 10-30 minutes later.

**Option B (simpler, recommended if signals are strong):** LLM provides only direction + symbol + conviction. Mechanical system handles everything else — entry timing (composite score threshold), SL (from MAE/range predictions), TP (from move prediction), sizing (from score). No price target to go stale. The LLM's directional thesis ("funding crowded short, expect squeeze") persists longer than a specific price level.

**Choose based on data:**
- If composite score IC > 0.15 and entry_quality IC > 0.10 → Option B (signals are strong enough to time entries mechanically)
- If composite score IC < 0.10 but latency is the proven problem → Option A with very short TTLs (5min micro, 15min macro)
- If both IC is low AND latency isn't the issue → Phase 4 isn't the right investment — focus on improving the condition models instead

---

## Required Reading

### Mechanical Exit Pattern (template for staged entry execution)
- **`src/hynous/intelligence/daemon.py`** — `_fast_trigger_check()` (starts around line 2056): the 1s loop that checks SL/TP triggers, peak ROE tracking, dynamic SL placement, fee-BE, and trailing stop. Study the full flow to understand where staged entry evaluation will be added. Each mechanical system follows the same pattern: check condition → execute action → update state → persist.
- **`src/hynous/intelligence/daemon.py`** — Trailing stop Phase 1/2/3 (lines 2346-2540): Study the activation check (Phase 1), update trail (Phase 2), check trail hit + execute close (Phase 3). Staged entries will follow an analogous pattern: check price trigger → re-verify score → execute entry.

### State Persistence Pattern
- **`src/hynous/intelligence/daemon.py`** — `_persist_mechanical_state()` (lines 4561-4581): atomic write to `storage/mechanical_state.json` using `_atomic_write()`. Study the JSON structure (`peak_roe`, `trailing_stop_px`, `trailing_active` dicts keyed by symbol).
- **`src/hynous/intelligence/daemon.py`** — `_load_mechanical_state()` (lines 4583-4623): loads JSON on startup, filters to open positions only. Staged entries will follow the same persist/load pattern with expiry-based filtering.

### Trade Execution (what staged entries replicate mechanically)
- **`src/hynous/intelligence/tools/trading.py`** — `handle_execute_trade()`: the full validation chain (circuit breaker, ML gate, leverage, sizing, risk checks, order placement, trigger placement, memory storage). Staged entries must re-run critical safety checks at trigger time, not just at staging time.

### Tool Registration
- **`src/hynous/intelligence/tools/registry.py`** — `get_registry()` (lines 87-158): 21 tool imports + `register()` calls. New `stage_trade` tool follows same pattern.
- **`src/hynous/intelligence/prompts/builder.py`** — TOOL_STRATEGY section (lines 217-290): where tool usage guidance is specified. New tool needs guidance here so the agent knows when to use `stage_trade` vs `execute_trade`.

### Provider Execution
- **`src/hynous/data/providers/hyperliquid.py`** — `market_open()`, `update_leverage()`: the actual exchange API calls. Staged entry execution calls these directly (same as the trading tool).
- **`src/hynous/data/providers/paper.py`** — Paper trading simulator. Must support the same calls for testing.

### WebSocket Prices
- **`src/hynous/data/providers/ws_feeds.py`** — `MarketDataFeed`: provides sub-second prices via WS. `provider.get_all_prices()` (WS-first, REST fallback) is what `_fast_trigger_check()` uses. Staged entry price triggers use the same prices.

---

## Step 4.1: Create Staged Entries Module

**New file:** `src/hynous/intelligence/staged_entries.py`

```python
"""Staged trade entries — mechanical execution of pre-computed entry directives.

The agent stages entries during wake cycles. The daemon evaluates them
every ~1s in _fast_trigger_check() and fires mechanically when:
  1. Price hits the entry zone
  2. Composite entry score still meets minimum
  3. Safety checks pass (circuit breaker, max positions, no duplicate)

State is persisted to storage/staged_entries.json (same pattern as mechanical_state.json).
"""

import json
import logging
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path

log = logging.getLogger(__name__)


@dataclass
class StagedEntry:
    """A pre-computed entry directive awaiting mechanical execution."""

    directive_id: str = field(default_factory=lambda: str(uuid.uuid4())[:12])
    coin: str = ""
    side: str = ""                     # "long" or "short"

    # Entry conditions (one of entry_price or zone must be set)
    entry_price: float | None = None   # Exact trigger price
    entry_zone_low: float | None = None
    entry_zone_high: float | None = None

    # Trade parameters (validated at staging time)
    leverage: int = 10
    confidence: float = 0.7
    stop_loss: float = 0.0
    take_profit: float = 0.0
    trade_type: str = "macro"          # "macro" or "micro"
    reasoning: str = ""

    # Lifecycle
    created_at: float = 0.0
    expires_at: float = 0.0
    status: str = "active"             # "active", "filled", "expired", "cancelled"

    # Re-verification at trigger time
    min_entry_score: float = 40.0      # Composite score must be >= this

    # Execution result (set on fill)
    fill_price: float | None = None
    fill_time: float | None = None


def evaluate_trigger(
    entry: StagedEntry,
    current_price: float,
) -> bool:
    """Check if price satisfies the entry's trigger condition.

    For longs: entry_price means "buy at or below this price"
    For shorts: entry_price means "sell at or above this price"
    Zone triggers: price must be within [low, high]
    """
    if entry.entry_price is not None:
        if entry.side == "long":
            return current_price <= entry.entry_price
        else:
            return current_price >= entry.entry_price

    if entry.entry_zone_low is not None and entry.entry_zone_high is not None:
        return entry.entry_zone_low <= current_price <= entry.entry_zone_high

    return False


def persist_staged_entries(
    entries: dict[str, StagedEntry],
    path: Path,
) -> None:
    """Atomic write of staged entries to disk.

    Follows the same pattern as _persist_mechanical_state() in daemon.py.
    """
    try:
        from hynous.core.persistence import _atomic_write
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {did: asdict(e) for did, e in entries.items() if e.status == "active"}
        _atomic_write(path, json.dumps(data, indent=2))
    except Exception as exc:
        log.debug("Failed to persist staged entries: %s", exc)


def load_staged_entries(path: Path) -> dict[str, StagedEntry]:
    """Load staged entries from disk, filtering expired ones.

    Follows the same pattern as _load_mechanical_state() in daemon.py.
    """
    if not path.exists():
        return {}

    try:
        raw = json.loads(path.read_text())
        now = time.time()
        entries = {}
        for did, data in raw.items():
            entry = StagedEntry(**data)
            if entry.status == "active" and entry.expires_at > now:
                entries[did] = entry
            else:
                log.debug("Skipping expired/inactive staged entry: %s", did)
        if entries:
            log.info("Loaded %d active staged entries from disk", len(entries))
        return entries
    except Exception as exc:
        log.debug("Failed to load staged entries: %s", exc)
        return {}
```

---

## Step 4.2: Create stage_trade Tool

**New file:** `src/hynous/intelligence/tools/stage_trade.py`

Follow the exact pattern of `trading.py` — TOOL_DEF dict, handler function, register function.

**TOOL_DEF:**
```python
TOOL_DEF = {
    "type": "function",
    "function": {
        "name": "stage_trade",
        "description": (
            "Pre-stage a trade entry for mechanical execution. "
            "The daemon fires the entry when price hits the target zone "
            "AND the composite entry score still meets the minimum threshold. "
            "Use this when you see a setup developing but price hasn't reached "
            "your entry level yet. Eliminates LLM thinking delay at execution time."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "Asset code (BTC, ETH, SOL)"},
                "side": {"type": "string", "enum": ["long", "short"]},
                "entry_price": {
                    "type": "number",
                    "description": "Exact trigger price. For longs: buy at or below. For shorts: sell at or above.",
                },
                "entry_zone_low": {"type": "number", "description": "Low end of entry zone (alternative to exact price)"},
                "entry_zone_high": {"type": "number", "description": "High end of entry zone"},
                "leverage": {"type": "integer", "description": "5-20x"},
                "stop_loss": {"type": "number", "description": "Price where thesis is wrong"},
                "take_profit": {"type": "number", "description": "Price where profit is taken"},
                "confidence": {"type": "number", "description": "0.0-1.0 conviction"},
                "reasoning": {"type": "string", "description": "Full thesis (stored in memory on fill)"},
                "trade_type": {"type": "string", "enum": ["macro", "micro"], "default": "macro"},
                "expires_minutes": {
                    "type": "number",
                    "description": "Directive lifetime in minutes. Default: 10 for micro, 30 for macro.",
                },
                "min_entry_score": {
                    "type": "number",
                    "description": "Minimum composite score at trigger time. Default: 40.",
                },
            },
            "required": ["symbol", "side", "leverage", "stop_loss", "take_profit", "confidence", "reasoning"],
        },
    },
}
```

**Handler function:** Validate all trade parameters using the same checks as `execute_trade()` — R:R floor, leverage coherence, portfolio risk cap, micro SL/TP bounds — but against the target entry price (not current market price). Do NOT place any orders. Create a `StagedEntry`, add to `daemon._staged_entries`, persist, and return a confirmation message.

**Register function:**
```python
def register(registry):
    from ...core.types import Tool
    registry.register(Tool(
        name="stage_trade",
        description=TOOL_DEF["function"]["description"],
        parameters=TOOL_DEF["function"]["parameters"],
        handler=handle_stage_trade,
        background=False,
    ))
```

**Register in registry.py** — add after the `trading` import (around line 140):
```python
    from . import stage_trade
    stage_trade.register(registry)
```

---

## Step 4.3: Daemon Evaluation Loop

**File:** `src/hynous/intelligence/daemon.py`

### 4.3a: Initialize state

After `_latest_predictions` init (line 434 area), add:

```python
        self._staged_entries: dict[str, StagedEntry] = {}
```

### 4.3b: Load on startup

After `_load_mechanical_state()` call (find it in the startup sequence), add:

```python
        from .staged_entries import load_staged_entries
        _staged_path = self.config.project_root / "storage" / "staged_entries.json"
        self._staged_entries = load_staged_entries(_staged_path)
```

### 4.3c: Add _check_staged_entries() to _fast_trigger_check()

**Location:** Inside `_fast_trigger_check()`, after all mechanical exit checks (trailing stop Phase 3, small wins, etc.) and before the method returns. The staged entry check runs at the same frequency as exit checks (~1s).

```python
        # ── Staged entry evaluation ──
        if self._staged_entries:
            self._evaluate_staged_entries(prices)
```

### 4.3d: Implement _evaluate_staged_entries()

Add this method to the daemon class. Follow the same pattern as trailing stop Phase 3 (check condition → execute → update state → persist):

```python
    def _evaluate_staged_entries(self, prices: dict[str, float]) -> None:
        """Evaluate staged entry directives against live WS prices.

        Called every ~1s from _fast_trigger_check(). Executes entries
        mechanically when price trigger + composite score are both satisfied.
        """
        from .staged_entries import evaluate_trigger, persist_staged_entries

        now = time.time()
        to_remove = []
        ts = get_trading_settings()

        for did, entry in list(self._staged_entries.items()):
            # Check expiry
            if now >= entry.expires_at:
                entry.status = "expired"
                to_remove.append(did)
                logger.info("Staged entry expired: %s %s %s", entry.coin, entry.side, did)
                continue

            # Check price trigger
            price = prices.get(entry.coin)
            if not price:
                continue

            if not evaluate_trigger(entry, price):
                continue

            # Re-verify composite score at trigger time
            with self._latest_predictions_lock:
                _pred = dict(self._latest_predictions.get(entry.coin, {}))
            current_score = _pred.get("entry_score", 0)
            if current_score < entry.min_entry_score:
                # Don't cancel — score may recover. Just skip this tick.
                continue

            # Re-verify safety gates
            if self._trading_paused:
                continue
            if entry.coin.upper() in self._prev_positions:
                entry.status = "cancelled"
                to_remove.append(did)
                logger.info("Staged entry cancelled (position exists): %s", did)
                continue
            if len(self._prev_positions) >= ts.max_open_positions:
                continue

            # EXECUTE
            self._execute_staged_entry(entry, price)
            to_remove.append(did)

        for did in to_remove:
            self._staged_entries.pop(did, None)

        if to_remove:
            _path = self.config.project_root / "storage" / "staged_entries.json"
            persist_staged_entries(self._staged_entries, _path)
```

### 4.3e: Implement _execute_staged_entry()

Follow the same execution pattern as the trailing stop Phase 3 market_close, but for opening:

```python
    def _execute_staged_entry(self, entry: StagedEntry, trigger_price: float) -> None:
        """Execute a staged entry via provider. Mechanical — no LLM."""
        try:
            provider = self._get_provider()
            ts = get_trading_settings()

            # Set leverage
            provider.update_leverage(entry.coin, entry.leverage)

            # Compute size from conviction (same formula as trading.py)
            try:
                state = provider.get_user_state()
                portfolio = state.get("account_value", 1000)
            except Exception:
                portfolio = 1000

            if entry.confidence >= 0.8:
                margin = portfolio * (ts.tier_high_margin_pct / 100)
            elif entry.confidence >= 0.6:
                margin = portfolio * (ts.tier_medium_margin_pct / 100)
            else:
                margin = portfolio * (ts.tier_speculative_margin_pct / 100)

            size_usd = margin * entry.leverage
            size_usd = min(size_usd, ts.max_position_usd)

            # Execute market order
            is_buy = entry.side == "long"
            result = provider.market_open(
                entry.coin, is_buy, size_usd,
                self._config.hyperliquid.default_slippage,
            )

            if result.get("status") != "filled" or not result.get("fillSz"):
                logger.warning("Staged entry fill failed: %s %s", entry.coin, result)
                return

            fill_px = float(result.get("avgPx", trigger_price))
            entry.status = "filled"
            entry.fill_price = fill_px
            entry.fill_time = time.time()

            # Place SL/TP triggers (same as trading tool)
            try:
                if entry.stop_loss:
                    provider.place_trigger_order(
                        entry.coin, not is_buy, entry.stop_loss,
                        size=float(result["fillSz"]), reduce_only=True,
                    )
                if entry.take_profit:
                    provider.place_trigger_order(
                        entry.coin, not is_buy, entry.take_profit,
                        size=float(result["fillSz"]), reduce_only=True,
                    )
            except Exception:
                logger.debug("Failed to place staged entry triggers", exc_info=True)

            # Record entry (same as daemon.record_trade_entry())
            self.record_trade_entry()
            self.register_position_type(entry.coin, entry.trade_type)

            # Store trade memory in background
            threading.Thread(
                target=self._store_staged_trade_memory,
                args=(entry, fill_px, size_usd),
                name="hynous-staged-memory",
                daemon=True,
            ).start()

            # Notify Discord
            latency_ms = (time.time() - entry.created_at) * 1000
            self._notify_discord_simple(
                f"STAGED ENTRY FILLED: {entry.coin} {entry.side.upper()} "
                f"@ ${fill_px:,.2f} ({entry.leverage}x) "
                f"| staged {(time.time() - entry.created_at) / 60:.1f}min ago"
            )

            logger.info(
                "Staged entry filled: %s %s @ %.2f (size=$%.0f, staged %.0fs ago)",
                entry.coin, entry.side, fill_px, size_usd,
                time.time() - entry.created_at,
            )

        except Exception:
            logger.exception("Staged entry execution failed: %s", entry.directive_id)
```

### 4.3f: Implement _store_staged_trade_memory()

Stores a `custom:trade_entry` node in Nous, same as the trading tool's `_store_trade_memory()`. Study `trading.py` around line 1177 for the exact Nous node structure.

---

## Step 4.4: Update System Prompt

**File:** `src/hynous/intelligence/prompts/builder.py`

**Location:** TOOL_STRATEGY section (lines 217-290). Add after the `execute_trade` description:

```
**stage_trade vs execute_trade:**
- `execute_trade` = enter RIGHT NOW at market price. Use when I see a signal and want immediate execution.
- `stage_trade` = pre-stage an entry at a target price/zone. The daemon fires it mechanically in <1s when price arrives. Use when I see a setup developing but price hasn't reached my ideal entry level.
- Staged entries auto-expire (default: 10min for micro, 30min for macro).
- The composite entry score must still meet min_entry_score when the trigger fires — if conditions degrade, the entry won't fire.
- Each wake: I review active staged entries — confirm, cancel, or stage new ones.
- Active staged entries are shown in my briefing under [Staged Entries].
```

---

## Step 4.5: Show Staged Entries in Wake Context

**File:** `src/hynous/intelligence/daemon.py`

**Location:** In `_wake_agent()` (around line 5719 where the message is assembled), add after the position awareness block:

```python
            # Active staged entries
            if self._staged_entries:
                staged_lines = []
                for e in self._staged_entries.values():
                    if e.status != "active":
                        continue
                    ttl_min = (e.expires_at - time.time()) / 60
                    age_min = (time.time() - e.created_at) / 60
                    price_str = (
                        f"@ ${e.entry_price:,.2f}"
                        if e.entry_price
                        else f"zone ${e.entry_zone_low:,.2f}-${e.entry_zone_high:,.2f}"
                    )
                    staged_lines.append(
                        f"  STAGED: {e.coin} {e.side.upper()} {price_str} "
                        f"| SL ${e.stop_loss:,.2f} TP ${e.take_profit:,.2f} "
                        f"| {e.leverage}x | {e.confidence:.0%} "
                        f"| expires {ttl_min:.0f}min | min_score={e.min_entry_score:.0f}"
                    )
                if staged_lines:
                    parts.append("[Staged Entries]\n" + "\n".join(staged_lines))
```

---

## Verification

1. **Stage via chat:** Ask agent to `stage_trade` for BTC long at a price slightly below current. Verify:
   - `_staged_entries` has the directive.
   - `storage/staged_entries.json` persisted.
   - Next wake shows the staged entry in context.

2. **Price trigger:** Set entry price near current market (within 0.1%). Wait for price to cross. Verify:
   - Daemon detects trigger in `_fast_trigger_check()` within 1-2s.
   - Order fills mechanically.
   - SL/TP placed.
   - Discord notification sent.
   - Trade memory stored.

3. **Score re-verification:** Stage entry, then wait for composite score to drop below min_entry_score (or temporarily set min_entry_score very high). Verify entry does NOT fire even when price triggers.

4. **Expiry:** Stage with `expires_minutes: 1`. Wait 60s. Verify directive expires and is removed from `_staged_entries` + JSON.

5. **Safety gates:** Stage when at max open positions. Verify it doesn't fire. Stage for a coin already held. Verify it cancels.

6. **Restart persistence:** Stage entry, restart daemon, verify entry reloads and remains active (if not expired).

7. **All tests pass:** `PYTHONPATH=src pytest tests/ -x && PYTHONPATH=. pytest satellite/tests/ -x`

---

Last updated: 2026-03-22
