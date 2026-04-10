# Phase 1 — Data Capture Expansion

> **Prerequisites:** Phase 0 complete and accepted. `00-master-plan.md`, `01-pre-implementation-reading.md`, `02-testing-standards.md` read in full.
>
> **Phase goal:** Establish the complete data capture pipeline that feeds the v2 journal. Every trade entry captures an exhaustive snapshot. Every mechanical exit event is logged as a lifecycle event. Every exit captures a full trade outcome with counterfactuals and ML comparison. This is the data backbone that makes the LLM analysis agent possible.
>
> **What this phase does NOT do:** create the journal module (phase 2), delete old code (phase 4), modify the entry decision path (phase 5). Phase 1 only adds data capture alongside existing behavior.

---

## Context

The LLM analysis agent in phase 3 will be asked to produce evidence-backed narratives about closed trades. Its output quality is bounded by the data we capture at trade time. The current v1 system stores a sparse `trade_entry` node in Nous with thesis text + a few fields. That's not enough for the analysis agent to operate on; it would fall back to hallucination.

Phase 1 builds the data pipeline before we build the analysis agent. Every piece of data that could matter for reconstructing what happened during a trade must be captured and stored with the trade. This includes:

- **Entry context** — the full ML signal state, market state, derivatives state, liquidation terrain, order flow, HLP/whale context, time/session, account state, settings snapshot, and preceding price path at the moment the trade fills
- **Lifecycle events** — every mechanical state mutation during the hold (dynamic SL placed, fee-BE set, trail activated, trail updated, peak ROE new, vol regime change) emitted as a discrete event row
- **Exit context** — the full ML signal state at exit (for entry-vs-exit comparison), the ROE trajectory summary, the exit classification, counterfactuals (MFE/MAE, did TP hit later, did price reverse after SL)
- **Price path** — 1m candles from entry to exit + 4h preceding context + counterfactual window after exit

The capture lives in a staging area during phase 1 (a temporary SQLite file under `storage/v2/`) that phase 2 will upgrade to the real journal. This isolation lets phase 1 be validated end-to-end without waiting for the full journal module.

Importantly, phase 1 does NOT disable or alter any v1 behavior. The existing `execute_trade` gates still run, the existing Nous memory storage still fires, the existing mechanical exit loop is untouched. Phase 1 adds a parallel capture layer alongside existing code. Phase 4 deletes the v1 paths.

---

## Required Reading for This Phase

In addition to the base reading list from `01-pre-implementation-reading.md`, phase 1 engineers must have absorbed:

1. **`src/hynous/intelligence/tools/trading.py` lines 511–1231** — the full `handle_execute_trade` function. Understand every gate, every state dict access, every exchange call.
2. **`src/hynous/intelligence/daemon.py` lines 2147–2700** — the full `_fast_trigger_check` function including all three mechanical exit layers (Dynamic SL, Fee-BE, Trailing v3) and Phase 3 trigger checks.
3. **`src/hynous/intelligence/daemon.py` lines 4425–4487** — `_persist_mechanical_state` and `_load_mechanical_state`. You'll model the lifecycle event persistence similarly.
4. **`src/hynous/intelligence/daemon.py` lines 3436–3454** — `_override_sl_classification`. This is the exit classification logic that maps generic "stop_loss" events to their specific type. Your exit capture must integrate with this.
5. **`src/hynous/intelligence/daemon.py` lines 1361–1540** — `_poll_derivatives`. This is where ML predictions get loaded into `_latest_predictions`. Understand what's in that dict.
6. **`src/hynous/intelligence/daemon.py` lines 2930–3050** — `_update_peaks_from_candles`. Candle-based peak tracking. You'll emit `peak_roe_new` events from here too.
7. **`satellite/conditions.py`** full read — understand the `MarketConditions` and `ConditionPrediction` dataclasses so you know the shape of data in `_latest_predictions[symbol]`.
8. **`satellite/inference.py`** full read — understand what `_latest_predictions[symbol]` contains (signal, long_roe, short_roe, shap values, components).
9. **`satellite/entry_score.py`** full read — the composite entry score and its components.
10. **`src/hynous/data/providers/paper.py`** — `check_triggers()` method specifically. Understand what event dicts it emits and what fields they have.
11. **`src/hynous/core/request_tracer.py`** — the existing trace span system. You'll NOT use it for lifecycle events (those go to the journal), but understand that trace spans and lifecycle events are separate concerns.

---

## Scope

### In Scope

- **Step 0: create `scripts/run_daemon.py`** — the phase 0 engineer discovered this file does not exist despite being referenced by Makefile, CLAUDE.md, and every phase plan. Phase 1 creates it as a proper standalone entry point (see master plan Amendment 1).
- A new `src/hynous/journal/schema.py` containing all dataclass definitions for entry/exit snapshots, events, and the staging table DDL. This file is shared with phase 2 — phase 2 will add the real journal tables alongside the staging table.
- A new `src/hynous/journal/staging_store.py` containing a thin SQLite wrapper for the phase 1 staging table (`trade_events_staging` and `trade_snapshots_staging`). Phase 2 deletes this in favor of the full journal store.
- A new `src/hynous/journal/capture.py` containing the capture builder helpers: `build_entry_snapshot(...)`, `build_exit_snapshot(...)`, `emit_lifecycle_event(...)`.
- Modifications to `src/hynous/intelligence/tools/trading.py` to call `capture.build_entry_snapshot()` and persist it alongside the existing Nous store (both paths active in parallel).
- Modifications to `src/hynous/intelligence/daemon.py` to emit lifecycle events at every mechanical state mutation point.
- Modifications to `src/hynous/intelligence/daemon.py` to build and persist an exit snapshot when a trade closes (in the existing trigger-close path).
- Counterfactual computation helpers in `src/hynous/journal/counterfactuals.py`.
- Unit tests for every new function.
- Integration test covering a full mocked trade lifecycle (entry → events → exit → counterfactual).

### Out of Scope

- The full journal module with nodes/edges/patterns (phase 2)
- Any LLM interaction (phase 3)
- Any deletion of v1 code paths (phase 4)
- Any entry decision refactoring (phase 5)
- Dashboard changes (phase 7)
- Backfilling historical trades (no migration — fresh start per plan)

---

## Step 0: Create `scripts/run_daemon.py`

Phase 0's smoke test instructions referenced `python -m scripts.run_daemon` but the file didn't exist. Phase 0 engineer used an inline runner. Phase 1 creates the real file so every subsequent phase can rely on a consistent smoke test command.

The file is a minimal standalone entry point that loads config, constructs the agent and daemon, and idles safely with clean shutdown on Ctrl-C. It does NOT start the Reflex dashboard. It does NOT start a web server. It is purely the daemon subsystem for smoke testing.

**Create `scripts/run_daemon.py` with this content:**

