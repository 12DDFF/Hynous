"""Coordinates one Kronos shadow tick: fetch candles → infer → record.

Pure coordination logic; all heavy work is in :mod:`adapter`. Never raises —
failures log and return None so the daemon loop is unaffected.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from .adapter import KronosAdapter, KronosForecast
from .config import V2KronosShadowConfig
from .store import insert_kronos_shadow

logger = logging.getLogger(__name__)


class KronosShadowPredictor:
    """Owns the adapter + config; the daemon drives ticks."""

    def __init__(
        self,
        *,
        adapter: KronosAdapter,
        config: V2KronosShadowConfig,
    ) -> None:
        self._adapter = adapter
        self._config = config

    def predict_and_record(self, *, daemon: Any) -> KronosForecast | None:
        """Run one shadow tick. Returns the forecast (also persisted), or None on failure."""
        symbol = self._config.symbol.upper()
        journal = getattr(daemon, "_journal_store", None)
        if journal is None:
            logger.debug("kronos-shadow: no journal — skipping")
            return None

        try:
            provider = daemon._get_provider()
            end_ms = int(time.time() * 1000)
            start_ms = end_ms - self._config.lookback_bars * 3_600_000
            candles = provider.get_candles(symbol, "1h", start_ms, end_ms)
        except Exception:
            logger.exception("kronos-shadow: candle fetch failed for %s", symbol)
            return None

        if not candles or len(candles) < 64:
            logger.warning(
                "kronos-shadow: insufficient candles for %s (%d)",
                symbol,
                len(candles) if candles else 0,
            )
            return None

        try:
            forecast = self._adapter.predict_upside_prob(
                symbol=symbol,
                candles_1h=candles,
                pred_len=self._config.pred_len,
                sample_count=self._config.sample_count,
                T=self._config.temperature,
                top_p=self._config.top_p,
            )
        except Exception:
            logger.exception("kronos-shadow: inference failed for %s", symbol)
            return None

        if forecast.upside_prob >= self._config.long_threshold:
            shadow_decision = "long"
        elif forecast.upside_prob <= self._config.short_threshold:
            shadow_decision = "short"
        else:
            shadow_decision = "skip"

        live_decision = _snapshot_live_decision(daemon, symbol)

        try:
            insert_kronos_shadow(
                journal=journal,
                forecast=forecast,
                shadow_decision=shadow_decision,
                live_decision=live_decision,
                config=self._config,
            )
        except Exception:
            logger.exception("kronos-shadow: store write failed for %s", symbol)
            return None

        logger.info(
            "kronos-shadow %s: prob=%.3f → %s (live=%s) inference=%.0fms",
            symbol,
            forecast.upside_prob,
            shadow_decision,
            live_decision,
            forecast.inference_ms,
        )
        return forecast


def _snapshot_live_decision(daemon: Any, symbol: str) -> str:
    """Non-mutating peek at what the live trigger would currently emit.

    Returns one of: ``long`` / ``short`` / ``skip`` / ``unknown``.
    We read the cached ML predictions instead of calling
    ``trigger.evaluate`` because the latter would write a rejection row.
    """
    lock = getattr(daemon, "_latest_predictions_lock", None)
    latest = getattr(daemon, "_latest_predictions", {}) or {}
    if lock is not None:
        with lock:
            preds = dict(latest.get(symbol, {}))
    else:
        preds = dict(latest.get(symbol, {}))
    if not preds:
        return "unknown"
    sig = preds.get("signal")
    if sig in ("long", "short"):
        return sig
    return "skip"
