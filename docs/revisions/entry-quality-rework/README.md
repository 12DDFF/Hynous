# Entry Quality Rework

> **Status:** Phases 0-3 implemented. Phase 4 deferred pending paper trading data.
> **Priority:** Critical
> **Depends on:** Phantom removal (done), ML briefing rewrite (done), trailing stop v3 (done), dynamic protective SL (done)

---

## Problem

The entry pipeline had three structural weaknesses:

1. **The XGBoost direction model was broken.** Feature hash mismatch caused `ModelArtifact.load()` to fail at daemon startup. Zero direction predictions generated. **FIXED in Phase 0+1.**

2. **No closed-loop learning.** The system didn't track which market conditions predicted winning entries. **FIXED in Phase 2+3.**

3. **The LLM is the entry bottleneck.** 5-30s reasoning latency means entry opportunities can pass before execution. **Deferred to Phase 4** — needs paper trading data to inform the right architecture.

## Solution

| Phase | Guide | What | Status |
|-------|-------|------|--------|
| 0 | [phase-0-ml-foundation.md](./phase-0-ml-foundation.md) | Fix 10 ML pipeline bugs (TRANSFORM_MAP, avail flags, std, alignment, threading lock) | **DONE** |
| 1 | [phase-1-retrain-models.md](./phase-1-retrain-models.md) | Retrain all models on VPS with 62K real-data snapshots. 13 models enabled. | **DONE** |
| 2 | [phase-2-composite-entry-score.md](./phase-2-composite-entry-score.md) | Mechanical composite entry score (0-100) replacing per-signal LLM synthesis | **DONE** |
| 3 | [phase-3-feedback-loop.md](./phase-3-feedback-loop.md) | Entry-outcome logging, rolling IC, adaptive weight adjustment | **DONE** |
| 4 | [phase-4-staged-entries.md](./phase-4-staged-entries.md) | LLM lookahead / mechanical entry execution — architecture TBD | **FUTURE** |

## Phase 4 Status

Phase 4 (staged entries / LLM lookahead) is deferred until Phases 1-3 are validated in paper trading. The design requires data on:
- Whether the composite score actually predicts winning entries (Phase 3 IC data)
- Whether LLM latency is the primary cause of entry quality loss (vs. bad direction calls, bad SL placement, etc.)
- Whether the LLM should specify exact entry prices (current concept) or just direction + conviction (Option B — simpler, less stale thesis risk)

The Phase 4 guide contains the original design. It will be revised based on paper trading results.

## Implementation Summary

### Phase 0 — ML Foundation Fixes (10 bugs)
- `normalize.py`: TRANSFORM_MAP 14 → 28 entries
- `features.py`: AVAIL_COLUMNS 11 → 16, 7 avail flag fixes, 5 population→sample std, 4 candle search/stale fixes
- `pipeline.py`: Unconditional avail column inclusion
- `inference.py`: Updated stale comments
- `schema.py`: 5 new avail column migrations
- `daemon.py`: `_latest_predictions_lock` + wrapped all read/write sites

### Phase 1 — Retrain Models (VPS, 62K snapshots)
- 13 condition models enabled (was 6 effective). Only `reversal_30m` disabled.
- Key recoveries: entry_quality (0.054→0.341), funding_4h (0→0.277), momentum_quality (0→0.398)
- Direction model v2 loads cleanly (Spearman ~0.02, inherently hard task)

### Phase 2 — Composite Entry Score
- `satellite/entry_score.py`: 6-signal weighted composite (entry_quality, vol_favorability, funding_safety, volume_quality, mae_safety, direction_edge)
- Daemon computes score after condition predictions, caches under lock
- Trading tool: composite gate (block <25, warn <45) + score-based sizing factor
- Briefing injection: "Entry score: XX/100 (label)"

### Phase 3 — Entry-Outcome Feedback Loop
- `satellite/schema.py`: `entry_snapshots` table (22 columns, condition values + outcome)
- `trading.py`: Logs entry conditions on every successful fill
- `daemon.py`: Backfills outcome (ROE, PnL, win/loss, exit reason) when trade closes
- `satellite/signal_evaluator.py`: Rolling Spearman IC per signal, ECE computation
- `satellite/weight_updater.py`: Auto-adjusts composite score weights from IC (daily, 30-trade minimum)
- Daemon loads persisted weights on startup, passes to `compute_entry_score()`

---

Last updated: 2026-03-22
