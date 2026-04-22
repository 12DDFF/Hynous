# Phase 5 — Mechanical Entry

> **Prerequisites:** Phases 0–4 complete. v1 decision-injection is gone. The LLM is still in the codebase but phase 5 removes it from the entry path entirely.
>
> **Phase goal:** Replace the LLM-in-the-loop entry path with a pluggable `EntryTriggerSource` interface and an `MLSignalDrivenTrigger` concrete implementation. Refactor `execute_trade` from a tool handler into a plain function callable by the mechanical pipeline. After this phase, the LLM makes zero trading decisions.
>
> **⚠️ Post-phase calibration (2026-04-22 — v2-debug C1 fix).** The code sketches below show the phase-5-landed math. Two numerics were recalibrated on v3's narrower peak-ROE distribution and differ from the sketches. Trust the live code, not the sketches, for current values:
>
> - **Gate 4 direction-confidence normalizer:** sketches show `max(abs(long_roe), abs(short_roe)) / 10.0`. Live code is `min(1.0, ... / 5.0)` in `src/hynous/mechanical_entry/ml_signal_driven.py:208`. The `/10` was inherited from v1's ±20% clip range; v3 predictions sit in ~[0, 7%] so `/10` made the 0.55 threshold unreachable. With `/5` + clamp, the same 0.55 threshold means `max_roe ≥ 2.75%` (≈ p95 on v3).
> - **Satellite inference threshold:** v2-planning/11-phase-8 inherited `inference_entry_threshold: 3.0` / `inference_conflict_margin: 1.0`. Now `2.0` / `0.5` respectively in `config/default.yaml`, for the same distribution reason.
> - **Direction-model target column:** phase 5 launched with `risk_adj_*` target; v3 deployed 2026-04-20 switched to `best_*_roe_30m_net`. `ModelMetadata` now self-documents via `long_target_column` / `short_target_column` (v2-debug H8).
>
> Rationale + data in `docs/revisions/v2-debug/README.md § C1`.

---

## Context

Phase 5 is the final nail in the LLM-trading coffin. Phases 1–3 proved that:
- ML signals are the real gate (composite entry score, direction model, vol regime)
- The LLM's `reasoning` field was stored but never read for mechanical decisions
- The LLM's `confidence` was multiplied by ML sizing factor — ML dominated
- Post-trade analysis is where the LLM actually earns its keep

With those proofs in place, phase 5 deletes the LLM entry path. The daemon now:
1. Sees a scanner anomaly or runs its periodic ML signal check
2. Calls `EntryTriggerSource.evaluate(context)` → returns an `EntrySignal | None`
3. If a signal is returned: calls `compute_entry_params(signal)` → returns exact entry params (leverage, size, SL, TP)
4. Calls `execute_trade_mechanical(...)` — a plain Python function, not a tool
5. Mechanical exits take over from there (unchanged from v1)
6. On exit, phase 3 analysis agent fires

The v1 `execute_trade` tool handler is removed from the registry. The `handle_execute_trade` function body is renamed to `execute_trade_mechanical` and its LLM-facing argument parsing is stripped out.

---

## Required Reading

1. All prior phase plans (0–4)
2. **`src/hynous/intelligence/tools/trading.py`** — current state after phase 4 deletions. You're refactoring what's left.
3. **`src/hynous/intelligence/daemon.py`** — the scanner wake path and all `_wake_for_*` methods. You'll remove LLM wakes and replace them with mechanical trigger evaluation.
4. **`satellite/entry_score.py`** — the composite entry score is the primary gate
5. **`satellite/inference.py`** — direction model predictions
6. **`satellite/conditions.py`** — condition models including entry quality, vol regime, MAE predictions
7. **Phase 3 plan** — you'll fire the analysis agent after every closed trade (already wired in phase 3, just confirm it's still correct after this refactor)

---

## Scope

### In Scope

