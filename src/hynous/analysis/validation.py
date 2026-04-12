"""Evidence validator for the LLM analysis pipeline.

Phase 3 Milestone 3. :func:`validate_analysis_output` consumes the parsed
dict returned by :func:`hynous.analysis.llm_pipeline.run_analysis` alongside
the deterministic findings and the dict-form trade bundle, and strips any
LLM-emitted claim that can't be traced back to real bundle data:

* ``supplemental_findings`` with an unrecognized ``evidence_source`` or no
  ``evidence_ref`` are dropped (prefix-match is permissive — see note below).
* ``narrative_citations`` referencing unknown finding ids have those ids
  stripped; citations that lose all ids are dropped entirely.
* ``mistake_tags`` not in the vocabulary or not supported by any finding
  (per :func:`hynous.analysis.mistake_tags.validate_mistake_tag`) are dropped.
* ``grades`` values that aren't integers in ``[0, 100]`` default to 50.
* ``process_quality_score`` is validated + coerced to an int in ``[0, 100]``.

Every stripped or defaulted item is recorded in the ``unverified_claims``
list returned alongside the validated dict. The caller (phase 3 M4's
``wake_integration.trigger_analysis_for_trade``) persists that list onto
the ``trade_analyses`` row so downstream audits can spot hallucination
patterns.

**Future work.** The supplemental-finding ref check is currently permissive:
we verify the ``evidence_source`` is a known section (prefix match) and that
``evidence_ref`` is non-empty, but we do NOT walk the bundle to dereference
the ref. Upgrading to strict path resolution (does
``bundle[section][...ref path...]`` actually yield a non-None value?) is
explicitly deferred to a later milestone.
"""

from __future__ import annotations

from typing import Any

from .mistake_tags import validate_mistake_tag
from .rules_engine import Finding


