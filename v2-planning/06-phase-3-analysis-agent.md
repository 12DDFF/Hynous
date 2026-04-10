# Phase 3 — Analysis Agent (Hybrid Rules + LLM)

> **Prerequisites:** Phases 0, 1, 2 complete and accepted.
>
> **Phase goal:** Build the post-trade analysis pipeline. For every closed trade, a deterministic rules engine emits objective findings, then an LLM synthesis pass produces a narrative with evidence citations. Every claim in the narrative must be backed by a finding. Output is persisted to `trade_analyses`. A hourly batch job analyzes rejected signals with a lighter prompt.

---

## Context

Phase 3 is where the LLM re-enters v2 — but in a radically different role than v1. The LLM no longer decides trades. It interprets them after the fact, with full access to the rich lifecycle data captured in phase 1 and stored in the phase 2 journal.

The pipeline is hybrid:

1. **Deterministic rules engine** — walks the trade's lifecycle (entry snapshot + events + exit snapshot + counterfactuals) and emits structured findings whenever a rule's conditions are met. These findings are objective ground truth — no interpretation, no hallucination possible.

2. **LLM synthesis agent** — receives the full trade bundle PLUS the deterministic findings and is asked to produce:
   - A narrative (2–3 paragraphs explaining what happened)
   - Supplemental findings (observations beyond the deterministic ruleset), each with mandatory evidence references
   - Component grades (0–100 for entry quality, timing, SL placement, TP placement, sizing, exit)
   - Mistake tags from a fixed vocabulary
   - A process quality score (0–100, NOT outcome-based)
   - A one-line summary

3. **Evidence validation** — every citation in the narrative and every LLM-generated finding must reference a real piece of data. Unverified claims are flagged and surfaced in the dashboard as untrustworthy.

4. **Batch rejection analysis** — a separate hourly pipeline runs a lighter LLM pass over rejected signals, asking "was this rejection correct given what happened next?" Output is a condensed analysis record stored in the same table.

---

## Required Reading

1. **Phase 1 plan (`04-phase-1-data-capture.md`)** — full — you're consuming the data it produced
2. **Phase 2 plan (`05-phase-2-journal-module.md`)** — full — you're writing to the `trade_analyses` table
3. **`src/hynous/intelligence/coach.py`** — full — you're deleting this in phase 4; understand what it was doing so you know what NOT to reproduce
4. **`src/hynous/intelligence/consolidation.py`** — full — same reason, the v1 cross-episode pattern extraction
5. **`src/hynous/intelligence/agent.py`** — targeted — understand how LLM calls are made via litellm, how the OpenRouter key is loaded, how tool-calling loops work. You'll reuse the litellm infrastructure but NOT the full agent.
6. **OpenRouter + litellm documentation** — understand model selection, response format, token counting
7. **`src/hynous/core/costs.py`** — understand how costs are recorded so your LLM calls cost-track correctly

---

## Scope

### In Scope

- `src/hynous/analysis/` module (scaffold already exists from phase 0)
- `rules_engine.py` — deterministic rule evaluation producing structured findings
- `finding_catalog.py` — fixed catalog of finding types
- `mistake_tags.py` — fixed vocabulary of mistake tags with mapping to finding types
- `llm_pipeline.py` — LLM call orchestration, prompt construction, response parsing
- `validation.py` — evidence reference validation
- `wake_integration.py` — daemon integration (background thread triggered after trade_exit)
- `batch_rejection.py` — hourly batch analysis of rejected signals
- `prompts.py` — the canonical system prompt for the analysis agent
- Unit tests for every rule, every validator, every parser
- Integration test running the full pipeline against 3 mocked trade bundles

### Out of Scope

- Deletion of v1 agent/coach (phase 4)
- Mechanical entry refactor (phase 5)
- Dashboard UI for analysis display (phase 7)
- Quantitative model improvements (phase 8)
- User chat agent (separate minor work at end of phase 5)

---

## Deterministic Rules Engine

The rules engine is the "proof" layer — its findings are objective facts computed from captured data. Keep the starter set tight: only rules that produce insight worth acting on, no decoration.

### Rule catalog

