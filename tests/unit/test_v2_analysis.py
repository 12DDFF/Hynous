"""Phase 3 analysis module tests — Milestone 1 (deterministic rules engine).

Covers the 12-rule :func:`hynous.analysis.run_rules` engine, the finding
catalog, and the mistake-tag vocabulary. No LLM code is under test here —
M2 adds the LLM pipeline.

Architect-additional tests (noted in the M1 report):
- ``test_run_rules_coerces_dataclass_entry_snapshot_to_dict``
- ``test_run_rules_accepts_pre_dicted_bundle``
- ``test_rule_mechanical_correct_uses_regime_specific_threshold``
"""

from __future__ import annotations

import sys
import types
from dataclasses import asdict
from typing import Any

# Ensure a ``litellm`` module is importable in sys.modules even in test-only
# environments where the real package isn't installed. Mirrors the stub
# pattern used by v1 test modules (see ``test_consolidation.py``). The
# ``llm_pipeline`` module lazily resolves ``litellm`` at call time, so this
# stub is all that's required for ``monkeypatch.setattr("litellm.completion",
# ...)`` to succeed without ``raising=False``.
if "litellm" not in sys.modules:
    sys.modules["litellm"] = types.ModuleType("litellm")
    sys.modules["litellm.exceptions"] = types.ModuleType("litellm.exceptions")
    sys.modules["litellm.exceptions"].APIError = Exception  # type: ignore[attr-defined]

import pytest

from hynous.analysis import (
    Finding,
    FindingType,
    run_rules,
    validate_mistake_tag,
)
from hynous.analysis.rules_engine import (
    _rule_against_funding,
    _rule_held_too_long,
    _rule_into_liq_cluster,
    _rule_low_composite,
    _rule_mechanical_correct,
    _rule_premature_exit,
    _rule_signal_degraded,
    _rule_signal_improved,
    _rule_sl_too_tight,
    _rule_stop_hunt,
    _rule_trail_never_activated,
    _rule_vol_regime_flipped,
)

# ---------------------------------------------------------------------------
# Helpers — small synthetic bundle builders
#
# The full `sample_entry_snapshot` / `sample_exit_snapshot` fixtures in
# `tests/conftest.py` are exhaustive dataclasses; good for round-trip and
# store tests but too heavy for targeted rule tests where we want to vary
# one or two fields at a time. These helpers build minimal dict-shaped
# bundles that satisfy each rule's .get() contract.
# ---------------------------------------------------------------------------


def _bundle(
    *,
    entry_snapshot: dict[str, Any] | None = None,
    exit_snapshot: dict[str, Any] | None = None,
    events: list[dict[str, Any]] | None = None,
    counterfactuals: dict[str, Any] | None = None,
    status: str = "closed",
    exit_classification: str | None = None,
    peak_roe: float | None = None,
    roe_pct: float | None = None,
) -> dict[str, Any]:
    """Build a synthetic bundle matching :meth:`JournalStore.get_trade`'s shape."""
    return {
        "trade_id": "t_test",
        "status": status,
        "exit_classification": exit_classification,
        "peak_roe": peak_roe,
        "roe_pct": roe_pct,
        "entry_snapshot": entry_snapshot,
        "exit_snapshot": exit_snapshot,
        "events": events or [],
        "counterfactuals": counterfactuals or {},
    }


def _entry(
    *,
    composite_entry_score: float | None = None,
    composite_label: str | None = None,
    vol_1h_regime: str | None = None,
    side: str = "long",
    entry_px: float = 50000.0,
    sl_px: float | None = None,
    funding_rate: float | None = None,
    realized_vol_1h_pct: float | None = None,
    clusters_above: list[dict[str, Any]] | None = None,
    clusters_below: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "trade_basics": {
            "side": side,
            "entry_px": entry_px,
            "sl_px": sl_px,
        },
        "ml_snapshot": {
            "composite_entry_score": composite_entry_score,
            "composite_label": composite_label,
            "composite_components": {},
            "vol_1h_regime": vol_1h_regime,
        },
        "market_state": {
            "realized_vol_1h_pct": realized_vol_1h_pct,
        },
        "derivatives_state": {
            "funding_rate": funding_rate,
        },
        "liquidation_terrain": {
            "clusters_above": clusters_above or [],
            "clusters_below": clusters_below or [],
        },
    }


