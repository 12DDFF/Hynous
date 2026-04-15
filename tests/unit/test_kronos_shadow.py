"""Unit tests for the Kronos shadow predictor (v2 post-launch).

Covers all M2–M5 acceptance points from
``v2-planning/12-kronos-shadow-integration.md`` without requiring the optional
``kronos-shadow`` extras (torch, huggingface_hub, einops). The adapter's
``predict_upside_prob`` is tested by injecting a fake predictor into
``KronosAdapter._predictor`` directly — no real model is loaded.
"""

from __future__ import annotations

import sqlite3
import threading
import time
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any
from unittest import mock

import pytest

from hynous.kronos_shadow import adapter as adapter_mod
from hynous.kronos_shadow.adapter import KronosAdapter, KronosForecast, is_kronos_available
from hynous.kronos_shadow.config import V2KronosShadowConfig
from hynous.kronos_shadow.shadow_predictor import (
    KronosShadowPredictor,
    _snapshot_live_decision,
)
from hynous.kronos_shadow.store import insert_kronos_shadow

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


@dataclass
class FakeJournal:
    """SQLite-backed minimal journal double for store tests.

    Mirrors the real :class:`JournalStore` contract:
    - ``_write_lock`` serializes mutations
    - ``_connect()`` returns a per-operation connection (autocommit)
    - a persistent ``_inspect_conn`` is exposed for test assertions only
    """

    _inspect_conn: sqlite3.Connection = field(default=None)  # type: ignore[assignment]
    _write_lock: threading.Lock = field(default_factory=threading.Lock)
    _db_path: str = ""

    def __post_init__(self) -> None:
        # Use a tmp file rather than :memory: so multiple SQLite
        # connections (inspect + per-op from insert_kronos_shadow) see the
        # same DB. File is auto-cleaned by the OS when the test process exits;
        # each FakeJournal gets a unique path.
        import tempfile

        fd, path = tempfile.mkstemp(prefix="fake_journal_", suffix=".db")
        import os

        os.close(fd)
        self._db_path = path
        boot = sqlite3.connect(self._db_path, isolation_level=None)
        from hynous.journal.schema import SCHEMA_DDL

        boot.executescript(SCHEMA_DDL)
        boot.close()
        self._inspect_conn = sqlite3.connect(self._db_path, isolation_level=None)

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._db_path, isolation_level=None)


@dataclass
class FakeProvider:
    """Returns a fixed candle list; records the arguments passed."""

    candles: list[dict[str, Any]] = field(default_factory=list)
    calls: list[tuple[str, str, int, int]] = field(default_factory=list)
    raise_on_call: bool = False

    def get_candles(
        self,
        symbol: str,
        interval: str,
        start_ms: int,
        end_ms: int,
    ) -> list[dict[str, Any]]:
        if self.raise_on_call:
            raise RuntimeError("fake provider failure")
        self.calls.append((symbol, interval, start_ms, end_ms))
        return self.candles


def _make_candles(n: int, base_close: float = 60000.0) -> list[dict[str, Any]]:
    out = []
    ts_ms = int(time.time() * 1000) - n * 3_600_000
    for i in range(n):
        close = base_close + i * 10.0
        out.append(
            {
                "t": ts_ms + i * 3_600_000,
                "o": close - 5.0,
                "h": close + 20.0,
                "l": close - 20.0,
                "c": close,
                "v": 100.0 + i,
            },
        )
    return out


def _make_daemon(
    *,
    journal: FakeJournal | None = None,
    provider: FakeProvider | None = None,
    latest_predictions: dict[str, Any] | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        _journal_store=journal,
        _get_provider=lambda: provider,
        _latest_predictions=latest_predictions or {},
        _latest_predictions_lock=threading.Lock(),
    )


def _default_config(**overrides: Any) -> V2KronosShadowConfig:
    base = dict(
        enabled=True,
        symbol="BTC",
        lookback_bars=200,
        pred_len=24,
        sample_count=20,
        temperature=1.0,
        top_p=0.9,
        long_threshold=0.60,
        short_threshold=0.40,
    )
    base.update(overrides)
    return V2KronosShadowConfig(**base)  # type: ignore[arg-type]


def _stub_forecast(**overrides: Any) -> KronosForecast:
    base = dict(
        symbol="BTC",
        model_variant="Kronos-mini",
        tokenizer_name="NeoQuasar/Kronos-Tokenizer-2k",
        lookback_len=200,
        pred_len=24,
        sample_count=20,
        current_close=60000.0,
        mean_forecast_close_end=60600.0,
        upside_prob=0.75,
        predicted_return_bps=100.0,
        sample_std_bps=30.0,
        inference_ms=2500.0,
        predicted_at=time.time(),
    )
    base.update(overrides)
    return KronosForecast(**base)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# M2 — Adapter