```python
"""Standalone daemon runner for smoke tests and development.

In v1 the daemon runs in-process inside the Reflex dashboard
(scripts/run_dashboard.py). This script exists so phase smoke tests can
exercise the daemon subsystem without booting the full Reflex stack.

Usage:
    python -m scripts.run_daemon [--duration <seconds>]

By default runs until Ctrl-C. With --duration, exits cleanly after N seconds
(useful for automated smoke tests: `timeout 300 python -m scripts.run_daemon`
is equivalent to `python -m scripts.run_daemon --duration 300`).
"""

from __future__ import annotations

import argparse
import logging
import signal
import sys
import time
from typing import Any

logger = logging.getLogger(__name__)


def _setup_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-5s %(name)s: %(message)s",
        stream=sys.stdout,
    )


def _build_daemon() -> tuple[Any, Any]:
    """Construct Agent + Daemon the same way the Reflex dashboard does.

    Returns (agent, daemon). Imports happen inside the function so
    `python -m scripts.run_daemon --help` works without a full env.
    """
    from hynous.core.config import load_config
    from hynous.intelligence.agent import Agent
    from hynous.intelligence.daemon import HynousDaemon
    
    cfg = load_config()
    logger.info("config loaded: mode=%s", cfg.execution.mode)
    
    agent = Agent(config=cfg)
    logger.info("agent constructed: model=%s", cfg.agent.model)
    
    daemon = HynousDaemon(agent=agent, config=cfg)
    logger.info("daemon constructed")
    
    return agent, daemon


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the Hynous daemon (standalone)")
    parser.add_argument(
        "--duration",
        type=int,
        default=0,
        help="Exit cleanly after N seconds (0 = run until Ctrl-C)",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    args = parser.parse_args()
    
    _setup_logging(getattr(logging, args.log_level))
    
    try:
        agent, daemon = _build_daemon()
    except Exception:
        logger.exception("daemon construction failed")
        return 1
    
    # Graceful shutdown handler
    _stop = {"flag": False}
    def _handle_signal(signum: int, frame: Any) -> None:
        logger.info("received signal %s, stopping", signum)
        _stop["flag"] = True
    
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)
    
    # Start the daemon's internal loop if the class exposes one.
    # HynousDaemon.start() is the v1 API; if it changes, update here.
    if hasattr(daemon, "start"):
        try:
            daemon.start()
            logger.info("daemon.start() called")
        except Exception:
            logger.exception("daemon.start() failed")
            return 1
    
    # Idle heartbeat loop
    started = time.monotonic()
    last_heartbeat = started
    logger.info("daemon running (duration=%s)", args.duration or "infinite")
    
    try:
        while not _stop["flag"]:
            time.sleep(1)
            now = time.monotonic()
            if now - last_heartbeat >= 60:
                logger.info("heartbeat: %.0fs elapsed", now - started)
                last_heartbeat = now
            if args.duration > 0 and (now - started) >= args.duration:
                logger.info("duration reached, stopping")
                break
    except KeyboardInterrupt:
        logger.info("keyboard interrupt, stopping")
    
    # Graceful stop
    if hasattr(daemon, "stop"):
        try:
            daemon.stop()
            logger.info("daemon.stop() called")
        except Exception:
            logger.exception("daemon.stop() raised (continuing)")
    
    elapsed = time.monotonic() - started
    logger.info("run_daemon complete: %.0fs elapsed, no fatal errors", elapsed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

**Adapt to reality before committing.** The phase 0 engineer's report shows that `HynousDaemon(agent=..., config=...)` is the constructor shape (they used this in their inline runner) and `daemon.start()` / `daemon.stop()` are the lifecycle methods. Verify these against the current `daemon.py` before writing the file — if the constructor signature has drifted, adjust. If `start()` doesn't exist, the daemon may initialize in its `__init__` and be idle-safe without an explicit start. In that case, just skip the `daemon.start()` call and rely on the idle loop to keep the process alive.

**Test it yourself before committing:**

```bash
# Short smoke run
python -m scripts.run_daemon --duration 10
# Expected: clean startup logs, one heartbeat at best, clean shutdown

# Help text
python -m scripts.run_daemon --help
# Expected: argparse help, no imports triggered
```

After committing, phase 1's smoke test section (below) uses this command verbatim.

---

## Entry Snapshot Specification

The entry snapshot is a single JSON-serializable blob capturing everything known at the moment a trade fills. It's built by `capture.build_entry_snapshot()` inside `handle_execute_trade` after the fill is confirmed (after line 1113 in current `trading.py`).

### Dataclass definition

```python
# src/hynous/journal/schema.py

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class TradeBasics:
    """Core identification + fill details."""
    trade_id: str              # UUID, generated at snapshot time
    symbol: str                # "BTC"
    side: str                  # "long" | "short"
    trade_type: str            # "macro" | "micro"
    entry_ts: str              # ISO 8601 UTC
    entry_px: float            # filled price
    sl_px: float | None
    tp_px: float | None
    leverage: int
    size_base: float           # e.g. 0.05 (BTC amount)
    size_usd: float            # notional in USD
    margin_usd: float          # size_usd / leverage
    fill_slippage_bps: float   # (fill_px - ref_px) / ref_px * 10000
    fees_paid_usd: float       # taker fee estimate at entry


@dataclass(slots=True)
class TriggerContext:
    """What caused this entry to fire."""
    trigger_source: str        # "scanner" | "ml_signal" | "manual" | "mechanical"
    trigger_type: str          # e.g. "book_flip" | "momentum" | "composite_score" | "direction_model"
    wake_source_id: str | None # daemon wake id for tracing back (None if manual)
    scanner_score: float | None
    scanner_detail: dict[str, Any]  # the raw anomaly dict if applicable


@dataclass(slots=True)
class MLSnapshot:
    """Complete ML signal state at entry."""
    # Composite entry score
    composite_entry_score: float | None
    composite_label: str | None      # "strong" | "moderate" | "weak" | "unfavorable"
    composite_components: dict[str, float]  # sub-scores

    # Entry quality model
    entry_quality_value: float | None
    entry_quality_percentile: int | None
    entry_quality_regime: str | None

    # Volatility models
    vol_1h_value: float | None
    vol_1h_percentile: int | None
    vol_1h_regime: str | None   # "low" | "normal" | "high" | "extreme"
    vol_4h_value: float | None
    vol_4h_percentile: int | None
    vol_4h_regime: str | None
    vol_expand_value: float | None
    vol_expand_regime: str | None
    vol_of_vol_value: float | None

    # Range / move models
    range_30m_value: float | None
    range_30m_regime: str | None
    move_30m_value: float | None
    move_30m_regime: str | None

    # Volume model
    volume_1h_value: float | None
    volume_1h_regime: str | None

    # Momentum model
    momentum_quality_value: float | None
    momentum_quality_regime: str | None

    # MAE models
    mae_long_value: float | None   # predicted adverse excursion for long, in ROE%
    mae_long_percentile: int | None
    mae_long_regime: str | None
    mae_short_value: float | None
    mae_short_percentile: int | None
    mae_short_regime: str | None

    # SL survival models
    sl_survival_03: float | None   # probability of 0.3% stop being hit in 30min
    sl_survival_05: float | None   # probability of 0.5% stop being hit in 30min

    # Funding model
    funding_4h_value: float | None
    funding_4h_percentile: int | None
    funding_4h_regime: str | None

    # Direction model
    direction_signal: str | None          # "long" | "short" | "skip" | "conflict"
    direction_long_roe: float | None      # predicted ROE for long
    direction_short_roe: float | None     # predicted ROE for short
    direction_shap_top5: list[dict[str, Any]]  # top 5 SHAP contributors per side

    # Metadata
    predictions_timestamp: float | None   # when the ML cache was last refreshed
    predictions_staleness_s: float | None # time.time() - predictions_timestamp


@dataclass(slots=True)
class MarketState:
    """Market data at entry."""
    mid_price: float
    bid: float | None
    ask: float | None
    spread_bps: float | None
    best_bid_size: float | None
    best_ask_size: float | None
    book_imbalance: float | None    # (bid_depth - ask_depth) / (bid_depth + ask_depth)
    depth_usd_20bp_bid: float | None
    depth_usd_20bp_ask: float | None

    # Price changes
    pct_change_1m: float | None
    pct_change_5m: float | None
    pct_change_15m: float | None
    pct_change_1h: float | None
    pct_change_4h: float | None
    pct_change_24h: float | None

    # Volume
    volume_1h_usd: float | None
    volume_4h_usd: float | None
    volume_24h_usd: float | None

    # Volatility (realized)
    realized_vol_1h_pct: float | None
    realized_vol_4h_pct: float | None


@dataclass(slots=True)
class DerivativesState:
    """Derivatives metrics at entry."""
    funding_rate: float | None              # current funding rate
    funding_8h_cumulative: float | None     # sum of last 8 hourly rates
    hours_to_next_funding: float | None     # float hours
    open_interest: float | None             # OI in USD
    oi_change_1h_pct: float | None
    oi_change_4h_pct: float | None
    oi_zscore_30d: float | None             # (current - 30d mean) / 30d std
    cross_exchange_oi_usd: float | None     # from Coinglass if available


@dataclass(slots=True)
class LiquidationTerrain:
    """Liquidation clusters at entry."""
    clusters_above: list[dict[str, Any]]    # up to 5, each {price, size_usd, confidence}
    clusters_below: list[dict[str, Any]]    # up to 5
    total_1h_long_liq_usd: float | None
    total_1h_short_liq_usd: float | None
    total_4h_long_liq_usd: float | None
    total_4h_short_liq_usd: float | None
    liq_ratio_1h: float | None              # short/long ratio
    cascade_active: bool                     # from satellite features


@dataclass(slots=True)
class OrderFlowState:
    """Order flow metrics from data-layer at entry."""
    cvd_30m: float | None
    cvd_1h: float | None
    cvd_acceleration: float | None
    buy_sell_ratio_1m: float | None
    buy_sell_ratio_5m: float | None
    buy_sell_ratio_15m: float | None
    buy_sell_ratio_1h: float | None
    large_trade_count_1h: int | None        # count of trades > 1% hourly volume


@dataclass(slots=True)
class SmartMoneyContext:
    """HLP and whale context at entry."""
    hlp_net_delta_usd: float | None
    hlp_side: str | None                     # "long" | "short" | "flat"
    hlp_size_usd: float | None
    top_whale_positions: list[dict[str, Any]]  # up to 5
    smart_money_opens_1h: int                # count of tracked wallets opening on this coin in last hour


@dataclass(slots=True)
class TimeContext:
    """Temporal context at entry."""
    hour_utc: int                # 0-23
    day_of_week: int             # 0=Monday, 6=Sunday
    session: str                 # "asia" | "eu" | "us" | "overlap_asia_eu" | "overlap_eu_us" | "off_hours"
    time_to_next_funding_s: int  # seconds