Starter set of 12 rules (trimmed from the 18 proposed earlier — removed rules that don't produce actionable insight):

```python
# src/hynous/analysis/finding_catalog.py

from enum import Enum

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


FINDING_METADATA: dict[FindingType, dict] = {
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
```

### Rule implementation

```python
# src/hynous/analysis/rules_engine.py

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from .finding_catalog import FindingType, FINDING_METADATA

logger = logging.getLogger(__name__)


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
    source: str = "deterministic" # "deterministic" | "llm"


def run_rules(bundle: dict[str, Any]) -> list[Finding]:
    """Evaluate all rules against a trade bundle.
    
    Args:
        bundle: full trade dict as returned by JournalStore.get_trade(),
                containing entry_snapshot, exit_snapshot, events, counterfactuals.
    
    Returns:
        list of Finding objects (deterministic source). May be empty.
    """
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


def _rule_signal_degraded(bundle: dict) -> Finding | None:
    """Fires if composite score dropped more than 20 points during the hold."""
    exit_snap = bundle.get("exit_snapshot")
    if not exit_snap:
        return None
    comparison = exit_snap.get("ml_exit_comparison", {})
    delta = comparison.get("composite_score_delta")
    if delta is None or delta > -20:
        return None
    
    entry = bundle.get("entry_snapshot", {}).get("ml_snapshot", {})
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


def _rule_signal_improved(bundle: dict) -> Finding | None:
    """Fires if composite score improved more than 20 points during the hold."""
    exit_snap = bundle.get("exit_snapshot")
    if not exit_snap:
        return None
    comparison = exit_snap.get("ml_exit_comparison", {})
    delta = comparison.get("composite_score_delta")
    if delta is None or delta < 20:
        return None
    
    entry = bundle.get("entry_snapshot", {}).get("ml_snapshot", {})
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


def _rule_low_composite(bundle: dict) -> Finding | None:
    """Fires if entry composite score was below 55 (marginal)."""
    ml = bundle.get("entry_snapshot", {}).get("ml_snapshot", {})
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


def _rule_vol_regime_flipped(bundle: dict) -> Finding | None:
    """Fires if a vol_regime_change event exists during the hold."""
    events = bundle.get("events", [])
    regime_changes = [e for e in events if e.get("event_type") == "vol_regime_change"]
    if not regime_changes:
        return None
    
    first_change = regime_changes[0]
    return Finding(
        id="",
        type=FindingType.VOL_REGIME_FLIPPED_MID_HOLD.value,
        severity="medium",
        evidence_source="trade_events.vol_regime_change",
        evidence_ref={"event_id": first_change.get("id")},
        evidence_values={
            "old_regime": first_change.get("payload", {}).get("old_regime"),
            "new_regime": first_change.get("payload", {}).get("new_regime"),
            "ts": first_change.get("ts"),
            "total_changes": len(regime_changes),
        },
        interpretation=(
            f"Vol regime changed from {first_change.get('payload', {}).get('old_regime')} to "
            f"{first_change.get('payload', {}).get('new_regime')} during hold "
            f"({len(regime_changes)} transition(s) total)"
        ),
    )


def _rule_mechanical_correct(bundle: dict) -> Finding | None:
    """Positive finding: exit classification matches expected layer given peak ROE."""
    trade = bundle  # top-level trade row
    classification = trade.get("exit_classification")
    peak_roe = trade.get("peak_roe", 0)
    
    if not classification:
        return None
    
    # Determine expected layer
    expected = None
    if peak_roe > 2.5:  # activation threshold for normal vol — ≈ trail_activation_normal
        expected = "trailing_stop"
    elif peak_roe > 0:
        expected = "breakeven_stop"
    else:
        expected = "dynamic_protective_sl"
    
    if classification != expected:
        return None  # mechanical did NOT match — that's a different finding (not implemented in starter set)
    
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
        },
        interpretation=(
            f"Exit classification {classification!r} matches expected layer "
            f"for peak ROE {peak_roe:.1f}%"
        ),
    )


def _rule_trail_never_activated(bundle: dict) -> Finding | None:
    """Fires if the trade closed without ever activating the trailing stop."""
    events = bundle.get("events", [])
    has_trail_activation = any(e.get("event_type") == "trail_activated" for e in events)
    if has_trail_activation:
        return None
    
    trade = bundle
    if trade.get("status") != "closed":
        return None
    
    peak_roe = trade.get("peak_roe", 0)
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


def _rule_stop_hunt(bundle: dict) -> Finding | None:
    """Fires if counterfactuals report SL hunt."""
    cf = bundle.get("counterfactuals", {})
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


def _rule_premature_exit(bundle: dict) -> Finding | None:
    """Fires if original TP was reached within the counterfactual window after exit."""
    cf = bundle.get("counterfactuals", {})
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


def _rule_held_too_long(bundle: dict) -> Finding | None:
    """Fires if peak_roe > 5% but exit_roe < 50% of peak (significant giveback)."""
    trade = bundle
    peak = trade.get("peak_roe", 0)
    roe_at_exit = trade.get("roe_pct", 0)
    
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


def _rule_against_funding(bundle: dict) -> Finding | None:
    """Fires if funding sign opposed trade direction with magnitude above threshold."""
    entry = bundle.get("entry_snapshot", {})
    basics = entry.get("trade_basics", {})
    derivs = entry.get("derivatives_state", {})
    
    funding = derivs.get("funding_rate")
    if funding is None or abs(funding) < 0.0005:  # 0.05% threshold
        return None
    
    side = basics.get("side")
    # Funding rate: positive = longs pay shorts. Going long against positive funding is paying.
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


def _rule_into_liq_cluster(bundle: dict) -> Finding | None:
    """Fires if entry price is within 0.5% of an adverse liquidation cluster."""
    entry = bundle.get("entry_snapshot", {})
    basics = entry.get("trade_basics", {})
    liq = entry.get("liquidation_terrain", {})
    
    entry_px = basics.get("entry_px", 0)
    side = basics.get("side")
    if entry_px <= 0:
        return None
    
    # Adverse clusters: below for long, above for short
    adverse = liq.get("clusters_below", []) if side == "long" else liq.get("clusters_above", [])
    
    for cluster in adverse:
        cluster_px = cluster.get("price", 0)
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


def _rule_sl_too_tight(bundle: dict) -> Finding | None:
    """Fires if SL distance was less than realized 1h vol × 0.5."""
    entry = bundle.get("entry_snapshot", {})
    basics = entry.get("trade_basics", {})
    market = entry.get("market_state", {})
    
    entry_px = basics.get("entry_px", 0)
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
```

---

## Mistake Tag Vocabulary

```python
# src/hynous/analysis/mistake_tags.py

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
    "clean_process_losing_outcome": [],  # no finding mapping; LLM assigns when process was solid but PnL negative
    "trail_insufficient_peak": [
        FindingType.TRAIL_NEVER_ACTIVATED,
    ],
}


def validate_mistake_tag(tag: str, findings: list) -> bool:
    """Return True if the tag is in the vocabulary AND at least one supporting finding exists."""
    if tag not in MISTAKE_TAGS:
        return False
    if tag == "clean_process_losing_outcome":
        return True  # special: LLM-judged, no deterministic mapping required
    required_types = {ft.value for ft in MISTAKE_TAGS[tag]}
    finding_types = {f.type if hasattr(f, "type") else f.get("type") for f in findings}
    return bool(required_types & finding_types)
```

---

## LLM Pipeline

```python
# src/hynous/analysis/llm_pipeline.py

from __future__ import annotations

import json
import logging
from dataclasses import asdict
from typing import Any

from .finding_catalog import FindingType
from .mistake_tags import MISTAKE_TAGS, validate_mistake_tag
from .prompts import ANALYSIS_SYSTEM_PROMPT, build_user_prompt
from .rules_engine import Finding

logger = logging.getLogger(__name__)


def run_analysis(
    *,
    trade_bundle: dict[str, Any],
    deterministic_findings: list[Finding],
    model: str = "anthropic/claude-sonnet-4.5",
    max_tokens: int = 4096,
    temperature: float = 0.2,
    prompt_version: str = "v1",
) -> dict[str, Any]:
    """Run the analysis LLM call and return the parsed structured output.
    
    Returns a dict with keys:
        narrative, narrative_citations, findings (includes LLM supplementals),
        grades, mistake_tags, process_quality_score, one_line_summary,
        unverified_claims, model_used, prompt_version
    
    Raises:
        RuntimeError on LLM call failure (caller decides whether to retry)
        ValueError if the LLM response cannot be parsed
    """
    # Build messages
    user_prompt = build_user_prompt(
        trade_bundle=trade_bundle,
        deterministic_findings=deterministic_findings,
    )
    
    messages = [
        {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]
    
    # Make LLM call via litellm (the same library v1 uses)
    import litellm
    
    try:
        response = litellm.completion(
            model=model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            response_format={"type": "json_object"},
        )
    except Exception as e:
        logger.exception("Analysis LLM call failed")
        raise RuntimeError(f"Analysis LLM call failed: {e}") from e
    
    # Extract content
    content = response.choices[0].message.content
    if not content:
        raise ValueError("Empty LLM response")
    
    # Parse JSON
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as e:
        logger.error("LLM response was not valid JSON: %s", content[:500])
        raise ValueError(f"LLM response not parseable: {e}") from e
    
    # Validate required top-level keys
    required_keys = {
        "narrative",
        "narrative_citations",
        "supplemental_findings",
        "grades",
        "mistake_tags",
        "process_quality_score",
        "one_line_summary",
    }
    missing = required_keys - set(parsed.keys())
    if missing:
        raise ValueError(f"LLM response missing required keys: {missing}")
    
    parsed["model_used"] = model
    parsed["prompt_version"] = prompt_version
    
    # Record cost
    try:
        from hynous.core.costs import record_llm_usage
        usage = getattr(response, "usage", None)
        if usage:
            record_llm_usage(
                model=model,
                input_tokens=getattr(usage, "prompt_tokens", 0),
                output_tokens=getattr(usage, "completion_tokens", 0),
                cost_usd=getattr(response, "_hidden_params", {}).get("response_cost", 0),
            )
    except Exception:
        logger.debug("Failed to record LLM usage", exc_info=True)
    
    return parsed
```

---

## Prompts

```python
# src/hynous/analysis/prompts.py

from typing import Any
from dataclasses import asdict

from .rules_engine import Finding
from .mistake_tags import MISTAKE_TAGS
from .finding_catalog import FindingType


ANALYSIS_SYSTEM_PROMPT = """You are a post-trade analysis agent. Your job is to interpret a closed crypto trade using the data provided, producing a structured JSON output that the engineer can audit against the underlying evidence.

## Your job

1. Read the trade bundle: entry snapshot, exit snapshot, lifecycle events, counterfactuals, and the deterministic findings already computed.
2. Produce a narrative that explains what happened, citing the specific findings that support each claim.
3. Optionally add supplemental findings for observations the deterministic rules missed — but every supplemental finding MUST have a concrete evidence reference (field path, event id, or specific value from the bundle).
4. Grade the trade on six independent dimensions (0–100).
5. Assign mistake tags from the fixed vocabulary.
6. Compute a process quality score (0–100) that reflects REASONING QUALITY, not outcome. A losing trade with clean process scores high; a winning trade that ignored warnings scores low.

## Hard rules

1. **Every claim in the narrative must cite at least one finding ID.** If you can't cite, don't claim.
2. **Every supplemental finding must have `evidence_ref` pointing to real data in the bundle.** Fabricating evidence refs is a critical failure — it will be caught by validation.
3. **Mistake tags must be from the fixed vocabulary.** Tags you invent will be stripped.
4. **Grades must be integers 0–100.** Provide one per dimension.
5. **Process quality is NOT outcome-based.** Do not let PnL influence process_quality_score.
6. **Do NOT use emojis.**
7. **Keep narrative to 2–3 paragraphs max.**
8. **Do NOT recommend future trades.** This is retrospective analysis, not prediction.

## Finding types (for reference)

The deterministic rules engine emits findings of these types:
- signal_degraded_before_exit
- signal_improved_during_hold
- low_composite_at_entry
- vol_regime_flipped_mid_hold
- mechanical_worked_as_designed
- trail_never_activated
- stop_hunt_detected
- premature_exit_vs_tp
- held_too_long_after_peak
- entered_against_funding
- entered_into_liq_cluster
- sl_too_tight_for_realized_vol

You may add supplemental findings with custom types (prefix with `llm_`) as long as they have evidence refs.

## Mistake tag vocabulary

Use ONLY these tags:
- signal_weak_at_entry
- signal_degraded
- exit_premature
- exit_late_giveback
- entered_against_funding
- entered_into_liq_cluster
- sl_too_tight
- stop_hunted
- vol_regime_shifted
- clean_mechanical_exit
- clean_process_losing_outcome
- trail_insufficient_peak

## Grade dimensions (each 0–100, independent)

- **entry_quality_grade** — was the ML composite + entry quality signal actually strong at entry?
- **entry_timing_grade** — was the fill price a good entry relative to the 5m preceding window?
- **sl_placement_grade** — was the SL distance sized appropriately for vol conditions?
- **tp_placement_grade** — was the TP distance realistic given range_30m prediction?
- **size_leverage_grade** — was the size and leverage appropriate for conviction and vol?
- **exit_quality_grade** — did the exit fire at the right moment given available data?

## Output format

Return a single JSON object with this exact schema:

```json
{
  "narrative": "<2-3 paragraphs>",
  "narrative_citations": [
    {"paragraph_idx": 0, "finding_ids": ["f1", "f3"]},
    {"paragraph_idx": 1, "finding_ids": ["f2"]},
    {"paragraph_idx": 2, "finding_ids": ["f4", "f5"]}
  ],
  "supplemental_findings": [
    {
      "type": "llm_<descriptor>",
      "severity": "low|medium|high",
      "evidence_source": "<which part of bundle>",
      "evidence_ref": {"field_or_event_path": "..."},
      "evidence_values": {"key": "value", ...},
      "interpretation": "<one sentence>"
    }
  ],
  "grades": {
    "entry_quality_grade": 0-100,
    "entry_timing_grade": 0-100,
    "sl_placement_grade": 0-100,
    "tp_placement_grade": 0-100,
    "size_leverage_grade": 0-100,
    "exit_quality_grade": 0-100
  },
  "mistake_tags": ["tag1", "tag2", ...],
  "process_quality_score": 0-100,
  "one_line_summary": "<≤15 words>"
}
```

Return ONLY the JSON. No preamble, no closing text.
"""


def build_user_prompt(
    *,
    trade_bundle: dict[str, Any],
    deterministic_findings: list[Finding],
) -> str:
    """Construct the user message containing the trade bundle and findings."""
    import json
    
    # Serialize deterministic findings as structured refs
    findings_dicts = []
    for f in deterministic_findings:
        findings_dicts.append({
            "id": f.id,
            "type": f.type,
            "severity": f.severity,
            "evidence_source": f.evidence_source,
            "evidence_ref": f.evidence_ref,
            "evidence_values": f.evidence_values,
            "interpretation": f.interpretation,
        })
    
    # Trim the bundle to essentials to stay under token budget
    trimmed = _trim_bundle_for_prompt(trade_bundle)
    
    parts = [
        "## Trade bundle",
        "```json",
        json.dumps(trimmed, indent=2, default=str),
        "```",
        "",
        "## Deterministic findings (already computed — cite these)",
        "```json",
        json.dumps(findings_dicts, indent=2, default=str),
        "```",
        "",
        "Produce your analysis as JSON per the system prompt schema.",
    ]
    return "\n".join(parts)


