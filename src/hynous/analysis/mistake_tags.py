"""Fixed vocabulary of mistake tags.

Each tag maps to one or more :class:`FindingType` values. The LLM synthesis
pass (phase 3 M2) emits tags from this vocabulary; :func:`validate_mistake_tag`
strips tags that are either not in the vocabulary or not supported by any
deterministic finding in the trade's findings list. New tags require a plan
update.
"""

from __future__ import annotations

from typing import Any

from .finding_catalog import FindingType

# Fixed starter vocabulary. Every tag maps to one or more finding types.
# Tags without a mapping are invalid and will be stripped during validation.

MISTAKE_TAGS: dict[str, list[FindingType]] = {
    "signal_weak_at_entry": [
        FindingType.LOW_COMPOSITE_AT_ENTRY,
    ],
    "signal_degraded": [
        FindingType.SIGNAL_DEGRADED_BEFORE_EXIT,
    ],
    "exit_premature": [
        FindingType.PREMATURE_EXIT_VS_TP,
        FindingType.SIGNAL_IMPROVED_DURING_HOLD,
    ],
    "exit_late_giveback": [
        FindingType.HELD_TOO_LONG_AFTER_PEAK,
    ],
    "entered_against_funding": [
        FindingType.ENTERED_AGAINST_FUNDING,
    ],
    "entered_into_liq_cluster": [
        FindingType.ENTERED_INTO_LIQ_CLUSTER,
    ],
    "sl_too_tight": [
        FindingType.SL_TOO_TIGHT_FOR_REALIZED_VOL,
    ],
    "stop_hunted": [
        FindingType.STOP_HUNT_DETECTED,
    ],
    "vol_regime_shifted": [
        FindingType.VOL_REGIME_FLIPPED_MID_HOLD,
    ],
    "clean_mechanical_exit": [
        FindingType.MECHANICAL_WORKED_AS_DESIGNED,
    ],
    # No finding mapping; LLM assigns when process was solid but PnL negative.
    "clean_process_losing_outcome": [],
    "trail_insufficient_peak": [
        FindingType.TRAIL_NEVER_ACTIVATED,
    ],
}


def validate_mistake_tag(tag: str, findings: list[Any]) -> bool:
    """Return True if the tag is in the vocabulary AND at least one supporting finding exists.

    ``findings`` may be a list of :class:`Finding` dataclasses OR a list of
    dicts with a ``"type"`` key — both shapes appear in the pipeline (phase 3
    M3 passes dicts from the LLM supplemental merge).
    """
    if tag not in MISTAKE_TAGS:
        return False
    if tag == "clean_process_losing_outcome":
        return True  # special: LLM-judged, no deterministic mapping required
    required_types = {ft.value for ft in MISTAKE_TAGS[tag]}
    finding_types = {
        f.type if hasattr(f, "type") else f.get("type") for f in findings
    }
    return bool(required_types & finding_types)