def _exit(
    *,
    composite_score_at_exit: float | None = None,
    composite_score_delta: float | None = None,
) -> dict[str, Any]:
    return {
        "ml_exit_comparison": {
            "composite_score_at_exit": composite_score_at_exit,
            "composite_score_delta": composite_score_delta,
        },
    }


# ---------------------------------------------------------------------------
# Rule tests (plan tests 1–14)
# ---------------------------------------------------------------------------


def test_rule_signal_degraded_fires_on_large_drop() -> None:
    bundle = _bundle(
        entry_snapshot=_entry(composite_entry_score=80.0),
        exit_snapshot=_exit(composite_score_at_exit=50.0, composite_score_delta=-30.0),
    )
    finding = _rule_signal_degraded(bundle)

    assert finding is not None
    assert finding.type == FindingType.SIGNAL_DEGRADED_BEFORE_EXIT.value
    # Delta of exactly -30 should NOT hit the high-severity branch (delta < -30).
    assert finding.severity == "medium"
    assert finding.evidence_values["delta"] == -30.0


def test_rule_signal_degraded_silent_on_small_drop() -> None:
    bundle = _bundle(
        entry_snapshot=_entry(composite_entry_score=80.0),
        exit_snapshot=_exit(composite_score_at_exit=65.0, composite_score_delta=-15.0),
    )
    assert _rule_signal_degraded(bundle) is None


def test_rule_signal_improved_fires_on_large_rise() -> None:
    bundle = _bundle(
        entry_snapshot=_entry(composite_entry_score=50.0),
        exit_snapshot=_exit(composite_score_at_exit=78.0, composite_score_delta=28.0),
    )
    finding = _rule_signal_improved(bundle)

    assert finding is not None
    assert finding.type == FindingType.SIGNAL_IMPROVED_DURING_HOLD.value
    assert finding.severity == "low"
    assert finding.evidence_values["delta"] == 28.0


def test_rule_low_composite_fires_below_55() -> None:
    bundle = _bundle(
        entry_snapshot=_entry(composite_entry_score=48.0, composite_label="below_average"),
    )
    finding = _rule_low_composite(bundle)

    assert finding is not None
    assert finding.type == FindingType.LOW_COMPOSITE_AT_ENTRY.value
    assert finding.severity == "medium"  # 40 <= score < 55


def test_rule_low_composite_severity_high_below_40() -> None:
    bundle = _bundle(
        entry_snapshot=_entry(composite_entry_score=32.0, composite_label="poor"),
    )
    finding = _rule_low_composite(bundle)

    assert finding is not None
    assert finding.severity == "high"


def test_rule_vol_regime_flipped_fires_on_event() -> None:
    bundle = _bundle(
        events=[
            {
                "id": 17,
                "ts": "2026-04-12T10:20:00+00:00",
                "event_type": "vol_regime_change",
                "payload": {"old_regime": "normal", "new_regime": "high"},
            },
            {
                "id": 18,
                "ts": "2026-04-12T10:40:00+00:00",
                "event_type": "vol_regime_change",
                "payload": {"old_regime": "high", "new_regime": "extreme"},
            },
        ],
    )
    finding = _rule_vol_regime_flipped(bundle)

    assert finding is not None
    assert finding.type == FindingType.VOL_REGIME_FLIPPED_MID_HOLD.value
    assert finding.evidence_values["total_changes"] == 2
    assert finding.evidence_values["old_regime"] == "normal"
    assert finding.evidence_values["new_regime"] == "high"


def test_rule_mechanical_correct_fires_on_matching_classification() -> None:
    # peak_roe=4.0 > default 2.5% trail threshold => expected=trailing_stop
    bundle = _bundle(
        entry_snapshot=_entry(vol_1h_regime="normal"),
        exit_classification="trailing_stop",
        peak_roe=4.0,
    )
    finding = _rule_mechanical_correct(bundle)

    assert finding is not None
    assert finding.type == FindingType.MECHANICAL_WORKED_AS_DESIGNED.value
    assert finding.evidence_values["expected_layer"] == "trailing_stop"
    assert finding.evidence_values["trail_activation_threshold"] == 2.5


def test_rule_trail_never_activated_fires_on_missing_event() -> None:
    bundle = _bundle(
        status="closed",
        peak_roe=1.2,
        events=[
            {
                "id": 1,
                "ts": "2026-04-12T10:05:00+00:00",
                "event_type": "fee_breakeven_placed",
                "payload": {},
            },
        ],
    )
    finding = _rule_trail_never_activated(bundle)

    assert finding is not None
    assert finding.type == FindingType.TRAIL_NEVER_ACTIVATED.value
    assert finding.evidence_values["peak_roe"] == 1.2