# ---------------------------------------------------------------------------


def test_is_kronos_available_returns_bool() -> None:
    # The real answer depends on whether torch is installed in this env.
    # Both outcomes are valid; we just assert the type and consistency.
    val = is_kronos_available()
    assert isinstance(val, bool)
    # Cached — second call returns the same value without side effects.
    assert is_kronos_available() is val


def test_adapter_load_raises_when_extras_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(adapter_mod, "_KRONOS_AVAILABLE", False)
    a = KronosAdapter(model_name="NeoQuasar/Kronos-mini")
    with pytest.raises(RuntimeError, match="Kronos shadow extras not installed"):
        a.load()


def test_adapter_predict_raises_if_not_loaded() -> None:
    a = KronosAdapter()
    with pytest.raises(RuntimeError, match="load"):
        a.predict_upside_prob(symbol="BTC", candles_1h=_make_candles(100))


def test_adapter_predict_rejects_short_candles() -> None:
    # Stub a predictor so we can get past the "not loaded" guard.
    a = KronosAdapter()
    a._predictor = mock.MagicMock()
    with pytest.raises(ValueError, match="≥64 candles"):
        a.predict_upside_prob(symbol="BTC", candles_1h=_make_candles(10))


def test_adapter_predict_rejects_non_list() -> None:
    a = KronosAdapter()
    a._predictor = mock.MagicMock()
    with pytest.raises(ValueError):
        a.predict_upside_prob(symbol="BTC", candles_1h="not-a-list")  # type: ignore[arg-type]


def test_adapter_model_variant_strips_org() -> None:
    assert KronosAdapter(model_name="NeoQuasar/Kronos-mini").model_variant == "Kronos-mini"
    assert KronosAdapter(model_name="Kronos-small").model_variant == "Kronos-small"


def test_adapter_predict_returns_forecast_with_stub_predictor() -> None:
    """Full path with a stubbed KronosPredictor: asserts shape, not numerical fidelity."""
    pytest.importorskip("pandas")
    import pandas as pd

    a = KronosAdapter()

    class StubPred:
        device = "cpu"

        def predict(self, *, df, x_timestamp, y_timestamp, pred_len, T, top_p, sample_count, verbose):  # noqa: ARG002, N803
            idx = y_timestamp
            # Simulate a modest upward forecast — close trends up from last close.
            last_close = float(df["close"].iloc[-1])
            out = pd.DataFrame(
                {
                    "open": [last_close] * pred_len,
                    "high": [last_close + 50.0] * pred_len,
                    "low": [last_close - 50.0] * pred_len,
                    "close": [last_close + (i + 1) * 5.0 for i in range(pred_len)],
                    "volume": [100.0] * pred_len,
                    "amount": [100.0 * last_close] * pred_len,
                },
                index=idx,
            )
            return out

    a._predictor = StubPred()
    forecast = a.predict_upside_prob(
        symbol="BTC", candles_1h=_make_candles(300), pred_len=24, sample_count=1,
    )

    assert isinstance(forecast, KronosForecast)
    assert forecast.symbol == "BTC"
    assert forecast.model_variant == "Kronos-mini"
    assert forecast.lookback_len == 300
    assert forecast.pred_len == 24
    assert forecast.sample_count == 1
    assert forecast.current_close > 0
    assert forecast.mean_forecast_close_end > forecast.current_close  # upward stub
    assert 0.0 <= forecast.upside_prob <= 1.0
    assert forecast.predicted_return_bps > 0
    assert forecast.sample_std_bps > 0
    assert forecast.inference_ms >= 0


def test_adapter_predict_trims_to_max_context() -> None:
    pytest.importorskip("pandas")
    import pandas as pd

    a = KronosAdapter(max_context=64)

    captured: dict[str, Any] = {}

    class CapturingPred:
        device = "cpu"

        def predict(self, *, df, x_timestamp, y_timestamp, pred_len, **_):  # noqa: ARG002
            captured["df_rows"] = len(df)
            captured["x_ts_len"] = len(x_timestamp)
            last = float(df["close"].iloc[-1])
            return pd.DataFrame(
                {
                    "open": [last] * pred_len,
                    "high": [last + 10.0] * pred_len,
                    "low": [last - 10.0] * pred_len,
                    "close": [last] * pred_len,
                    "volume": [0.0] * pred_len,
                    "amount": [0.0] * pred_len,
                },
                index=y_timestamp,
            )

    a._predictor = CapturingPred()
    a.predict_upside_prob(symbol="BTC", candles_1h=_make_candles(500), pred_len=2, sample_count=1)
    assert captured["df_rows"] == 64
    assert captured["x_ts_len"] == 64


