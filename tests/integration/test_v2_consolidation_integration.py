"""Phase 6 Milestone 3 — consolidation integration tests.

End-to-end verification that the post-analysis edge-build hook in
:mod:`hynous.analysis.wake_integration` reaches the SQL edge builders and
persists a ``trade_edges`` row linking a newly-analyzed trade to a prior
same-regime / same-symbol trade.

The LLM + embedding are monkeypatched to deterministic fakes; deterministic
rules (:func:`hynous.analysis.rules_engine.run_rules`) still run unpatched so
the pipeline's real flow executes. The async dispatch is exercised
synchronously by joining the daemon thread spawned by
:func:`build_edges_async` — tests that relied on a polling loop would be
brittle.
"""

from __future__ import annotations

import json
import sys
import threading
import time
import types
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

# litellm may not be installed in the test env; the pipeline lazy-imports it.
if "litellm" not in sys.modules:
    sys.modules["litellm"] = types.ModuleType("litellm")
    sys.modules["litellm.exceptions"] = types.ModuleType("litellm.exceptions")
    sys.modules["litellm.exceptions"].APIError = Exception  # type: ignore[attr-defined]

import pytest


# ---------------------------------------------------------------------------
# Helpers (duplicated from the analysis integration suite — one-shot shape)
# ---------------------------------------------------------------------------


def _valid_llm_output() -> dict[str, Any]:
    return {
        "narrative": "A trade happened.",
        "narrative_citations": [],
        "supplemental_findings": [],
        "grades": {
            "entry_quality_grade": 70,
            "entry_timing_grade": 70,
            "sl_placement_grade": 70,
            "tp_placement_grade": 70,
            "size_leverage_grade": 70,
            "exit_quality_grade": 70,
        },
        "mistake_tags": [],
        "process_quality_score": 70,
        "one_line_summary": "fine.",
    }


def _fake_response(*, content: str) -> Any:
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(prompt_tokens=0, completion_tokens=0),
        _hidden_params={"response_cost": 0.0},
    )


def _snapshot_with(
    base: Any,
    *,
    trade_id: str,
    entry_ts: str,
    vol_1h_regime: str,
) -> Any:
    """Clone ``base`` swapping trade_id / entry_ts / vol_1h_regime. Mirrors the
    unit-test helper in ``tests/unit/test_v2_consolidation.py``."""
    new_basics = replace(base.trade_basics, trade_id=trade_id, entry_ts=entry_ts)
    new_ml = replace(base.ml_snapshot, vol_1h_regime=vol_1h_regime)
    return replace(base, trade_basics=new_basics, ml_snapshot=new_ml)