@dataclass(slots=True)
class AccountContext:
    """Account state at entry."""
    portfolio_value_usd: float
    portfolio_initial_usd: float
    daily_pnl_so_far_usd: float
    open_positions_count: int
    open_position_symbols: list[str]
    entries_today_count: int
    trading_paused: bool


@dataclass(slots=True)
class SettingsSnapshot:
    """Reference to active trading settings at entry."""
    settings_hash: str   # SHA256 of trading_settings.json content (first 16 chars)
    settings_version: str | None  # If a version field exists


@dataclass(slots=True)
class PriceHistoryContext:
    """Preceding price path as candle lists."""
    candles_1m_15min: list[list[float]]  # last 15 1m candles: [[ts, o, h, l, c, v], ...]
    candles_5m_4h: list[list[float]]     # last 48 5m candles


@dataclass(slots=True)
class TradeEntrySnapshot:
    """Complete entry snapshot. Persisted as JSON in trade_entry_snapshots table."""
    trade_basics: TradeBasics
    trigger_context: TriggerContext
    ml_snapshot: MLSnapshot
    market_state: MarketState
    derivatives_state: DerivativesState
    liquidation_terrain: LiquidationTerrain
    order_flow_state: OrderFlowState
    smart_money_context: SmartMoneyContext
    time_context: TimeContext
    account_context: AccountContext
    settings_snapshot: SettingsSnapshot
    price_history: PriceHistoryContext
    schema_version: str = "1.0.0"  # bump if the schema changes
```

### Builder function

```python
# src/hynous/journal/capture.py

from __future__ import annotations

import hashlib
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from .schema import (
    AccountContext,
    DerivativesState,
    LiquidationTerrain,
    MarketState,
    MLSnapshot,
    OrderFlowState,
    PriceHistoryContext,
    SettingsSnapshot,
    SmartMoneyContext,
    TimeContext,
    TradeBasics,
    TradeEntrySnapshot,
    TriggerContext,
)

logger = logging.getLogger(__name__)


def build_entry_snapshot(
    *,
    symbol: str,
    side: str,
    trade_type: str,
    fill_px: float,
    fill_sz: float,
    leverage: int,
    sl_px: float | None,
    tp_px: float | None,
    size_usd: float,
    reference_price: float,
    fees_paid_usd: float,
    daemon: Any,  # hynous.intelligence.daemon.HynousDaemon
    trigger_source: str = "manual",
    trigger_type: str = "unknown",
    wake_source_id: str | None = None,
    scanner_detail: dict[str, Any] | None = None,
    scanner_score: float | None = None,
) -> TradeEntrySnapshot:
    """Build a full entry snapshot from daemon state and the provided fill details.
    
    This must be called AFTER the order has filled and BEFORE returning from
    handle_execute_trade. It reads live state from the daemon (ML predictions,
    snapshot, account state, etc.) and assembles a complete TradeEntrySnapshot.
    
    Any data that is unavailable (e.g. data-layer is down) is set to None.
    The snapshot is still persisted; downstream analysis can see what was missing.
    """
    now_ts = datetime.now(timezone.utc).isoformat()
    trade_id = _generate_trade_id(symbol, now_ts)

    # Basics
    margin_usd = size_usd / leverage if leverage > 0 else size_usd
    slippage_bps = (
        (fill_px - reference_price) / reference_price * 10000 if reference_price > 0 else 0.0
    )
    basics = TradeBasics(
        trade_id=trade_id,
        symbol=symbol,
        side=side,
        trade_type=trade_type,
        entry_ts=now_ts,
        entry_px=fill_px,
        sl_px=sl_px,
        tp_px=tp_px,
        leverage=leverage,
        size_base=fill_sz,
        size_usd=size_usd,
        margin_usd=margin_usd,
        fill_slippage_bps=slippage_bps,
        fees_paid_usd=fees_paid_usd,
    )

    # Trigger context
    trigger_ctx = TriggerContext(
        trigger_source=trigger_source,
        trigger_type=trigger_type,
        wake_source_id=wake_source_id,
        scanner_score=scanner_score,
        scanner_detail=scanner_detail or {},
    )

    # ML snapshot
    ml_snapshot = _build_ml_snapshot(daemon, symbol)

    # Market state
    market_state = _build_market_state(daemon, symbol, fill_px)

    # Derivatives state
    derivatives_state = _build_derivatives_state(daemon, symbol)

    # Liquidation terrain
    liquidation_terrain = _build_liquidation_terrain(daemon, symbol, fill_px)

    # Order flow state
    order_flow_state = _build_order_flow_state(daemon, symbol)

    # Smart money context
    smart_money_context = _build_smart_money_context(daemon, symbol)

    # Time context
    time_context = _build_time_context()

    # Account context
    account_context = _build_account_context(daemon)

    # Settings snapshot
    settings_snapshot = _build_settings_snapshot()

    # Price history
    price_history = _build_price_history(daemon, symbol)

    return TradeEntrySnapshot(
        trade_basics=basics,
        trigger_context=trigger_ctx,
        ml_snapshot=ml_snapshot,
        market_state=market_state,
        derivatives_state=derivatives_state,
        liquidation_terrain=liquidation_terrain,
        order_flow_state=order_flow_state,
        smart_money_context=smart_money_context,
        time_context=time_context,
        account_context=account_context,
        settings_snapshot=settings_snapshot,
        price_history=price_history,
    )


def _generate_trade_id(symbol: str, ts: str) -> str:
    """UUID-based trade id for unique identification across restarts."""
    return f"trade_{uuid.uuid4().hex[:16]}"


def _build_ml_snapshot(daemon: Any, symbol: str) -> MLSnapshot:
    """Read daemon._latest_predictions[symbol] and build an MLSnapshot.
    
    Gracefully handles missing data: every field becomes None if not available.
    """
    with daemon._latest_predictions_lock:
        preds = dict(daemon._latest_predictions.get(symbol, {}))
    conditions = preds.get("conditions", {})
    ts = conditions.get("timestamp", 0)
    now = time.time()
    staleness = now - ts if ts > 0 else None

    def _get_cond_field(cond_name: str, field_name: str, default=None):
        return conditions.get(cond_name, {}).get(field_name, default)

    return MLSnapshot(
        composite_entry_score=preds.get("_entry_score"),
        composite_label=preds.get("_entry_score_label"),
        composite_components=preds.get("_entry_score_components", {}),
        entry_quality_value=_get_cond_field("entry_quality", "value"),
        entry_quality_percentile=_get_cond_field("entry_quality", "percentile"),
        entry_quality_regime=_get_cond_field("entry_quality", "regime"),
        vol_1h_value=_get_cond_field("vol_1h", "value"),
        vol_1h_percentile=_get_cond_field("vol_1h", "percentile"),
        vol_1h_regime=_get_cond_field("vol_1h", "regime"),
        vol_4h_value=_get_cond_field("vol_4h", "value"),
        vol_4h_percentile=_get_cond_field("vol_4h", "percentile"),
        vol_4h_regime=_get_cond_field("vol_4h", "regime"),
        vol_expand_value=_get_cond_field("vol_expand", "value"),
        vol_expand_regime=_get_cond_field("vol_expand", "regime"),
        vol_of_vol_value=_get_cond_field("vol_of_vol", "value"),
        range_30m_value=_get_cond_field("range_30m", "value"),
        range_30m_regime=_get_cond_field("range_30m", "regime"),
        move_30m_value=_get_cond_field("move_30m", "value"),
        move_30m_regime=_get_cond_field("move_30m", "regime"),
        volume_1h_value=_get_cond_field("volume_1h", "value"),
        volume_1h_regime=_get_cond_field("volume_1h", "regime"),
        momentum_quality_value=_get_cond_field("momentum_quality", "value"),
        momentum_quality_regime=_get_cond_field("momentum_quality", "regime"),
        mae_long_value=_get_cond_field("mae_long", "value"),
        mae_long_percentile=_get_cond_field("mae_long", "percentile"),
        mae_long_regime=_get_cond_field("mae_long", "regime"),
        mae_short_value=_get_cond_field("mae_short", "value"),
        mae_short_percentile=_get_cond_field("mae_short", "percentile"),
        mae_short_regime=_get_cond_field("mae_short", "regime"),
        sl_survival_03=_get_cond_field("sl_survival_03", "value"),
        sl_survival_05=_get_cond_field("sl_survival_05", "value"),
        funding_4h_value=_get_cond_field("funding_4h", "value"),
        funding_4h_percentile=_get_cond_field("funding_4h", "percentile"),
        funding_4h_regime=_get_cond_field("funding_4h", "regime"),
        direction_signal=preds.get("signal"),
        direction_long_roe=preds.get("long_roe"),
        direction_short_roe=preds.get("short_roe"),
        direction_shap_top5=preds.get("shap_top5", []),
        predictions_timestamp=ts if ts > 0 else None,
        predictions_staleness_s=staleness,
    )