# ---------------------------------------------------------------------------
# M3 — Shadow predictor
# ---------------------------------------------------------------------------


def test_shadow_returns_none_without_journal() -> None:
    daemon = _make_daemon(journal=None, provider=FakeProvider(candles=_make_candles(200)))
    adapter = KronosAdapter()
    adapter._predictor = mock.MagicMock()
    sp = KronosShadowPredictor(adapter=adapter, config=_default_config())
    assert sp.predict_and_record(daemon=daemon) is None


def test_shadow_returns_none_on_insufficient_candles() -> None:
    journal = FakeJournal()
    provider = FakeProvider(candles=_make_candles(10))  # way short
    daemon = _make_daemon(journal=journal, provider=provider)
    adapter = KronosAdapter()
    adapter._predictor = mock.MagicMock()
    sp = KronosShadowPredictor(adapter=adapter, config=_default_config())

    result = sp.predict_and_record(daemon=daemon)
    assert result is None
    # No insert attempted.
    rows = journal._inspect_conn.execute("SELECT COUNT(*) FROM kronos_shadow_predictions").fetchone()
    assert rows[0] == 0


def test_shadow_returns_none_on_provider_exception() -> None:
    journal = FakeJournal()
    provider = FakeProvider(raise_on_call=True)
    daemon = _make_daemon(journal=journal, provider=provider)
    adapter = KronosAdapter()
    adapter._predictor = mock.MagicMock()
    sp = KronosShadowPredictor(adapter=adapter, config=_default_config())

    result = sp.predict_and_record(daemon=daemon)
    assert result is None


def test_shadow_derives_long_on_high_upside_prob() -> None:
    journal = FakeJournal()
    provider = FakeProvider(candles=_make_candles(200))
    daemon = _make_daemon(journal=journal, provider=provider)

    adapter = KronosAdapter()
    adapter._predictor = mock.MagicMock()
    adapter.predict_upside_prob = mock.MagicMock(  # type: ignore[method-assign]
        return_value=_stub_forecast(upside_prob=0.75),
    )
    sp = KronosShadowPredictor(adapter=adapter, config=_default_config())

    result = sp.predict_and_record(daemon=daemon)
    assert result is not None
    row = journal._inspect_conn.execute(
        "SELECT shadow_decision FROM kronos_shadow_predictions",
    ).fetchone()
    assert row[0] == "long"


def test_shadow_derives_short_on_low_upside_prob() -> None:
    journal = FakeJournal()
    provider = FakeProvider(candles=_make_candles(200))
    daemon = _make_daemon(journal=journal, provider=provider)

    adapter = KronosAdapter()
    adapter._predictor = mock.MagicMock()
    adapter.predict_upside_prob = mock.MagicMock(  # type: ignore[method-assign]
        return_value=_stub_forecast(upside_prob=0.25),
    )
    sp = KronosShadowPredictor(adapter=adapter, config=_default_config())

    sp.predict_and_record(daemon=daemon)
    row = journal._inspect_conn.execute(
        "SELECT shadow_decision FROM kronos_shadow_predictions",
    ).fetchone()
    assert row[0] == "short"


def test_shadow_derives_skip_in_neutral_zone() -> None:
    journal = FakeJournal()
    provider = FakeProvider(candles=_make_candles(200))
    daemon = _make_daemon(journal=journal, provider=provider)

    adapter = KronosAdapter()
    adapter._predictor = mock.MagicMock()
    adapter.predict_upside_prob = mock.MagicMock(  # type: ignore[method-assign]
        return_value=_stub_forecast(upside_prob=0.50),
    )
    sp = KronosShadowPredictor(adapter=adapter, config=_default_config())

    sp.predict_and_record(daemon=daemon)
    row = journal._inspect_conn.execute(
        "SELECT shadow_decision FROM kronos_shadow_predictions",
    ).fetchone()
    assert row[0] == "skip"


def test_shadow_records_live_decision_snapshot() -> None:
    journal = FakeJournal()
    provider = FakeProvider(candles=_make_candles(200))
    daemon = _make_daemon(
        journal=journal,
        provider=provider,
        latest_predictions={"BTC": {"signal": "long"}},
    )

    adapter = KronosAdapter()
    adapter._predictor = mock.MagicMock()
    adapter.predict_upside_prob = mock.MagicMock(  # type: ignore[method-assign]
        return_value=_stub_forecast(upside_prob=0.30),  # shadow -> short
    )
    sp = KronosShadowPredictor(adapter=adapter, config=_default_config())

    sp.predict_and_record(daemon=daemon)
    row = journal._inspect_conn.execute(
        "SELECT shadow_decision, live_decision FROM kronos_shadow_predictions",
    ).fetchone()
    assert row == ("short", "long")  # disagreement captured


