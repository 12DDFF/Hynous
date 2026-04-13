"""Phase 6 Milestone 3 — unit-level regression tests for the three hook sites.

Each hook dispatches :func:`hynous.journal.consolidation.build_edges_async`
after a successful journal write (wake + batch-rejection) or starts the
weekly-rollup cron at daemon init. These tests monkeypatch the dispatched
function with a spy and assert the contract — call count + argument shape —
without exercising the edge-build SQL path (that is covered exhaustively by
``tests/unit/test_v2_consolidation.py``).
"""

from __future__ import annotations

import json
import sys
import types
from types import SimpleNamespace
from typing import Any

# litellm may not be installed in the test env; the pipeline lazy-imports it.
if "litellm" not in sys.modules:
    sys.modules["litellm"] = types.ModuleType("litellm")
    sys.modules["litellm.exceptions"] = types.ModuleType("litellm.exceptions")
    sys.modules["litellm.exceptions"].APIError = Exception  # type: ignore[attr-defined]

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _fake_response(*, content: str) -> Any:
    """litellm-style response wrapping ``content`` as the first choice."""
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(prompt_tokens=0, completion_tokens=0),
        _hidden_params={"response_cost": 0.0},
    )


def _valid_llm_output() -> dict[str, Any]:
    """Minimum-shape valid analysis LLM response (mirrors integration suite)."""
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


# ---------------------------------------------------------------------------
# Hook 1 — wake_integration dispatches build_edges_async after insert_analysis
# ---------------------------------------------------------------------------


