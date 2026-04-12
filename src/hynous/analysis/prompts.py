"""Analysis agent prompts — system prompt + user prompt builder.

The system prompt (``ANALYSIS_SYSTEM_PROMPT``) is the contract with the LLM:
it enumerates the fixed vocabulary (finding types, mistake tags, grade
dimensions) and the exact JSON schema the model must return. Any drift
between this file and ``finding_catalog.py`` / ``mistake_tags.py`` teaches
the LLM to emit tokens that validation will strip — silent quality
degradation. Keep catalogs in lockstep.

Phase 3 M2 — M3 adds evidence validation, M4 wires the daemon.
"""

from __future__ import annotations

import json
from typing import Any

from .rules_engine import Finding

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
  "one_line_summary": "<=15 words>"
}
```

Return ONLY the JSON. No preamble, no closing text.
"""


def build_user_prompt(
    *,
    trade_bundle: dict[str, Any],
    deterministic_findings: list[Finding],
) -> str:
    """Construct the user message containing the trade bundle and findings.

    Args:
        trade_bundle: the ``JournalStore.get_trade()``-shaped dict. May contain
            hydrated dataclass snapshots — ``default=str`` on ``json.dumps``
            handles that, plus :func:`_trim_bundle_for_prompt` only inspects
            top-level keys that are still dicts (the caller is free to pre-
            coerce via :func:`dataclasses.asdict` if they prefer).
        deterministic_findings: list of ``Finding`` objects from the rules
            engine. These are serialized inline so the LLM can cite them by
            ``id`` in its narrative.

    Returns:
        The full user message string (Markdown + fenced JSON blocks).
    """
    # Serialize deterministic findings as structured refs
    findings_dicts: list[dict[str, Any]] = []
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


def _trim_bundle_for_prompt(bundle: dict[str, Any]) -> dict[str, Any]:
    """Remove large redundant sections from the bundle to fit prompt token budget.

    Drops the full ``price_history`` candle arrays (keeps counts), drops the
    ``price_path_1m`` array on the exit snapshot (keeps count), and truncates
    the ``events`` list to the first 100 entries (recording the number dropped
    in ``_events_truncated``).
    """
    trimmed = dict(bundle)
    # Drop the full price_history (huge); keep counts instead
    entry = trimmed.get("entry_snapshot") or {}
    if isinstance(entry, dict) and "price_history" in entry:
        ph = entry["price_history"] or {}
        entry = dict(entry)
        entry["price_history"] = {
            "candles_1m_15min_count": len(ph.get("candles_1m_15min", [])),
            "candles_5m_4h_count": len(ph.get("candles_5m_4h", [])),
        }
        trimmed["entry_snapshot"] = entry

    exit_snap = trimmed.get("exit_snapshot") or {}
    if isinstance(exit_snap, dict) and "price_path_1m" in exit_snap:
        pp = exit_snap["price_path_1m"] or []
        exit_snap = dict(exit_snap)
        exit_snap["price_path_1m"] = {"count": len(pp)}
        trimmed["exit_snapshot"] = exit_snap

    # Limit events to first 100
    events = trimmed.get("events", []) or []
    if len(events) > 100:
        trimmed["events"] = events[:100]
        trimmed["_events_truncated"] = len(events) - 100

    return trimmed