def _build_market_state(daemon: Any, symbol: str, fill_px: float) -> MarketState:
    """Read daemon snapshot + provider L2 book + candle-derived metrics."""
    provider = daemon._get_provider()
    bid = None
    ask = None
    spread_bps = None
    best_bid_size = None
    best_ask_size = None
    book_imbalance = None
    depth_bid = None
    depth_ask = None

    try:
        book = provider.get_l2_book(symbol)
        if book:
            bid = book.get("best_bid")
            ask = book.get("best_ask")
            if bid and ask and ask > 0:
                spread_bps = (ask - bid) / ask * 10000
            bids = book.get("bids", [])
            asks = book.get("asks", [])
            if bids:
                best_bid_size = bids[0].get("size")
            if asks:
                best_ask_size = asks[0].get("size")
            # Compute depth within 20bp of mid
            mid = (bid + ask) / 2 if (bid and ask) else fill_px
            depth_bid = _sum_depth_within_bps(bids, mid, 20, side="bid")
            depth_ask = _sum_depth_within_bps(asks, mid, 20, side="ask")
            total_depth = (depth_bid or 0) + (depth_ask or 0)
            if total_depth > 0:
                book_imbalance = ((depth_bid or 0) - (depth_ask or 0)) / total_depth
    except Exception:
        logger.debug("Failed to fetch L2 book for entry snapshot", exc_info=True)

    # Price changes from daemon snapshot cache (if available) or provider
    pct_changes = _compute_pct_changes(daemon, symbol, fill_px)

    # Volumes from daemon snapshot or context
    vol_1h = daemon.snapshot.volumes.get(symbol, {}).get("1h") if hasattr(daemon.snapshot, "volumes") else None
    vol_4h = daemon.snapshot.volumes.get(symbol, {}).get("4h") if hasattr(daemon.snapshot, "volumes") else None
    vol_24h = daemon.snapshot.volumes.get(symbol, {}).get("24h") if hasattr(daemon.snapshot, "volumes") else None

    # Realized vol from ML conditions (already computed)
    with daemon._latest_predictions_lock:
        preds = dict(daemon._latest_predictions.get(symbol, {}))
    cond = preds.get("conditions", {})
    realized_vol_1h = cond.get("vol_1h", {}).get("value") if cond else None
    realized_vol_4h = cond.get("vol_4h", {}).get("value") if cond else None

    return MarketState(
        mid_price=fill_px,
        bid=bid,
        ask=ask,
        spread_bps=spread_bps,
        best_bid_size=best_bid_size,
        best_ask_size=best_ask_size,
        book_imbalance=book_imbalance,
        depth_usd_20bp_bid=depth_bid,
        depth_usd_20bp_ask=depth_ask,
        pct_change_1m=pct_changes.get("1m"),
        pct_change_5m=pct_changes.get("5m"),
        pct_change_15m=pct_changes.get("15m"),
        pct_change_1h=pct_changes.get("1h"),
        pct_change_4h=pct_changes.get("4h"),
        pct_change_24h=pct_changes.get("24h"),
        volume_1h_usd=vol_1h,
        volume_4h_usd=vol_4h,
        volume_24h_usd=vol_24h,
        realized_vol_1h_pct=realized_vol_1h,
        realized_vol_4h_pct=realized_vol_4h,
    )


# Remaining builder functions follow the same pattern:
# - _build_derivatives_state: reads daemon.snapshot.funding, daemon.snapshot.oi_usd
# - _build_liquidation_terrain: calls daemon's data-layer client or satellite heatmap
# - _build_order_flow_state: reads from data-layer or cvd condition model
# - _build_smart_money_context: calls daemon's data-layer HLP and whale endpoints
# - _build_time_context: pure datetime computation
# - _build_account_context: reads daemon.trading_paused, daemon.entries_today,
#                          and calls provider.get_user_state()
# - _build_settings_snapshot: reads trading_settings.json, computes SHA256
# - _build_price_history: fetches candles via provider.get_candles() for 1m/5m
# 
# Each follows the graceful-degradation pattern: try to fetch, catch Exception,
# return None fields instead of raising.


def _sum_depth_within_bps(levels: list[dict], mid: float, bps: int, side: str) -> float:
    """Sum USD depth within N bps of mid on one side of the book."""
    threshold = mid * (1 - bps / 10000) if side == "bid" else mid * (1 + bps / 10000)
    total = 0.0
    for level in levels:
        px = level.get("price", 0)
        sz = level.get("size", 0)
        if side == "bid" and px < threshold:
            break
        if side == "ask" and px > threshold:
            break
        total += px * sz
    return total


def _compute_pct_changes(daemon: Any, symbol: str, current_px: float) -> dict[str, float | None]:
    """Compute % price change over 1m/5m/15m/1h/4h/24h using candle data."""
    out: dict[str, float | None] = {
        "1m": None, "5m": None, "15m": None,
        "1h": None, "4h": None, "24h": None,
    }
    provider = daemon._get_provider()
    # Try WS candles first (1m); fall back to REST for longer timeframes
    try:
        candles_1m = provider.get_candles(symbol, "1m") or []
        if candles_1m and len(candles_1m) >= 60:
            # Most recent candle is index -1 (possibly forming); compare against older
            now_px = candles_1m[-1].get("c", current_px)
            if len(candles_1m) >= 2:
                out["1m"] = _pct_diff(candles_1m[-2].get("c"), now_px)
            if len(candles_1m) >= 6:
                out["5m"] = _pct_diff(candles_1m[-6].get("c"), now_px)
            if len(candles_1m) >= 16:
                out["15m"] = _pct_diff(candles_1m[-16].get("c"), now_px)
            if len(candles_1m) >= 61:
                out["1h"] = _pct_diff(candles_1m[-61].get("c"), now_px)
    except Exception:
        pass
    # Use daemon snapshot cache for 4h/24h if available
    try:
        snap = daemon.snapshot
        if hasattr(snap, "pct_changes") and snap.pct_changes.get(symbol):
            changes = snap.pct_changes[symbol]
            out["4h"] = out.get("4h") or changes.get("4h")
            out["24h"] = out.get("24h") or changes.get("24h")
    except Exception:
        pass
    return out


def _pct_diff(old: float | None, new: float | None) -> float | None:
    if old is None or new is None or old == 0:
        return None
    return (new - old) / old * 100
```

### Testing notes for entry snapshot builder

- Every individual builder function (`_build_ml_snapshot`, `_build_market_state`, etc.) must have its own unit test with a mocked daemon fixture.
- Tests must cover: (a) happy path with full data available, (b) graceful degradation when specific fields are missing, (c) exception recovery when provider calls raise.
- The `build_entry_snapshot()` integration test must use a real daemon fixture in paper mode with a mocked `_latest_predictions` dict and verify every output field.

---

## Lifecycle Event Specification

Lifecycle events are discrete records emitted by the daemon every time a mechanical state mutation happens during a trade hold. They're the "proof" trail for the LLM analysis agent — the agent cannot claim "the trail activated at T+4min" without an event saying exactly that.

### Event types

| Event type | When emitted | Emitter line | Payload fields |
|------------|--------------|--------------|----------------|
| `dynamic_sl_placed` | Dynamic SL placed after position detection | daemon.py:2305, 2329 | `vol_regime`, `sl_roe_distance`, `sl_px`, `existing_sl_was_tighter` |
| `fee_be_set` | Fee-BE set when ROE clears threshold | daemon.py:2382, 2406 | `old_sl_px`, `new_sl_px`, `roe_at_trigger`, `buffer_pct`, `trade_type` |
| `peak_roe_new` | Peak ROE reached a new high | daemon.py:2245 | `peak_roe`, `price`, `ml_composite_score` |
| `trough_roe_new` | Trough ROE reached a new low | daemon.py:2247 | `trough_roe`, `price` |
| `trail_activated` | Trailing stop activated | daemon.py:2472 | `vol_regime`, `activation_roe`, `k_value`, `fee_be_roe` |
| `trail_updated` | Trail stop price updated | daemon.py:2542 | `peak_roe`, `old_trail_px`, `new_trail_px`, `retracement_pct`, `k_value`, `vol_regime` |
| `vol_regime_change` | Vol regime differs from previous check | new — emitted once per change | `old_regime`, `new_regime`, `at_ml_timestamp` |
| `sl_replaced` | SL cancel-and-replace cycle | all three layers | `reason` (dynamic_sl/fee_be/trail), `old_sl_px`, `new_sl_px` |
| `trade_exit` | Position closed by any path | daemon.py:2201 | `exit_px`, `exit_classification`, `realized_pnl_usd`, `peak_roe`, `trough_roe`, `hold_duration_s` |

### Event schema

```python
# src/hynous/journal/schema.py (add to existing file)