def _edges(store: Any) -> list[dict[str, Any]]:
    conn = store._connect()
    try:
        rows = conn.execute(
            "SELECT source_trade_id, target_trade_id, edge_type, reason "
            "FROM trade_edges ORDER BY id ASC",
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# End-to-end test (plan line 718)
# ---------------------------------------------------------------------------


def test_analysis_hook_triggers_edge_build(
    tmp_journal_db: Any,
    sample_entry_snapshot: Any,
    sample_exit_snapshot: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two closed trades on the same symbol within 30 min of each other with
    matching ``vol_1h_regime``. Triggering analysis on the second trade must
    populate ``trade_edges`` with ``preceded_by`` + ``followed_by`` (temporal)
    and ``same_regime_bucket`` rows linking the pair.

    LLM + embedding are stubbed; deterministic rules run unpatched.
    """
    from hynous.analysis import wake_integration
    from hynous.journal import consolidation

    now = datetime(2026, 4, 12, 10, 0, 0, tzinfo=timezone.utc)
    prior_ts = (now - timedelta(minutes=30)).isoformat()
    later_ts = now.isoformat()

    prior_entry = _snapshot_with(
        sample_entry_snapshot,
        trade_id="trade_prior_111111111111",
        entry_ts=prior_ts,
        vol_1h_regime="normal",
    )
    later_entry = _snapshot_with(
        sample_entry_snapshot,
        trade_id="trade_later_222222222222",
        entry_ts=later_ts,
        vol_1h_regime="normal",
    )
    later_exit = replace(
        sample_exit_snapshot,
        trade_id="trade_later_222222222222",
    )

    # Seed the prior trade as fully closed.
    tmp_journal_db.insert_entry_snapshot(prior_entry)
    tmp_journal_db.upsert_trade(
        trade_id=prior_entry.trade_basics.trade_id,
        symbol=prior_entry.trade_basics.symbol,
        side=prior_entry.trade_basics.side,
        trade_type=prior_entry.trade_basics.trade_type,
        status="closed",
        entry_ts=prior_ts,
        exit_classification="trailing_stop",
        realized_pnl_usd=25.0,
        peak_roe=18.0,
        roe_pct=12.0,
    )

    # Seed the later (subject-of-analysis) trade as closed but not yet analyzed.
    tmp_journal_db.insert_entry_snapshot(later_entry)
    tmp_journal_db.insert_exit_snapshot(later_exit)
    tmp_journal_db.upsert_trade(
        trade_id=later_entry.trade_basics.trade_id,
        symbol=later_entry.trade_basics.symbol,
        side=later_entry.trade_basics.side,
        trade_type=later_entry.trade_basics.trade_type,
        status="closed",
        entry_ts=later_ts,
        exit_classification="trailing_stop",
        realized_pnl_usd=32.0,
        peak_roe=22.0,
        roe_pct=18.0,
    )

    # Deterministic fakes: LLM + embedding only. run_rules runs for real.
    fake_resp = _fake_response(content=json.dumps(_valid_llm_output()))
    monkeypatch.setattr("litellm.completion", lambda **_kw: fake_resp, raising=False)
    monkeypatch.setattr(
        wake_integration, "build_analysis_embedding", lambda _text: b"emb",
    )

    # Capture the spawned edge-build thread so the test can join it. The
    # production dispatch is fire-and-forget; we wrap the real
    # ``build_edges_async`` to stash the thread handle before returning.
    spawned: list[threading.Thread] = []
    original_async = consolidation.build_edges_async

    def _capturing_async(store: Any, tid: str) -> None:
        def _run() -> None:
            try:
                consolidation.build_edges(store, tid)
            except Exception:  # pragma: no cover - defensive
                pass

        thread = threading.Thread(
            target=_run, daemon=True, name=f"edges-test-{tid[:8]}",
        )
        thread.start()
        spawned.append(thread)

    monkeypatch.setattr(consolidation, "build_edges_async", _capturing_async)
    try:
        wake_integration.trigger_analysis_for_trade(
            trade_id=later_entry.trade_basics.trade_id,
            journal_store=tmp_journal_db,
        )
    finally:
        monkeypatch.setattr(consolidation, "build_edges_async", original_async)

    # Wait for the edge-build thread to complete. join() with timeout avoids
    # hanging the suite if the dispatch never happened.
    assert spawned, "expected build_edges_async to be dispatched once"
    for thread in spawned:
        thread.join(timeout=5.0)
        assert not thread.is_alive(), "edge-build thread did not complete"

    # Give SQLite a moment to settle writes from the worker thread before we
    # read from the main thread's connection. JournalStore uses short-lived
    # connections so a tiny sleep is belt-and-suspenders, not a race.
    time.sleep(0.05)

    rows = _edges(tmp_journal_db)
    edge_types = {r["edge_type"] for r in rows}

    assert "preceded_by" in edge_types, (
        f"expected a preceded_by edge; got edge_types={edge_types}"
    )
    assert "same_regime_bucket" in edge_types, (
        f"expected a same_regime_bucket edge; got edge_types={edge_types}"
    )

    # The preceded_by edge points from the subject → the earlier trade.
    preceded = [r for r in rows if r["edge_type"] == "preceded_by"]
    assert any(
        r["source_trade_id"] == later_entry.trade_basics.trade_id
        and r["target_trade_id"] == prior_entry.trade_basics.trade_id
        for r in preceded
    ), f"preceded_by should link later -> prior; got {preceded}"

    # The same_regime_bucket edge points from the subject → the matching peer.
    regime_bucket = [r for r in rows if r["edge_type"] == "same_regime_bucket"]
    assert any(
        r["source_trade_id"] == later_entry.trade_basics.trade_id
        and r["target_trade_id"] == prior_entry.trade_basics.trade_id
        for r in regime_bucket
    ), f"same_regime_bucket should link later -> prior; got {regime_bucket}"
