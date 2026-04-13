"""Wake-triggered post-trade analysis entry point.

The daemon calls :func:`trigger_analysis_async` from the ``trade_exit``
branch of :meth:`Daemon._fast_trigger_check` (immediately after the exit
snapshot is persisted). The async wrapper spawns a daemon thread that
runs :func:`trigger_analysis_for_trade` — the full deterministic rules →
LLM synthesis → evidence validation → embedding → persist pipeline — so
the fast trigger loop never blocks on the LLM round-trip.

Idempotency is enforced here, not in the daemon: an already-analyzed or
non-closed trade is a no-op. LLM failures are caught inside the pipeline
and do NOT retry (plan lines 1245–1247); the parent ``try`` around the
whole pipeline ensures nothing escapes to the background thread.
"""

from __future__ import annotations

import logging
import threading
from typing import Any

from hynous.journal.store import JournalStore

from .embeddings import build_analysis_embedding
from .llm_pipeline import run_analysis
from .rules_engine import run_rules
from .validation import validate_analysis_output

logger = logging.getLogger(__name__)


def trigger_analysis_for_trade(
    *,
    trade_id: str,
    journal_store: JournalStore,
    model: str = "anthropic/claude-sonnet-4.5",
    prompt_version: str = "v1",
) -> None:
    """Run the full analysis pipeline for a closed trade.

    Called from the daemon on ``trade_exit`` inside a background thread.
    Does NOT block the daemon's fast trigger loop. All exceptions are
    caught at the outer ``try`` so a failure here never propagates into
    the dispatching thread.
    """
    try:
        bundle = journal_store.get_trade(trade_id)
        if not bundle:
            logger.warning("Analysis: trade %s not found in journal", trade_id)
            return
        if bundle.get("status") != "closed":
            logger.info(
                "Analysis: skip %s — status=%s",
                trade_id,
                bundle.get("status"),
            )
            return
        if bundle.get("analysis"):
            logger.info("Analysis: %s already has analysis, skipping", trade_id)
            return

        logger.info("Analysis starting for trade %s", trade_id)

        # Step 1: deterministic rules
        findings = run_rules(bundle)
        logger.info(
            "Analysis: %d deterministic findings for %s",
            len(findings),
            trade_id,
        )

        # Step 2: LLM synthesis — single-attempt; no retry on failure.
        try:
            parsed = run_analysis(
                trade_bundle=bundle,
                deterministic_findings=findings,
                model=model,
                prompt_version=prompt_version,
            )
        except Exception:
            logger.exception(
                "Analysis LLM failed for %s (will NOT retry)",
                trade_id,
            )
            return

        # Step 3: validate evidence + grades + citations + tags
        validated, unverified = validate_analysis_output(
            parsed=parsed,
            deterministic_findings=findings,
            trade_bundle=bundle,
        )

        # Step 4: merge deterministic + validated LLM supplemental findings
        all_findings: list[dict[str, Any]] = [
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

        # Step 5: compute embedding for narrative (semantic search later);
        # best-effort — never block persistence on embedding failure.
        embedding_bytes: bytes | None = None
        try:
            embedding_bytes = build_analysis_embedding(
                validated.get("narrative", ""),
            )
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

        # phase 6 M3: fire-and-forget edge build after analysis is persisted.
        # build_edges_async spawns a daemon thread; the local try/except is
        # belt-and-suspenders around the import + dispatch so an edge-build
        # failure never rolls back the analysis insert.
        try:
            from hynous.journal.consolidation import build_edges_async
            build_edges_async(journal_store, trade_id)
        except Exception:
            logger.exception("Edge building dispatch failed for %s", trade_id)

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


def trigger_analysis_async(
    *,
    trade_id: str,
    journal_store: JournalStore,
    **kwargs: Any,
) -> None:
    """Fire :func:`trigger_analysis_for_trade` in a daemon background thread.

    Non-blocking. Thread name is ``analysis-<trade_id[:8]>`` for easy
    identification in logs / stack dumps. The thread inherits ``daemon=True``
    so it does not keep the process alive on shutdown.
    """
    thread = threading.Thread(
        target=trigger_analysis_for_trade,
        kwargs={"trade_id": trade_id, "journal_store": journal_store, **kwargs},
        daemon=True,
        name=f"analysis-{trade_id[:8]}",
    )
    thread.start()