@dataclass(slots=True)
class LifecycleEvent:
    """A single mechanical event during a trade's hold."""
    event_id: int | None        # autoincrement from SQLite
    trade_id: str               # foreign key to trades table
    ts: str                     # ISO 8601 UTC
    event_type: str             # one of the types in the table above
    payload: dict[str, Any]     # event-type-specific fields
```

### Emitter helper

```python
# src/hynous/journal/capture.py (add to existing file)

def emit_lifecycle_event(
    *,
    journal_store: Any,   # StagingStore in phase 1, full JournalStore in phase 2
    trade_id: str,
    event_type: str,
    payload: dict[str, Any],
) -> None:
    """Emit a lifecycle event and persist it.
    
    Called from daemon.py at every mechanical state mutation point.
    Non-blocking: failures are logged and swallowed so a failed emit
    does not crash the trigger check loop.
    """
    try:
        from datetime import datetime, timezone
        now_ts = datetime.now(timezone.utc).isoformat()
        journal_store.insert_lifecycle_event(
            trade_id=trade_id,
            ts=now_ts,
            event_type=event_type,
            payload=payload,
        )
    except Exception:
        logger.exception(
            "Failed to emit lifecycle event type=%s for trade_id=%s",
            event_type, trade_id,
        )
```

### Emission points in daemon.py

Every line listed below needs a new `emit_lifecycle_event(...)` call immediately following the existing state mutation. **Do NOT modify the existing mutation logic** — only add the emission call after it.

Each emission site must resolve the `trade_id` from a new `daemon._open_trade_ids: dict[str, str]` mapping (symbol → trade_id) that phase 1 establishes alongside `_prev_positions`. The mapping is populated when `execute_trade` stores a new entry snapshot and cleared when a position closes.

**Example: dynamic SL placement emission at daemon.py:2329**

Current code:
```python
if result and result.get("status") == "trigger_placed":
    self._refresh_trigger_cache()
    self._dynamic_sl_set[sym] = True
    logger.info(
        "Dynamic SL placed: %s %s | %.2f ROE%% (%s vol) | SL @ $%.4f",
        sym, side, sl_roe, _vol_regime, sl_px,
    )
```

After phase 1 modification:
```python
if result and result.get("status") == "trigger_placed":
    self._refresh_trigger_cache()
    self._dynamic_sl_set[sym] = True
    logger.info(
        "Dynamic SL placed: %s %s | %.2f ROE%% (%s vol) | SL @ $%.4f",
        sym, side, sl_roe, _vol_regime, sl_px,
    )
    # v2 lifecycle event emission
    _trade_id = self._open_trade_ids.get(sym)
    if _trade_id and self._journal_store:
        from hynous.journal.capture import emit_lifecycle_event
        emit_lifecycle_event(
            journal_store=self._journal_store,
            trade_id=_trade_id,
            event_type="dynamic_sl_placed",
            payload={
                "vol_regime": _vol_regime,
                "sl_roe_distance": sl_roe,
                "sl_px": sl_px,
                "existing_sl_was_tighter": False,
                "side": side,
                "entry_px": entry_px,
                "leverage": leverage,
            },
        )
```

Apply this pattern at every emission point listed in the table above. The engineer must locate each exact line and add the emission **immediately after** the state mutation, not before. If the mutation happens inside a try/except, the emission belongs inside the success path.

### Complete list of daemon.py modifications

1. **daemon.py ~line 380 (`__init__` method):** add `self._open_trade_ids: dict[str, str] = {}` and `self._journal_store = None` to the state dict declarations (near `_prev_positions` initialization — check the exact init block line)

2. **daemon.py ~line 920 (daemon startup code):** after `_load_mechanical_state()` is called, add:
   ```python
   # v2: initialize staging journal store for data capture (phase 1)
   try:
       from hynous.journal.staging_store import StagingStore
       self._journal_store = StagingStore(
           db_path=self.config.v2.journal.db_path.replace("journal.db", "staging.db"),
       )
   except Exception:
       logger.exception("Failed to initialize v2 staging journal store")
       self._journal_store = None
   ```

3. **daemon.py line 2201** (position eviction after trigger close): before the `self._prev_positions.pop(event["coin"], None)` line, emit `trade_exit` event and clear the trade_id mapping:
   ```python
   for event in events:
       _trade_id = self._open_trade_ids.get(event["coin"])
       if _trade_id and self._journal_store:
           from hynous.journal.capture import emit_lifecycle_event
           # Compute hold duration + final peak/trough from state
           emit_lifecycle_event(
               journal_store=self._journal_store,
               trade_id=_trade_id,
               event_type="trade_exit",
               payload={
                   "exit_px": event["exit_px"],
                   "exit_classification": event["classification"],
                   "realized_pnl_usd": event["realized_pnl"],
                   "peak_roe": self._peak_roe.get(event["coin"], 0),
                   "trough_roe": self._trough_roe.get(event["coin"], 0),
                   "entry_px": event["entry_px"],
                   "side": event["side"],
               },
           )
       self._open_trade_ids.pop(event["coin"], None)
       self._prev_positions.pop(event["coin"], None)
   ```

4. **daemon.py line 2245** (`_peak_roe[sym] = roe_pct`): emit `peak_roe_new` after:
   ```python
   if roe_pct > self._peak_roe.get(sym, 0):
       self._peak_roe[sym] = roe_pct
       _trade_id = self._open_trade_ids.get(sym)
       if _trade_id and self._journal_store:
           from hynous.journal.capture import emit_lifecycle_event
           emit_lifecycle_event(
               journal_store=self._journal_store,
               trade_id=_trade_id,
               event_type="peak_roe_new",
               payload={"peak_roe": roe_pct, "price": px},
           )
   ```

5. **daemon.py line 2247** (`_trough_roe[sym]`): same pattern for `trough_roe_new`

6. **daemon.py lines 2305 and 2329** (dynamic_sl_set): emit `dynamic_sl_placed` at both

7. **daemon.py lines 2382 and 2406** (breakeven_set): emit `fee_be_set` at both

8. **daemon.py line 2472** (`_trailing_active[sym] = True`): emit `trail_activated`

9. **daemon.py line 2542** (`_trailing_stop_px[sym] = new_trail_px`): emit `trail_updated`

10. **daemon.py line 3514** (second `_peak_roe[coin]` update): same as #4

11. **New: vol regime change detection.** Add a `self._last_vol_regime: str | None = None` state var. In `_fast_trigger_check`, after resolving `_vol_regime`, compare to `self._last_vol_regime`. If changed, emit `vol_regime_change` for every open trade and update `_last_vol_regime`. Only emit once per change, not once per trade per check.

### Testing notes for lifecycle events

- Every emission point must have a test that triggers the mutation and asserts the event was persisted.
- Use a real `StagingStore` fixture in a tmp SQLite file; do not mock the store.
- Assert the `trade_id` in the emitted event matches the `_open_trade_ids[symbol]` value at mutation time.
- Assert the payload contains all required fields per the event type table.
- Test that a mutation with no matching trade_id (orphan position) does NOT crash — it should log and skip.

---

## Exit Snapshot Specification

The exit snapshot captures everything known at the moment a trade closes, plus counterfactual data computed after the fact.

### Dataclass definition

```python
# src/hynous/journal/schema.py (add to existing file)

@dataclass(slots=True)
class TradeOutcome:
    """Core outcome metrics at exit."""
    exit_ts: str
    exit_px: float
    exit_classification: str   # "dynamic_protective_sl" | "breakeven_stop" | "trailing_stop" |
                               # "stop_loss" | "take_profit" | "liquidation" | "manual_close"
    realized_pnl_usd: float
    realized_pnl_pct: float
    roe_at_exit: float
    fees_paid_usd: float
    hold_duration_s: int
    slippage_vs_trigger_bps: float | None


@dataclass(slots=True)
class ROETrajectory:
    """Summary of ROE path during the hold."""
    peak_roe: float
    peak_roe_ts: str
    peak_roe_price: float
    trough_roe: float
    trough_roe_ts: str
    trough_roe_price: float
    time_to_peak_s: int
    time_to_trough_s: int
    mfe_usd: float    # max favorable excursion
    mae_usd: float    # max adverse excursion


@dataclass(slots=True)
class Counterfactuals:
    """Post-hoc analysis of the trade path beyond the exit."""
    counterfactual_window_s: int
    max_favorable_price: float   # best price seen during (entry_ts, exit_ts + window)
    max_adverse_price: float     # worst price seen during same window
    optimal_exit_px: float       # best exit the trade could have achieved
    optimal_exit_ts: str
    did_tp_hit_later: bool       # did price reach original TP within window post-exit?
    did_tp_hit_ts: str | None
    did_sl_get_hunted: bool      # did price touch SL then reverse >1% within 10min post-exit?
    sl_hunt_reversal_pct: float | None