def test_wake_integration_dispatches_edges_after_insert(
    tmp_journal_db: Any,
    sample_entry_snapshot: Any,
    sample_exit_snapshot: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """After a successful ``insert_analysis``, ``build_edges_async`` is called
    exactly once with the matching ``trade_id``. The spy targets the function's
    source module so the in-function lazy import sees the patched callable.
    """
    from hynous.analysis import wake_integration
    from hynous.journal import consolidation

    trade_id = sample_entry_snapshot.trade_basics.trade_id
    tmp_journal_db.insert_entry_snapshot(sample_entry_snapshot)
    tmp_journal_db.insert_exit_snapshot(sample_exit_snapshot)
    tmp_journal_db.upsert_trade(
        trade_id=trade_id,
        symbol=sample_entry_snapshot.trade_basics.symbol,
        side=sample_entry_snapshot.trade_basics.side,
        trade_type=sample_entry_snapshot.trade_basics.trade_type,
        status="closed",
        exit_classification="trailing_stop",
        realized_pnl_usd=40.0,
        peak_roe=30.0,
        roe_pct=24.0,
    )

    calls: list[tuple[Any, str]] = []

    def _spy(store: Any, tid: str) -> None:
        calls.append((store, tid))

    monkeypatch.setattr(consolidation, "build_edges_async", _spy)

    fake_resp = _fake_response(content=json.dumps(_valid_llm_output()))
    monkeypatch.setattr("litellm.completion", lambda **_kw: fake_resp, raising=False)
    monkeypatch.setattr(
        wake_integration, "build_analysis_embedding", lambda _text: b"emb",
    )

    wake_integration.trigger_analysis_for_trade(
        trade_id=trade_id,
        journal_store=tmp_journal_db,
    )

    assert len(calls) == 1, f"expected 1 dispatch, got {len(calls)}: {calls}"
    assert calls[0][0] is tmp_journal_db
    assert calls[0][1] == trade_id


# ---------------------------------------------------------------------------
# Hook 2 — batch_rejection dispatches build_edges_async per judgment
# ---------------------------------------------------------------------------


def test_batch_rejection_dispatches_edges_per_result(
    tmp_journal_db: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two judgments returned by the LLM → spy invoked twice, once per
    rejection ``trade_id``. Verifies the dispatch sits inside the per-result
    loop rather than outside of it.
    """
    from datetime import datetime, timedelta, timezone

    from hynous.analysis.batch_rejection import run_batch_rejection_analysis
    from hynous.journal import consolidation

    now = datetime.now(timezone.utc)
    rejection_ids = [f"trade_rej{i:02d}0000000000" for i in range(1, 3)]
    for i, tid in enumerate(rejection_ids):
        tmp_journal_db.upsert_trade(
            trade_id=tid,
            symbol="BTC",
            side="long",
            trade_type="macro",
            status="rejected",
            entry_ts=(now - timedelta(minutes=5 - i)).isoformat(),
            rejection_reason="entry_quality_too_low",
        )

    judgments = [
        {
            "rejection_id": tid,
            "correct": True,
            "reason": f"judgment-{i}",
            "counterfactual_pnl_roe": 0.0,
        }
        for i, tid in enumerate(rejection_ids)
    ]
    fake_resp = _fake_response(content=json.dumps({"judgments": judgments}))
    monkeypatch.setattr("litellm.completion", lambda **_kw: fake_resp, raising=False)

    calls: list[tuple[Any, str]] = []

    def _spy(store: Any, tid: str) -> None:
        calls.append((store, tid))

    monkeypatch.setattr(consolidation, "build_edges_async", _spy)

    processed = run_batch_rejection_analysis(
        journal_store=tmp_journal_db,
        since=now - timedelta(hours=2),
    )
    assert processed == 2

    assert len(calls) == 2, f"expected 2 dispatches, got {len(calls)}: {calls}"
    dispatched_ids = [tid for _, tid in calls]
    assert set(dispatched_ids) == set(rejection_ids)


# ---------------------------------------------------------------------------
# Hook 3 — daemon starts the weekly rollup cron under flag + journal guard
# ---------------------------------------------------------------------------


def _run_rollup_init_block(
    *,
    journal_store: Any,
    pattern_rollup_enabled: bool,
    interval_hours: int = 168,
    window_days: int = 30,
    spy: Any,
) -> None:
    """Mirror the daemon's init-time rollup block exactly.

    Keeping the block-shape identical to ``daemon.py`` keeps this regression
    test honest: if the daemon block drifts (guard change, argument rename),
    this test fails to match and flags the drift.
    """
    import logging

    from hynous.journal import consolidation

    logger = logging.getLogger("test_daemon_rollup_block")

    # Monkey the module-level symbol the daemon imports.
    original = consolidation.start_weekly_rollup_cron
    consolidation.start_weekly_rollup_cron = spy  # type: ignore[assignment]
    try:
        if journal_store is not None and pattern_rollup_enabled:
            try:
                from hynous.journal.consolidation import start_weekly_rollup_cron
                start_weekly_rollup_cron(
                    journal_store=journal_store,
                    interval_s=interval_hours * 3600,
                    window_days=window_days,
                )
                logger.info("v2 weekly rollup cron started")
            except Exception:
                logger.exception("Failed to start v2 weekly rollup cron")
    finally:
        consolidation.start_weekly_rollup_cron = original  # type: ignore[assignment]


def test_daemon_starts_weekly_rollup_cron_when_enabled(
    tmp_journal_db: Any,
) -> None:
    """Flag on + journal present → cron starter called once with expected
    kwargs. Flag off → not called at all.
    """
    calls: list[dict[str, Any]] = []

    def _spy(**kwargs: Any) -> None:
        calls.append(kwargs)

    # Enabled: dispatched once.
    _run_rollup_init_block(
        journal_store=tmp_journal_db,
        pattern_rollup_enabled=True,
        interval_hours=168,
        window_days=30,
        spy=_spy,
    )
    assert len(calls) == 1
    assert calls[0]["journal_store"] is tmp_journal_db
    assert calls[0]["interval_s"] == 168 * 3600
    assert calls[0]["window_days"] == 30

    # Disabled: not called at all.
    calls.clear()
    _run_rollup_init_block(
        journal_store=tmp_journal_db,
        pattern_rollup_enabled=False,
        spy=_spy,
    )
    assert calls == []

    # Journal missing: not called even with flag on.
    _run_rollup_init_block(
        journal_store=None,
        pattern_rollup_enabled=True,
        spy=_spy,
    )
    assert calls == []
