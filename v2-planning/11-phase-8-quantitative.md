# Phase 8 — Quantitative Improvements

> **Prerequisites:** Phases 0–7 complete. v2 is running as a fully mechanical entry + post-trade analysis system. Paper trading is active. You've accumulated real journal data for the quantitative calibration work.
>
> **Phase goal:** Ship the backlog of quantitative fixes and calibrations that were identified in the v1 revision docs but never prioritized in v1's LLM-centric world. These are the improvements that matter most now that the mechanical entry gate *is* the trade decision: composite score calibration against real outcomes, tick model fix, Monte Carlo corruption guards, feature list consolidation, and tightened feedback loop weight updates.

---

## Context

Phase 8 is different from the prior phases because it has no single unifying deliverable — it's a set of independent quantitative improvements that were each documented in v1's revision directories but never shipped. Most were deferred because v1's LLM-in-the-loop could paper over model weaknesses. In v2 the composite entry score IS the entry gate; calibration quality is now mission-critical.

The improvements, in priority order:

1. **Tick model train/inference downsample mismatch fix** — the satellite tick model is currently stuck at coin-flip accuracy because training downsamples to 5s while inference reads raw 1s. Training and inference compute fundamentally different features despite having the same names. 10 lines of code + a model retrain. Highest priority: without this fix, the tick model is dead weight.
2. **Monte Carlo feature corruption guard + bias score consistency + feature list consolidation** — three fixes from `docs/revisions/mc-fixes/implementation-guide.md`. Ready to implement.
3. **Composite entry score calibration audit** — verify the reject/warn thresholds (currently 25/45 guessed values) match reality by running them against accumulated paper trading data.
4. **Tighter weight update loop** — drop the entry-outcome feedback loop minimum from 30 trades to 10 trades so weights update faster during paper trading.
5. **Direction model retrain on entry_snapshots data** — the Phase 3 entry_snapshots table is now populated by v2 journal captures. Use it to retrain the direction model more frequently.

This phase does NOT include:
- WebSocket account data migration (ws-migration Phase 2) — deferred per earlier discussion
- Kill switch tightening — paper mode doesn't use kill switches
- New feature engineering
- Any structural ML changes (e.g., switching model type)

---

## Required Reading

1. **`docs/revisions/tick-system-audit/README.md`** — full read. This documents the downsample bug in detail.
2. **`docs/revisions/tick-system-audit/future-entry-timing.md`** — context for why the fix matters
3. **`docs/revisions/mc-fixes/implementation-guide.md`** — full read. Three specific fixes with exact code locations.
4. **`docs/revisions/entry-quality-rework/README.md`** — understand the entry-outcome feedback loop architecture (Phase 3 in the v1 revision doc, not to be confused with v2 phase 3)
5. **`satellite/tick_inference.py`** — the file with the downsample bug
6. **`satellite/tick_features.py`** — the feature computation logic
7. **`satellite/training/train_tick_direction.py`** — the training pipeline that downsamples
8. **`satellite/entry_score.py`** — composite score logic, threshold definitions
9. **`satellite/signal_evaluator.py`** + **`satellite/weight_updater.py`** — rolling IC + weight update
10. **`scripts/monte_carlo_server.py`** + **`scripts/monte_carlo.html`** — the MC system that needs fixes
11. Your accumulated journal data from paper trading — useful for the calibration task

---

## Scope

### In Scope

**Task 1: Tick model downsample fix**
- Fix `tick_inference.py` to downsample raw 1s data to 5s before computing rolling features
- Retrain the tick direction model with the fixed inference pipeline
- Update the feature consolidation to prevent this drift from recurring
- Add regression tests

**Task 2: Monte Carlo fixes**
- Implement the 3 fixes from `mc-fixes/implementation-guide.md`:
  - Feature corruption guard
  - Bias score consistency
  - Feature list deduplication

**Task 3: Composite score calibration audit**
- New script `scripts/calibrate_composite_score.py` that:
  - Queries v2 journal for trades with analysis
  - Computes actual win rate / avg PnL stratified by composite score buckets
  - Identifies the true decision boundary
  - Suggests new reject_threshold and warn_threshold values
  - Does NOT auto-apply — human reviews and decides

