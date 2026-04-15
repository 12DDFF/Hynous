"""Opt-in Kronos shadow smoke test.

This test exercises the real Kronos model and therefore needs:

* ``pip install -e ".[kronos-shadow]"`` (torch + huggingface_hub + einops)
* Network access to HuggingFace (first run downloads ~200 MB of weights)

Run with:

    pytest -m kronos tests/integration/test_kronos_shadow_smoke.py

Without the extras, the test skips cleanly.
"""

from __future__ import annotations

import sqlite3
import threading
import time
from types import SimpleNamespace

import pytest

pytest.importorskip("torch", reason="Kronos shadow extras (torch) not installed")
pytest.importorskip("huggingface_hub", reason="Kronos shadow extras (huggingface_hub) not installed")
pytest.importorskip("einops", reason="Kronos shadow extras (einops) not installed")


@pytest.mark.kronos
def test_end_to_end_inference_and_journal_write() -> None:
    """Run one real Kronos-mini inference and assert a row lands in the DB.

    This is a smoke test — it does NOT assert numerical accuracy. It
    confirms:
      * Model + tokenizer download + load succeed
      * A 200-candle synthetic BTC history produces a KronosForecast
      * One row lands in kronos_shadow_predictions with all required columns
    """
    from hynous.journal.schema import SCHEMA_DDL
    from hynous.kronos_shadow.adapter import KronosAdapter
    from hynous.kronos_shadow.config import V2KronosShadowConfig
    from hynous.kronos_shadow.shadow_predictor import KronosShadowPredictor

    # Minimal journal double (real DDL, in-memory DB).
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA_DDL)
    journal = SimpleNamespace(_conn=conn, _lock=threading.Lock())

    # Synthetic 200-bar 1h BTC history.
    now_ms = int(time.time() * 1000)
    candles = []
    base = 60000.0
    for i in range(200):
        close = base + (i * 15.0) + ((i % 7) - 3) * 50.0
        candles.append(
            {
                "t": now_ms - (200 - i) * 3_600_000,
                "o": close - 20.0,
                "h": close + 80.0,
                "l": close - 80.0,
                "c": close,
                "v": 100.0 + i,
            },
        )

    provider = SimpleNamespace(
        get_candles=lambda symbol, interval, start_ms, end_ms: candles,
    )
    daemon = SimpleNamespace(
        _journal_store=journal,
        _get_provider=lambda: provider,
        _latest_predictions={"BTC": {"signal": "long"}},
        _latest_predictions_lock=threading.Lock(),
    )

    # Use smallest / fastest combo for the smoke run. sample_count=1 to
    # minimize CPU time; the smoke confirms wiring, not MC quality.
    adapter = KronosAdapter(
        model_name="NeoQuasar/Kronos-mini",
        tokenizer_name="NeoQuasar/Kronos-Tokenizer-2k",
        max_context=512,
    )
    adapter.load()
    cfg = V2KronosShadowConfig(
        enabled=True,
        symbol="BTC",
        lookback_bars=200,
        pred_len=24,
        sample_count=1,
    )
    sp = KronosShadowPredictor(adapter=adapter, config=cfg)

    forecast = sp.predict_and_record(daemon=daemon)
    assert forecast is not None
    assert forecast.symbol == "BTC"
    assert forecast.model_variant == "Kronos-mini"

    row = conn.execute(
        "SELECT symbol, shadow_decision, live_decision, inference_ms "
        "FROM kronos_shadow_predictions",
    ).fetchone()
    assert row is not None
    assert row[0] == "BTC"
    assert row[1] in ("long", "short", "skip")
    assert row[2] == "long"
    assert row[3] > 0  # inference took some measurable time
