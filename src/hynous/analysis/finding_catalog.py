"""Fixed catalog of deterministic finding types.

The rules engine emits :class:`Finding` objects whose ``type`` field is one of
the :class:`FindingType` values below. New finding types require a plan update
— do not add ad-hoc values, or the LLM prompt (phase 3 M2) and the dashboard
display (phase 7) will drift out of sync with what the rules actually emit.
"""

from __future__ import annotations

from enum import Enum
from typing import Any


class FindingType(str, Enum):
    """Fixed catalog of deterministic finding types. Do not add without plan update."""

    # Signal quality
    SIGNAL_DEGRADED_BEFORE_EXIT = "signal_degraded_before_exit"
    SIGNAL_IMPROVED_DURING_HOLD = "signal_improved_during_hold"
    LOW_COMPOSITE_AT_ENTRY = "low_composite_at_entry"

    # Vol regime
    VOL_REGIME_FLIPPED_MID_HOLD = "vol_regime_flipped_mid_hold"

    # Mechanical exit correctness
    MECHANICAL_WORKED_AS_DESIGNED = "mechanical_worked_as_designed"
    TRAIL_NEVER_ACTIVATED = "trail_never_activated"

    # Stop hunting / premature exits
    STOP_HUNT_DETECTED = "stop_hunt_detected"
    PREMATURE_EXIT_VS_TP = "premature_exit_vs_tp"
    HELD_TOO_LONG_AFTER_PEAK = "held_too_long_after_peak"

    # Entry placement
    ENTERED_AGAINST_FUNDING = "entered_against_funding"
    ENTERED_INTO_LIQ_CLUSTER = "entered_into_liq_cluster"

    # SL/TP sanity
    SL_TOO_TIGHT_FOR_REALIZED_VOL = "sl_too_tight_for_realized_vol"


FINDING_METADATA: dict[FindingType, dict[str, Any]] = {
    FindingType.SIGNAL_DEGRADED_BEFORE_EXIT: {
        "severity_default": "medium",
        "description": "Composite entry score dropped significantly between entry and exit",
        "evidence_source": "ml_exit_comparison",
    },
    FindingType.SIGNAL_IMPROVED_DURING_HOLD: {
        "severity_default": "low",
        "description": "ML signals strengthened during the hold — possible early exit",
        "evidence_source": "ml_exit_comparison",
    },
    FindingType.LOW_COMPOSITE_AT_ENTRY: {
        "severity_default": "medium",
        "description": "Entry fired with composite score below 55 (marginal)",
        "evidence_source": "entry_snapshot.ml_snapshot",
    },
    FindingType.VOL_REGIME_FLIPPED_MID_HOLD: {
        "severity_default": "medium",
        "description": "Volatility regime changed during the hold",
        "evidence_source": "trade_events.vol_regime_change",
    },
    FindingType.MECHANICAL_WORKED_AS_DESIGNED: {
        "severity_default": "low",  # positive finding
        "description": "Exit classification matches expected layer given peak ROE",
        "evidence_source": "trade_events + exit_classification",
    },
    FindingType.TRAIL_NEVER_ACTIVATED: {
        "severity_default": "low",
        "description": "Trade closed without peak_roe reaching trail activation threshold",
        "evidence_source": "peak_roe + trade_events",
    },
    FindingType.STOP_HUNT_DETECTED: {
        "severity_default": "high",
        "description": "SL was hit then price reversed >1% within 10 min",
        "evidence_source": "counterfactuals.did_sl_get_hunted",
    },
    FindingType.PREMATURE_EXIT_VS_TP: {
        "severity_default": "medium",
        "description": "Price reached original TP within counterfactual window after exit",
        "evidence_source": "counterfactuals.did_tp_hit_later",
    },
    FindingType.HELD_TOO_LONG_AFTER_PEAK: {
        "severity_default": "medium",
        "description": "Peak ROE exceeded 5% but exit ROE was less than 50% of peak",
        "evidence_source": "roe_trajectory",
    },
    FindingType.ENTERED_AGAINST_FUNDING: {
        "severity_default": "medium",
        "description": "Funding sign opposed trade direction with magnitude above threshold",
        "evidence_source": "entry_snapshot.derivatives_state",
    },
    FindingType.ENTERED_INTO_LIQ_CLUSTER: {
        "severity_default": "high",
        "description": "Entry price within 0.5% of adverse liquidation cluster",
        "evidence_source": "entry_snapshot.liquidation_terrain",
    },
    FindingType.SL_TOO_TIGHT_FOR_REALIZED_VOL: {
        "severity_default": "high",
        "description": "SL distance was less than realized 1h vol × 0.5 at entry",
        "evidence_source": "entry_snapshot + sl_distance",
    },
}