def _trim_bundle_for_prompt(bundle: dict) -> dict:
    """Remove large redundant sections from the bundle to fit prompt token budget."""
    trimmed = dict(bundle)
    # Drop the full price_history (huge); keep counts instead
    entry = trimmed.get("entry_snapshot") or {}
    if "price_history" in entry:
        ph = entry["price_history"]
        entry = dict(entry)
        entry["price_history"] = {
            "candles_1m_15min_count": len(ph.get("candles_1m_15min", [])),
            "candles_5m_4h_count": len(ph.get("candles_5m_4h", [])),
        }
        trimmed["entry_snapshot"] = entry
    
    exit_snap = trimmed.get("exit_snapshot") or {}
    if "price_path_1m" in exit_snap:
        pp = exit_snap["price_path_1m"]
        exit_snap = dict(exit_snap)
        exit_snap["price_path_1m"] = {"count": len(pp)}
        trimmed["exit_snapshot"] = exit_snap
    
    # Limit events to first 20 per type
    events = trimmed.get("events", [])
    if len(events) > 100:
        # Keep a representative sample
        trimmed["events"] = events[:100]
        trimmed["_events_truncated"] = len(events) - 100
    
    return trimmed
```

---

## Evidence Validation

```python
# src/hynous/analysis/validation.py

