"""Phase 3 M5 — integration tests for the v2 analysis pipeline.

Four end-to-end scenarios exercising the full trigger → rules → LLM → validate
→ persist chain (plus the batch-rejection cron path) against a real SQLite
``JournalStore``. ``litellm.completion`` is always mocked; the pipeline wiring
is otherwise unmocked.

These tests promote the fully-populated ``sample_entry_snapshot`` /
``sample_exit_snapshot`` fixtures from ``tests/conftest.py`` and mutate them
per-scenario via :func:`dataclasses.replace` (kept outside ``conftest`` — trivial
inline copy would have duplicated ~250 LOC of fixture scaffolding; the shared
fixtures are already reachable from ``tests/integration/``).
"""

from __future__ import annotations

import json
from dataclasses import replace
from typing import Any

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _valid_llm_output() -> dict[str, Any]:
    """Minimum-shape valid LLM response matching the required 7 top-level keys.

    Mirrored from ``tests/unit/test_v2_analysis.py`` — integration duplicates
    this deliberately so the two suites stay independent.
    """
    return {
        "narrative": "Entry fired on a clean composite score. Exit tripped trailing stop at peak retracement.",
        "narrative_citations": [{"paragraph_idx": 0, "finding_ids": ["f1"]}],
        "supplemental_findings": [],
        "grades": {
            "entry_quality_grade": 75,
            "entry_timing_grade": 70,
            "sl_placement_grade": 65,
            "tp_placement_grade": 60,
            "size_leverage_grade": 70,
            "exit_quality_grade": 80,
        },
        "mistake_tags": [],
        "process_quality_score": 78,
        "one_line_summary": "Clean entry, mechanical exit hit target.",
    }


def _fake_response(*, content: str) -> Any:
    """Build a litellm-like response object using SimpleNamespace."""
    from types import SimpleNamespace
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(prompt_tokens=0, completion_tokens=0),
        _hidden_params={"response_cost": 0.0},
    )


def _seed_closed_trade(
    store: Any,
    entry_snapshot: Any,
    exit_snapshot: Any,
    *,
    realized_pnl_usd: float,
    exit_classification: str,
    peak_roe: float | None = None,
    roe_pct: float | None = None,
) -> str:
    """Insert entry + exit snapshots and upsert the trade-level fields needed
    for the deterministic rules (``peak_roe``, ``roe_pct``, ``realized_pnl_usd``,
    ``exit_classification``). Returns trade_id.
    """
    store.insert_entry_snapshot(entry_snapshot)
    store.insert_exit_snapshot(exit_snapshot)
    # Promote trade-level columns the rules engine reads.
    store.upsert_trade(
        trade_id=entry_snapshot.trade_basics.trade_id,
        symbol=entry_snapshot.trade_basics.symbol,
        side=entry_snapshot.trade_basics.side,
        trade_type=entry_snapshot.trade_basics.trade_type,
        status="closed",
        exit_classification=exit_classification,
        realized_pnl_usd=realized_pnl_usd,
        peak_roe=peak_roe,
        roe_pct=roe_pct,
    )
    return entry_snapshot.trade_basics.trade_id


# ---------------------------------------------------------------------------
# Full-pipeline integration tests
# ---------------------------------------------------------------------------


