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

from dataclasses import asdict
from typing import Any

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

    # Sample fixtures: composite_entry_score=0.71 => low_composite fires.
    # composite_score_delta=-0.19 => signal_degraded does NOT fire (|delta|<20).
    types = {f.type for f in findings}
    assert FindingType.LOW_COMPOSITE_AT_ENTRY.value in types


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
