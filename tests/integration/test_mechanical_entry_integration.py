"""Phase 5 Milestone 8 — integration tests for the v2 mechanical entry pipeline.

Three end-to-end scenarios covering the phase 5 plan integration cases
(``v2-planning/08-phase-5-mechanical-entry.md`` lines 786-790):

1. ``test_full_mechanical_lifecycle`` — scanner anomaly →
   ``_evaluate_entry_signals`` → ``MLSignalDrivenTrigger.evaluate`` returns a
   signal → ``execute_trade_mechanical`` → entry snapshot captured in journal
   → mechanical exit hit (mock SL trigger) → exit snapshot captured →
   analysis agent fires and writes to ``trade_analyses``.
2. ``test_rejected_signals_accumulate_in_journal`` — three successive
   evaluations with progressively failing gates produce three ``status='rejected'``
   rows, each with the correct ``rejection_reason``.
3. ``test_periodic_ml_signal_check_fires_without_scanner`` — ``_periodic_ml_signal_check``
   with favorable predictions and no active position fires
   ``execute_trade_mechanical`` and a trade lands in the journal.

Pattern-match ``test_v2_journal_integration.py`` + ``test_v2_analysis_integration.py``:
real :class:`JournalStore` on tmp SQLite, provider + analysis LLM mocked, the
mechanical_entry module otherwise unmocked. The daemon itself is a
``SimpleNamespace`` fake with the attributes ``_evaluate_entry_signals`` +
``_periodic_ml_signal_check`` + ``execute_trade_mechanical`` actually read.
"""

from __future__ import annotations

import json
import sys
import time
import types
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

# ---------------------------------------------------------------------------
# Module-level import shim — mirrors the litellm stub in other v2 suites.
# ``hynous.intelligence.__init__`` transitively imports ``litellm``; stubbing it
# lets the real ``hynous.intelligence.tools.trading`` module load cleanly,
# which is what the executor's lazy import needs.
# ---------------------------------------------------------------------------
if "litellm" not in sys.modules:
    sys.modules["litellm"] = types.ModuleType("litellm")
    sys.modules["litellm.exceptions"] = types.ModuleType("litellm.exceptions")
    sys.modules["litellm.exceptions"].APIError = Exception  # type: ignore[attr-defined]

import pytest  # noqa: E402

from hynous.intelligence.daemon import Daemon  # noqa: E402
from hynous.mechanical_entry.interface import (  # noqa: E402
    EntryEvaluationContext,
)
from hynous.mechanical_entry.ml_signal_driven import (  # noqa: E402
    MLSignalDrivenTrigger,
)


# ---------------------------------------------------------------------------
# Fakes / helpers
# ---------------------------------------------------------------------------


def _make_mech_cfg(
    *,
    trigger_source: str = "ml_signal_driven",
    coin: str = "BTC",
    composite_threshold: float = 50,
    direction_conf: float = 0.55,
    eq_pctl: int = 60,
    max_vol: str = "high",
) -> SimpleNamespace:
    return SimpleNamespace(
        trigger_source=trigger_source,
        coin=coin,
        composite_entry_threshold=composite_threshold,
        direction_confidence_threshold=direction_conf,
        require_entry_quality_pctl=eq_pctl,
        max_vol_regime=max_vol,
        roe_target_pct=10.0,
    )


def _make_favorable_predictions() -> dict[str, Any]:
    """Predictions dict that satisfies every MLSignalDrivenTrigger gate."""
    return {
        "BTC": {
            "signal": "long",
            "long_roe": 6.0,
            "short_roe": -1.2,
            "entry_score": 72,
            "conditions": {
                "timestamp": time.time(),
                "entry_quality": {"percentile": 75},
                "vol_1h": {"regime": "normal"},
            },
        },
    }


def _make_provider(
    *,
    price: float = 50_000.0,
    account_value: float = 10_000.0,
    fill_sz: float = 0.04,
    fill_avg_px: float = 50_010.0,
) -> MagicMock:
    provider = MagicMock()
    provider.get_price.return_value = price
    provider.get_user_state.return_value = {"account_value": account_value}
    provider.update_leverage.return_value = None
    provider.market_open.return_value = {
        "status": "filled",
        "avg_px": fill_avg_px,
        "filled_sz": fill_sz,
    }
    provider.place_trigger_order.return_value = None
    return provider