def test_full_pipeline_on_synthetic_winning_trade(
    tmp_journal_db: Any,
    sample_entry_snapshot: Any,
    sample_exit_snapshot: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Winning trade → full pipeline persists a well-formed analysis row.

    Asserts narrative, grades, findings shape, tags, citations pass validation
    and the row is retrievable via :meth:`get_analysis`.
    """
    from hynous.analysis import wake_integration

    trade_id = _seed_closed_trade(
        tmp_journal_db,
        sample_entry_snapshot,
        sample_exit_snapshot,
        realized_pnl_usd=39.45,
        exit_classification="trailing_stop",
        peak_roe=31.2,
        roe_pct=24.6,
    )

    fake_resp = _fake_response(content=json.dumps(_valid_llm_output()))
    monkeypatch.setattr("litellm.completion", lambda **_kw: fake_resp, raising=False)
    # Stub embedding so the integration test doesn't hit the OpenAI API.
    monkeypatch.setattr(
        wake_integration, "build_analysis_embedding", lambda _text: b"emb",
    )

    wake_integration.trigger_analysis_for_trade(
        trade_id=trade_id,
        journal_store=tmp_journal_db,
        model="anthropic/claude-sonnet-4.5",
        prompt_version="v1",
    )

    persisted = tmp_journal_db.get_analysis(trade_id)
    assert persisted is not None
    assert persisted["narrative"].startswith("Entry fired on a clean composite")
    # Grades survive validation.
    grades = persisted["grades"]
    assert grades["entry_quality_grade"] == 75
    assert grades["exit_quality_grade"] == 80
    # Citations + tags shape intact.
    assert isinstance(persisted["narrative_citations"], list)
    assert isinstance(persisted["mistake_tags"], list)
    # Findings list is non-empty (deterministic rules contribute at least the
    # trade's exit classification). Each finding has the required keys.
    assert len(persisted["findings"]) >= 1
    required_finding_keys = {
        "id", "type", "severity", "evidence_source",
        "evidence_ref", "evidence_values", "interpretation",
    }
    for f in persisted["findings"]:
        assert required_finding_keys.issubset(set(f.keys()))
    # Prompt + model tagged correctly.
    assert persisted["prompt_version"] == "v1"
    assert persisted["model_used"] == "anthropic/claude-sonnet-4.5"


def test_full_pipeline_on_synthetic_losing_trade(
    tmp_journal_db: Any,
    sample_entry_snapshot: Any,
    sample_exit_snapshot: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Losing trade + stop_loss exit → deterministic rules fire.

    Mutates the sample entry snapshot to force a low composite score so
    ``low_composite`` fires; mutates the exit to a steep giveback so
    ``held_too_long`` also fires. Asserts at least one of them appears in the
    persisted ``findings``.
    """
    from hynous.analysis import wake_integration
    from hynous.analysis.finding_catalog import FindingType

    # Low composite: < 55 triggers LOW_COMPOSITE_AT_ENTRY.
    weak_ml = replace(
        sample_entry_snapshot.ml_snapshot,
        composite_entry_score=45.0,
        composite_label="weak",
    )
    weak_entry = replace(sample_entry_snapshot, ml_snapshot=weak_ml)

    trade_id = _seed_closed_trade(
        tmp_journal_db,
        weak_entry,
        sample_exit_snapshot,
        realized_pnl_usd=-42.50,
        exit_classification="stop_loss",
        # Large giveback: peak=15%, exit=1% (< 50% of peak) triggers
        # HELD_TOO_LONG_AFTER_PEAK.
        peak_roe=15.0,
        roe_pct=1.0,
    )

    fake_resp = _fake_response(content=json.dumps(_valid_llm_output()))
    monkeypatch.setattr("litellm.completion", lambda **_kw: fake_resp, raising=False)
    monkeypatch.setattr(
        wake_integration, "build_analysis_embedding", lambda _text: b"emb",
    )

    wake_integration.trigger_analysis_for_trade(
        trade_id=trade_id,
        journal_store=tmp_journal_db,
    )

    persisted = tmp_journal_db.get_analysis(trade_id)
    assert persisted is not None
    finding_types = {f["type"] for f in persisted["findings"]}
    # At least one deterministic rule fired — expect both but assert the
    # weaker predicate (OR) so future rule tuning doesn't break the suite.
    deterministic_hits = {
        FindingType.LOW_COMPOSITE_AT_ENTRY.value,
        FindingType.HELD_TOO_LONG_AFTER_PEAK.value,
    }
    assert finding_types & deterministic_hits, (
        f"expected at least one deterministic rule to fire on losing trade; "
        f"got findings: {finding_types}"
    )


def test_full_pipeline_on_stop_hunted_trade(
    tmp_journal_db: Any,
    sample_entry_snapshot: Any,
    sample_exit_snapshot: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Stop-hunt counterfactual flag → STOP_HUNT_DETECTED finding persisted.

    Mutates the exit snapshot's counterfactuals to set ``did_sl_get_hunted=True``
    + a reversal pct. Asserts the ``stop_hunt_detected`` finding appears in
    the persisted findings array.
    """
    from hynous.analysis import wake_integration
    from hynous.analysis.finding_catalog import FindingType

    hunted_cf = replace(
        sample_exit_snapshot.counterfactuals,
        did_sl_get_hunted=True,
        sl_hunt_reversal_pct=2.8,
    )
    hunted_exit = replace(sample_exit_snapshot, counterfactuals=hunted_cf)

    trade_id = _seed_closed_trade(
        tmp_journal_db,
        sample_entry_snapshot,
        hunted_exit,
        realized_pnl_usd=-18.20,
        exit_classification="stop_loss",
        peak_roe=5.0,
        roe_pct=-3.1,
    )

    fake_resp = _fake_response(content=json.dumps(_valid_llm_output()))
    monkeypatch.setattr("litellm.completion", lambda **_kw: fake_resp, raising=False)
    monkeypatch.setattr(
        wake_integration, "build_analysis_embedding", lambda _text: b"emb",
    )

    wake_integration.trigger_analysis_for_trade(
        trade_id=trade_id,
        journal_store=tmp_journal_db,
    )

    persisted = tmp_journal_db.get_analysis(trade_id)
    assert persisted is not None
    finding_types = {f["type"] for f in persisted["findings"]}
    assert FindingType.STOP_HUNT_DETECTED.value in finding_types, (
        f"expected stop_hunt_detected finding; got: {finding_types}"
    )


# ---------------------------------------------------------------------------
# Batch rejection cron — full-path integration
# ---------------------------------------------------------------------------


def test_batch_rejection_analysis_processes_pending(
    tmp_journal_db: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Seed 3 synthetic rejections, mock the LLM to emit 3 judgments, and
    assert the cron function persists one ``trade_analyses`` row per rejection
    with ``prompt_version='rejection-v1'`` and the expected evidence_values.

    A second call returns 0 (already-analyzed short-circuit).
    """
    from datetime import datetime, timedelta, timezone

    from hynous.analysis.batch_rejection import run_batch_rejection_analysis

    # Seed rejections stamped "now" so the default since-window (last hour)
    # catches them. The explicit ``since`` override a few lines down also
    # exercises the non-default code path.
    now = datetime.now(timezone.utc)
    rejection_ids = [f"trade_rej{i:02d}0000000000" for i in range(1, 4)]
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
            "correct": bool(i % 2 == 0),
            "reason": f"judgment-{i}",
            "counterfactual_pnl_roe": -1.2 + i * 0.5,
        }
        for i, tid in enumerate(rejection_ids)
    ]
    fake_resp = _fake_response(content=json.dumps({"judgments": judgments}))
    monkeypatch.setattr("litellm.completion", lambda **_kw: fake_resp, raising=False)

    processed = run_batch_rejection_analysis(
        journal_store=tmp_journal_db,
        since=now - timedelta(hours=2),
    )
    assert processed == 3

    for i, tid in enumerate(rejection_ids):
        analysis = tmp_journal_db.get_analysis(tid)
        assert analysis is not None, f"missing analysis for {tid}"
        assert analysis["prompt_version"] == "rejection-v1"
        assert analysis["narrative"] == f"judgment-{i}"
        # Score reflects correctness: correct=100, incorrect=50.
        expected_score = 100 if (i % 2 == 0) else 50
        assert analysis["process_quality_score"] == expected_score
        # Single rejection_judgment finding with evidence_values populated.
        assert len(analysis["findings"]) == 1
        finding = analysis["findings"][0]
        assert finding["type"] == "rejection_judgment"
        assert finding["evidence_values"]["correct"] is bool(i % 2 == 0)
        assert finding["evidence_values"]["counterfactual_pnl_roe"] == pytest.approx(
            -1.2 + i * 0.5
        )

    # Second call: all 3 already analyzed → short-circuit returns 0.
    processed_again = run_batch_rejection_analysis(
        journal_store=tmp_journal_db,
        since=now - timedelta(hours=2),
    )
    assert processed_again == 0