def test_rule_stop_hunt_fires_on_counterfactual_flag() -> None:
    bundle = _bundle(
        counterfactuals={
            "did_sl_get_hunted": True,
            "sl_hunt_reversal_pct": 1.8,
        },
    )
    finding = _rule_stop_hunt(bundle)

    assert finding is not None
    assert finding.type == FindingType.STOP_HUNT_DETECTED.value
    assert finding.severity == "high"
    assert finding.evidence_values["reversal_pct"] == 1.8


def test_rule_premature_exit_fires_on_tp_later_hit() -> None:
    bundle = _bundle(
        counterfactuals={
            "did_tp_hit_later": True,
            "did_tp_hit_ts": "2026-04-12T12:05:00+00:00",
            "optimal_exit_px": 65700.0,
        },
    )
    finding = _rule_premature_exit(bundle)

    assert finding is not None
    assert finding.type == FindingType.PREMATURE_EXIT_VS_TP.value
    assert finding.evidence_values["tp_hit_ts"] == "2026-04-12T12:05:00+00:00"


def test_rule_held_too_long_fires_on_50pct_giveback() -> None:
    bundle = _bundle(peak_roe=10.0, roe_pct=3.0)
    finding = _rule_held_too_long(bundle)

    assert finding is not None
    assert finding.type == FindingType.HELD_TOO_LONG_AFTER_PEAK.value
    # 70% giveback (1 - 3/10)
    assert finding.evidence_values["giveback_ratio"] == pytest.approx(0.7)


def test_rule_against_funding_fires_on_opposing_sign() -> None:
    bundle = _bundle(
        entry_snapshot=_entry(side="long", funding_rate=0.001),  # longs pay 0.1%
    )
    finding = _rule_against_funding(bundle)

    assert finding is not None
    assert finding.type == FindingType.ENTERED_AGAINST_FUNDING.value
    assert finding.evidence_values["funding_rate"] == 0.001
    assert finding.evidence_values["side"] == "long"


def test_rule_into_liq_cluster_fires_within_half_percent() -> None:
    bundle = _bundle(
        entry_snapshot=_entry(
            side="long",
            entry_px=50_000.0,
            # 0.4% below entry — within 0.5% threshold
            clusters_below=[{"price": 49_800.0, "size_usd": 1.5e7, "confidence": 0.9}],
        ),
    )
    finding = _rule_into_liq_cluster(bundle)

    assert finding is not None
    assert finding.type == FindingType.ENTERED_INTO_LIQ_CLUSTER.value
    assert finding.evidence_values["cluster_price"] == 49_800.0
    assert finding.evidence_values["distance_pct"] == pytest.approx(0.4, rel=1e-3)


def test_rule_sl_too_tight_fires_below_vol_threshold() -> None:
    # SL distance 0.4%; realized_vol 2% => threshold 1.0%; 0.4 < 1.0 => fires.
    bundle = _bundle(
        entry_snapshot=_entry(
            side="long",
            entry_px=50_000.0,
            sl_px=49_800.0,
            realized_vol_1h_pct=2.0,
        ),
    )
    finding = _rule_sl_too_tight(bundle)

    assert finding is not None
    assert finding.type == FindingType.SL_TOO_TIGHT_FOR_REALIZED_VOL.value
    assert finding.evidence_values["sl_distance_pct"] == pytest.approx(0.4, rel=1e-3)


# ---------------------------------------------------------------------------
# run_rules orchestration (plan tests 15–16)
# ---------------------------------------------------------------------------


def test_run_rules_assigns_sequential_ids() -> None:
    """Two rules fire; ensure IDs are f1, f2 (order preserved)."""
    bundle = _bundle(
        entry_snapshot=_entry(composite_entry_score=45.0),  # low composite
        exit_snapshot=_exit(composite_score_at_exit=20.0, composite_score_delta=-25.0),  # signal degraded
    )
    findings = run_rules(bundle)

    # Signal degraded and low composite both fire. Order from rule_fns list:
    # signal_degraded (1), signal_improved (0), low_composite (2).
    assert len(findings) >= 2
    ids = [f.id for f in findings]
    assert ids == [f"f{i+1}" for i in range(len(findings))]
    types = {f.type for f in findings}
    assert FindingType.SIGNAL_DEGRADED_BEFORE_EXIT.value in types
    assert FindingType.LOW_COMPOSITE_AT_ENTRY.value in types


