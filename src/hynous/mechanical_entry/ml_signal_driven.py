"""ML-signal-driven entry trigger (v2 phase 5, Option B).

Fires an ``EntrySignal`` when all of the following gates pass:

1. Circuit breaker inactive (``daemon.trading_paused`` is False).
2. No existing position on ``symbol`` (one position at a time).
3. ML predictions present for ``symbol`` in ``daemon._latest_predictions``.
4. Predictions fresh (``conditions["timestamp"]`` within 600 s of now).
5. Composite entry score >= ``composite_threshold``.
6. Direction model emits ``"long"`` or ``"short"`` (not ``"skip"`` / ``"conflict"``).
7. (Optional) Tick direction model agrees with satellite direction.
8. Direction confidence >= ``direction_confidence_threshold``.
9. Entry-quality percentile >= ``entry_quality_threshold``.
10. Vol regime rank <= ``max_vol_regime`` rank.

Gate ordering is load-bearing: cheapest / most-likely-to-reject gates run
first. Do not reorder without a matching update to phase 6's rejection
analysis plan.

Rejection path writes a single ``trades`` row via ``journal.upsert_trade``
with ``status='rejected'`` and returns ``None``. Per M2 directive, no entry
snapshot is written — that is deferred to phase 6 (batch-rejection analysis).
"""

from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from .interface import EntryEvaluationContext, EntrySignal, EntryTriggerSource

logger = logging.getLogger(__name__)

_VOL_RANK: dict[str, int] = {"low": 0, "normal": 1, "high": 2, "extreme": 3}


