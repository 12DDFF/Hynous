"""Deterministic rules engine — produces objective, evidence-backed findings.

Walk a trade bundle (top-level row + entry_snapshot + exit_snapshot + events +
counterfactuals) and emit a :class:`Finding` per matching rule. Each rule is a
pure function of the bundle; rules never mutate inputs and never raise past
:func:`run_rules` (which wraps every rule in try/except to prevent a bad rule
from poisoning the whole pass).

The output of :func:`run_rules` is the "proof" layer for phase 3 M2's LLM
synthesis pass — the LLM must cite these finding IDs in its narrative.
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass, is_dataclass
from typing import Any

from .finding_catalog import FindingType

logger = logging.getLogger(__name__)


# Vol-regime-adaptive trailing stop activation thresholds (percent ROE).
# Keep in sync with `TradingSettings.trail_activation_*` in
# `src/hynous/core/trading_settings.py`. See
# `docs/revisions/breakeven-fix/ml-adaptive-trailing-stop.md`.
_TRAIL_ACTIVATION_BY_REGIME: dict[str, float] = {
    "extreme": 1.5,
    "high": 2.0,
    "normal": 2.5,
    "low": 3.0,
}
_TRAIL_ACTIVATION_DEFAULT: float = 2.5


@dataclass(slots=True)
class Finding:
    """A single structured, evidence-backed finding."""

    id: str                       # f1, f2, ... assigned by engine
    type: str                     # FindingType value
    severity: str                 # "low" | "medium" | "high"
    evidence_source: str          # which part of the bundle
    evidence_ref: dict[str, Any]  # specific pointer (field path, event id, etc.)
    evidence_values: dict[str, Any]  # actual raw values
    interpretation: str           # one-sentence explanation
    source: str = "deterministic"  # "deterministic" | "llm"


def run_rules(bundle: dict[str, Any]) -> list[Finding]:
    """Evaluate all rules against a trade bundle.

    Args:
        bundle: full trade dict as returned by ``JournalStore.get_trade()``.
            Per Amendment 9, ``bundle["entry_snapshot"]`` and
            ``bundle["exit_snapshot"]`` are hydrated dataclass instances
            (:class:`TradeEntrySnapshot` / :class:`TradeExitSnapshot`), NOT
            plain dicts. Every rule body below assumes dict-style
            ``.get(...)`` access, so this function COERCES both snapshots with
            :func:`dataclasses.asdict` at the boundary. This is the single
            point of contract adaptation — rule functions stay dict-only.

    Returns:
        list of :class:`Finding` objects (deterministic source). May be empty.
    """
    # Coerce dataclass snapshots to dicts before dispatching to rules.
    # Use `is_dataclass` guard so this function still works when callers
    # pass a pre-dict'd bundle (e.g. synthetic test bundles, or a future
    # store that returns dicts).
    bundle = dict(bundle)  # shallow copy so we don't mutate the caller
    entry_snap = bundle.get("entry_snapshot")
    if is_dataclass(entry_snap) and not isinstance(entry_snap, type):
        bundle["entry_snapshot"] = asdict(entry_snap)
    exit_snap = bundle.get("exit_snapshot")
    if is_dataclass(exit_snap) and not isinstance(exit_snap, type):
        bundle["exit_snapshot"] = asdict(exit_snap)

    findings: list[Finding] = []
    rule_fns = [
        _rule_signal_degraded,
        _rule_signal_improved,
        _rule_low_composite,
        _rule_vol_regime_flipped,
        _rule_mechanical_correct,
        _rule_trail_never_activated,
        _rule_stop_hunt,
        _rule_premature_exit,
        _rule_held_too_long,
        _rule_against_funding,
        _rule_into_liq_cluster,
        _rule_sl_too_tight,
    ]

    for fn in rule_fns:
        try:
            result = fn(bundle)
            if result:
                findings.append(result)
        except Exception:
            logger.exception("Rule %s failed", fn.__name__)

    # Assign finding IDs after dedup
    for i, f in enumerate(findings):
        f.id = f"f{i+1}"

    return findings


def _rule_signal_degraded(bundle: dict[str, Any]) -> Finding | None:
    """Fires if composite score dropped more than 20 points during the hold."""
    exit_snap = bundle.get("exit_snapshot")
    if not exit_snap:
        return None
    comparison = exit_snap.get("ml_exit_comparison", {}) or {}
    delta = comparison.get("composite_score_delta")
    if delta is None or delta > -20:
        return None

    entry = (bundle.get("entry_snapshot") or {}).get("ml_snapshot", {}) or {}
    return Finding(
        id="",
        type=FindingType.SIGNAL_DEGRADED_BEFORE_EXIT.value,
        severity="high" if delta < -30 else "medium",
        evidence_source="ml_exit_comparison",
        evidence_ref={
            "entry_composite": entry.get("composite_entry_score"),
            "exit_composite": comparison.get("composite_score_at_exit"),
        },
        evidence_values={
            "entry_composite": entry.get("composite_entry_score"),
            "exit_composite": comparison.get("composite_score_at_exit"),
            "delta": delta,
        },
        interpretation=(
            f"Composite entry score dropped from "
            f"{entry.get('composite_entry_score', 0):.0f} at entry to "
            f"{comparison.get('composite_score_at_exit', 0):.0f} at exit "
            f"(delta: {delta:+.0f})"
        ),
    )


def _rule_signal_improved(bundle: dict[str, Any]) -> Finding | None:
    """Fires if composite score improved more than 20 points during the hold."""
    exit_snap = bundle.get("exit_snapshot")
    if not exit_snap:
        return None
    comparison = exit_snap.get("ml_exit_comparison", {}) or {}
    delta = comparison.get("composite_score_delta")
    if delta is None or delta < 20:
        return None

    entry = (bundle.get("entry_snapshot") or {}).get("ml_snapshot", {}) or {}
    return Finding(
        id="",
        type=FindingType.SIGNAL_IMPROVED_DURING_HOLD.value,
        severity="low",
        evidence_source="ml_exit_comparison",
        evidence_ref={
            "entry_composite": entry.get("composite_entry_score"),
            "exit_composite": comparison.get("composite_score_at_exit"),
        },
        evidence_values={
            "entry_composite": entry.get("composite_entry_score"),
            "exit_composite": comparison.get("composite_score_at_exit"),
            "delta": delta,
        },
        interpretation=(
            f"Signal strengthened during hold "
            f"(composite {entry.get('composite_entry_score', 0):.0f} → "
            f"{comparison.get('composite_score_at_exit', 0):.0f})"
        ),
    )


def _rule_low_composite(bundle: dict[str, Any]) -> Finding | None:
    """Fires if entry composite score was below 55 (marginal)."""
    ml = (bundle.get("entry_snapshot") or {}).get("ml_snapshot", {}) or {}
    score = ml.get("composite_entry_score")
    if score is None or score >= 55:
        return None

    return Finding(
        id="",
        type=FindingType.LOW_COMPOSITE_AT_ENTRY.value,
        severity="high" if score < 40 else "medium",
        evidence_source="entry_snapshot.ml_snapshot",
        evidence_ref={"field": "composite_entry_score"},
        evidence_values={
            "composite_entry_score": score,
            "composite_label": ml.get("composite_label"),
            "components": ml.get("composite_components", {}),
        },
        interpretation=(
            f"Entry fired with composite score {score:.0f}/100 ({ml.get('composite_label')}) — "
            f"marginal conditions"
        ),
    )


def _rule_vol_regime_flipped(bundle: dict[str, Any]) -> Finding | None:
    """Fires if a vol_regime_change event exists during the hold."""
    events = bundle.get("events", []) or []
    regime_changes = [e for e in events if e.get("event_type") == "vol_regime_change"]
    if not regime_changes:
        return None

    first_change = regime_changes[0]
    payload = first_change.get("payload", {}) or {}
    return Finding(
        id="",
        type=FindingType.VOL_REGIME_FLIPPED_MID_HOLD.value,
        severity="medium",
        evidence_source="trade_events.vol_regime_change",
        evidence_ref={"event_id": first_change.get("id")},
        evidence_values={
            "old_regime": payload.get("old_regime"),
            "new_regime": payload.get("new_regime"),
            "ts": first_change.get("ts"),
            "total_changes": len(regime_changes),
        },
        interpretation=(
            f"Vol regime changed from {payload.get('old_regime')} to "
            f"{payload.get('new_regime')} during hold "
            f"({len(regime_changes)} transition(s) total)"
        ),
    )


def _rule_mechanical_correct(bundle: dict[str, Any]) -> Finding | None:
    """Positive finding: exit classification matches expected layer given peak ROE.

    Trail activation is vol-regime-adaptive in production
    (see ``docs/revisions/breakeven-fix/ml-adaptive-trailing-stop.md``).
    Thresholds: extreme=1.5%, high=2.0%, normal=2.5%, low=3.0%.
    Using a hard-coded 2.5% would false-positive on extreme/high regime
    trades that legitimately activated trail below 2.5% ROE.
    """
    trade = bundle  # top-level trade row
    classification = trade.get("exit_classification")
    peak_roe = trade.get("peak_roe", 0) or 0

    if not classification:
        return None

    # Resolve vol regime from the entry snapshot's ml_snapshot.
    # Bundle entry_snapshot is already coerced to a dict by run_rules.
    vol_regime = (
        (bundle.get("entry_snapshot") or {})
        .get("ml_snapshot", {})
        .get("vol_1h_regime")
    )
    trail_threshold = _TRAIL_ACTIVATION_BY_REGIME.get(
        vol_regime, _TRAIL_ACTIVATION_DEFAULT,
    )

    # Determine expected layer
    expected: str
    if peak_roe > trail_threshold:
        expected = "trailing_stop"
    elif peak_roe > 0:
        expected = "breakeven_stop"
    else:
        expected = "dynamic_protective_sl"

    if classification != expected:
        # mechanical did NOT match — that's a different finding
        # (not implemented in starter set)
        return None

    return Finding(
        id="",
        type=FindingType.MECHANICAL_WORKED_AS_DESIGNED.value,
        severity="low",
        evidence_source="trade_row",
        evidence_ref={"field": "exit_classification"},
        evidence_values={
            "exit_classification": classification,
            "peak_roe": peak_roe,
            "expected_layer": expected,
            "vol_1h_regime": vol_regime,
            "trail_activation_threshold": trail_threshold,
        },
        interpretation=(
            f"Exit classification {classification!r} matches expected layer "
            f"for peak ROE {peak_roe:.1f}% (vol_regime={vol_regime or 'unknown'}, "
            f"trail_activation≥{trail_threshold:.1f}%)"
        ),
    )


def _rule_trail_never_activated(bundle: dict[str, Any]) -> Finding | None:
    """Fires if the trade closed without ever activating the trailing stop."""
    events = bundle.get("events", []) or []
    has_trail_activation = any(
        e.get("event_type") == "trail_activated" for e in events
    )
    if has_trail_activation:
        return None

    trade = bundle
    if trade.get("status") != "closed":
        return None

    peak_roe = trade.get("peak_roe", 0) or 0
    return Finding(
        id="",
        type=FindingType.TRAIL_NEVER_ACTIVATED.value,
        severity="low",
        evidence_source="trade_events + peak_roe",
        evidence_ref={"peak_roe": peak_roe},
        evidence_values={"peak_roe": peak_roe},
        interpretation=(
            f"Peak ROE of {peak_roe:.1f}% did not reach trail activation threshold "
            f"(trade closed without trailing stop engaging)"
        ),
    )


def _rule_stop_hunt(bundle: dict[str, Any]) -> Finding | None:
    """Fires if counterfactuals report SL hunt."""
    cf = bundle.get("counterfactuals", {}) or {}
    if not cf.get("did_sl_get_hunted"):
        return None

    return Finding(
        id="",
        type=FindingType.STOP_HUNT_DETECTED.value,
        severity="high",
        evidence_source="counterfactuals.did_sl_get_hunted",
        evidence_ref={"field": "did_sl_get_hunted"},
        evidence_values={
            "reversal_pct": cf.get("sl_hunt_reversal_pct"),
        },
        interpretation=(
            f"SL was hit, then price reversed "
            f"{cf.get('sl_hunt_reversal_pct', 0):.1f}% within 10 min — stop hunt pattern"
        ),
    )


def _rule_premature_exit(bundle: dict[str, Any]) -> Finding | None:
    """Fires if original TP was reached within the counterfactual window after exit."""
    cf = bundle.get("counterfactuals", {}) or {}
    if not cf.get("did_tp_hit_later"):
        return None

    return Finding(
        id="",
        type=FindingType.PREMATURE_EXIT_VS_TP.value,
        severity="medium",
        evidence_source="counterfactuals.did_tp_hit_later",
        evidence_ref={"tp_hit_ts": cf.get("did_tp_hit_ts")},
        evidence_values={
            "did_tp_hit_later": True,
            "tp_hit_ts": cf.get("did_tp_hit_ts"),
            "optimal_exit_px": cf.get("optimal_exit_px"),
        },
        interpretation=(
            f"Original TP was reached at {cf.get('did_tp_hit_ts')} — "
            f"holding longer would have captured the full target"
        ),
    )


def _rule_held_too_long(bundle: dict[str, Any]) -> Finding | None:
    """Fires if peak_roe > 5% but exit_roe < 50% of peak (significant giveback)."""
    trade = bundle
    peak = trade.get("peak_roe", 0) or 0
    roe_at_exit = trade.get("roe_pct", 0) or 0

    if peak < 5:
        return None
    if roe_at_exit >= peak * 0.5:
        return None

    return Finding(
        id="",
        type=FindingType.HELD_TOO_LONG_AFTER_PEAK.value,
        severity="medium",
        evidence_source="roe_trajectory",
        evidence_ref={"peak_roe": peak, "exit_roe": roe_at_exit},
        evidence_values={
            "peak_roe": peak,
            "exit_roe": roe_at_exit,
            "giveback_ratio": 1 - (roe_at_exit / peak) if peak else 0,
        },
        interpretation=(
            f"Peak ROE of {peak:.1f}% gave back to {roe_at_exit:.1f}% at exit "
            f"({(1 - roe_at_exit/peak)*100:.0f}% giveback)"
        ),
    )


def _rule_against_funding(bundle: dict[str, Any]) -> Finding | None:
    """Fires if funding sign opposed trade direction with magnitude above threshold."""
    entry = bundle.get("entry_snapshot") or {}
    basics = entry.get("trade_basics", {}) or {}
    derivs = entry.get("derivatives_state", {}) or {}

    funding = derivs.get("funding_rate")
    if funding is None or abs(funding) < 0.0005:  # 0.05% threshold
        return None

    side = basics.get("side")
    # Funding rate: positive = longs pay shorts. Going long against positive
    # funding is paying.
    against = (side == "long" and funding > 0) or (side == "short" and funding < 0)
    if not against:
        return None

    return Finding(
        id="",
        type=FindingType.ENTERED_AGAINST_FUNDING.value,
        severity="medium",
        evidence_source="entry_snapshot.derivatives_state",
        evidence_ref={"field": "funding_rate"},
        evidence_values={
            "funding_rate": funding,
            "side": side,
        },
        interpretation=(
            f"Entered {side} against funding rate of {funding*100:.3f}% — "
            f"paying funding while holding"
        ),
    )


def _rule_into_liq_cluster(bundle: dict[str, Any]) -> Finding | None:
    """Fires if entry price is within 0.5% of an adverse liquidation cluster."""
    entry = bundle.get("entry_snapshot") or {}
    basics = entry.get("trade_basics", {}) or {}
    liq = entry.get("liquidation_terrain", {}) or {}

    entry_px = basics.get("entry_px", 0) or 0
    side = basics.get("side")
    if entry_px <= 0:
        return None

    # Adverse clusters: below for long, above for short
    if side == "long":
        adverse = liq.get("clusters_below", []) or []
    else:
        adverse = liq.get("clusters_above", []) or []

    for cluster in adverse:
        cluster_px = cluster.get("price", 0) or 0
        if cluster_px <= 0:
            continue
        distance_pct = abs(cluster_px - entry_px) / entry_px
        if distance_pct < 0.005:  # 0.5%
            return Finding(
                id="",
                type=FindingType.ENTERED_INTO_LIQ_CLUSTER.value,
                severity="high",
                evidence_source="entry_snapshot.liquidation_terrain",
                evidence_ref={"cluster_price": cluster_px, "side": side},
                evidence_values={
                    "entry_px": entry_px,
                    "cluster_price": cluster_px,
                    "distance_pct": distance_pct * 100,
                    "cluster_size_usd": cluster.get("size_usd"),
                },
                interpretation=(
                    f"Entry at ${entry_px:.2f} within "
                    f"{distance_pct*100:.2f}% of adverse liq cluster at "
                    f"${cluster_px:.2f} "
                    f"(${cluster.get('size_usd', 0):,.0f} size)"
                ),
            )
    return None


def _rule_sl_too_tight(bundle: dict[str, Any]) -> Finding | None:
    """Fires if SL distance was less than realized 1h vol × 0.5."""
    entry = bundle.get("entry_snapshot") or {}
    basics = entry.get("trade_basics", {}) or {}
    market = entry.get("market_state", {}) or {}

    entry_px = basics.get("entry_px", 0) or 0
    sl_px = basics.get("sl_px")
    realized_vol = market.get("realized_vol_1h_pct")

    if entry_px <= 0 or sl_px is None or realized_vol is None:
        return None

    sl_distance_pct = abs(sl_px - entry_px) / entry_px * 100
    threshold = realized_vol * 0.5

    if sl_distance_pct >= threshold:
        return None

    return Finding(
        id="",
        type=FindingType.SL_TOO_TIGHT_FOR_REALIZED_VOL.value,
        severity="high",
        evidence_source="entry_snapshot.market_state",
        evidence_ref={"sl_distance_pct": sl_distance_pct, "realized_vol_1h": realized_vol},
        evidence_values={
            "sl_distance_pct": sl_distance_pct,
            "realized_vol_1h_pct": realized_vol,
            "ratio": sl_distance_pct / realized_vol if realized_vol else 0,
        },
        interpretation=(
            f"SL distance {sl_distance_pct:.2f}% < half of realized 1h vol "
            f"({realized_vol:.2f}%) — high noise-stop probability"
        ),
    )