@dataclass(slots=True)
class MLExitComparison:
    """ML state at exit for comparison vs entry."""
    composite_score_at_exit: float | None
    composite_score_delta: float | None       # exit - entry
    vol_regime_at_exit: str | None
    vol_regime_changed: bool
    entry_quality_pctl_at_exit: int | None
    direction_signal_at_exit: str | None
    direction_signal_changed: bool
    mae_long_value_at_exit: float | None
    mae_short_value_at_exit: float | None


@dataclass(slots=True)
class TradeExitSnapshot:
    """Complete exit snapshot. Persisted as JSON in trade_exit_snapshots table."""
    trade_id: str
    trade_outcome: TradeOutcome
    roe_trajectory: ROETrajectory
    counterfactuals: Counterfactuals
    ml_exit_comparison: MLExitComparison
    market_state_at_exit: MarketState  # reuse from entry snapshot dataclass
    price_path_1m: list[list[float]]    # 1m candles from entry to exit + counterfactual window
    schema_version: str = "1.0.0"
```

### Counterfactual window formula

Per the plan discussion: **`window_s = max(hold_duration_s, 7200) capped at 43200`** (min 2h, max 12h).

Implementation:

```python
# src/hynous/journal/counterfactuals.py

def compute_counterfactual_window(hold_duration_s: int) -> int:
    """Return the counterfactual lookahead window in seconds.
    
    Rule: max(hold_duration, 2h) capped at 12h.
    """
    return max(min(hold_duration_s, 43200), 7200)


def compute_counterfactuals(
    *,
    provider: Any,
    symbol: str,
    side: str,
    entry_px: float,
    entry_ts: str,
    exit_px: float,
    exit_ts: str,
    sl_px: float | None,
    tp_px: float | None,
) -> Counterfactuals:
    """Compute counterfactuals for a closed trade.
    
    Fetches 1m candles from entry_ts to exit_ts + window_s and analyzes:
    - The best/worst prices seen
    - Whether original TP would have hit if held longer
    - Whether SL was hunted (hit then reversed)
    """
    from datetime import datetime, timezone, timedelta
    
    entry_dt = datetime.fromisoformat(entry_ts.replace("Z", "+00:00"))
    exit_dt = datetime.fromisoformat(exit_ts.replace("Z", "+00:00"))
    hold_duration = int((exit_dt - entry_dt).total_seconds())
    window_s = compute_counterfactual_window(hold_duration)
    
    start_ms = int(entry_dt.timestamp() * 1000)
    end_dt = exit_dt + timedelta(seconds=window_s)
    end_ms = int(end_dt.timestamp() * 1000)
    
    candles = provider.get_candles(symbol, "1m", start_ms, end_ms) or []
    if not candles:
        # Graceful degradation: return empty counterfactuals
        return Counterfactuals(
            counterfactual_window_s=window_s,
            max_favorable_price=exit_px,
            max_adverse_price=exit_px,
            optimal_exit_px=exit_px,
            optimal_exit_ts=exit_ts,
            did_tp_hit_later=False,
            did_tp_hit_ts=None,
            did_sl_get_hunted=False,
            sl_hunt_reversal_pct=None,
        )
    
    # Compute MFE / MAE from candles
    if side == "long":
        max_fav_px = max(c["h"] for c in candles)
        max_adv_px = min(c["l"] for c in candles)
        optimal_exit_px = max_fav_px
    else:
        max_fav_px = min(c["l"] for c in candles)
        max_adv_px = max(c["h"] for c in candles)
        optimal_exit_px = max_fav_px
    
    optimal_exit_ts = _find_optimal_exit_ts(candles, side)
    
    # Check TP hit post-exit
    did_tp_hit = False
    did_tp_hit_ts = None
    if tp_px is not None:
        post_exit_candles = [c for c in candles if c["t"] > int(exit_dt.timestamp() * 1000)]
        for c in post_exit_candles:
            if side == "long" and c["h"] >= tp_px:
                did_tp_hit = True
                did_tp_hit_ts = _ms_to_iso(c["t"])
                break
            if side == "short" and c["l"] <= tp_px:
                did_tp_hit = True
                did_tp_hit_ts = _ms_to_iso(c["t"])
                break
    
    # Check SL hunted pattern (touch then reverse >1% within 10min)
    did_sl_hunted = False
    sl_hunt_reversal_pct = None
    if sl_px is not None:
        # Simplified: was SL touched at all during hold? Then did price reverse by 1%+ within 10min?
        for i, c in enumerate(candles):
            touched = False
            if side == "long" and c["l"] <= sl_px:
                touched = True
            elif side == "short" and c["h"] >= sl_px:
                touched = True
            if touched:
                # Look ahead 10 candles (1m each = 10min)
                next_window = candles[i+1:i+11]
                if next_window:
                    if side == "long":
                        max_after = max(c2["h"] for c2 in next_window)
                        reversal = (max_after - sl_px) / sl_px * 100
                    else:
                        min_after = min(c2["l"] for c2 in next_window)
                        reversal = (sl_px - min_after) / sl_px * 100
                    if reversal > 1.0:
                        did_sl_hunted = True
                        sl_hunt_reversal_pct = reversal
                        break
    
    return Counterfactuals(
        counterfactual_window_s=window_s,
        max_favorable_price=max_fav_px,
        max_adverse_price=max_adv_px,
        optimal_exit_px=optimal_exit_px,
        optimal_exit_ts=optimal_exit_ts,
        did_tp_hit_later=did_tp_hit,
        did_tp_hit_ts=did_tp_hit_ts,
        did_sl_get_hunted=did_sl_hunted,
        sl_hunt_reversal_pct=sl_hunt_reversal_pct,
    )


def _find_optimal_exit_ts(candles: list[dict], side: str) -> str:
    """Find the timestamp of the candle with the best exit price for the given side."""
    if side == "long":
        best = max(candles, key=lambda c: c["h"])
    else:
        best = min(candles, key=lambda c: c["l"])
    return _ms_to_iso(best["t"])


def _ms_to_iso(ms: int) -> str:
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()
```

### Exit snapshot builder

```python
# src/hynous/journal/capture.py (add)

def build_exit_snapshot(
    *,
    trade_id: str,
    entry_snapshot: TradeEntrySnapshot,
    exit_event: dict[str, Any],   # the event dict from provider.check_triggers()
    daemon: Any,
) -> TradeExitSnapshot:
    """Build a complete exit snapshot from the close event and daemon state.
    
    Called from the daemon's trigger-close handler immediately after the
    trade_exit lifecycle event is emitted.
    """
    from datetime import datetime, timezone
    from .counterfactuals import compute_counterfactuals
    
    exit_ts = datetime.now(timezone.utc).isoformat()
    
    # Compute hold duration
    entry_dt = datetime.fromisoformat(entry_snapshot.trade_basics.entry_ts.replace("Z", "+00:00"))
    exit_dt = datetime.fromisoformat(exit_ts.replace("Z", "+00:00"))
    hold_duration = int((exit_dt - entry_dt).total_seconds())
    
    # Trade outcome
    outcome = TradeOutcome(
        exit_ts=exit_ts,
        exit_px=exit_event["exit_px"],
        exit_classification=exit_event["classification"],
        realized_pnl_usd=exit_event["realized_pnl"],
        realized_pnl_pct=_compute_pnl_pct(
            entry_snapshot.trade_basics.entry_px,
            exit_event["exit_px"],
            entry_snapshot.trade_basics.side,
        ),
        roe_at_exit=_compute_roe(
            entry_snapshot.trade_basics.entry_px,
            exit_event["exit_px"],
            entry_snapshot.trade_basics.side,
            entry_snapshot.trade_basics.leverage,
        ),
        fees_paid_usd=0.0,  # filled in by mechanism: entry fee + exit fee (needs taker_fee_pct from settings)
        hold_duration_s=hold_duration,
        slippage_vs_trigger_bps=None,  # filled in from event if available
    )
    
    # ROE trajectory from daemon state
    trajectory = ROETrajectory(
        peak_roe=daemon._peak_roe.get(entry_snapshot.trade_basics.symbol, 0),
        peak_roe_ts="",  # daemon doesn't currently track the ts of peak; needs new state
        peak_roe_price=0,  # same
        trough_roe=daemon._trough_roe.get(entry_snapshot.trade_basics.symbol, 0),
        trough_roe_ts="",
        trough_roe_price=0,
        time_to_peak_s=0,
        time_to_trough_s=0,
        mfe_usd=0,  # computed from trajectory
        mae_usd=0,
    )
    # NOTE: peak_roe_ts and trough_roe_ts require new state tracking.
    # Phase 1 adds daemon._peak_roe_ts and daemon._trough_roe_ts dicts
    # populated at the same time as the ROE updates.
    
    # Counterfactuals
    provider = daemon._get_provider()
    counterfactuals = compute_counterfactuals(
        provider=provider,
        symbol=entry_snapshot.trade_basics.symbol,
        side=entry_snapshot.trade_basics.side,
        entry_px=entry_snapshot.trade_basics.entry_px,
        entry_ts=entry_snapshot.trade_basics.entry_ts,
        exit_px=exit_event["exit_px"],
        exit_ts=exit_ts,
        sl_px=entry_snapshot.trade_basics.sl_px,
        tp_px=entry_snapshot.trade_basics.tp_px,
    )
    
    # ML exit comparison
    ml_exit = _build_ml_exit_comparison(daemon, entry_snapshot)
    
    # Market state at exit
    market_state_exit = _build_market_state(daemon, entry_snapshot.trade_basics.symbol, exit_event["exit_px"])
    
    # Price path during hold
    price_path = _fetch_hold_candles(provider, entry_snapshot, exit_ts, counterfactuals.counterfactual_window_s)
    
    return TradeExitSnapshot(
        trade_id=trade_id,
        trade_outcome=outcome,
        roe_trajectory=trajectory,
        counterfactuals=counterfactuals,
        ml_exit_comparison=ml_exit,
        market_state_at_exit=market_state_exit,
        price_path_1m=price_path,
    )