def validate_analysis_output(
    *,
    parsed: dict[str, Any],
    deterministic_findings: list[Finding],
    trade_bundle: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Validate the parsed LLM output against the trade bundle.

    Args:
        parsed: the dict returned by :func:`run_analysis` — already has
            the 7 required top-level keys plus ``model_used`` and
            ``prompt_version`` annotations.
        deterministic_findings: findings from :func:`run_rules`; their ids
            (``f1``, ``f2``, ...) form the base set of valid citation ids.
        trade_bundle: dict-form bundle matching :meth:`JournalStore.get_trade`.
            The rules-engine boundary coerces dataclass snapshots via
            ``asdict``, so validation consumes the same dict-form shape.

    Returns:
        ``(validated_dict, unverified_claims)``:

        * ``validated_dict`` is a shallow copy of ``parsed`` with invalid
          supplemental findings / citations / tags stripped and grades
          coerced.
        * ``unverified_claims`` is a list of ``{"kind": ..., ...}`` dicts
          describing each stripped-or-defaulted item. Persisted verbatim
          onto the trade-analysis row.
    """
    unverified: list[dict[str, Any]] = []
    validated: dict[str, Any] = dict(parsed)

    # ------------------------------------------------------------------
    # Supplemental findings — assign ids, validate ref, strip invalid.
    # ------------------------------------------------------------------
    det_ids = {f.id for f in deterministic_findings}
    llm_findings = parsed.get("supplemental_findings", []) or []

    validated_supplemental: list[dict[str, Any]] = []
    for i, f in enumerate(llm_findings):
        f_id = f"llm_f{i + 1}"
        if _supplemental_finding_has_valid_ref(f, trade_bundle):
            f["id"] = f_id
            f["source"] = "llm"
            validated_supplemental.append(f)
        else:
            unverified.append(
                {
                    "kind": "supplemental_finding",
                    "content": f,
                    "reason": "evidence_ref does not resolve to bundle data",
                }
            )
    validated["supplemental_findings"] = validated_supplemental

    all_ids = det_ids | {f["id"] for f in validated_supplemental}

    # ------------------------------------------------------------------
    # Narrative citations — drop unknown ids per citation.
    # ------------------------------------------------------------------
    citations = parsed.get("narrative_citations", []) or []
    valid_citations: list[dict[str, Any]] = []
    for c in citations:
        cited = set(c.get("finding_ids", []))
        bad = cited - all_ids
        if bad:
            unverified.append(
                {
                    "kind": "narrative_citation",
                    "paragraph_idx": c.get("paragraph_idx"),
                    "bad_ids": list(bad),
                }
            )
            valid = list(cited - bad)
            if valid:
                valid_citations.append(
                    {
                        "paragraph_idx": c.get("paragraph_idx"),
                        "finding_ids": valid,
                    }
                )
        else:
            valid_citations.append(c)
    validated["narrative_citations"] = valid_citations

    # ------------------------------------------------------------------
    # Mistake tags — drop unknown / unsupported.
    # ------------------------------------------------------------------
    tags = parsed.get("mistake_tags", []) or []
    all_findings_for_tags: list[Any] = [
        {"type": f.type} for f in deterministic_findings
    ] + validated_supplemental
    valid_tags = [t for t in tags if validate_mistake_tag(t, all_findings_for_tags)]
    invalid_tags = [t for t in tags if t not in valid_tags]
    if invalid_tags:
        unverified.append(
            {
                "kind": "mistake_tag",
                "invalid_tags": invalid_tags,
                "reason": "not in vocabulary or no supporting finding",
            }
        )
    validated["mistake_tags"] = valid_tags

    # ------------------------------------------------------------------
    # Grades — integers in [0, 100] (inclusive); default to 50.
    # ------------------------------------------------------------------
    grades = parsed.get("grades", {}) or {}
    valid_grades: dict[str, int] = {}
    required_grades = [
        "entry_quality_grade",
        "entry_timing_grade",
        "sl_placement_grade",
        "tp_placement_grade",
        "size_leverage_grade",
        "exit_quality_grade",
    ]
    for key in required_grades:
        val = grades.get(key)
        if isinstance(val, (int, float)) and 0 <= val <= 100:
            valid_grades[key] = int(val)
        else:
            valid_grades[key] = 50  # neutral default
            unverified.append(
                {
                    "kind": "grade",
                    "key": key,
                    "raw": val,
                    "reason": "not an integer 0-100; defaulted to 50",
                }
            )
    validated["grades"] = valid_grades

    # ------------------------------------------------------------------
    # Process quality score — single int in [0, 100].
    # ------------------------------------------------------------------
    pqs = parsed.get("process_quality_score")
    if not (isinstance(pqs, (int, float)) and 0 <= pqs <= 100):
        validated["process_quality_score"] = 50
        unverified.append(
            {
                "kind": "process_quality_score",
                "raw": pqs,
                "reason": "not an integer 0-100; defaulted to 50",
            }
        )
    else:
        validated["process_quality_score"] = int(pqs)

    return validated, unverified


def _supplemental_finding_has_valid_ref(
    finding: dict[str, Any], bundle: dict[str, Any]
) -> bool:
    """Heuristic check that the LLM's ``evidence_ref`` points to real data.

    Minimal validation (permissive baseline — see module docstring for the
    future-work note on strict path resolution):

    * ``evidence_source`` must match one of the known bundle sections by a
      bidirectional prefix comparison (so ``entry_snapshot.ml_snapshot``
      matches either the exact entry or the broader ``entry_snapshot``).
    * ``evidence_ref`` must be a non-empty mapping.
    """
    source = finding.get("evidence_source", "")
    known_sources = {
        "entry_snapshot",
        "exit_snapshot",
        "events",
        "counterfactuals",
        "ml_exit_comparison",
        "trade_row",
        "roe_trajectory",
        "entry_snapshot.ml_snapshot",
        "entry_snapshot.market_state",
        "entry_snapshot.derivatives_state",
        "entry_snapshot.liquidation_terrain",
        "entry_snapshot.order_flow_state",
        "entry_snapshot.smart_money_context",
        "entry_snapshot.time_context",
        "entry_snapshot.account_context",
        "trade_events",
        "trade_events.vol_regime_change",
    }
    # Permissive prefix match: accept if the declared source is a known
    # section or contains a known section as a prefix.
    source_ok = any(
        source.startswith(ks) or ks.startswith(source) for ks in known_sources
    )
    if not source_ok:
        return False

    # Minimal ref check: non-empty mapping. Deeper dereference (walking
    # bundle[section][path...]) is intentionally deferred — see module
    # docstring.
    ref = finding.get("evidence_ref", {}) or {}
    if not ref:
        return False

    _ = bundle  # reserved for future strict-path resolution
    return True