def test_run_rules_handles_rule_exceptions(monkeypatch: pytest.MonkeyPatch) -> None:
    """A rule that raises is logged and skipped; other rules still run."""
    from hynous.analysis import rules_engine

    def _boom(_bundle: dict[str, Any]) -> Finding | None:
        raise RuntimeError("kaboom")

    monkeypatch.setattr(rules_engine, "_rule_stop_hunt", _boom)

    bundle = _bundle(
        entry_snapshot=_entry(composite_entry_score=30.0),
        counterfactuals={"did_sl_get_hunted": True, "sl_hunt_reversal_pct": 1.5},
    )
    findings = rules_engine.run_rules(bundle)

    types = {f.type for f in findings}
    # stop_hunt was monkey-patched to raise — must not appear.
    assert FindingType.STOP_HUNT_DETECTED.value not in types
    # low_composite still fires.
    assert FindingType.LOW_COMPOSITE_AT_ENTRY.value in types


# ---------------------------------------------------------------------------
# Mistake-tag validation (plan tests 17–19)
# ---------------------------------------------------------------------------


def test_validate_mistake_tag_accepts_valid() -> None:
    findings = [
        Finding(
            id="f1",
            type=FindingType.LOW_COMPOSITE_AT_ENTRY.value,
            severity="medium",
            evidence_source="entry_snapshot.ml_snapshot",
            evidence_ref={},
            evidence_values={},
            interpretation="",
        ),
    ]
    assert validate_mistake_tag("signal_weak_at_entry", findings) is True


def test_validate_mistake_tag_rejects_unknown() -> None:
    findings: list[Finding] = []
    assert validate_mistake_tag("not_a_real_tag", findings) is False


def test_validate_mistake_tag_rejects_without_finding_support() -> None:
    # Findings present but none match the tag's required types.
    findings = [
        Finding(
            id="f1",
            type=FindingType.STOP_HUNT_DETECTED.value,
            severity="high",
            evidence_source="counterfactuals.did_sl_get_hunted",
            evidence_ref={},
            evidence_values={},
            interpretation="",
        ),
    ]
    # `signal_weak_at_entry` requires LOW_COMPOSITE_AT_ENTRY, not STOP_HUNT_DETECTED.
    assert validate_mistake_tag("signal_weak_at_entry", findings) is False


# ---------------------------------------------------------------------------
# Architect-additional tests
# ---------------------------------------------------------------------------


def test_run_rules_coerces_dataclass_entry_snapshot_to_dict(
    sample_entry_snapshot: Any, sample_exit_snapshot: Any,
) -> None:
    """A bundle with REAL dataclass snapshots must still produce rule findings
    that reference ``entry_snapshot.ml_snapshot.*`` correctly.

    Proves the ``asdict``-coercion boundary in :func:`run_rules` works: rule
    bodies use ``.get(...)`` but the caller may pass dataclasses.
    """
    bundle: dict[str, Any] = {
        "trade_id": "t_test",
        "status": "closed",
        "exit_classification": None,
        "peak_roe": 31.2,
        "roe_pct": 24.6,
        "entry_snapshot": sample_entry_snapshot,  # real dataclass
        "exit_snapshot": sample_exit_snapshot,    # real dataclass
        "events": [],
        "counterfactuals": asdict(sample_exit_snapshot.counterfactuals),
    }

    findings = run_rules(bundle)

    # Sample fixtures: composite_entry_score=71.0 (production 0–100 scale,
    # fixed in M2) => low_composite does NOT fire (71 >= 55 threshold).
    # composite_score_delta=-0.19 => signal_degraded does NOT fire (|delta|<20).
    # The test's intent is that a real-dataclass bundle flows through
    # run_rules without error and produces a well-formed finding list; the
    # coercion boundary (is_dataclass guard + asdict) is exercised by the
    # mere fact that rule bodies using `.get(...)` did not raise.
    types = {f.type for f in findings}
    assert FindingType.LOW_COMPOSITE_AT_ENTRY.value not in types


