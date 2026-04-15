"""Single-purpose SQLite writer for ``kronos_shadow_predictions`` rows.

Lives in ``kronos_shadow/`` (not ``journal/``) because it is the only caller
of this table and we don't want to bloat :class:`JournalStore` with
feature-specific methods. If a second caller ever appears, promote this to a
``JournalStore.insert_kronos_shadow`` method.

Matches the real :class:`JournalStore` contract: per-operation connections
(opened via ``journal._connect()``) serialized through
``journal._write_lock``. Autocommit is on (``isolation_level=None`` in
``_connect``) so no explicit commit is required.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .adapter import KronosForecast
from .config import V2KronosShadowConfig

_INSERT_SQL = """
INSERT INTO kronos_shadow_predictions (
    predicted_at, symbol, model_variant, tokenizer_name,
    lookback_len, pred_len, sample_count,
    current_close, mean_forecast_close_end,
    predicted_return_bps, sample_std_bps, upside_prob,
    shadow_decision, live_decision,
    long_threshold, short_threshold,
    inference_ms, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""


def insert_kronos_shadow(
    *,
    journal: Any,
    forecast: KronosForecast,
    shadow_decision: str,
    live_decision: str,
    config: V2KronosShadowConfig,
) -> None:
    """Persist one row via a per-operation connection.

    Serializes on :attr:`JournalStore._write_lock`. Raises the underlying DB
    exception on failure; the :class:`KronosShadowPredictor` caller swallows.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    row = (
        forecast.predicted_at,
        forecast.symbol,
        forecast.model_variant,
        forecast.tokenizer_name,
        forecast.lookback_len,
        forecast.pred_len,
        forecast.sample_count,
        forecast.current_close,
        forecast.mean_forecast_close_end,
        forecast.predicted_return_bps,
        forecast.sample_std_bps,
        forecast.upside_prob,
        shadow_decision,
        live_decision,
        config.long_threshold,
        config.short_threshold,
        forecast.inference_ms,
        now_iso,
    )
    with journal._write_lock:
        conn = journal._connect()
        try:
            conn.execute(_INSERT_SQL, row)
        finally:
            conn.close()
