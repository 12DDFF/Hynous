"""Batch rejection analysis (phase 3 M5).

Hourly cron that scans the journal for trades with ``status='rejected'`` that
have not yet been analyzed, bundles them into batches of 10, and asks the
LLM to judge — per rejection — whether the rejection was correct in hindsight
based on the ML conditions + subsequent price action.

Each judgment is persisted as a minimal ``trade_analyses`` row with
``prompt_version='rejection-v1'`` and a single ``rejection_judgment`` finding
carrying ``correct`` + ``counterfactual_pnl_roe`` in ``evidence_values``.

Phase 5 contract (architect-authoritative, documented here so the phase 5
engineer inherits the decision):

* **No rejection-write path exists yet.** Rejections land in the journal
  only once phase 5 (mechanical entry) wires ``_rejection_record()``. For
  phase 3 this cron is infrastructure — it will be fully exercised by
  phase 5's smoke run. Integration test #4 synthesizes rejection rows
  directly via ``upsert_trade(status='rejected', ...)``.

* **Rejection snapshot shape.** When phase 5 eventually writes snapshots
  for rejected signals, reuse the existing ``trade_entry_snapshots`` row
  with a *partially-populated* :class:`TradeEntrySnapshot` — only
  ``ml_snapshot`` and ``trigger_context`` need to be populated (this
  function reads those two sub-objects only). Do NOT add a
  ``rejection_snapshot`` table or a new schema column.

* **Post-rejection counterfactual window: 30 minutes.** When phase 5
  captures a rejection's forward price path (plan line 1360 "price path in
  the window following the rejection"), use a 30-minute window to match
  phase 1's deferred counterfactual recompute cadence. Not actionable in
  M5 — documented here only.

The cron swallows per-iteration exceptions: a bad LLM response or a stale
journal row must never kill the thread. Log-and-continue.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from hynous.journal.store import JournalStore

logger = logging.getLogger(__name__)


# Lighter system prompt for rejection analysis — brief JSON output per rejection.
REJECTION_SYSTEM_PROMPT = """You are analyzing rejected trade signals. For each rejection, judge whether the rejection was correct based on subsequent price action.

You will receive:
- The rejected signal's ML conditions at the time of rejection
- Which gate rejected it (rejection_reason)
- The price path in the window following the rejection

Return ONE JSON object wrapping all judgments:
```json
{
  "judgments": [
    {
      "rejection_id": "<trade_id>",
      "correct": true|false,
      "reason": "<one sentence>",
      "counterfactual_pnl_roe": <estimated ROE if the trade had been taken>
    },
    ...
  ]
}
```