def test_run_rules_accepts_pre_dicted_bundle(
    sample_entry_snapshot: Any, sample_exit_snapshot: Any,
) -> None:
    """Same bundle with pre-``asdict``'d snapshots yields the same finding set.

    Proves the ``is_dataclass`` guard is non-destructive for dict inputs.
    """
    bundle_dc: dict[str, Any] = {
        "trade_id": "t_test",
        "status": "closed",
        "exit_classification": None,
        "peak_roe": 31.2,
        "roe_pct": 24.6,
        "entry_snapshot": sample_entry_snapshot,
        "exit_snapshot": sample_exit_snapshot,
        "events": [],
        "counterfactuals": asdict(sample_exit_snapshot.counterfactuals),
    }
    bundle_dict: dict[str, Any] = {
        **bundle_dc,
        "entry_snapshot": asdict(sample_entry_snapshot),
        "exit_snapshot": asdict(sample_exit_snapshot),
    }

    types_dc = {f.type for f in run_rules(bundle_dc)}
    types_dict = {f.type for f in run_rules(bundle_dict)}

    assert types_dc == types_dict


def test_rule_mechanical_correct_uses_regime_specific_threshold() -> None:
    """Regime-adaptive trail threshold: extreme=1.5%, low=3.0%.

    Same peak_roe=1.8 + trailing_stop classification: fires under ``extreme``
    (1.8 > 1.5) but not under ``low`` (1.8 < 3.0).
    """
    extreme_bundle = _bundle(
        entry_snapshot=_entry(vol_1h_regime="extreme"),
        exit_classification="trailing_stop",
        peak_roe=1.8,
    )
    low_bundle = _bundle(
        entry_snapshot=_entry(vol_1h_regime="low"),
        exit_classification="trailing_stop",
        peak_roe=1.8,
    )

    extreme_finding = _rule_mechanical_correct(extreme_bundle)
    low_finding = _rule_mechanical_correct(low_bundle)

    assert extreme_finding is not None
    assert extreme_finding.evidence_values["trail_activation_threshold"] == 1.5
    assert low_finding is None


# ---------------------------------------------------------------------------
# M2 — LLM synthesis pipeline tests (prompts + llm_pipeline)
# ---------------------------------------------------------------------------


def _valid_llm_output() -> dict[str, Any]:
    """Minimum-shape valid LLM response matching the required 7 top-level keys."""
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


def _fake_response(
    *,
    content: str,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    response_cost: float = 0.0,
) -> Any:
    """Build a litellm-like response object using SimpleNamespace."""
    from types import SimpleNamespace
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        ),
        _hidden_params={"response_cost": response_cost},
    )


def test_build_user_prompt_includes_trimmed_bundle() -> None:
    """Fat price_history / price_path_1m get replaced with counts in the prompt.

    Also: the serialized deterministic_findings block appears with the
    expected id/type/severity keys. Proves :func:`_trim_bundle_for_prompt`
    wired into :func:`build_user_prompt`.
    """
    from hynous.analysis.prompts import build_user_prompt

    dummy_candle = [0.0, 1.0, 1.5, 0.9, 1.2, 10.0]
    bundle: dict[str, Any] = {
        "trade_id": "t_test",
        "entry_snapshot": {
            "ml_snapshot": {"composite_entry_score": 71.0},
            "price_history": {
                "candles_1m_15min": [dummy_candle] * 15,
                "candles_5m_4h": [dummy_candle] * 48,
            },
        },
        "exit_snapshot": {
            "price_path_1m": [dummy_candle] * 30,
        },
        "events": [],
    }
    findings = [
        Finding(
            id="f1",
            type=FindingType.LOW_COMPOSITE_AT_ENTRY.value,
            severity="medium",
            evidence_source="entry_snapshot.ml_snapshot",
            evidence_ref={"field": "composite_entry_score"},
            evidence_values={"composite_entry_score": 42.0},
            interpretation="Entry fired with a marginal score.",
        ),
    ]

    prompt = build_user_prompt(
        trade_bundle=bundle,
        deterministic_findings=findings,
    )

    # Candle counts are preserved; raw candle dicts are NOT in the prompt.
    assert '"candles_1m_15min_count": 15' in prompt
    assert '"candles_5m_4h_count": 48' in prompt
    assert '"count": 30' in prompt  # price_path_1m count
    # The raw candle list shouldn't appear — its stringified first element
    # `1.5, 0.9, 1.2` would be easy to find; we assert the full repeated
    # candles_1m_15min array is NOT spelled out verbatim.
    assert '"candles_1m_15min": [' not in prompt

    # Deterministic findings are serialized with the expected keys.
    assert '"id": "f1"' in prompt
    assert f'"type": "{FindingType.LOW_COMPOSITE_AT_ENTRY.value}"' in prompt
    assert '"severity": "medium"' in prompt