def _compute_pnl_pct(entry_px: float, exit_px: float, side: str) -> float:
    if entry_px == 0:
        return 0.0
    raw = (exit_px - entry_px) / entry_px * 100
    return raw if side == "long" else -raw


def _compute_roe(entry_px: float, exit_px: float, side: str, leverage: int) -> float:
    return _compute_pnl_pct(entry_px, exit_px, side) * leverage
```

---

## Staging Store Specification

Phase 1 uses a minimal staging store at `storage/v2/staging.db`. Phase 2 replaces this with the full journal store but reuses the same schema conceptually.

### Staging schema

```python
# src/hynous/journal/staging_store.py

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from pathlib import Path
from typing import Any

from .schema import LifecycleEvent, TradeEntrySnapshot, TradeExitSnapshot

logger = logging.getLogger(__name__)


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS trade_entry_snapshots_staging (
    trade_id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    entry_ts TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entry_snapshots_symbol ON trade_entry_snapshots_staging(symbol);
CREATE INDEX IF NOT EXISTS idx_entry_snapshots_entry_ts ON trade_entry_snapshots_staging(entry_ts);

CREATE TABLE IF NOT EXISTS trade_exit_snapshots_staging (
    trade_id TEXT PRIMARY KEY,
    exit_ts TEXT NOT NULL,
    exit_classification TEXT NOT NULL,
    realized_pnl_usd REAL,
    snapshot_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (trade_id) REFERENCES trade_entry_snapshots_staging(trade_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exit_snapshots_exit_ts ON trade_exit_snapshots_staging(exit_ts);

CREATE TABLE IF NOT EXISTS trade_events_staging (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_trade_id ON trade_events_staging(trade_id);
CREATE INDEX IF NOT EXISTS idx_events_event_type ON trade_events_staging(event_type);
CREATE INDEX IF NOT EXISTS idx_events_ts ON trade_events_staging(ts);
"""


class StagingStore:
    """Thin SQLite wrapper for phase 1 data capture.
    
    Not for long-term use. Phase 2 replaces this with the full JournalStore.
    """
    
    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._lock = threading.Lock()
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()
    
    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, timeout=5.0, isolation_level=None)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn
    
    def _init_schema(self) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.executescript(SCHEMA_SQL)
            finally:
                conn.close()
    
    def insert_entry_snapshot(self, snapshot: TradeEntrySnapshot) -> None:
        """Persist an entry snapshot."""
        from dataclasses import asdict
        from datetime import datetime, timezone
        
        json_str = json.dumps(asdict(snapshot), sort_keys=True, separators=(",", ":"), default=str)
        
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO trade_entry_snapshots_staging
                    (trade_id, symbol, side, entry_ts, snapshot_json, schema_version, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        snapshot.trade_basics.trade_id,
                        snapshot.trade_basics.symbol,
                        snapshot.trade_basics.side,
                        snapshot.trade_basics.entry_ts,
                        json_str,
                        snapshot.schema_version,
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
            finally:
                conn.close()
    
    def insert_exit_snapshot(self, snapshot: TradeExitSnapshot) -> None:
        """Persist an exit snapshot."""
        from dataclasses import asdict
        from datetime import datetime, timezone
        
        json_str = json.dumps(asdict(snapshot), sort_keys=True, separators=(",", ":"), default=str)
        
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO trade_exit_snapshots_staging
                    (trade_id, exit_ts, exit_classification, realized_pnl_usd,
                     snapshot_json, schema_version, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        snapshot.trade_id,
                        snapshot.trade_outcome.exit_ts,
                        snapshot.trade_outcome.exit_classification,
                        snapshot.trade_outcome.realized_pnl_usd,
                        json_str,
                        snapshot.schema_version,
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
            finally:
                conn.close()
    
    def insert_lifecycle_event(
        self,
        *,
        trade_id: str,
        ts: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        """Persist a lifecycle event."""
        from datetime import datetime, timezone
        
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO trade_events_staging
                    (trade_id, ts, event_type, payload_json, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        trade_id,
                        ts,
                        event_type,
                        json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str),
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
            finally:
                conn.close()
    
    def get_entry_snapshot(self, trade_id: str) -> TradeEntrySnapshot | None:
        """Load an entry snapshot by trade_id."""
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT snapshot_json FROM trade_entry_snapshots_staging WHERE trade_id = ?",
                    (trade_id,),
                ).fetchone()
                if not row:
                    return None
                data = json.loads(row[0])
                return _dict_to_entry_snapshot(data)
            finally:
                conn.close()
    
    def get_events_for_trade(self, trade_id: str) -> list[LifecycleEvent]:
        """Load all lifecycle events for a trade in chronological order."""
        with self._lock:
            conn = self._connect()
            try:
                rows = conn.execute(
                    """
                    SELECT id, trade_id, ts, event_type, payload_json
                    FROM trade_events_staging
                    WHERE trade_id = ?
                    ORDER BY ts ASC
                    """,
                    (trade_id,),
                ).fetchall()
                return [
                    LifecycleEvent(
                        event_id=r[0],
                        trade_id=r[1],
                        ts=r[2],
                        event_type=r[3],
                        payload=json.loads(r[4]),
                    )
                    for r in rows
                ]
            finally:
                conn.close()


def _dict_to_entry_snapshot(data: dict) -> TradeEntrySnapshot:
    """Reconstruct a TradeEntrySnapshot from a loaded JSON dict.
    
    Manual reconstruction because nested dataclasses don't auto-hydrate.
    """
    # Implementation: walk the dict, instantiate each inner dataclass in order
    # This is ~30 lines of straightforward code — engineer implements it.
    raise NotImplementedError("Implement dict→dataclass reconstruction")
```

---

## Integration with execute_trade

### Call site in trading.py

After the order fills (around line 1113, after the `_record_trade_span` for `order_fill` success), add the entry snapshot capture call BEFORE the existing `_store_trade_memory` call:

```python
# trading.py around line 1115

# v2 — capture rich entry snapshot (phase 1)
try:
    from ...intelligence.daemon import get_active_daemon
    _daemon = get_active_daemon()
    if _daemon and _daemon._journal_store:
        from hynous.journal.capture import build_entry_snapshot
        _snapshot = build_entry_snapshot(
            symbol=symbol,
            side=side,
            trade_type=trade_type,
            fill_px=fill_px,
            fill_sz=fill_sz,
            leverage=leverage,
            sl_px=stop_loss,
            tp_px=take_profit,
            size_usd=effective_usd,
            reference_price=price,
            fees_paid_usd=effective_usd * (get_trading_settings().taker_fee_pct / 100),
            daemon=_daemon,
            trigger_source="manual",  # phase 5 will enrich with real trigger context
            trigger_type="unknown",   # phase 5 will set based on wake source
            wake_source_id=None,
            scanner_detail=None,
        )
        _daemon._journal_store.insert_entry_snapshot(_snapshot)
        _daemon._open_trade_ids[symbol] = _snapshot.trade_basics.trade_id
        _record_trade_span(
            "execute_trade", "v2_capture", True,
            f"Entry snapshot captured for {_snapshot.trade_basics.trade_id}",
            trade_id=_snapshot.trade_basics.trade_id,
        )
except Exception as e:
    logger.exception("Failed to capture v2 entry snapshot")
    _record_trade_span("execute_trade", "v2_capture", False, f"Capture failed: {e}")
```

**Critical:** the existing `_store_trade_memory` call at line 1183 is NOT removed in phase 1. It stays alongside the new capture. Phase 4 removes it.

### Call site in daemon.py (exit snapshot)

In `_fast_trigger_check` at line 2201 (after the existing `trade_exit` lifecycle event emission and before `self._prev_positions.pop(...)`):

```python
# daemon.py around line 2201, inside the events loop

_trade_id = self._open_trade_ids.get(event["coin"])
if _trade_id and self._journal_store:
    try:
        entry_snapshot = self._journal_store.get_entry_snapshot(_trade_id)
        if entry_snapshot:
            from hynous.journal.capture import build_exit_snapshot
            exit_snapshot = build_exit_snapshot(
                trade_id=_trade_id,
                entry_snapshot=entry_snapshot,
                exit_event=event,
                daemon=self,
            )
            self._journal_store.insert_exit_snapshot(exit_snapshot)
    except Exception:
        logger.exception("Failed to capture v2 exit snapshot for %s", event["coin"])
```

---

## Testing

### Unit tests

Create `tests/unit/test_v2_capture.py` with the following test cases:

1. **`test_build_ml_snapshot_with_full_predictions`** — mock daemon with a complete `_latest_predictions[symbol]` and assert all MLSnapshot fields are populated
2. **`test_build_ml_snapshot_with_empty_predictions`** — empty predictions, assert all fields are None and staleness is None
3. **`test_build_ml_snapshot_with_stale_predictions`** — predictions older than 330s, assert staleness is computed and regime is marked as stale
4. **`test_build_market_state_with_full_book`** — mock provider with populated L2 book, assert spread, imbalance, depth computed correctly
5. **`test_build_market_state_with_missing_book`** — provider returns None, assert all book fields are None, other fields still populated
6. **`test_build_entry_snapshot_generates_unique_trade_id`** — two calls produce different trade_ids
7. **`test_emit_lifecycle_event_persists`** — call emit, verify row in staging DB
8. **`test_emit_lifecycle_event_handles_store_exception`** — broken store, emit does not raise
9. **`test_staging_store_roundtrip_entry_snapshot`** — insert, retrieve, assert equality
10. **`test_staging_store_roundtrip_lifecycle_event`** — insert, retrieve, assert order and fields
11. **`test_counterfactual_window_formula`** — verify `max(hold, 7200)` capped at `43200` for various hold durations
12. **`test_compute_counterfactuals_with_tp_hit_later`** — mock candles where TP hits 5min after exit, assert `did_tp_hit_later = True`
13. **`test_compute_counterfactuals_with_sl_hunted`** — mock candles where price touches SL then reverses >1% in 10min, assert `did_sl_get_hunted = True`

### Integration tests

Create `tests/integration/test_v2_capture_integration.py`:

1. **`test_full_trade_lifecycle_paper_mode`** — spin up paper provider, simulate an entry, manually emit lifecycle events, simulate an exit, assert:
   - Entry snapshot is in staging DB
   - All 5+ lifecycle events are in staging DB linked to trade_id
   - Exit snapshot is in staging DB with counterfactuals computed
   - `_open_trade_ids` cleanup happened after close
2. **`test_vol_regime_change_emits_event`** — change `_latest_predictions` mid-trade to simulate regime shift, confirm `vol_regime_change` event is emitted exactly once per transition
3. **`test_multiple_concurrent_trades_events_isolated`** — (BTC phase 1 is single-position, but test that the system handles this correctly): open two different symbol positions in paper, emit events on each, assert each event's trade_id matches correctly

### Smoke test

Run the daemon in paper mode for 15 minutes (longer than standard 5min because you need at least one scanner anomaly and one trade cycle):

```bash
timeout 900 python -m scripts.run_daemon 2>&1 | tee storage/v2/smoke-phase-1.log
```

Post-smoke verification:

```bash
sqlite3 storage/v2/staging.db <<'EOF'
SELECT COUNT(*) AS entries FROM trade_entry_snapshots_staging;
SELECT COUNT(*) AS exits FROM trade_exit_snapshots_staging;
SELECT event_type, COUNT(*) FROM trade_events_staging GROUP BY event_type;
SELECT COUNT(DISTINCT trade_id) FROM trade_events_staging;
EOF
```

Expected output: at least 1 entry, potentially 0 exits (if no trade closed in 15min), and events distributed across `peak_roe_new`, `dynamic_sl_placed`, and possibly others.

If zero entries after 15min: paper mode isn't firing trades, which could be unrelated to phase 1 — check the daemon log for unrelated issues. **Pause and report.**

### JSON validation

For every entry snapshot persisted during smoke test, verify the JSON is valid and contains the expected top-level keys:

```bash
sqlite3 storage/v2/staging.db "SELECT snapshot_json FROM trade_entry_snapshots_staging LIMIT 1;" | python -c "
import sys, json
data = json.loads(sys.stdin.read())
expected_keys = {
    'trade_basics', 'trigger_context', 'ml_snapshot', 'market_state',
    'derivatives_state', 'liquidation_terrain', 'order_flow_state',
    'smart_money_context', 'time_context', 'account_context',
    'settings_snapshot', 'price_history', 'schema_version',
}
missing = expected_keys - set(data.keys())
extra = set(data.keys()) - expected_keys
print(f'Missing: {missing}')
print(f'Extra: {extra}')
assert not missing, f'Missing keys: {missing}'
print('Entry snapshot schema valid')
"
```

---

## Acceptance Criteria

- [ ] `src/hynous/journal/schema.py` contains all dataclass definitions listed in this doc
- [ ] `src/hynous/journal/capture.py` contains `build_entry_snapshot`, `build_exit_snapshot`, `emit_lifecycle_event` and all builder helpers
- [ ] `src/hynous/journal/staging_store.py` contains `StagingStore` with schema init and all CRUD methods
- [ ] `src/hynous/journal/counterfactuals.py` contains `compute_counterfactual_window` and `compute_counterfactuals`
- [ ] `trading.py` `handle_execute_trade` calls `build_entry_snapshot` + `staging_store.insert_entry_snapshot` after order fill
- [ ] `daemon.py` has `_open_trade_ids` state dict and `_journal_store` reference
- [ ] `daemon.py` `_fast_trigger_check` emits `trade_exit` lifecycle event in the trigger close loop
- [ ] `daemon.py` emits `peak_roe_new` and `trough_roe_new` at lines 2245 and 2247
- [ ] `daemon.py` emits `dynamic_sl_placed` at lines 2305 and 2329
- [ ] `daemon.py` emits `fee_be_set` at lines 2382 and 2406
- [ ] `daemon.py` emits `trail_activated` at line 2472
- [ ] `daemon.py` emits `trail_updated` at line 2542
- [ ] `daemon.py` has vol regime change detection with `_last_vol_regime` state and emits `vol_regime_change` once per transition
- [ ] `daemon.py` builds and persists exit snapshot in the trigger close path
- [ ] All 13 unit tests in `test_v2_capture.py` pass
- [ ] All 3 integration tests in `test_v2_capture_integration.py` pass
- [ ] Full regression `pytest tests/ --ignore=tests/e2e` passes with zero new failures (baseline: 810 passed / 1 pre-existing failure — see master plan Amendment 2)
- [ ] mypy error count ≤ baseline
- [ ] ruff error count ≤ baseline
- [ ] 15-minute smoke test produces at least one complete entry snapshot in staging.db
- [ ] JSON schema validation passes for at least one captured entry snapshot
- [ ] If a trade closed during smoke, exit snapshot exists and counterfactuals are non-empty
- [ ] Lifecycle events are present for open/closed trades from smoke test
- [ ] v1 behavior is unchanged: Nous store still fires, existing gates still run, existing trigger check logic unchanged
- [ ] Phase 1 commit(s) on v2 branch tagged `[phase-1]`

---

## Rollback

Phase 1 is reversible because it adds capture alongside v1 paths without modifying them:

```bash
git revert <phase-1-commit-sha>
rm -f storage/v2/staging.db
```

Rollback does NOT require any state cleanup because the new code paths are additive.

---

## Report-Back

Use the template from `02-testing-standards.md`. Phase 1 specific items to include:

- Number of entry snapshots captured during smoke test
- Number of lifecycle events captured, grouped by event_type
- Number of exit snapshots captured
- Schema validation result for a sample entry snapshot
- Any graceful-degradation cases observed (e.g., book data was missing, ML predictions were stale) and whether the capture succeeded despite them
- Any deviations from the plan (e.g., a daemon line number drifted — report the new line)
- Any observed latency impact on `_fast_trigger_check` from the new event emissions (should be imperceptible but measure if possible)

If lifecycle event emission caused measurable daemon latency increase (> 50ms per trigger check cycle), pause and report — phase 1 should not slow down the fast trigger loop.