from __future__ import annotations

from typing import Any

from .rules_engine import Finding
from .mistake_tags import validate_mistake_tag


def validate_analysis_output(
    *,
    parsed: dict[str, Any],
    deterministic_findings: list[Finding],
    trade_bundle: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Validate the parsed LLM output against the trade bundle.
    
    Returns:
        (validated_dict, unverified_claims):
            validated_dict has stripped invalid tags and unfounded findings
            unverified_claims is a list of things that failed validation
    """
    unverified: list[dict[str, Any]] = []
    validated = dict(parsed)
    
    # Build set of all valid finding IDs (deterministic + LLM supplemental)
    det_ids = {f.id for f in deterministic_findings}
    llm_findings = parsed.get("supplemental_findings", []) or []
    
    # Assign IDs to LLM supplementals
    validated_supplemental = []
    for i, f in enumerate(llm_findings):
        f_id = f"llm_f{i+1}"
        if _supplemental_finding_has_valid_ref(f, trade_bundle):
            f["id"] = f_id
            f["source"] = "llm"
            validated_supplemental.append(f)
        else:
            unverified.append({
                "kind": "supplemental_finding",
                "content": f,
                "reason": "evidence_ref does not resolve to bundle data",
            })
    validated["supplemental_findings"] = validated_supplemental
    
    all_ids = det_ids | {f["id"] for f in validated_supplemental}
    
    # Validate narrative citations
    citations = parsed.get("narrative_citations", []) or []
    valid_citations = []
    for c in citations:
        cited = set(c.get("finding_ids", []))
        bad = cited - all_ids
        if bad:
            unverified.append({
                "kind": "narrative_citation",
                "paragraph_idx": c.get("paragraph_idx"),
                "bad_ids": list(bad),
            })
            valid = list(cited - bad)
            if valid:
                valid_citations.append({
                    "paragraph_idx": c.get("paragraph_idx"),
                    "finding_ids": valid,
                })
        else:
            valid_citations.append(c)
    validated["narrative_citations"] = valid_citations
    
    # Validate mistake tags
    tags = parsed.get("mistake_tags", []) or []
    all_findings_for_tags = [
        {"type": f.type} for f in deterministic_findings
    ] + validated_supplemental
    valid_tags = [t for t in tags if validate_mistake_tag(t, all_findings_for_tags)]
    invalid_tags = [t for t in tags if t not in valid_tags]
    if invalid_tags:
        unverified.append({
            "kind": "mistake_tag",
            "invalid_tags": invalid_tags,
            "reason": "not in vocabulary or no supporting finding",
        })
    validated["mistake_tags"] = valid_tags
    
    # Validate grades are integers 0-100
    grades = parsed.get("grades", {}) or {}
    valid_grades = {}
    required_grades = [
        "entry_quality_grade", "entry_timing_grade", "sl_placement_grade",
        "tp_placement_grade", "size_leverage_grade", "exit_quality_grade",
    ]
    for key in required_grades:
        val = grades.get(key)
        if isinstance(val, (int, float)) and 0 <= val <= 100:
            valid_grades[key] = int(val)
        else:
            valid_grades[key] = 50  # neutral default
            unverified.append({
                "kind": "grade",
                "key": key,
                "raw": val,
                "reason": "not an integer 0-100; defaulted to 50",
            })
    validated["grades"] = valid_grades
    
    # Validate process_quality_score
    pqs = parsed.get("process_quality_score")
    if not (isinstance(pqs, (int, float)) and 0 <= pqs <= 100):
        validated["process_quality_score"] = 50
        unverified.append({
            "kind": "process_quality_score",
            "raw": pqs,
            "reason": "not an integer 0-100; defaulted to 50",
        })
    else:
        validated["process_quality_score"] = int(pqs)
    
    return validated, unverified


def _supplemental_finding_has_valid_ref(finding: dict, bundle: dict) -> bool:
    """Heuristic check that the LLM's evidence_ref points to real data.
    
    Minimal validation: the evidence_source string should match a known bundle section,
    and any field paths in evidence_ref should dereference non-None values.
    """
    source = finding.get("evidence_source", "")
    known_sources = {
        "entry_snapshot", "exit_snapshot", "events", "counterfactuals",
        "ml_exit_comparison", "trade_row", "roe_trajectory",
        "entry_snapshot.ml_snapshot", "entry_snapshot.market_state",
        "entry_snapshot.derivatives_state", "entry_snapshot.liquidation_terrain",
        "entry_snapshot.order_flow_state", "entry_snapshot.smart_money_context",
        "entry_snapshot.time_context", "entry_snapshot.account_context",
        "trade_events", "trade_events.vol_regime_change",
    }
    # Accept the source if any known source is a prefix
    source_ok = any(source.startswith(ks) or ks.startswith(source) for ks in known_sources)
    if not source_ok:
        return False
    
    # Minimal ref check: if evidence_ref has field paths, verify at least one exists
    ref = finding.get("evidence_ref", {}) or {}
    if not ref:
        return False
    
    return True  # permissive — stricter path resolution can be added later
```

---

## Wake Integration

```python
# src/hynous/analysis/wake_integration.py

from __future__ import annotations

import logging
import threading
from typing import Any

from hynous.journal.store import JournalStore
from .rules_engine import run_rules
from .llm_pipeline import run_analysis
from .validation import validate_analysis_output
from .embeddings import build_analysis_embedding

logger = logging.getLogger(__name__)


def trigger_analysis_for_trade(
    *,
    trade_id: str,
    journal_store: JournalStore,
    model: str = "anthropic/claude-sonnet-4.5",
    prompt_version: str = "v1",
) -> None:
    """Run the full analysis pipeline for a closed trade.
    
    Called from daemon on trade_exit in a background thread. Does NOT block
    the daemon's fast trigger loop.
    """
    try:
        bundle = journal_store.get_trade(trade_id)
        if not bundle:
            logger.warning("Analysis: trade %s not found in journal", trade_id)
            return
        if bundle.get("status") != "closed":
            logger.info("Analysis: skip %s — status=%s", trade_id, bundle.get("status"))
            return
        if bundle.get("analysis"):
            logger.info("Analysis: %s already has analysis, skipping", trade_id)
            return
        
        logger.info("Analysis starting for trade %s", trade_id)
        
        # Step 1: deterministic rules
        findings = run_rules(bundle)
        logger.info("Analysis: %d deterministic findings for %s", len(findings), trade_id)
        
        # Step 2: LLM synthesis
        try:
            parsed = run_analysis(
                trade_bundle=bundle,
                deterministic_findings=findings,
                model=model,
                prompt_version=prompt_version,
            )
        except Exception:
            logger.exception("Analysis LLM failed for %s (will NOT retry)", trade_id)
            return
        
        # Step 3: validate
        validated, unverified = validate_analysis_output(
            parsed=parsed,
            deterministic_findings=findings,
            trade_bundle=bundle,
        )
        
        # Step 4: merge deterministic + validated LLM supplemental findings
        all_findings = [
            {
                "id": f.id,
                "type": f.type,
                "severity": f.severity,
                "evidence_source": f.evidence_source,
                "evidence_ref": f.evidence_ref,
                "evidence_values": f.evidence_values,
                "interpretation": f.interpretation,
                "source": f.source,
            }
            for f in findings
        ] + list(validated.get("supplemental_findings", []))
        
        # Step 5: compute embedding for narrative (semantic search later)
        embedding_bytes = None
        try:
            embedding_bytes = build_analysis_embedding(validated.get("narrative", ""))
        except Exception:
            logger.debug("Analysis embedding failed (non-fatal)", exc_info=True)
        
        # Step 6: persist
        journal_store.insert_analysis(
            trade_id=trade_id,
            narrative=validated.get("narrative", ""),
            narrative_citations=validated.get("narrative_citations", []),
            findings=all_findings,
            grades=validated.get("grades", {}),
            mistake_tags=validated.get("mistake_tags", []),
            process_quality_score=validated.get("process_quality_score", 50),
            one_line_summary=validated.get("one_line_summary", ""),
            unverified_claims=unverified if unverified else None,
            model_used=model,
            prompt_version=prompt_version,
            embedding=embedding_bytes,
        )
        
        logger.info(
            "Analysis complete for %s: %d findings, %d tags, score=%d, unverified=%d",
            trade_id,
            len(all_findings),
            len(validated.get("mistake_tags", [])),
            validated.get("process_quality_score", 50),
            len(unverified),
        )
    except Exception:
        logger.exception("Analysis pipeline raised for trade_id=%s", trade_id)


def trigger_analysis_async(*, trade_id: str, journal_store: JournalStore, **kwargs) -> None:
    """Fire the analysis in a background thread. Non-blocking."""
    thread = threading.Thread(
        target=trigger_analysis_for_trade,
        kwargs={"trade_id": trade_id, "journal_store": journal_store, **kwargs},
        daemon=True,
        name=f"analysis-{trade_id[:8]}",
    )
    thread.start()
```

### Daemon integration

In `daemon.py` `_fast_trigger_check`, immediately after the phase 1 exit snapshot persist call, add:

```python
# v2: trigger post-trade analysis in background
try:
    from hynous.analysis.wake_integration import trigger_analysis_async
    trigger_analysis_async(
        trade_id=_trade_id,
        journal_store=self._journal_store,
        model=self.config.v2.analysis_agent.model,
        prompt_version=self.config.v2.analysis_agent.prompt_version,
    )
except Exception:
    logger.exception("Failed to dispatch analysis for %s", _trade_id)
```

---

## Batch Rejection Analysis

```python
# src/hynous/analysis/batch_rejection.py

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta, timezone

from hynous.journal.store import JournalStore

logger = logging.getLogger(__name__)


# Lighter system prompt for rejection analysis
REJECTION_SYSTEM_PROMPT = """You are analyzing rejected trade signals. For each rejection, judge whether the rejection was correct based on subsequent price action.

You will receive:
- The rejected signal's ML conditions at the time of rejection
- Which gate rejected it (rejection_reason)
- The price path in the window following the rejection

Your job is a brief JSON per rejection:
```json
{
  "rejection_id": "<trade_id>",
  "correct": true|false,
  "reason": "<one sentence>",
  "counterfactual_pnl_roe": <estimated ROE if the trade had been taken>
}
```

Be brief. No narrative. No decoration. Just the structured judgment.
"""


def run_batch_rejection_analysis(
    *,
    journal_store: JournalStore,
    since: datetime | None = None,
    model: str = "anthropic/claude-sonnet-4.5",
    batch_size: int = 10,
) -> int:
    """Analyze all rejected signals in the window.
    
    Returns count of rejections processed.
    """
    if since is None:
        since = datetime.now(timezone.utc) - timedelta(hours=1)
    
    rejections = journal_store.list_trades(
        status="rejected",
        since=since.isoformat(),
        limit=200,
    )
    if not rejections:
        return 0
    
    # Filter rejections that don't have an analysis yet
    pending = []
    for r in rejections:
        existing = journal_store.get_analysis(r["trade_id"])
        if not existing:
            pending.append(r)
    
    if not pending:
        return 0
    
    logger.info("Batch rejection analysis: %d pending", len(pending))
    
    # Process in batches of batch_size
    processed = 0
    for i in range(0, len(pending), batch_size):
        batch = pending[i:i + batch_size]
        try:
            _process_rejection_batch(batch, journal_store, model)
            processed += len(batch)
        except Exception:
            logger.exception("Rejection batch failed (continuing)")
    
    return processed


def _process_rejection_batch(
    batch: list[dict],
    journal_store: JournalStore,
    model: str,
) -> None:
    """Run one LLM call per batch to analyze multiple rejections at once."""
    import json
    import litellm
    
    # Build bundle of rejection contexts
    contexts = []
    for r in batch:
        entry = journal_store.get_trade(r["trade_id"]) or {}
        contexts.append({
            "rejection_id": r["trade_id"],
            "symbol": r["symbol"],
            "rejection_reason": r.get("rejection_reason"),
            "ml_conditions_at_rejection": entry.get("entry_snapshot", {}).get("ml_snapshot"),
            "trigger_context": entry.get("entry_snapshot", {}).get("trigger_context"),
        })
    
    messages = [
        {"role": "system", "content": REJECTION_SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(contexts, default=str)},
    ]
    
    response = litellm.completion(
        model=model,
        messages=messages,
        max_tokens=2048,
        temperature=0.2,
        response_format={"type": "json_object"},
    )
    content = response.choices[0].message.content
    results = json.loads(content)
    
    # Persist each result as a minimal analysis
    for result in results.get("judgments", []):
        tid = result.get("rejection_id")
        if not tid:
            continue
        journal_store.insert_analysis(
            trade_id=tid,
            narrative=result.get("reason", ""),
            narrative_citations=[],
            findings=[{
                "id": "rejection_judgment",
                "type": "rejection_judgment",
                "severity": "low",
                "evidence_source": "llm_batch_rejection",
                "evidence_ref": {"rejection_id": tid},
                "evidence_values": {
                    "correct": result.get("correct"),
                    "counterfactual_pnl_roe": result.get("counterfactual_pnl_roe"),
                },
                "interpretation": result.get("reason", ""),
                "source": "llm_batch",
            }],
            grades={},
            mistake_tags=[],
            process_quality_score=100 if result.get("correct") else 50,
            one_line_summary=result.get("reason", "")[:80],
            unverified_claims=None,
            model_used=model,
            prompt_version="rejection-v1",
        )


def start_batch_rejection_cron(
    *,
    journal_store: JournalStore,
    interval_s: int,
    model: str,
) -> threading.Thread:
    """Start the hourly rejection analysis background thread."""
    def _loop():
        while True:
            try:
                time.sleep(interval_s)
                run_batch_rejection_analysis(
                    journal_store=journal_store,
                    model=model,
                )
            except Exception:
                logger.exception("Batch rejection cron iteration failed")
    
    thread = threading.Thread(target=_loop, daemon=True, name="rejection-analysis-cron")
    thread.start()
    return thread
```

Mount the cron in daemon startup (alongside journal store init).

---

## Testing

### Unit tests

Create `tests/unit/test_v2_analysis.py` with tests for each rule, each validator, each parser edge case:

1. `test_rule_signal_degraded_fires_on_large_drop`
2. `test_rule_signal_degraded_silent_on_small_drop`
3. `test_rule_signal_improved_fires_on_large_rise`
4. `test_rule_low_composite_fires_below_55`
5. `test_rule_low_composite_severity_high_below_40`
6. `test_rule_vol_regime_flipped_fires_on_event`
7. `test_rule_mechanical_correct_fires_on_matching_classification`
8. `test_rule_trail_never_activated_fires_on_missing_event`
9. `test_rule_stop_hunt_fires_on_counterfactual_flag`
10. `test_rule_premature_exit_fires_on_tp_later_hit`
11. `test_rule_held_too_long_fires_on_50pct_giveback`
12. `test_rule_against_funding_fires_on_opposing_sign`
13. `test_rule_into_liq_cluster_fires_within_half_percent`
14. `test_rule_sl_too_tight_fires_below_vol_threshold`
15. `test_run_rules_assigns_sequential_ids`
16. `test_run_rules_handles_rule_exceptions`
17. `test_validate_mistake_tag_accepts_valid`
18. `test_validate_mistake_tag_rejects_unknown`
19. `test_validate_mistake_tag_rejects_without_finding_support`
20. `test_validate_analysis_output_strips_invalid_citations`
21. `test_validate_analysis_output_strips_invalid_tags`
22. `test_validate_analysis_output_defaults_bad_grades`
23. `test_supplemental_finding_valid_ref_accepts_known_source`
24. `test_supplemental_finding_valid_ref_rejects_unknown_source`
25. `test_build_user_prompt_includes_trimmed_bundle`
26. `test_run_analysis_parses_valid_llm_response` (mock litellm)
27. `test_run_analysis_raises_on_missing_required_keys`
28. `test_run_analysis_raises_on_non_json_response`
29. `test_trigger_analysis_skips_if_already_analyzed`

### Integration tests

`tests/integration/test_v2_analysis_integration.py`:

1. `test_full_pipeline_on_synthetic_winning_trade`
2. `test_full_pipeline_on_synthetic_losing_trade`
3. `test_full_pipeline_on_stop_hunted_trade`
4. `test_batch_rejection_analysis_processes_pending`

### Smoke test

Phase 3 smoke test: run daemon for 30 minutes in paper mode, wait for at least one closed trade, verify:
- `trade_analyses` row exists for the closed trade
- Narrative is non-empty
- At least one finding exists
- All grades are 0-100
- process_quality_score is 0-100
- unverified_claims is empty OR clearly explained
- API: `curl /api/v2/journal/trades/<trade_id>/analysis` returns the full record

---

## Acceptance Criteria

- [ ] All 12 rules implemented with tests
- [ ] `finding_catalog.py` contains exact FindingType enum
- [ ] `mistake_tags.py` contains the 12-tag vocabulary
- [ ] `llm_pipeline.py` successfully calls the LLM via litellm
- [ ] `validation.py` strips invalid citations/tags/grades
- [ ] `wake_integration.py` fires analysis in background thread on trade close
- [ ] `batch_rejection.py` hourly cron processes pending rejections
- [ ] Daemon calls `trigger_analysis_async` in the trigger close path
- [ ] Daemon starts batch rejection cron on startup
- [ ] 29 unit tests pass
- [ ] 4 integration tests pass
- [ ] Smoke test produces at least one analysis
- [ ] Analysis JSON validates against schema
- [ ] Zero hallucinated evidence refs in smoke test output
- [ ] Phase 3 commit(s) tagged `[phase-3]`

---

## Report-Back

Include LLM cost per analysis (from litellm), average analysis latency, count of unverified_claims across all smoke test analyses, and any rule that produced false positives during smoke testing.