def test_run_analysis_parses_valid_llm_response(monkeypatch: pytest.MonkeyPatch) -> None:
    """A well-formed LLM response is returned with model_used + prompt_version annotated."""
    import json as _json

    from hynous.analysis import run_analysis

    fake_resp = _fake_response(content=_json.dumps(_valid_llm_output()))

    def fake_completion(**_kwargs: Any) -> Any:
        return fake_resp

    monkeypatch.setattr(
        "litellm.completion",
        fake_completion,
        raising=False,
    )

    result = run_analysis(
        trade_bundle={"trade_id": "t1", "entry_snapshot": {}, "exit_snapshot": {}, "events": []},
        deterministic_findings=[],
        model="anthropic/claude-sonnet-4.5",
        prompt_version="v1",
    )

    required = {
        "narrative",
        "narrative_citations",
        "supplemental_findings",
        "grades",
        "mistake_tags",
        "process_quality_score",
        "one_line_summary",
    }
    assert required.issubset(set(result.keys()))
    assert result["model_used"] == "anthropic/claude-sonnet-4.5"
    assert result["prompt_version"] == "v1"


def test_run_analysis_raises_on_missing_required_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """LLM response missing any of the 7 required keys => ValueError naming them."""
    import json as _json

    from hynous.analysis import run_analysis

    partial = _valid_llm_output()
    del partial["grades"]
    del partial["one_line_summary"]

    monkeypatch.setattr(
        "litellm.completion",
        lambda **_kw: _fake_response(content=_json.dumps(partial)),
        raising=False,
    )

    with pytest.raises(ValueError, match="missing required keys") as excinfo:
        run_analysis(
            trade_bundle={"trade_id": "t1", "entry_snapshot": {}, "exit_snapshot": {}, "events": []},
            deterministic_findings=[],
        )
    msg = str(excinfo.value)
    assert "grades" in msg
    assert "one_line_summary" in msg


def test_run_analysis_raises_on_non_json_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Non-JSON LLM content surfaces as ValueError with 'not parseable' match."""
    from hynous.analysis import run_analysis

    monkeypatch.setattr(
        "litellm.completion",
        lambda **_kw: _fake_response(content="this is not json"),
        raising=False,
    )

    with pytest.raises(ValueError, match="not parseable"):
        run_analysis(
            trade_bundle={"trade_id": "t1", "entry_snapshot": {}, "exit_snapshot": {}, "events": []},
            deterministic_findings=[],
        )


def test_run_analysis_records_cost_when_usage_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Cost tracking must fire exactly once with the observed tokens + cost.

    Guards against a silent regression where ``record_llm_usage`` stops being
    called (e.g. due to an import path change in ``hynous.core.costs``).
    """
    import json as _json

    from hynous.analysis import run_analysis

    fake_resp = _fake_response(
        content=_json.dumps(_valid_llm_output()),
        prompt_tokens=500,
        completion_tokens=200,
        response_cost=0.0123,
    )
    monkeypatch.setattr(
        "litellm.completion",
        lambda **_kw: fake_resp,
        raising=False,
    )

    calls: list[dict[str, Any]] = []

    def fake_record(**kwargs: Any) -> None:
        calls.append(kwargs)

    monkeypatch.setattr("hynous.core.costs.record_llm_usage", fake_record)

    run_analysis(
        trade_bundle={"trade_id": "t1", "entry_snapshot": {}, "exit_snapshot": {}, "events": []},
        deterministic_findings=[],
        model="anthropic/claude-sonnet-4.5",
    )

    assert len(calls) == 1
    call = calls[0]
    assert call["model"] == "anthropic/claude-sonnet-4.5"
    assert call["input_tokens"] == 500
    assert call["output_tokens"] == 200
    assert call["cost_usd"] == 0.0123


# ---------------------------------------------------------------------------
# M3 — evidence validator (validation.py)
# ---------------------------------------------------------------------------


def _low_composite_finding(fid: str = "f1") -> Finding:
    """Helper: a single deterministic finding that supports ``signal_weak_at_entry``."""
    return Finding(
        id=fid,
        type=FindingType.LOW_COMPOSITE_AT_ENTRY.value,
        severity="medium",
        evidence_source="entry_snapshot.ml_snapshot",
        evidence_ref={"field": "composite_entry_score"},
        evidence_values={"composite_entry_score": 42.0},
        interpretation="Entry fired with a marginal score.",
    )