- `src/hynous/mechanical_entry/` new module
  - `interface.py` — `EntryTriggerSource` abstract base + `EntrySignal` dataclass
  - `ml_signal_driven.py` — concrete implementation using composite score + direction model
  - `compute_entry_params.py` — deterministic mapping from `EntrySignal` → trade params
  - `executor.py` — plain function wrapping the exchange call flow
- Refactor `src/hynous/intelligence/tools/trading.py`:
  - Rename `handle_execute_trade` → internals moved into `executor.execute_trade_mechanical`
  - Remove tool handler wrapper
  - Unregister from `tools/registry.py`
  - Keep `close_position`, `modify_position`, `get_account` for now (used by user chat agent)
- Modify `src/hynous/intelligence/daemon.py`:
  - Replace scanner wake path with mechanical entry evaluation
  - Remove `_wake_for_scanner` → replaced by `_evaluate_entry_signals`
  - Remove LLM wake calls from fill/profit/watchpoint paths (still emit to daemon_log for observability, but don't fire the LLM)
  - Keep review wake if user wants to manually trigger analysis re-runs
- Delete `src/hynous/intelligence/agent.py` v1 agent class (the LiteLLM wrapper with tool loop)
  - Replace with a minimal `user_chat_agent.py` for dashboard chat queries (separate from trading)
- Configure the trigger source via `config.v2.mechanical_entry.trigger_source`
- Delete `prompts/builder.py` entirely if no remaining consumer, or trim to only the user chat agent prompt

### Out of Scope

- Building the hybrid scanner-driven trigger (Option C) — deferred, but the interface supports it
- Dashboard rework (phase 7)
- Quantitative improvements (phase 8)

---

## Interface

```python
# src/hynous/mechanical_entry/interface.py

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class EntrySignal:
    """A candidate entry produced by an EntryTriggerSource.
    
    The trigger source is responsible for all gating. If an EntrySignal is
    returned, the downstream code assumes it's been fully validated and
    computes entry params deterministically.
    """
    symbol: str
    side: str                   # "long" | "short"
    trade_type: str             # "macro" | "micro"
    conviction: float           # 0.0–1.0 derived from ML signals
    trigger_source: str         # "ml_signal" | "hybrid_scanner_ml" | "manual"
    trigger_type: str           # "composite_score" | "direction_model" | "scanner_anomaly" | etc.
    trigger_detail: dict[str, Any]  # raw context: anomaly dict, ML signal state
    ml_snapshot_ref: dict[str, Any] # references to the ML state used for gating
    expires_at: str | None = None   # ISO timestamp, or None for no expiry


@dataclass(slots=True)
class EntryEvaluationContext:
    """Context passed to a trigger source for evaluation."""
    daemon: Any                 # the HynousDaemon instance (for state access)
    symbol: str                 # the symbol being considered
    scanner_anomaly: dict[str, Any] | None = None  # if fired from scanner
    now_ts: str = ""            # ISO UTC timestamp


class EntryTriggerSource(ABC):
    """Abstract interface for mechanical entry decision sources.
    
    Implementations:
        - MLSignalDrivenTrigger (phase 5, Option B): fires based on composite
          entry score + direction model alone, no scanner involvement
        - HybridScannerMLTrigger (future, Option C): scanner nominates, ML gates
    """
    
    @abstractmethod
    def evaluate(self, ctx: EntryEvaluationContext) -> EntrySignal | None:
        """Decide whether to fire an entry.
        
        Returns an EntrySignal to fire, or None to pass.
        Must be pure-deterministic: same context always produces same output.
        """
        ...
    
    @abstractmethod
    def name(self) -> str:
        """Return identifier used in logging and rejection records."""
        ...
```

---

## ML Signal Driven Trigger (Option B)

```python
# src/hynous/mechanical_entry/ml_signal_driven.py

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

from .interface import EntryEvaluationContext, EntrySignal, EntryTriggerSource

logger = logging.getLogger(__name__)


class MLSignalDrivenTrigger(EntryTriggerSource):
    """Entry trigger driven purely by ML signals.
    
    Fires when:
    - Composite entry score >= composite_entry_threshold
    - Direction model confidence >= direction_confidence_threshold
    - Entry quality percentile >= require_entry_quality_pctl
    - Vol regime <= max_vol_regime (extreme blocks)
    - No existing position on the symbol (one at a time)
    - Circuit breaker is not active
    """
    
    def __init__(
        self,
        *,
        composite_threshold: float,
        direction_confidence_threshold: float,
        entry_quality_threshold: int,
        max_vol_regime: str,
    ) -> None:
        self._composite_threshold = composite_threshold
        self._direction_conf_threshold = direction_confidence_threshold
        self._entry_quality_threshold = entry_quality_threshold
        self._max_vol_regime = max_vol_regime
        self._vol_rank = {"low": 0, "normal": 1, "high": 2, "extreme": 3}
    
    def name(self) -> str:
        return "ml_signal_driven"
    
    def evaluate(self, ctx: EntryEvaluationContext) -> EntrySignal | None:
        daemon = ctx.daemon
        symbol = ctx.symbol.upper()
        
        # Gate 0: circuit breaker
        if getattr(daemon, "trading_paused", False):
            return self._rejection_record(
                ctx, reason="circuit_breaker_active",
                detail={"reason": "daemon.trading_paused"},
            )
        
        # Gate 1: no existing position on symbol
        if symbol in daemon._prev_positions:
            return self._rejection_record(
                ctx, reason="already_has_position",
                detail={"existing_position": daemon._prev_positions.get(symbol)},
            )
        
        # Gate 2: fetch ML predictions
        with daemon._latest_predictions_lock:
            preds = dict(daemon._latest_predictions.get(symbol, {}))
        
        if not preds:
            return self._rejection_record(
                ctx, reason="no_ml_predictions",
                detail={"symbol": symbol},
            )
        
        conditions = preds.get("conditions", {})
        pred_ts = conditions.get("timestamp", 0)
        staleness = time.time() - pred_ts if pred_ts > 0 else 1e9
        if staleness > 600:  # > 10 min stale
            return self._rejection_record(
                ctx, reason="ml_predictions_stale",
                detail={"staleness_s": staleness},
            )
        
        # Gate 3: composite entry score
        comp_score = preds.get("_entry_score")
        if comp_score is None:
            return self._rejection_record(
                ctx, reason="no_composite_score",
                detail={},
            )
        if comp_score < self._composite_threshold:
            return self._rejection_record(
                ctx, reason="composite_below_threshold",
                detail={"score": comp_score, "threshold": self._composite_threshold},
            )
        
        # Gate 4: direction model
        direction_signal = preds.get("signal")  # "long" | "short" | "skip" | "conflict"
        if direction_signal not in ("long", "short"):
            return self._rejection_record(
                ctx, reason="no_direction_signal",
                detail={"signal": direction_signal},
            )
        
        long_roe = preds.get("long_roe", 0)
        short_roe = preds.get("short_roe", 0)
        direction_conf = max(abs(long_roe), abs(short_roe)) / 10.0  # rough normalization
        if direction_conf < self._direction_conf_threshold:
            return self._rejection_record(
                ctx, reason="direction_confidence_below_threshold",
                detail={"confidence": direction_conf, "threshold": self._direction_conf_threshold},
            )
        
        # Gate 5: entry quality percentile
        eq = conditions.get("entry_quality", {}) or {}
        eq_pctl = eq.get("percentile", 0)
        if eq_pctl < self._entry_quality_threshold:
            return self._rejection_record(
                ctx, reason="entry_quality_below_threshold",
                detail={"pctl": eq_pctl, "threshold": self._entry_quality_threshold},
            )
        
        # Gate 6: vol regime
        vol_regime = conditions.get("vol_1h", {}).get("regime", "normal")
        if self._vol_rank.get(vol_regime, 99) > self._vol_rank.get(self._max_vol_regime, 2):
            return self._rejection_record(
                ctx, reason="vol_regime_above_max",
                detail={"regime": vol_regime, "max": self._max_vol_regime},
            )
        
        # All gates passed — fire the signal
        now_iso = datetime.now(timezone.utc).isoformat()
        return EntrySignal(
            symbol=symbol,
            side=direction_signal,
            trade_type="macro",
            conviction=direction_conf,
            trigger_source="ml_signal_driven",
            trigger_type="composite_score_plus_direction",
            trigger_detail={
                "composite_score": comp_score,
                "entry_quality_pctl": eq_pctl,
                "vol_regime": vol_regime,
                "direction_long_roe": long_roe,
                "direction_short_roe": short_roe,
            },
            ml_snapshot_ref={
                "composite_entry_score": comp_score,
                "entry_quality_percentile": eq_pctl,
                "vol_1h_regime": vol_regime,
                "direction_signal": direction_signal,
                "direction_long_roe": long_roe,
                "direction_short_roe": short_roe,
                "predictions_timestamp": pred_ts,
            },
        )
    
    def _rejection_record(
        self,
        ctx: EntryEvaluationContext,
        *,
        reason: str,
        detail: dict,
    ) -> None:
        """Write a rejection to the journal + return None."""
        import uuid
        from hynous.journal.store import JournalStore
        
        daemon = ctx.daemon
        journal = getattr(daemon, "_journal_store", None)
        if not journal:
            logger.debug("Rejection recorded (no journal): %s", reason)
            return None
        
        trade_id = f"rej_{uuid.uuid4().hex[:16]}"
        now_iso = ctx.now_ts or datetime.now(timezone.utc).isoformat()
        
        try:
            journal.upsert_trade(
                trade_id=trade_id,
                symbol=ctx.symbol,
                side="none",
                trade_type="macro",
                status="rejected",
                entry_ts=now_iso,
                rejection_reason=reason,
                trigger_source=self.name(),
                trigger_type=reason,
            )
            # Store a minimal "entry snapshot" with ML conditions for batch rejection analysis
            from hynous.journal.capture import _build_ml_snapshot
            from hynous.journal.schema import (
                TradeEntrySnapshot, TradeBasics, TriggerContext,
                # ... other imports as needed for a minimal rejection snapshot
            )
            # Engineer implements: minimal TradeEntrySnapshot with only ml_snapshot populated
        except Exception:
            logger.exception("Failed to record rejection for %s: %s", ctx.symbol, reason)
        
        return None
```

---

## Compute Entry Params

```python
# src/hynous/mechanical_entry/compute_entry_params.py

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from hynous.core.trading_settings import get_trading_settings
from .interface import EntrySignal


@dataclass(slots=True)
class EntryParams:
    """Concrete parameters for execute_trade_mechanical."""
    symbol: str
    side: str
    leverage: int
    size_usd: float
    sl_px: float
    tp_px: float
    trade_type: str


def compute_entry_params(
    *,
    signal: EntrySignal,
    entry_price: float,
    portfolio_value_usd: float,
    vol_regime: str,
) -> EntryParams:
    """Deterministic mapping from ML signal to exact trade params.
    
    No LLM. No conviction. No free parameters beyond trading_settings.
    Identical inputs produce identical outputs.
    """
    ts = get_trading_settings()
    
    # Leverage: vol-regime capped
    if vol_regime == "extreme":
        leverage = ts.ml_vol_leverage_cap_extreme
    elif vol_regime == "high":
        leverage = ts.ml_vol_leverage_cap_high
    else:
        leverage = ts.macro_leverage_max
    leverage = max(leverage, ts.macro_leverage_min)
    
    # Size: tier based on signal conviction
    if signal.conviction >= 0.8:
        margin_pct = ts.tier_high_margin_pct / 100
    elif signal.conviction >= 0.6:
        margin_pct = ts.tier_medium_margin_pct / 100
    else:
        margin_pct = ts.tier_speculative_margin_pct / 100
    
    margin_usd = portfolio_value_usd * margin_pct
    size_usd = margin_usd * leverage
    
    # Safety cap
    size_usd = min(size_usd, ts.max_position_usd)
    
    # SL: dynamic protective SL is placed mechanically AFTER entry.
    # But execute_trade still accepts an initial SL — use a wide placeholder
    # at vol-regime-appropriate distance. The daemon's mechanical exit layer
    # will tighten this within seconds.
    if vol_regime == "extreme":
        sl_pct = ts.dynamic_sl_extreme_vol / leverage / 100
    elif vol_regime == "high":
        sl_pct = ts.dynamic_sl_high_vol / leverage / 100
    elif vol_regime == "low":
        sl_pct = ts.dynamic_sl_low_vol / leverage / 100
    else:
        sl_pct = ts.dynamic_sl_normal_vol / leverage / 100
    
    if signal.side == "long":
        sl_px = entry_price * (1 - sl_pct)
    else:
        sl_px = entry_price * (1 + sl_pct)
    
    # TP: fixed roe_target per config
    tp_roe = ts.roe_target
    tp_pct = tp_roe / leverage / 100
    if signal.side == "long":
        tp_px = entry_price * (1 + tp_pct)
    else:
        tp_px = entry_price * (1 - tp_pct)
    
    return EntryParams(
        symbol=signal.symbol,
        side=signal.side,
        leverage=int(leverage),
        size_usd=round(size_usd, 2),
        sl_px=round(sl_px, 6),
        tp_px=round(tp_px, 6),
        trade_type=signal.trade_type,
    )
```

---

## Executor

```python
# src/hynous/mechanical_entry/executor.py

from __future__ import annotations

import logging
import time
from typing import Any

from hynous.core.trading_settings import get_trading_settings
from hynous.journal.capture import build_entry_snapshot
from .compute_entry_params import EntryParams, compute_entry_params
from .interface import EntrySignal

logger = logging.getLogger(__name__)


def execute_trade_mechanical(
    *,
    signal: EntrySignal,
    daemon: Any,  # HynousDaemon
) -> str | None:
    """Execute an entry trade mechanically.
    
    No LLM involvement. Pulls ML state, computes deterministic params,
    fires the exchange call, writes the rich entry snapshot to the journal,
    and updates daemon state.
    
    Returns trade_id on success, None on failure.
    """
    provider = daemon._get_provider()
    
    # Get live price + portfolio state
    try:
        price = provider.get_price(signal.symbol)
        if not price:
            logger.error("No price for %s", signal.symbol)
            return None
        user_state = provider.get_user_state()
        portfolio_value = user_state.get("account_value", 1000)
    except Exception:
        logger.exception("Pre-execution state fetch failed for %s", signal.symbol)
        return None
    
    vol_regime = signal.trigger_detail.get("vol_regime", "normal")
    
    # Compute params
    params = compute_entry_params(
        signal=signal,
        entry_price=price,
        portfolio_value_usd=portfolio_value,
        vol_regime=vol_regime,
    )
    
    logger.info(
        "Mechanical entry: %s %s %dx size $%.0f SL %.4f TP %.4f",
        params.symbol, params.side, params.leverage, params.size_usd,
        params.sl_px, params.tp_px,
    )
    
    # Set leverage
    try:
        provider.update_leverage(params.symbol, params.leverage)
    except Exception:
        logger.exception("Leverage set failed for %s", params.symbol)
        return None
    
    # Execute market order
    is_buy = params.side == "long"
    slippage = daemon.config.hyperliquid.default_slippage
    try:
        from hynous.intelligence.tools.trading import _retry_exchange_call
        result = _retry_exchange_call(
            provider.market_open,
            params.symbol, is_buy, params.size_usd, slippage,
        )
    except Exception:
        logger.exception("Market order failed for %s", params.symbol)
        return None
    
    if not isinstance(result, dict) or result.get("status") != "filled":
        logger.error("Order not filled: %s", result)
        return None
    
    fill_px = result.get("avg_px", price)
    fill_sz = result.get("filled_sz", 0)
    
    if fill_sz == 0:
        logger.error("Zero fill for %s", params.symbol)
        return None
    
    # Place SL/TP triggers
    try:
        from hynous.intelligence.tools.trading import _place_triggers
        _place_triggers(
            provider, params.symbol, is_buy, fill_sz,
            params.sl_px, params.tp_px, [], entry_px=fill_px,
        )
    except Exception:
        logger.exception("Trigger placement failed for %s", params.symbol)
        # Don't abort — position is open, mechanical exits will still protect it
    
    # Build rich entry snapshot
    ts = get_trading_settings()
    effective_usd = params.size_usd
    fees_paid = effective_usd * (ts.taker_fee_pct / 100)
    
    try:
        snapshot = build_entry_snapshot(
            symbol=params.symbol,
            side=params.side,
            trade_type=params.trade_type,
            fill_px=fill_px,
            fill_sz=fill_sz,
            leverage=params.leverage,
            sl_px=params.sl_px,
            tp_px=params.tp_px,
            size_usd=effective_usd,
            reference_price=price,
            fees_paid_usd=fees_paid,
            daemon=daemon,
            trigger_source=signal.trigger_source,
            trigger_type=signal.trigger_type,
            wake_source_id=None,
            scanner_detail=signal.trigger_detail,
            scanner_score=signal.conviction,
        )
        daemon._journal_store.insert_entry_snapshot(snapshot)
        daemon._open_trade_ids[params.symbol] = snapshot.trade_basics.trade_id
        daemon.record_trade_entry()
        daemon.register_position_type(params.symbol, params.trade_type)
        logger.info("Entry snapshot persisted: %s", snapshot.trade_basics.trade_id)
        return snapshot.trade_basics.trade_id
    except Exception:
        logger.exception("Entry snapshot persistence failed for %s", params.symbol)
        return None
```

---

## Daemon Integration

In `src/hynous/intelligence/daemon.py`:

### 1. Replace `_wake_for_scanner`

```python
def _evaluate_entry_signals(self, anomalies: list) -> None:
    """Evaluate ML-driven entry for each anomaly.
    
    Replaces _wake_for_scanner. No LLM involvement. Mechanical trigger
    source decides whether to fire an entry.
    """
    from hynous.mechanical_entry.interface import EntryEvaluationContext
    from hynous.mechanical_entry.executor import execute_trade_mechanical
    from datetime import datetime, timezone
    
    if not self._entry_trigger:
        return
    
    # For each anomaly, build a context and evaluate
    for anomaly in anomalies:
        symbol = anomaly.get("symbol", "BTC").upper()
        if symbol != "BTC":
            continue  # phase 1: BTC only
        
        ctx = EntryEvaluationContext(
            daemon=self,
            symbol=symbol,
            scanner_anomaly=anomaly,
            now_ts=datetime.now(timezone.utc).isoformat(),
        )
        
        try:
            signal = self._entry_trigger.evaluate(ctx)
        except Exception:
            logger.exception("Entry trigger evaluation failed for %s", symbol)
            continue
        
        if signal is None:
            continue  # rejection already recorded by trigger
        
        # Fire mechanical entry
        try:
            trade_id = execute_trade_mechanical(signal=signal, daemon=self)
            if trade_id:
                logger.info("Mechanical entry fired: %s", trade_id)
        except Exception:
            logger.exception("Mechanical entry execution failed for %s", symbol)
```

### 2. Initialize trigger source

In daemon `__init__`:

```python
self._entry_trigger = None

def _init_mechanical_entry(self) -> None:
    """Initialize the configured EntryTriggerSource."""
    cfg = self.config.v2.mechanical_entry
    if cfg.trigger_source == "ml_signal_driven":
        from hynous.mechanical_entry.ml_signal_driven import MLSignalDrivenTrigger
        self._entry_trigger = MLSignalDrivenTrigger(
            composite_threshold=cfg.composite_entry_threshold,
            direction_confidence_threshold=cfg.direction_confidence_threshold,
            entry_quality_threshold=cfg.require_entry_quality_pctl,
            max_vol_regime=cfg.max_vol_regime,
        )
    else:
        raise ValueError(f"Unknown trigger_source: {cfg.trigger_source}")
```

Call from daemon startup after journal store init.

### 3. Remove LLM wake calls

In `_wake_for_fill`, `_wake_for_profit`, `_wake_for_watchpoint`, `_wake_for_review`:
- Delete any LLM agent invocation (`agent.chat(...)`)
- Keep logging to `daemon_log` for observability
- Keep phase 3 analysis agent trigger (already fires on trade_exit events in `_fast_trigger_check`)

The wake methods become minimal notification + logging sinks. For the review wake specifically, it becomes a no-op or manual trigger for re-running analysis on recent trades.

### 4. Periodic ML signal check

Add a new periodic check: every 60s, even without a scanner anomaly, evaluate the ML trigger for BTC. This catches the case where conditions improve gradually without any specific anomaly.

```python
def _periodic_ml_signal_check(self) -> None:
    """Evaluate entry trigger for BTC every 60s even without scanner anomaly."""
    if not self._entry_trigger:
        return
    
    # Skip if there's already a position
    if "BTC" in self._prev_positions:
        return
    
    # Evaluate with empty anomaly (pure ML-driven)
    ctx = EntryEvaluationContext(
        daemon=self,
        symbol="BTC",
        scanner_anomaly=None,
        now_ts=datetime.now(timezone.utc).isoformat(),
    )
    try:
        signal = self._entry_trigger.evaluate(ctx)
        if signal:
            execute_trade_mechanical(signal=signal, daemon=self)
    except Exception:
        logger.exception("Periodic ML signal check failed")
```

Schedule from `_loop_inner` with a 60s interval guard.

---

## Refactor trading.py

After phase 4, `trading.py` still has `handle_execute_trade`, `handle_close_position`, `handle_modify_position`, `handle_get_account`, and helpers like `_place_triggers`, `_retry_exchange_call`, `_check_trading_allowed`.

### Delete from trading.py

- `handle_execute_trade` — functionality moves into `mechanical_entry/executor.py`
- `_store_trade_memory` (already removed in phase 4)
- The v1 `register` function that registers `execute_trade` as a tool

### Keep in trading.py

- `_place_triggers` — called from `executor.py` and `close_position`
- `_retry_exchange_call` — called from `executor.py`
- `_check_trading_allowed` — circuit breaker helper
- `_get_ml_conditions` — still useful for user chat agent
- `_record_trade_span` — still useful for trace logging
- `handle_close_position`, `handle_modify_position`, `handle_get_account` — exposed to user chat agent

### Update registry.py

Remove `execute_trade` from tool registrations. Only keep the tools that the user chat agent needs:
- `get_account`, `close_position`, `modify_position`
- `get_market_data`, `get_orderbook`, `get_funding_history` (if kept)
- `search_trades`, `get_trade_by_id` (new tools defined below for user chat)

---

## User Chat Agent (Minor Addition)

A minimal agent for dashboard chat, separate from the trading path. Lives at `src/hynous/user_chat/`.

```python
# src/hynous/user_chat/agent.py

class UserChatAgent:
    """Lightweight LLM wrapper for dashboard chat queries.
    
    Tool surface:
        - search_trades: query journal by filters
        - get_trade_by_id: get full trade bundle
        - get_market_data: current market snapshot
        - get_account: current account state
    
    No trade execution capability.
    """
    
    def __init__(self, *, model: str, journal_store, provider): ...
    
    def chat(self, message: str) -> str: ...
```

Engineer implements following the v1 agent.py patterns (use litellm, OpenRouter, standard tool loop). Keep it under 300 LOC. Mount as `/api/v2/chat` route.

Delete `src/hynous/intelligence/agent.py` (the v1 agent) once the user chat agent is stood up.

---

## Testing

### Unit tests

`tests/unit/test_mechanical_entry.py`:

1. `test_ml_signal_trigger_fires_on_strong_conditions`
2. `test_ml_signal_trigger_rejects_low_composite`
3. `test_ml_signal_trigger_rejects_stale_predictions`
4. `test_ml_signal_trigger_rejects_extreme_vol`
5. `test_ml_signal_trigger_rejects_existing_position`
6. `test_ml_signal_trigger_rejects_low_direction_confidence`
7. `test_ml_signal_trigger_records_rejection_in_journal`
8. `test_compute_entry_params_high_conviction_uses_high_tier`
9. `test_compute_entry_params_caps_leverage_for_extreme_vol`
10. `test_compute_entry_params_sl_distance_matches_vol_regime`
11. `test_compute_entry_params_tp_uses_roe_target`
12. `test_compute_entry_params_respects_max_position_usd`
13. `test_execute_trade_mechanical_happy_path_mocks`
14. `test_execute_trade_mechanical_handles_order_failure`
15. `test_execute_trade_mechanical_persists_entry_snapshot`

### Integration tests

`tests/integration/test_mechanical_entry_integration.py`:

1. `test_full_mechanical_lifecycle` — scanner → trigger → execute → mechanical exits → analysis (end-to-end with mocks)
2. `test_rejected_signals_accumulate_in_journal`
3. `test_periodic_ml_signal_check_fires_without_scanner`

### Smoke test

60-minute paper mode run. Verify:
- At least one mechanical entry fires (assuming ML conditions favorable)
- Rejected signals appear in `trades` table with `status='rejected'`
- On any closed trade, analysis fires and writes to `trade_analyses`
- No LLM calls in the entry path (grep log for "agent.chat")
- Mechanical exit layers still work

---

## Acceptance Criteria

- [ ] `src/hynous/mechanical_entry/` module with all 4 files
- [ ] `MLSignalDrivenTrigger` implements `EntryTriggerSource`
- [ ] `compute_entry_params` is pure-deterministic (test with same inputs returns same output)
- [ ] `execute_trade_mechanical` handles happy path and failures gracefully
- [ ] Daemon `_evaluate_entry_signals` replaces `_wake_for_scanner` for entry decisions
- [ ] Periodic ML signal check fires every 60s
- [ ] All LLM agent invocation removed from daemon wake methods
- [ ] `handle_execute_trade` removed from trading.py
- [ ] `execute_trade` unregistered from tools registry
- [ ] Rejected signals stored in journal with `status='rejected'` and rejection_reason
- [ ] User chat agent scaffolded at `src/hynous/user_chat/`
- [ ] v1 `agent.py` deleted
- [ ] All unit + integration tests pass
- [ ] 60-min smoke test produces at least one entry OR a set of clean rejections
- [ ] Phase 5 commits tagged `[phase-5]`

---

## Rollback

Phase 5 is harder to roll back than phase 4 because it refactors core flow. Each commit should still be a clean checkpoint. Revert in reverse order if needed.

---

## Report-Back

Include:
- Number of entries fired during smoke test
- Number of rejections recorded and their reasons (histogram)
- Any deviation from the pluggable interface (e.g., if you needed a second implementation mid-phase)
- Confirmation that the LLM is NOT called in the entry path (logs are the evidence)