def _make_fake_daemon(
    *,
    journal_store: Any,
    provider: Any,
    predictions: dict[str, Any] | None = None,
    prev_positions: dict | None = None,
    trigger_source: str = "ml_signal_driven",
    coin: str = "BTC",
) -> SimpleNamespace:
    """Assemble a daemon stand-in with exactly the surface area the
    mechanical entry pipeline touches."""
    cfg = SimpleNamespace(
        v2=SimpleNamespace(
            mechanical_entry=_make_mech_cfg(
                trigger_source=trigger_source, coin=coin,
            ),
        ),
        hyperliquid=SimpleNamespace(default_slippage=0.01),
    )
    daemon = SimpleNamespace(
        config=cfg,
        _entry_trigger=None,
        _prev_positions=prev_positions or {},
        _latest_predictions=predictions or {},
        _latest_predictions_lock=None,
        _journal_store=journal_store,
        _open_trade_ids={},
        trading_paused=False,
        _get_provider=lambda: provider,
        record_trade_entry=MagicMock(),
        register_position_type=MagicMock(),
    )
    # Bind the real methods to the fake.
    daemon._init_mechanical_entry = types.MethodType(  # type: ignore[attr-defined]
        Daemon._init_mechanical_entry, daemon,
    )
    daemon._evaluate_entry_signals = types.MethodType(  # type: ignore[attr-defined]
        Daemon._evaluate_entry_signals, daemon,
    )
    daemon._periodic_ml_signal_check = types.MethodType(  # type: ignore[attr-defined]
        Daemon._periodic_ml_signal_check, daemon,
    )
    return daemon


def _valid_llm_output() -> dict[str, Any]:
    """Minimum-shape valid analysis LLM response (mirrors
    ``test_v2_analysis_integration.py``)."""
    return {
        "narrative": "Mechanical entry fired on a clean composite. Exit "
                     "tripped stop_loss at scripted level.",
        "narrative_citations": [{"paragraph_idx": 0, "finding_ids": ["f1"]}],
        "supplemental_findings": [],
        "grades": {
            "entry_quality_grade": 72,
            "entry_timing_grade": 70,
            "sl_placement_grade": 65,
            "tp_placement_grade": 60,
            "size_leverage_grade": 70,
            "exit_quality_grade": 55,
        },
        "mistake_tags": [],
        "process_quality_score": 65,
        "one_line_summary": "Mechanical entry, stop-loss exit.",
    }


def _fake_litellm_response(*, content: str) -> Any:
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(prompt_tokens=0, completion_tokens=0),
        _hidden_params={"response_cost": 0.0},
    )


# ---------------------------------------------------------------------------
# 1. Full mechanical lifecycle — entry → exit → analysis
# ---------------------------------------------------------------------------