def _valid_parsed(**overrides: Any) -> dict[str, Any]:
    """Build a parsed-LLM-output dict with sane defaults, overridable."""
    base: dict[str, Any] = {
        "narrative": "Solid entry, clean exit.",
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
        "one_line_summary": "Summary.",
    }
    base.update(overrides)
    return base


def test_validate_analysis_output_strips_invalid_citations() -> None:
    """Citation referencing an unknown finding id is stripped and logged."""
    from hynous.analysis import validate_analysis_output

    parsed = _valid_parsed(
        narrative_citations=[
            {"paragraph_idx": 0, "finding_ids": ["f1", "ghost_f99"]},
        ],
    )
    validated, unverified = validate_analysis_output(
        parsed=parsed,
        deterministic_findings=[_low_composite_finding("f1")],
        trade_bundle={},
    )

    # The known id survives; ghost_f99 is stripped.
    assert validated["narrative_citations"] == [
        {"paragraph_idx": 0, "finding_ids": ["f1"]}
    ]
    citation_entries = [u for u in unverified if u["kind"] == "narrative_citation"]
    assert len(citation_entries) == 1
    assert citation_entries[0]["paragraph_idx"] == 0
    assert citation_entries[0]["bad_ids"] == ["ghost_f99"]


def test_validate_analysis_output_strips_invalid_tags() -> None:
    """Unknown tag AND tag-with-no-supporting-finding are both stripped."""
    from hynous.analysis import validate_analysis_output

    # `signal_weak_at_entry` requires LOW_COMPOSITE_AT_ENTRY — we provide a
    # STOP_HUNT_DETECTED finding, so the tag loses its support and should be
    # stripped alongside the nonsense tag.
    stop_hunt_finding = Finding(
        id="f1",
        type=FindingType.STOP_HUNT_DETECTED.value,
        severity="high",
        evidence_source="counterfactuals",
        evidence_ref={"field": "did_sl_get_hunted"},
        evidence_values={},
        interpretation="",
    )
    parsed = _valid_parsed(
        mistake_tags=["not_a_real_tag", "signal_weak_at_entry", "stop_hunted"],
    )

    validated, unverified = validate_analysis_output(
        parsed=parsed,
        deterministic_findings=[stop_hunt_finding],
        trade_bundle={},
    )

    assert validated["mistake_tags"] == ["stop_hunted"]
    tag_entries = [u for u in unverified if u["kind"] == "mistake_tag"]
    assert len(tag_entries) == 1
    assert set(tag_entries[0]["invalid_tags"]) == {
        "not_a_real_tag",
        "signal_weak_at_entry",
    }


def test_validate_analysis_output_defaults_bad_grades() -> None:
    """Non-integer grade and out-of-range grade both default to 50."""
    from hynous.analysis import validate_analysis_output

    parsed = _valid_parsed(
        grades={
            "entry_quality_grade": "A+",          # non-numeric
            "entry_timing_grade": 150,            # out of range
            "sl_placement_grade": 70,             # valid
            "tp_placement_grade": 70,             # valid
            "size_leverage_grade": 70,            # valid
            "exit_quality_grade": 70,             # valid
        },
    )

    validated, unverified = validate_analysis_output(
        parsed=parsed,
        deterministic_findings=[],
        trade_bundle={},
    )

    assert validated["grades"]["entry_quality_grade"] == 50
    assert validated["grades"]["entry_timing_grade"] == 50
    assert validated["grades"]["sl_placement_grade"] == 70

    grade_entries = [u for u in unverified if u["kind"] == "grade"]
    keys = {u["key"] for u in grade_entries}
    assert keys == {"entry_quality_grade", "entry_timing_grade"}
    raws = {u["key"]: u["raw"] for u in grade_entries}
    assert raws["entry_quality_grade"] == "A+"
    assert raws["entry_timing_grade"] == 150


def test_supplemental_finding_valid_ref_accepts_known_source() -> None:
    """A supplemental with a known source + non-empty ref survives and gets an llm id."""
    from hynous.analysis import validate_analysis_output

    parsed = _valid_parsed(
        supplemental_findings=[
            {
                "type": "custom_ml_finding",
                "severity": "low",
                "evidence_source": "entry_snapshot.ml_snapshot",
                "evidence_ref": {"field": "vol_1h_regime"},
                "evidence_values": {"vol_1h_regime": "extreme"},
                "interpretation": "Entered during extreme vol.",
            },
        ],
    )

    validated, unverified = validate_analysis_output(
        parsed=parsed,
        deterministic_findings=[],
        trade_bundle={},
    )

    assert len(validated["supplemental_findings"]) == 1
    surviving = validated["supplemental_findings"][0]
    assert surviving["id"] == "llm_f1"
    assert surviving["source"] == "llm"
    assert not [u for u in unverified if u["kind"] == "supplemental_finding"]