**Task 4: Weight update loop tightening**
- Drop the minimum trade count for rolling IC weight updates from 30 to 10
- Update the cron to check for updates more frequently (daily instead of weekly, since the window is smaller)

**Task 5: Direction model retrain from v2 entry_snapshots**
- Connect the v2 journal as a training data source
- Retrain direction models periodically (monthly cron or manual trigger)
- Store model artifacts with timestamps so rollback is possible

### Out of Scope

- Retraining the condition models (they're passing current quality bars)
- New features in the satellite pipeline
- Neural network architecture changes
- Multi-asset model training (BTC only for phase 1)

---

## Task 1: Tick Model Downsample Fix

### The bug

Per `tick-system-audit/README.md`:

- Training downsamples tick data to 5s before computing rolling features with window sizes `w5=1, w10=2, w30=6, w60=12 ticks`
- Inference reads raw 1s data without downsampling, with window sizes `w5=5, w10=10, w30=30, w60=60 ticks`
- Result: slope features are ~5x too small at inference, mean features are fundamentally different features (w5=1 at training is an identity copy; w5=5 at inference is a 5-point smooth), std features vary unpredictably

### The fix

In `satellite/tick_inference.py`, add a downsample step at the top of `_get_latest_tick_features()` (or wherever raw ticks are loaded).

```python
# satellite/tick_inference.py

def _get_latest_tick_features(db_path: str, coin: str) -> dict:
    """Get latest tick features for inference, downsampled to match training."""
    # Fetch raw 1s ticks from tick_snapshots table
    raw_ticks = _fetch_raw_ticks(db_path, coin, limit=600)  # last 10 min of 1s data
    
    # **NEW**: downsample to 5s before computing rolling features
    ticks_5s = _downsample_ticks(raw_ticks, interval_s=5)
    
    # Now compute rolling features with the same window sizes as training
    features = _compute_rolling_features_from_downsampled(ticks_5s)
    return features


def _downsample_ticks(ticks: list[dict], interval_s: int = 5) -> list[dict]:
    """Downsample 1s ticks to 5s buckets.
    
    For each 5s window, produce a single tick by:
    - Using the close of the last tick in the window
    - Summing volumes
    - Averaging or using most-recent other fields
    
    This must match the downsample behavior in train_tick_direction.py EXACTLY.
    """
    if not ticks:
        return []
    
    # Group by 5s bucket
    bucketed: dict[int, list[dict]] = {}
    for t in ticks:
        ts = int(t["ts"])
        bucket = (ts // interval_s) * interval_s
        bucketed.setdefault(bucket, []).append(t)
    
    # Produce one aggregated tick per bucket
    out = []
    for bucket_ts in sorted(bucketed.keys()):
        bucket = bucketed[bucket_ts]
        last = bucket[-1]
        aggregated = dict(last)  # start from last tick
        aggregated["ts"] = bucket_ts
        # Sum volume fields (adjust to your tick schema)
        for vol_key in ["volume", "buy_volume", "sell_volume"]:
            if vol_key in last:
                aggregated[vol_key] = sum(t.get(vol_key, 0) for t in bucket)
        out.append(aggregated)
    
    return out
```

**Critical:** The downsample behavior here MUST match the downsample behavior in `train_tick_direction.py` exactly. If there's any divergence (different aggregation method for any field), the fix reintroduces the same bug in a different way.

After the code fix, retrain the model:

```bash
# From the satellite directory
PYTHONPATH=. python -m satellite.training.train_tick_direction \
    --db storage/satellite.db \
    --coin BTC \
    --output artifacts/tick_models/v2/
```

Update `satellite/tick_inference.py` to load the v2 model artifact. Verify the feature hash in the model matches the inference code's feature hash.

### Validation

Create `tests/unit/test_tick_downsample_fix.py`:

1. `test_downsample_ticks_preserves_last_close` — given 5 ticks with closes [100, 101, 102, 103, 104], downsampled to 5s bucket should have close=104
2. `test_downsample_ticks_sums_volume` — given 5 ticks with volumes [1, 2, 3, 4, 5], downsampled should have volume=15
3. `test_downsample_ticks_handles_empty_bucket` — no ticks → empty output
4. `test_downsample_match_training_pipeline` — load a known snapshot from tick_snapshots, run the inference downsample, compare to training's downsample (import the training function) — must be bit-identical for all fields
5. `test_rolling_features_after_downsample_match_window_sizes` — verify that rolling features with w5=1, w10=2 produce sensible values after downsampling

After the model is retrained, run a validation report:

```bash
python -m satellite.training.validate_tick_direction \
    --model artifacts/tick_models/v2/model.pkl \
    --holdout_days 14
```

Expected: accuracy should jump from ~55% to the 60-65% range at 20-45s horizons per the audit doc.

---

## Task 2: Monte Carlo Fixes

Follow `docs/revisions/mc-fixes/implementation-guide.md` exactly. The three fixes in order:

### Fix 3: Feature list consolidation (do first — enables other fixes)

Create a single canonical module:

```python
# satellite/tick_features.py (add to existing file)

# Canonical feature list — the single source of truth
BASE_TICK_FEATURES = [
    "price", "volume", "buy_volume", "sell_volume",
    # ... (list from the guide)
]

ROLLING_FEATURES_DEF = [
    ("mean", [1, 2, 6, 12]),   # window sizes for mean
    ("std", [1, 2, 6, 12]),    # same for std
    ("slope", [1, 2, 6, 12]),  # same for slope
    # ... other rolling feature types
]

def get_feature_names() -> list[str]:
    """Return the canonical ordered list of feature names."""
    names = list(BASE_TICK_FEATURES)
    for feat_type, windows in ROLLING_FEATURES_DEF:
        for w in windows:
            names.append(f"{feat_type}_w{w}")
    return names
```

Update these three files to import from the canonical source:
- `satellite/training/train_tick_direction.py`
- `satellite/tick_inference.py`
- `scripts/monte_carlo_server.py`

Delete the duplicate feature list definitions in each.

### Fix 1: Feature corruption guard

In `scripts/monte_carlo_server.py`, in the prediction entry point, add:

```python
def predict_with_guard(features: dict) -> dict | None:
    """Predict with corruption guard.
    
    If too many feature values are zero, the snapshot is likely corrupt
    (e.g., data-layer was down). Skip prediction rather than feed garbage
    to the model.
    """
    zero_count = sum(1 for v in features.values() if v == 0 or v is None)
    if zero_count >= 10:
        logger.warning(
            "MC corruption guard: %d/%d features are zero — skipping prediction",
            zero_count, len(features),
        )
        return None
    
    return _predict_unguarded(features)
```

### Fix 2: Bias score consistency

In `scripts/monte_carlo.html`, find the two places where bias score is computed (one over all signals, one over strong-only). Unify to strong-only.

Per the guide, replace the all-signals formula with the strong-only formula so both computations match.

### Validation

```bash
PYTHONPATH=. pytest satellite/tests/test_mc_fixes.py  # engineer creates these
```

Tests:
1. `test_corruption_guard_skips_when_too_many_zeros`
2. `test_corruption_guard_allows_mostly_populated_features`
3. `test_feature_list_is_identical_across_modules`
4. `test_bias_score_strong_only_matches_html`

---

## Task 3: Composite Score Calibration Audit

Create `scripts/calibrate_composite_score.py`:

```python
"""Audit composite entry score thresholds against real v2 journal data.

Usage:
    python scripts/calibrate_composite_score.py [--window-days 30]

Output:
    Prints a histogram of composite scores vs outcomes (win rate, avg PnL)
    Suggests new reject_threshold and warn_threshold based on decision boundary
"""

import argparse
import json
import statistics
import sqlite3
from collections import defaultdict


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--window-days", type=int, default=30)
    parser.add_argument("--db", default="storage/v2/journal.db")
    args = parser.parse_args()
    
    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    
    # Fetch all closed trades with entry snapshot + outcome
    rows = conn.execute(
        """
        SELECT 
            t.trade_id,
            json_extract(tes.snapshot_json, '$.ml_snapshot.composite_entry_score') AS score,
            t.realized_pnl_usd,
            t.roe_pct
        FROM trades t
        JOIN trade_entry_snapshots tes ON t.trade_id = tes.trade_id
        WHERE t.status IN ('closed', 'analyzed')
          AND t.entry_ts >= datetime('now', ?)
        """,
        (f"-{args.window_days} days",),
    ).fetchall()
    
    if not rows:
        print("No trades in window")
        return
    
    # Bucket by composite score (10-point buckets)
    buckets: dict[int, list] = defaultdict(list)
    for r in rows:
        score = r["score"]
        if score is None:
            continue
        bucket = int(score / 10) * 10
        buckets[bucket].append({
            "pnl": r["realized_pnl_usd"] or 0,
            "roe": r["roe_pct"] or 0,
        })
    
    print(f"Composite score calibration — {len(rows)} trades over {args.window_days} days")
    print()
    print(f"{'Bucket':<12} {'Count':<8} {'Win%':<10} {'Avg ROE%':<12} {'Sum PnL':<12}")
    print("-" * 60)
    
    for bucket in sorted(buckets.keys()):
        trades = buckets[bucket]
        count = len(trades)
        wins = sum(1 for t in trades if t["pnl"] > 0)
        win_rate = wins / count * 100
        avg_roe = statistics.mean(t["roe"] for t in trades)
        sum_pnl = sum(t["pnl"] for t in trades)
        print(f"{bucket}-{bucket+9:<8} {count:<8} {win_rate:<10.1f} {avg_roe:<12.2f} ${sum_pnl:<12.2f}")
    
    # Find decision boundary: lowest bucket where win_rate >= 50%
    suggested_reject = 0
    suggested_warn = 0
    for bucket in sorted(buckets.keys()):
        trades = buckets[bucket]
        wins = sum(1 for t in trades if t["pnl"] > 0)
        win_rate = wins / len(trades) * 100 if trades else 0
        if win_rate >= 50 and not suggested_reject:
            suggested_reject = bucket
        if win_rate >= 60 and not suggested_warn:
            suggested_warn = bucket
    
    print()
    print(f"Current thresholds: reject={25}, warn={45}")
    print(f"Suggested reject threshold: {suggested_reject} (lowest 50% win rate bucket)")
    print(f"Suggested warn threshold: {suggested_warn} (lowest 60% win rate bucket)")
    print()
    print("Review and manually update config/default.yaml v2.mechanical_entry.composite_entry_threshold")


if __name__ == "__main__":
    main()
```

This is a read-only audit tool. It does not modify config. The engineer runs it, reviews the output, and decides whether to update the threshold in `config/default.yaml`.

---

## Task 4: Weight Update Loop Tightening

In `satellite/weight_updater.py` (or wherever the rolling IC update lives), find the minimum trade count constant and change it:

```python
# Before:
MIN_TRADES_FOR_UPDATE = 30

# After:
MIN_TRADES_FOR_UPDATE = 10
```

In `satellite/signal_evaluator.py` (or the cron that schedules updates), change the interval from weekly to daily:

```python
# Before:
UPDATE_INTERVAL_HOURS = 168  # weekly

# After:
UPDATE_INTERVAL_HOURS = 24   # daily
```

**Verify** that the tighter update doesn't cause thrashing: add a test that simulates 100 trades with varying outcomes and verifies weights converge smoothly (no oscillation).

---

## Task 5: Direction Model Retrain from v2 Entry Snapshots

The direction model currently trains on satellite's internal labeled snapshots. Phase 3 of the v1 entry-quality-rework added the `entry_snapshots` table in satellite.db for feedback loops, but v2 captures everything in the journal instead.

Create a bridge script to periodically retrain the direction model using v2 journal data:

```python
# scripts/retrain_direction_model.py

"""Retrain the satellite direction model from v2 journal data.

Pulls closed trades from journal.db, extracts features from the entry snapshot
+ outcome (ROE), and retrains the XGBoost long/short regressors.

Usage:
    python scripts/retrain_direction_model.py [--output artifacts/direction/v2/]
"""

# Implementation sketch:
# 1. Connect to storage/v2/journal.db
# 2. Load all closed trades (last 90 days)
# 3. For each: extract 28 structural features from entry_snapshot.ml_snapshot
#    and the realized roe_pct as the label
# 4. Split train/val by time
# 5. Fit XGBoost regressors (long side, short side)
# 6. Save artifacts to the output directory
# 7. Print validation MAE
```

Run manually for now. A cron can be added later if this pattern stabilizes.

---

## Testing

### Static tests

- All existing satellite tests must pass
- mypy + ruff baselines preserved

### Unit tests

- `test_tick_downsample_fix.py` (5 tests listed in Task 1)
- `test_mc_fixes.py` (4 tests listed in Task 2)
- `test_weight_updater_tight_window.py` — smoothness over 100 trades

### Integration tests

- `test_direction_model_retrain_from_journal.py` — mock journal data, run retrain, assert artifacts produced
- `test_calibrate_composite_score_script.py` — seed journal with known outcomes, run the audit script, verify suggested thresholds

### Smoke test

After tick model retrain, run the full satellite inference on live paper data for 30 min. Verify:
- Inference accuracy at 20-45s horizons is measurably above 55% (track via daemon log)
- No crashes or feature hash mismatches
- The new composite score thresholds (if updated based on audit) don't suddenly reject or accept everything

---

## Acceptance Criteria

**Task 1 (Tick model fix):**
- [ ] `_downsample_ticks` function implemented in `tick_inference.py`
- [ ] Function matches training downsample behavior exactly (verified by test)
- [ ] Tick model retrained, artifacts in `artifacts/tick_models/v2/`
- [ ] Validation report shows accuracy > 55% at 20-45s horizons
- [ ] 5 unit tests pass

**Task 2 (MC fixes):**
- [ ] Feature list consolidation complete, imports updated in 3 files
- [ ] Corruption guard implemented in monte_carlo_server.py
- [ ] Bias score unified to strong-only in monte_carlo.html
- [ ] 4 unit tests pass

**Task 3 (Composite calibration):**
- [ ] `scripts/calibrate_composite_score.py` script created
- [ ] Script runs against journal.db without errors
- [ ] Output format matches the expected histogram
- [ ] Integration test verifies with seeded data

**Task 4 (Weight update tightening):**
- [ ] `MIN_TRADES_FOR_UPDATE` changed to 10
- [ ] Update interval changed to daily
- [ ] Smoothness test passes

**Task 5 (Direction model retrain):**
- [ ] `scripts/retrain_direction_model.py` script created
- [ ] Pulls data from v2 journal
- [ ] Produces artifacts in a timestamped directory
- [ ] Integration test passes

**Overall:**
- [ ] All tests pass
- [ ] mypy + ruff baselines preserved
- [ ] Smoke test shows tick model accuracy improvement
- [ ] Calibration audit run at least once with real paper data
- [ ] Phase 8 commits tagged `[phase-8]`

---

## Report-Back

Include:
- Tick model accuracy before vs after the fix (both on training validation AND on live paper data smoke test)
- MC fix test results
- Composite score calibration audit output (paste the histogram)
- Suggested new composite thresholds (if different from 25/45)
- Whether you applied the new thresholds or deferred the decision
- Weight update window smoothness metrics
- Direction model retrain output (validation MAE)

---

## Final Note

Phase 8 completes the v2 refactor. After this phase:

1. v2 is a fully mechanical trading system (phase 5)
2. Every trade produces an evidence-backed LLM analysis (phase 3)
3. Every mechanical event is captured in the journal (phase 1)
4. The decision-injection layer is gone (phase 4)
5. The dashboard shows everything transparently (phase 7)
6. Consolidation and patterns surface system health over time (phase 6)
7. Quantitative quality is tuned against real data (phase 8)

At this point, run the v2 system success criteria check from `00-master-plan.md`:

1. Full 24h paper trading session without exceptions
2. Every closed trade has a complete `trade_analysis` record
3. Every rejected signal has a batch analysis
4. Every narrative citation resolves to real evidence
5. Dashboard Journal page renders every trade detail without errors
6. Weekly pattern rollup fires automatically
7. Mechanical exits fire correctly at expected levels
8. Daemon runs without the nous process
9. No v1 decision-injection code remains

If all 9 criteria pass, v2 is ready for extended paper trading validation. Report back to the user with a summary.