def test_full_mechanical_lifecycle(
    tmp_journal_db: Any,
    sample_entry_snapshot: Any,
    sample_exit_snapshot: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Scanner anomaly → ML signal → entry snapshot → exit snapshot → analysis.

    The ``build_entry_snapshot`` call is patched to return
    ``sample_entry_snapshot`` so the integration test doesn't depend on the
    daemon's full data-layer wiring — the goal is to verify the pipeline
    plumbing (trigger → executor → journal → analysis), not to re-test
    snapshot construction (covered by unit tests).
    """
    from hynous.analysis import wake_integration
    from hynous.mechanical_entry.executor import execute_trade_mechanical

    # --- Set up daemon with favorable ML predictions + real journal store ---
    provider = _make_provider()
    daemon = _make_fake_daemon(
        journal_store=tmp_journal_db,
        provider=provider,
        predictions=_make_favorable_predictions(),
    )
    daemon._init_mechanical_entry()
    assert isinstance(daemon._entry_trigger, MLSignalDrivenTrigger)

    # --- Fire entry via scanner-anomaly path ---
    anomalies = [SimpleNamespace(symbol="BTC", headline="px spike")]

    with patch(
        "hynous.mechanical_entry.executor.build_entry_snapshot",
        return_value=sample_entry_snapshot,
    ):
        daemon._evaluate_entry_signals(anomalies)

    # Entry persisted: trade_id recorded, row in journal with status='open'.
    trade_id = sample_entry_snapshot.trade_basics.trade_id
    assert daemon._open_trade_ids.get("BTC") == trade_id
    daemon.record_trade_entry.assert_called_once()
    daemon.register_position_type.assert_called_once_with("BTC", "macro")

    bundle = tmp_journal_db.get_trade(trade_id)
    assert bundle is not None
    assert bundle["status"] == "open"
    assert bundle["entry_snapshot"] is not None

    # --- Persist exit snapshot (simulate mechanical SL hit) ---
    tmp_journal_db.insert_exit_snapshot(sample_exit_snapshot)
    tmp_journal_db.upsert_trade(
        trade_id=trade_id,
        symbol=sample_entry_snapshot.trade_basics.symbol,
        side=sample_entry_snapshot.trade_basics.side,
        trade_type=sample_entry_snapshot.trade_basics.trade_type,
        status="closed",
        exit_classification="stop_loss",
        realized_pnl_usd=-18.20,
        peak_roe=5.0,
        roe_pct=-3.1,
    )

    # --- Fire analysis agent (litellm + embedding stubbed) ---
    fake_resp = _fake_litellm_response(content=json.dumps(_valid_llm_output()))
    monkeypatch.setattr("litellm.completion", lambda **_kw: fake_resp, raising=False)
    monkeypatch.setattr(
        wake_integration, "build_analysis_embedding", lambda _text: b"emb",
    )

    wake_integration.trigger_analysis_for_trade(
        trade_id=trade_id,
        journal_store=tmp_journal_db,
        model="anthropic/claude-sonnet-4.5",
        prompt_version="v1",
    )

    # --- Assert the full lifecycle landed in the journal ---
    analysis = tmp_journal_db.get_analysis(trade_id)
    assert analysis is not None
    assert analysis["narrative"].startswith("Mechanical entry fired")
    assert analysis["prompt_version"] == "v1"
    assert analysis["model_used"] == "anthropic/claude-sonnet-4.5"
    assert analysis["process_quality_score"] == 65

    final_bundle = tmp_journal_db.get_trade(trade_id)
    assert final_bundle is not None
    assert final_bundle["status"] == "analyzed"
    assert final_bundle["entry_snapshot"] is not None
    assert final_bundle["exit_snapshot"] is not None
    assert final_bundle["analysis"] is not None

    # Provider side-effects observed (entry path only — exit is mocked).
    provider.get_price.assert_called_with("BTC")
    provider.update_leverage.assert_called_once()
    provider.market_open.assert_called_once()
    # Trigger placement happens via _place_triggers → place_trigger_order × 2.
    assert provider.place_trigger_order.call_count == 2

    # Keep a reference to ``execute_trade_mechanical`` import so linters don't
    # flag the unused import — it's exercised transitively via
    # ``_evaluate_entry_signals``.
    assert execute_trade_mechanical is not None


# ---------------------------------------------------------------------------
# 2. Rejected signals accumulate in the journal with the correct reason
# ---------------------------------------------------------------------------


def test_rejected_signals_accumulate_in_journal(
    tmp_journal_db: Any,
) -> None:
    """Three successive evaluations with distinct gate failures persist three
    ``status='rejected'`` rows. No executor is called — each path short-
    circuits at a gate inside the trigger.

    Cases:
        a. ML predictions stale (``ml_predictions_stale``).
        b. Composite score below threshold (``composite_below_threshold``).
        c. Existing position on the target coin (``already_has_position``).
    """
    now = time.time()

    # Start with a daemon that has no position and no predictions at all; then
    # we'll mutate state per case to exercise each rejection path.
    provider = _make_provider()
    daemon = _make_fake_daemon(
        journal_store=tmp_journal_db,
        provider=provider,
        predictions={},
    )
    daemon._init_mechanical_entry()

    # --- (a) Stale ML predictions (timestamp > 600s old) ---
    daemon._latest_predictions = {
        "BTC": {
            "signal": "long",
            "long_roe": 6.0,
            "short_roe": -1.0,
            "entry_score": 72,
            "conditions": {
                "timestamp": now - 3600,  # 1h old — stale
                "entry_quality": {"percentile": 75},
                "vol_1h": {"regime": "normal"},
            },
        },
    }
    daemon._evaluate_entry_signals([SimpleNamespace(symbol="BTC")])

    # --- (b) Composite below threshold (40 < 50) ---
    daemon._latest_predictions = {
        "BTC": {
            "signal": "long",
            "long_roe": 6.0,
            "short_roe": -1.0,
            "entry_score": 40,  # below the 50 threshold
            "conditions": {
                "timestamp": now,
                "entry_quality": {"percentile": 75},
                "vol_1h": {"regime": "normal"},
            },
        },
    }
    daemon._evaluate_entry_signals([SimpleNamespace(symbol="BTC")])

    # --- (c) Already has position on BTC ---
    daemon._latest_predictions = _make_favorable_predictions()
    daemon._prev_positions = {"BTC": {"side": "long", "size": 0.02}}
    daemon._evaluate_entry_signals([SimpleNamespace(symbol="BTC")])

    # --- Assert: three rejection rows, zero executor invocations ---
    rejections = tmp_journal_db.list_trades(status="rejected", limit=50)
    assert len(rejections) == 3

    reasons = {r["rejection_reason"] for r in rejections}
    assert reasons == {
        "ml_predictions_stale",
        "composite_below_threshold",
        "already_has_position",
    }

    # Every rejection uses a ``rej_`` trade-id prefix and the configured
    # trigger source.
    for r in rejections:
        assert r["trade_id"].startswith("rej_")
        assert r["trigger_source"] == "ml_signal_driven"
        assert r["status"] == "rejected"
        assert r["symbol"] == "BTC"

    # Executor was never called — no open trades, no entry snapshots, no
    # record_trade_entry.
    open_trades = tmp_journal_db.list_trades(status="open", limit=50)
    assert open_trades == []
    daemon.record_trade_entry.assert_not_called()
    daemon.register_position_type.assert_not_called()
    provider.market_open.assert_not_called()


# ---------------------------------------------------------------------------
# 3. Periodic ML signal check fires without a scanner anomaly
# ---------------------------------------------------------------------------


def test_periodic_ml_signal_check_fires_without_scanner(
    tmp_journal_db: Any,
    sample_entry_snapshot: Any,
) -> None:
    """``_periodic_ml_signal_check`` with favorable predictions + no active
    position fires ``execute_trade_mechanical`` and a trade lands in the
    journal.

    This is the path that runs every 60s inside ``_loop_inner`` at daemon
    lines 1035-1042 — independent of the scanner.
    """
    from hynous.mechanical_entry.executor import execute_trade_mechanical

    provider = _make_provider()
    daemon = _make_fake_daemon(
        journal_store=tmp_journal_db,
        provider=provider,
        predictions=_make_favorable_predictions(),
    )
    daemon._init_mechanical_entry()

    with patch(
        "hynous.mechanical_entry.executor.execute_trade_mechanical",
        wraps=execute_trade_mechanical,
    ) as spy, patch(
        "hynous.mechanical_entry.executor.build_entry_snapshot",
        return_value=sample_entry_snapshot,
    ):
        daemon._periodic_ml_signal_check()

    # Executor was called once — the periodic path reached the fire branch.
    spy.assert_called_once()
    _, kwargs = spy.call_args
    assert kwargs["daemon"] is daemon
    assert kwargs["signal"].symbol == "BTC"
    assert kwargs["signal"].side == "long"
    assert kwargs["signal"].trigger_source == "ml_signal_driven"

    # Trade lives in the journal with status='open' and matching trade_id.
    trade_id = sample_entry_snapshot.trade_basics.trade_id
    assert daemon._open_trade_ids.get("BTC") == trade_id

    bundle = tmp_journal_db.get_trade(trade_id)
    assert bundle is not None
    assert bundle["status"] == "open"
    assert bundle["entry_snapshot"] is not None

    # Sanity: the evaluator also delegates to the real trigger (EntryEvaluationContext
    # import is exercised inside the daemon method).
    assert EntryEvaluationContext is not None