class MLSignalDrivenTrigger(EntryTriggerSource):
    """Entry trigger driven purely by ML signals (phase 5 Option B).

    The trigger is dependency-light: no ``hynous.intelligence.*`` imports,
    and the ``journal.store`` import is performed lazily inside the
    rejection writer so the module stays cheap to import in unit tests.
    """

    def __init__(
        self,
        *,
        composite_threshold: float,
        direction_confidence_threshold: float,
        entry_quality_threshold: int,
        max_vol_regime: str,
        tick_confirmation_enabled: bool = False,
        tick_confirmation_horizon: str = "direction_10s",
    ) -> None:
        self._composite_threshold = composite_threshold
        self._direction_conf_threshold = direction_confidence_threshold
        self._entry_quality_threshold = entry_quality_threshold
        self._max_vol_regime = max_vol_regime
        self._tick_confirmation_enabled = tick_confirmation_enabled
        self._tick_confirmation_horizon = tick_confirmation_horizon

    def name(self) -> str:
        return "ml_signal_driven"

    def evaluate(self, ctx: EntryEvaluationContext) -> EntrySignal | None:
        daemon = ctx.daemon
        symbol = ctx.symbol.upper()

        # Gate 0: circuit breaker
        if getattr(daemon, "trading_paused", False):
            self._rejection_record(
                ctx,
                symbol=symbol,
                reason="circuit_breaker_active",
                detail={"reason": "daemon.trading_paused"},
            )
            return None

        # Gate 1: no existing position on symbol
        prev_positions = getattr(daemon, "_prev_positions", {}) or {}
        if symbol in prev_positions:
            self._rejection_record(
                ctx,
                symbol=symbol,
                reason="already_has_position",
                detail={"existing_position": prev_positions.get(symbol)},
            )
            return None

        # Gate 2: ML predictions present
        preds_lock = getattr(daemon, "_latest_predictions_lock", None)
        latest_predictions = getattr(daemon, "_latest_predictions", {}) or {}
        if preds_lock is not None:
            with preds_lock:
                preds = dict(latest_predictions.get(symbol, {}))
        else:
            preds = dict(latest_predictions.get(symbol, {}))

        if not preds:
            self._rejection_record(
                ctx,
                symbol=symbol,
                reason="no_ml_predictions",
                detail={"symbol": symbol},
            )
            return None

        # Gate 3: staleness (conditions["timestamp"] is unix seconds — see
        # daemon.py cache writes at lines 1651-1652).
        conditions = preds.get("conditions", {}) or {}
        pred_ts = conditions.get("timestamp", 0) or 0
        staleness = time.time() - pred_ts if pred_ts > 0 else 1e9
        if staleness > 600:  # > 10 min stale
            self._rejection_record(
                ctx,
                symbol=symbol,
                reason="ml_predictions_stale",
                detail={"staleness_s": staleness},
            )
            return None

        # Gate 4: composite entry score.
        # NOTE: daemon.py writes this under ``entry_score`` (no underscore
        # prefix) at the satellite inference cache. Keep in sync.
        comp_score = preds.get("entry_score")
        if comp_score is None:
            self._rejection_record(
                ctx,
                symbol=symbol,
                reason="no_composite_score",
                detail={},
            )
            return None
        if comp_score < self._composite_threshold:
            self._rejection_record(
                ctx,
                symbol=symbol,
                reason="composite_below_threshold",
                detail={
                    "score": comp_score,
                    "threshold": self._composite_threshold,
                },
            )
            return None

        # Gate 5: direction model signal
        direction_signal = preds.get("signal")  # "long" | "short" | "skip" | "conflict"
        if direction_signal not in ("long", "short"):
            self._rejection_record(
                ctx,
                symbol=symbol,
                reason="no_direction_signal",
                detail={"signal": direction_signal},
            )
            return None

        # Gate 6 (optional): tick direction confirmation.
        # Tick predictions are cached by daemon._poll_derivatives under tick_* keys.
        # tick_signal is "long" | "short" | "skip" | None (engine missing / stale tick data).
        # When enabled, satellite direction must agree with tick_signal or be confirmed by the
        # chosen horizon's sign in tick_predictions. "skip" or disagreement = reject.
        if self._tick_confirmation_enabled:
            tick_signal = preds.get("tick_signal")
            tick_return_bps = preds.get("tick_return_bps")
            horizon_pred_bps = (preds.get("tick_predictions") or {}).get(
                self._tick_confirmation_horizon,
            )
            if tick_signal is None and horizon_pred_bps is None:
                self._rejection_record(
                    ctx,
                    symbol=symbol,
                    reason="tick_confirmation_unavailable",
                    detail={"tick_signal": None, "horizon": self._tick_confirmation_horizon},
                )
                return None
            # Prefer the specific horizon's sign when we have it; fall back to tick_signal.
            if horizon_pred_bps is not None:
                tick_agrees = (
                    (direction_signal == "long" and horizon_pred_bps > 0)
                    or (direction_signal == "short" and horizon_pred_bps < 0)
                )
            else:
                tick_agrees = tick_signal == direction_signal
            if not tick_agrees:
                self._rejection_record(
                    ctx,
                    symbol=symbol,
                    reason="tick_direction_disagreement",
                    detail={
                        "direction": direction_signal,
                        "tick_signal": tick_signal,
                        "horizon": self._tick_confirmation_horizon,
                        "horizon_pred_bps": horizon_pred_bps,
                        "tick_return_bps": tick_return_bps,
                    },
                )
                return None

        # Gate 7: direction confidence.
        # NOTE: ``max(abs(long_roe), abs(short_roe)) / 10.0`` is a rough
        # normalizer carried forward from the v1 adaptive trailing layer.
        # A formal calibration is deferred to phase 8.
        long_roe = preds.get("long_roe", 0) or 0
        short_roe = preds.get("short_roe", 0) or 0
        direction_conf = max(abs(long_roe), abs(short_roe)) / 10.0
        if direction_conf < self._direction_conf_threshold:
            self._rejection_record(
                ctx,
                symbol=symbol,
                reason="direction_confidence_below_threshold",
                detail={
                    "confidence": direction_conf,
                    "threshold": self._direction_conf_threshold,
                },
            )
            return None

        # Gate 8: entry-quality percentile
        eq = conditions.get("entry_quality", {}) or {}
        eq_pctl = eq.get("percentile", 0) or 0
        if eq_pctl < self._entry_quality_threshold:
            self._rejection_record(
                ctx,
                symbol=symbol,
                reason="entry_quality_below_threshold",
                detail={
                    "pctl": eq_pctl,
                    "threshold": self._entry_quality_threshold,
                },
            )
            return None

        # Gate 9: vol regime
        vol_regime = (conditions.get("vol_1h", {}) or {}).get("regime", "normal")
        if _VOL_RANK.get(vol_regime, 99) > _VOL_RANK.get(self._max_vol_regime, 2):
            self._rejection_record(
                ctx,
                symbol=symbol,
                reason="vol_regime_above_max",
                detail={"regime": vol_regime, "max": self._max_vol_regime},
            )
            return None

        # All gates passed — fire the signal.
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
            expires_at=None,
        )

    def _rejection_record(
        self,
        ctx: EntryEvaluationContext,
        *,
        symbol: str,
        reason: str,
        detail: dict[str, Any],
    ) -> None:
        """Write a rejection row to the journal and return ``None``.

        Fire-and-forget: if the journal is unavailable (e.g. unit tests
        without a store) or any write error occurs, we log and return
        ``None``. We never raise — the caller always ends up returning
        ``None`` upward.

        The rejection ``trigger_type`` column stores the rejection reason
        (e.g. ``composite_below_threshold``). Fired entries will store the
        positive trigger (``composite_score_plus_direction``) in the same
        column; phase 6's rejection analysis filters on the ``rej_`` trade
        id prefix to distinguish the two.
        """
        daemon = ctx.daemon
        journal = getattr(daemon, "_journal_store", None)
        if journal is None:
            logger.debug(
                "ml_signal_driven rejection recorded (no journal): %s (%s)",
                symbol,
                reason,
            )
            return None

        trade_id = f"rej_{uuid.uuid4().hex[:16]}"
        now_iso = ctx.now_ts or datetime.now(timezone.utc).isoformat()

        try:
            journal.upsert_trade(
                trade_id=trade_id,
                symbol=symbol,
                side="none",
                trade_type="macro",
                status="rejected",
                entry_ts=now_iso,
                rejection_reason=reason,
                trigger_source=self.name(),
                trigger_type=reason,
            )
            logger.debug(
                "ml_signal_driven rejection %s: %s %s detail=%s",
                trade_id,
                symbol,
                reason,
                detail,
            )
        except Exception:
            logger.exception(
                "Failed to record ml_signal_driven rejection for %s: %s",
                symbol,
                reason,
            )

        return None