def test_shadow_inference_exception_is_swallowed() -> None:
    journal = FakeJournal()
    provider = FakeProvider(candles=_make_candles(200))
    daemon = _make_daemon(journal=journal, provider=provider)

    adapter = KronosAdapter()
    adapter._predictor = mock.MagicMock()
    adapter.predict_upside_prob = mock.MagicMock(  # type: ignore[method-assign]
        side_effect=RuntimeError("inference kaboom"),
    )
    sp = KronosShadowPredictor(adapter=adapter, config=_default_config())

    result = sp.predict_and_record(daemon=daemon)
    assert result is None
    # No row should have been persisted.
    assert journal._inspect_conn.execute(
        "SELECT COUNT(*) FROM kronos_shadow_predictions",
    ).fetchone()[0] == 0


def test_snapshot_live_decision_reads_long() -> None:
    daemon = _make_daemon(latest_predictions={"BTC": {"signal": "long"}})
    assert _snapshot_live_decision(daemon, "BTC") == "long"


def test_snapshot_live_decision_reads_short() -> None:
    daemon = _make_daemon(latest_predictions={"BTC": {"signal": "short"}})
    assert _snapshot_live_decision(daemon, "BTC") == "short"


def test_snapshot_live_decision_skip_on_non_directional() -> None:
    daemon = _make_daemon(latest_predictions={"BTC": {"signal": "conflict"}})
    assert _snapshot_live_decision(daemon, "BTC") == "skip"


def test_snapshot_live_decision_unknown_without_preds() -> None:
    daemon = _make_daemon(latest_predictions={})
    assert _snapshot_live_decision(daemon, "BTC") == "unknown"


# ---------------------------------------------------------------------------
# M5 — Store writer
# ---------------------------------------------------------------------------


def test_insert_writes_all_columns() -> None:
    journal = FakeJournal()
    forecast = _stub_forecast(
        upside_prob=0.42,
        predicted_return_bps=-35.0,
        sample_std_bps=50.0,
    )
    cfg = _default_config()

    insert_kronos_shadow(
        journal=journal,
        forecast=forecast,
        shadow_decision="skip",
        live_decision="long",
        config=cfg,
    )

    row = journal._inspect_conn.execute(
        """
        SELECT symbol, model_variant, tokenizer_name, lookback_len, pred_len,
               sample_count, current_close, mean_forecast_close_end,
               predicted_return_bps, sample_std_bps, upside_prob,
               shadow_decision, live_decision, long_threshold, short_threshold,
               inference_ms
        FROM kronos_shadow_predictions
        """,
    ).fetchone()
    assert row == (
        "BTC",
        "Kronos-mini",
        "NeoQuasar/Kronos-Tokenizer-2k",
        200,
        24,
        20,
        60000.0,
        60600.0,
        -35.0,
        50.0,
        0.42,
        "skip",
        "long",
        0.60,
        0.40,
        2500.0,
    )


def test_insert_indexes_exist() -> None:
    journal = FakeJournal()
    idx_names = {
        r[0]
        for r in journal._inspect_conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' "
            "AND tbl_name='kronos_shadow_predictions'",
        ).fetchall()
    }
    assert {
        "idx_kronos_shadow_predicted_at",
        "idx_kronos_shadow_symbol",
        "idx_kronos_shadow_decision",
    } <= idx_names


# ---------------------------------------------------------------------------
# M4 — Config wiring
# ---------------------------------------------------------------------------


def test_v2_kronos_shadow_defaults_from_yaml(tmp_path) -> None:
    from hynous.core.config import load_config

    cfg = load_config()  # reads repo's config/default.yaml
    assert cfg.v2.kronos_shadow.enabled is False
    assert cfg.v2.kronos_shadow.symbol == "BTC"
    assert cfg.v2.kronos_shadow.model_name == "NeoQuasar/Kronos-base"
    assert cfg.v2.kronos_shadow.tokenizer_name == "NeoQuasar/Kronos-Tokenizer-base"
    assert cfg.v2.kronos_shadow.lookback_bars == 360
    assert cfg.v2.kronos_shadow.long_threshold == 0.60
    assert cfg.v2.kronos_shadow.short_threshold == 0.40


def test_v2_kronos_shadow_config_dataclass_defaults() -> None:
    cfg = V2KronosShadowConfig()
    assert cfg.enabled is False
    assert cfg.tick_interval_s == 300
    assert cfg.device is None
    assert cfg.pred_len == 24
    assert cfg.sample_count == 20