One element in "judgments" per rejection in the batch. Be brief. No narrative. No decoration. Just the structured judgments.
"""


def run_batch_rejection_analysis(
    *,
    journal_store: JournalStore,
    since: datetime | None = None,
    model: str = "openrouter/anthropic/claude-sonnet-4.5",
    batch_size: int = 10,
) -> int:
    """Analyze all rejected signals in the window.

    Defaults to the last hour. Idempotent — rejections that already have a
    ``trade_analyses`` row are skipped.

    Returns the count of rejections processed in this invocation.
    """
    if since is None:
        since = datetime.now(timezone.utc) - timedelta(hours=1)

    # Monthly budget guard — bail out of the entire cron iteration without
    # enumerating rejections if the v2 LLM cap is tripped. Cheaper than
    # checking per batch (no journal query, no network). Pending rejections
    # simply carry over to next month's cron.
    from hynous.core.costs import check_budget
    is_over, _current, _budget = check_budget()
    if is_over:
        return 0

    rejections = journal_store.list_trades(
        status="rejected",
        since=since.isoformat(),
        limit=200,
    )
    if not rejections:
        return 0

    # Filter rejections that don't have an analysis row yet.
    pending: list[dict[str, Any]] = []
    for r in rejections:
        existing = journal_store.get_analysis(r["trade_id"])
        if not existing:
            pending.append(r)

    if not pending:
        return 0

    logger.info("Batch rejection analysis: %d pending", len(pending))

    from hynous.core.costs import check_budget

    processed = 0
    for i in range(0, len(pending), batch_size):
        # Re-check between batches — an earlier batch may have pushed us
        # over the cap (each batch is a separate LiteLLM call that records
        # cost post-return). Keeps large backlogs from over-running the cap.
        is_over, _current, _budget = check_budget()
        if is_over:
            logger.info(
                "Batch rejection analysis: budget hit after %d processed, "
                "skipping remaining %d", processed, len(pending) - i,
            )
            break
        batch = pending[i:i + batch_size]
        try:
            _process_rejection_batch(batch, journal_store, model)
            processed += len(batch)
        except Exception:
            logger.exception("Rejection batch failed (continuing)")

    return processed


def _process_rejection_batch(
    batch: list[dict[str, Any]],
    journal_store: JournalStore,
    model: str,
) -> None:
    """Run one LLM call per batch to analyze multiple rejections at once.

    ``entry.get("entry_snapshot") or {}`` guards the phase-3 reality that
    rejections do not yet carry entry snapshots (phase 5 will add them).
    """
    import litellm

    contexts = []
    for r in batch:
        entry = journal_store.get_trade(r["trade_id"]) or {}
        snapshot = entry.get("entry_snapshot") or {}
        # snapshot may be a dataclass (reconstructed by get_trade) or a dict
        # (absent / plain). Use getattr→dict-get fallback so both shapes work
        # through a single path. The ``default`` sentinel keeps mypy happy
        # about the Union[dataclass, dict] source.
        if isinstance(snapshot, dict):
            ml_conditions = snapshot.get("ml_snapshot")
            trigger_context = snapshot.get("trigger_context")
        else:
            ml_conditions = getattr(snapshot, "ml_snapshot", None)
            trigger_context = getattr(snapshot, "trigger_context", None)
        contexts.append({
            "rejection_id": r["trade_id"],
            "symbol": r["symbol"],
            "rejection_reason": r.get("rejection_reason"),
            "ml_conditions_at_rejection": ml_conditions,
            "trigger_context": trigger_context,
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
    # Anthropic via OpenRouter returns JSON wrapped in markdown fences,
    # so route through the shared fence-tolerant parser.
    from .llm_pipeline import parse_llm_json
    content = response.choices[0].message.content
    results = parse_llm_json(content)

    # Record cost + prime the budget tracker so subsequent in-loop calls
    # see this batch's spend reflected before they check_budget().
    try:
        from hynous.core.costs import record_llm_usage
        usage = getattr(response, "usage", None)
        if usage:
            hidden = getattr(response, "_hidden_params", {}) or {}
            record_llm_usage(
                model=model,
                input_tokens=getattr(usage, "prompt_tokens", 0),
                output_tokens=getattr(usage, "completion_tokens", 0),
                cost_usd=hidden.get("response_cost", 0),
            )
    except Exception:
        logger.debug("Failed to record batch rejection LLM usage", exc_info=True)

    # Persist each result as a minimal analysis row.
    # Tolerate two shapes: the prompt-requested ``{"judgments": [...]}``
    # wrapper, or a bare list if the model drops the wrapper (Claude
    # sometimes does this despite the prompt).
    if isinstance(results, list):
        judgments = results
    elif isinstance(results, dict):
        judgments = results.get("judgments", [])
    else:
        logger.warning(
            "Batch rejection analysis: unexpected result shape %s, skipping",
            type(results).__name__,
        )
        return
    for result in judgments:
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

        # phase 6 M3: fire-and-forget edge build after each rejection is persisted.
        # Local try/except keeps a single bad dispatch from killing the rest of
        # the batch; the outer try/except in run_batch_rejection_analysis is the
        # batch-level safety net.
        try:
            from hynous.journal.consolidation import build_edges_async
            build_edges_async(journal_store, tid)
        except Exception:
            logger.exception("Edge building dispatch failed for %s", tid)


def start_batch_rejection_cron(
    *,
    journal_store: JournalStore,
    interval_s: int,
    model: str,
) -> threading.Thread:
    """Start the hourly rejection-analysis background thread.

    Thread is ``daemon=True`` named ``rejection-analysis-cron``. Each
    iteration starts with ``time.sleep(interval_s)`` so startup never races
    journal migration. Per-iteration exceptions are swallowed so a bad LLM
    response or stale row never kills the cron.
    """
    def _loop() -> None:
        while True:
            try:
                time.sleep(interval_s)
                run_batch_rejection_analysis(
                    journal_store=journal_store,
                    model=model,
                )
            except Exception:
                logger.exception("Batch rejection cron iteration failed")

    thread = threading.Thread(
        target=_loop, daemon=True, name="rejection-analysis-cron",
    )
    thread.start()
    return thread