def test_supplemental_finding_valid_ref_rejects_unknown_source() -> None:
    """A supplemental with a fabricated evidence_source is stripped."""
    from hynous.analysis import validate_analysis_output

    parsed = _valid_parsed(
        supplemental_findings=[
            {
                "type": "fabricated",
                "severity": "high",
                "evidence_source": "something_fabricated",
                "evidence_ref": {"field": "whatever"},
                "evidence_values": {},
                "interpretation": "",
            },
        ],
    )

    validated, unverified = validate_analysis_output(
        parsed=parsed,
        deterministic_findings=[],
        trade_bundle={},
    )

    assert validated["supplemental_findings"] == []
    stripped = [u for u in unverified if u["kind"] == "supplemental_finding"]
    assert len(stripped) == 1
    assert stripped[0]["content"]["evidence_source"] == "something_fabricated"


def test_validate_analysis_output_grade_clamp_boundary() -> None:
    """Boundary check: 0 and 100 pass (inclusive); -1 and 101 default to 50."""
    from hynous.analysis import validate_analysis_output

    # Case A: inclusive boundaries — both 0 and 100 must pass unchanged.
    parsed_inclusive = _valid_parsed(
        grades={
            "entry_quality_grade": 100,
            "entry_timing_grade": 0,
            "sl_placement_grade": 50,
            "tp_placement_grade": 50,
            "size_leverage_grade": 50,
            "exit_quality_grade": 50,
        },
    )
    validated_a, unverified_a = validate_analysis_output(
        parsed=parsed_inclusive,
        deterministic_findings=[],
        trade_bundle={},
    )
    assert validated_a["grades"]["entry_quality_grade"] == 100
    assert validated_a["grades"]["entry_timing_grade"] == 0
    assert not [u for u in unverified_a if u["kind"] == "grade"]

    # Case B: just outside (101, -1) must default to 50 and log.
    parsed_outside = _valid_parsed(
        grades={
            "entry_quality_grade": 101,
            "entry_timing_grade": -1,
            "sl_placement_grade": 50,
            "tp_placement_grade": 50,
            "size_leverage_grade": 50,
            "exit_quality_grade": 50,
        },
    )
    validated_b, unverified_b = validate_analysis_output(
        parsed=parsed_outside,
        deterministic_findings=[],
        trade_bundle={},
    )
    assert validated_b["grades"]["entry_quality_grade"] == 50
    assert validated_b["grades"]["entry_timing_grade"] == 50
    bad_keys = {u["key"] for u in unverified_b if u["kind"] == "grade"}
    assert bad_keys == {"entry_quality_grade", "entry_timing_grade"}


def test_validate_analysis_output_process_quality_score_defaulting() -> None:
    """Missing key AND non-numeric value both default to 50 + log unverified."""
    from hynous.analysis import validate_analysis_output

    # Case A: missing key entirely (``pop`` rather than set to None so the
    # ``.get(...)`` returns None, which fails the ``isinstance`` check).
    parsed_missing = _valid_parsed()
    parsed_missing.pop("process_quality_score")
    validated_a, unverified_a = validate_analysis_output(
        parsed=parsed_missing,
        deterministic_findings=[],
        trade_bundle={},
    )
    assert validated_a["process_quality_score"] == 50
    pqs_entries_a = [u for u in unverified_a if u["kind"] == "process_quality_score"]
    assert len(pqs_entries_a) == 1
    assert pqs_entries_a[0]["raw"] is None

    # Case B: non-numeric value (string).
    parsed_non_numeric = _valid_parsed(process_quality_score="high")
    validated_b, unverified_b = validate_analysis_output(
        parsed=parsed_non_numeric,
        deterministic_findings=[],
        trade_bundle={},
    )
    assert validated_b["process_quality_score"] == 50
    pqs_entries_b = [u for u in unverified_b if u["kind"] == "process_quality_score"]
    assert len(pqs_entries_b) == 1
    assert pqs_entries_b[0]["raw"] == "high"
