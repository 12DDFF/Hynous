# Evaluation Metric Alignment — Implementation Guide

> **Status:** Ready for implementation
> **Date:** 2026-04-01
> **Scope:** 2 files, ~25 lines changed. Aligns training validation metric with live MC evaluation so accuracy numbers are directly comparable.
> **Branch:** `monte-carlo-live-heatmap`

---

## Problem Statement

Training reports `dir_accuracy` only on actual moves > 3 bps (`sig_mask`). The live MC visualization evaluates on all predictions where `|predicted| > 0.1 bps`. These measure different populations — especially at short horizons:

| Horizon | % of moves > 3 bps | Training evaluates | Live evaluates |
|---------|--------------------|--------------------|----------------|
| 10s | 10.7% | Only this 10.7% | All moves |
| 30s | 32.0% | Only this 32.0% | All moves |
| 60s | 47.2% | Only this 47.2% | All moves |
| 180s | 67.7% | Only this 67.7% | All moves |

Additionally, the live evaluation penalizes the model for zero-return moves (price didn't change). At 10s horizon, 25.9% of returns are exactly zero — every one is counted as wrong because:

```javascript
const correct = (predictedBps > 0 && actualBps > 0) || (predictedBps < 0 && actualBps < 0);
// actualBps = 0 → both conditions are false → wrong
```

The model structurally cannot predict direction when price doesn't move. These auto-wrong penalties drag 10s live accuracy down by ~13 percentage points.

**Result:** Training reports 66.6% for 10s; live shows 52.7%. The model is actually ~71% accurate on 10s moves that happen, but the evaluation methodology obscures this.

### Solution

1. **Training**: Add `prod_dir_accuracy` metric that evaluates on all non-zero moves where the model has an opinion — matching what the live eval should measure.
2. **Live eval**: Exclude zero actual returns from accuracy counting — the model can't be right or wrong when price doesn't move.

---

## Required Reading (Before Starting)

Read these files before writing any code:

| # | File | Lines | What to Understand |
|---|------|-------|--------------------|
| 1 | `satellite/training/train_tick_direction.py` | 369–405 | Current metrics block: `sig_mask > 3.0`, `dir_acc`, `avg_pnl_bps`, results dict, log format |
| 2 | `satellite/training/train_tick_direction.py` | 411–420 | Summary averages: `avg_dir`, `avg_pnl`, log format |
| 3 | `satellite/training/train_tick_direction.py` | 461–478 | Metadata dict saved to artifact (includes `validation_dir_accuracy`) |
| 4 | `satellite/training/train_tick_direction.py` | 486–497 | Return dict (includes `avg_dir_accuracy`) |
| 5 | `satellite/training/train_tick_direction.py` | 553–567 | `main()` summary log line format and JSON save |
| 6 | `scripts/monte_carlo.html` | 637–677 | `evaluateAccuracy()` — the full function, especially lines 653–659 (correct/wrong counting) |
| 7 | `scripts/monte_carlo.html` | 728–763 | `evaluateBiasAccuracy()` — same pattern, for understanding consistency |
| 8 | `scripts/monte_carlo.html` | 299–306 | `accuracyStats` initialization — `{correct, wrong, total_pnl}` per horizon |
| 9 | `satellite/tests/test_tick_inference.py` | Full file | Test patterns, helper functions (`_make_rows`, `_downsample`), class organization |

---

## Implementation Order

1. **Change 1** — Live evaluation zero-return fix (`monte_carlo.html`)
2. **Change 2** — Training production metric (`train_tick_direction.py`)
3. **Static verification** — Run existing tests, verify imports
4. **Dynamic verification** — Retrain on VPS, compare metrics, run MC server

---

## Change 1: Exclude Zero Returns from Live Evaluation

### File: `scripts/monte_carlo.html`

### 1a. Fix `evaluateAccuracy()` — add zero-return guard

In the `evaluateAccuracy` function, lines 653–659 currently count correct/wrong for ALL non-trivial predictions. Add a guard that skips zero actual returns.

**BEFORE (lines 653–659):**

```javascript
          if (predictedBps !== undefined && Math.abs(predictedBps) > 0.1) {
            const actualBps = (evalPrice - pred.price) / pred.price * 10000;
            const correct = (predictedBps > 0 && actualBps > 0) || (predictedBps < 0 && actualBps < 0);
            const pnl = predictedBps > 0 ? actualBps : -actualBps;
            accuracyStats[h].correct += correct ? 1 : 0;
            accuracyStats[h].wrong += correct ? 0 : 1;
            accuracyStats[h].total_pnl += pnl;
          }
```

**AFTER:**

```javascript
          if (predictedBps !== undefined && Math.abs(predictedBps) > 0.1) {
            const actualBps = (evalPrice - pred.price) / pred.price * 10000;
            if (Math.abs(actualBps) >= 0.01) {
              const correct = (predictedBps > 0 && actualBps > 0) || (predictedBps < 0 && actualBps < 0);
              const pnl = predictedBps > 0 ? actualBps : -actualBps;
              accuracyStats[h].correct += correct ? 1 : 0;
              accuracyStats[h].wrong += correct ? 0 : 1;
              accuracyStats[h].total_pnl += pnl;
            }
          }
```

**Why 0.01 bps:** At BTC $84K, 0.01 bps = $0.084 — below the minimum price increment. This catches exact-zero returns without filtering real micro-moves. The threshold is deliberately tiny: it only excludes cases where the price literally did not change.

**Control flow preserved:** The `pred[key] = true` at line 661 (outside this block) still executes. Zero-return predictions are marked as evaluated and won't be rechecked. They simply don't increment correct or wrong. The `n` displayed in the UI (`s.correct + s.wrong`) reflects only evaluable predictions.

**P&L unaffected by design:** Zero actual returns contribute `±0 bps` P&L. Excluding them from counting doesn't change the total P&L calculation — it only removes zero-value entries from the denominator of the average.

### 1b. Fix `evaluateBiasAccuracy()` — same zero-return guard

Apply the identical pattern to `evaluateBiasAccuracy` (lines 741–747) for consistency. This function evaluates bias directional signals over 60s/180s/300s windows where zero returns are rare (0.6–2.3%), but the fix should be consistent.

**BEFORE (lines 741–747):**

```javascript
          const actualBps = (evalPrice - sig.price) / sig.price * 10000;
          const correct = (sig.direction === 'long' && actualBps > 0) ||
                          (sig.direction === 'short' && actualBps < 0);
          const pnl = sig.direction === 'long' ? actualBps : -actualBps;
          biasAccuracyStats[w].correct += correct ? 1 : 0;
          biasAccuracyStats[w].wrong += correct ? 0 : 1;
          biasAccuracyStats[w].total_pnl += pnl;
          sig[key] = true;
```

**AFTER:**

```javascript
          const actualBps = (evalPrice - sig.price) / sig.price * 10000;
          if (Math.abs(actualBps) >= 0.01) {
            const correct = (sig.direction === 'long' && actualBps > 0) ||
                            (sig.direction === 'short' && actualBps < 0);
            const pnl = sig.direction === 'long' ? actualBps : -actualBps;
            biasAccuracyStats[w].correct += correct ? 1 : 0;
            biasAccuracyStats[w].wrong += correct ? 0 : 1;
            biasAccuracyStats[w].total_pnl += pnl;
          }
          sig[key] = true;
```

**Note:** `sig[key] = true` stays OUTSIDE the new guard — the signal must still be marked as evaluated regardless of whether the actual return was zero.

### What NOT to Change

- `findPriceAtTime()` (line 623) — price lookup logic is correct
- `pendingPredictions.push()` (line 405) — prediction storage is correct
- `updateAccuracyPanel()` (line 679) — display logic reads from `accuracyStats`, no changes needed
- `updateBiasAccuracyPanel()` (line 765) — same, reads from `biasAccuracyStats`
- `accuracyStats` initialization (line 305) — schema `{correct, wrong, total_pnl}` is unchanged

---

## Change 2: Add Production-Realistic Metric to Training

### File: `satellite/training/train_tick_direction.py`

### 2a. Add `prod_dir_accuracy` per generation

After the existing `sig_mask` block and before `avg_pnl_bps`, add the new metric.

**BEFORE (lines 375–384):**

```python
        # Directional accuracy on significant moves (>3 bps)
        sig_mask = np.abs(y_test) > 3.0
        if sig_mask.sum() > 100:
            dir_acc = float(np.mean(np.sign(y_test[sig_mask]) == np.sign(y_pred[sig_mask]))) * 100
        else:
            dir_acc = 50.0

        # Profit simulation: if we trade in predicted direction, what's the avg P&L?
        # Positive = model makes money, negative = loses money
        avg_pnl_bps = float(np.mean(np.sign(y_pred) * y_test))
```

**AFTER:**

```python
        # Directional accuracy on significant moves (>3 bps)
        sig_mask = np.abs(y_test) > 3.0
        if sig_mask.sum() > 100:
            dir_acc = float(np.mean(np.sign(y_test[sig_mask]) == np.sign(y_pred[sig_mask]))) * 100
        else:
            dir_acc = 50.0

        # Production-realistic accuracy — matches live MC evaluation:
        # All non-zero moves where model has a direction opinion (|pred| > 0.1 bps).
        # Excludes zero actual returns (structurally unevaluable).
        prod_mask = (np.abs(y_pred) > 0.1) & (np.abs(y_test) > 0.01)
        prod_dir_acc = float(np.mean(
            np.sign(y_test[prod_mask]) == np.sign(y_pred[prod_mask])
        )) * 100 if prod_mask.sum() > 100 else 50.0

        # Profit simulation: if we trade in predicted direction, what's the avg P&L?
        # Positive = model makes money, negative = loses money
        avg_pnl_bps = float(np.mean(np.sign(y_pred) * y_test))
```

**Why `np.abs(y_pred) > 0.1`:** The live MC HTML only evaluates when `Math.abs(predictedBps) > 0.1`. This mirrors that filter. In practice, XGBoost regression predictions almost never land exactly at 0, so this excludes very few samples.

**Why `np.abs(y_test) > 0.01`:** Mirrors the `Math.abs(actualBps) >= 0.01` guard from Change 1. Excludes zero actual returns where direction is undefined.

**Why inline ternary:** The `> 100` minimum sample guard is consistent with the existing `sig_mask.sum() > 100` pattern. If fewer than 100 evaluable samples exist, default to 50.0 (same convention).

### 2b. Add to per-generation results dict

**BEFORE (lines 386–399):**

```python
        results.append({
            "generation": gen,
            "spearman": round(sp, 4),
            "spearman_pval": round(float(sp_pval), 6),
            "mae_bps": round(mae, 2),
            "dir_accuracy": round(dir_acc, 1),
            "avg_pnl_bps": round(avg_pnl_bps, 3),
            "sig_moves": int(sig_mask.sum()),
            "rounds": model.best_iteration + 1 if hasattr(model, "best_iteration") else NUM_BOOST_ROUNDS,
            "train_size": len(X_train),
            "test_size": len(X_test),
            "train_range": f"{t_valid[0]:.0f}-{t_valid[val_start - 1]:.0f}",
            "test_range": f"{t_valid[test_start]:.0f}-{t_valid[test_end - 1]:.0f}",
        })
```

**AFTER:**

```python
        results.append({
            "generation": gen,
            "spearman": round(sp, 4),
            "spearman_pval": round(float(sp_pval), 6),
            "mae_bps": round(mae, 2),
            "dir_accuracy": round(dir_acc, 1),
            "prod_dir_accuracy": round(prod_dir_acc, 1),
            "avg_pnl_bps": round(avg_pnl_bps, 3),
            "sig_moves": int(sig_mask.sum()),
            "prod_moves": int(prod_mask.sum()),
            "rounds": model.best_iteration + 1 if hasattr(model, "best_iteration") else NUM_BOOST_ROUNDS,
            "train_size": len(X_train),
            "test_size": len(X_test),
            "train_range": f"{t_valid[0]:.0f}-{t_valid[val_start - 1]:.0f}",
            "test_range": f"{t_valid[test_start]:.0f}-{t_valid[test_end - 1]:.0f}",
        })
```

Two new keys: `prod_dir_accuracy` and `prod_moves`.

### 2c. Add to per-generation log line

**BEFORE (lines 401–405):**

```python
        log.info(
            "  Gen %d: sp=%.4f  dir=%.1f%%  pnl=%.3f bps  mae=%.1f bps  rounds=%d  (train=%d test=%d sig=%d)",
            gen, sp, dir_acc, avg_pnl_bps, mae,
            results[-1]["rounds"], len(X_train), len(X_test), int(sig_mask.sum()),
        )
```

**AFTER:**

```python
        log.info(
            "  Gen %d: sp=%.4f  dir=%.1f%%  prod=%.1f%%  pnl=%.3f bps  mae=%.1f bps  rounds=%d  (train=%d test=%d sig=%d prod=%d)",
            gen, sp, dir_acc, prod_dir_acc, avg_pnl_bps, mae,
            results[-1]["rounds"], len(X_train), len(X_test), int(sig_mask.sum()), int(prod_mask.sum()),
        )
```

Added `prod=%.1f%%` after `dir=` and `prod=%d` at end of parenthetical.

### 2d. Add to summary averages

**BEFORE (lines 411–420):**

```python
    # Summary
    avg_sp = float(np.mean([r["spearman"] for r in results]))
    avg_dir = float(np.mean([r["dir_accuracy"] for r in results]))
    avg_pnl = float(np.mean([r["avg_pnl_bps"] for r in results]))
    std_sp = float(np.std([r["spearman"] for r in results]))

    log.info(
        "%s RESULT: sp=%.4f±%.4f  dir=%.1f%%  pnl=%.3f bps  (%d gens)",
        target.name, avg_sp, std_sp, avg_dir, avg_pnl, len(results),
    )
```

**AFTER:**

```python
    # Summary
    avg_sp = float(np.mean([r["spearman"] for r in results]))
    avg_dir = float(np.mean([r["dir_accuracy"] for r in results]))
    avg_prod_dir = float(np.mean([r["prod_dir_accuracy"] for r in results]))
    avg_pnl = float(np.mean([r["avg_pnl_bps"] for r in results]))
    std_sp = float(np.std([r["spearman"] for r in results]))

    log.info(
        "%s RESULT: sp=%.4f±%.4f  dir=%.1f%%  prod=%.1f%%  pnl=%.3f bps  (%d gens)",
        target.name, avg_sp, std_sp, avg_dir, avg_prod_dir, avg_pnl, len(results),
    )
```

Added `avg_prod_dir` computation and `prod=%.1f%%` to log format.

### 2e. Add to artifact metadata

**BEFORE (lines 471–474):**

```python
            "validation_spearman": round(avg_sp, 4),
            "validation_spearman_std": round(std_sp, 4),
            "validation_dir_accuracy": round(avg_dir, 1),
            "validation_avg_pnl_bps": round(avg_pnl, 3),
```

**AFTER:**

```python
            "validation_spearman": round(avg_sp, 4),
            "validation_spearman_std": round(std_sp, 4),
            "validation_dir_accuracy": round(avg_dir, 1),
            "validation_prod_dir_accuracy": round(avg_prod_dir, 1),
            "validation_avg_pnl_bps": round(avg_pnl, 3),
```

One new key: `validation_prod_dir_accuracy`.

### 2f. Add to function return dict

**BEFORE (lines 486–497):**

```python
    return {
        "name": target.name,
        "status": verdict,
        "avg_spearman": avg_sp,
        "spearman_std": std_sp,
        "avg_dir_accuracy": avg_dir,
        "avg_pnl_bps": avg_pnl,
        "generations": len(results),
        "training_samples": len(X_valid),
        "artifact_path": artifact_path,
        "results": results,
    }
```

**AFTER:**

```python
    return {
        "name": target.name,
        "status": verdict,
        "avg_spearman": avg_sp,
        "spearman_std": std_sp,
        "avg_dir_accuracy": avg_dir,
        "avg_prod_dir_accuracy": avg_prod_dir,
        "avg_pnl_bps": avg_pnl,
        "generations": len(results),
        "training_samples": len(X_valid),
        "artifact_path": artifact_path,
        "results": results,
    }
```

One new key: `avg_prod_dir_accuracy`.

### 2g. Add to main() summary log

**BEFORE (lines 556–561):**

```python
    for r in all_results:
        sp = r.get("avg_spearman", 0)
        da = r.get("avg_dir_accuracy", 0)
        pnl = r.get("avg_pnl_bps", 0)
        log.info("  %-20s sp=%.4f  dir=%.1f%%  pnl=%.3f bps  [%s]",
                 r["name"], sp, da, pnl, r["status"])
```

**AFTER:**

```python
    for r in all_results:
        sp = r.get("avg_spearman", 0)
        da = r.get("avg_dir_accuracy", 0)
        pda = r.get("avg_prod_dir_accuracy", 0)
        pnl = r.get("avg_pnl_bps", 0)
        log.info("  %-20s sp=%.4f  dir=%.1f%%  prod=%.1f%%  pnl=%.3f bps  [%s]",
                 r["name"], sp, da, pda, pnl, r["status"])
```

### What NOT to Change

- **XGBoost training**: Model training, hyperparams, walk-forward logic — untouched. Models produce identical artifacts.
- **Existing `dir_accuracy`**: Keep it. It's useful for big-move analysis. The new metric supplements, not replaces.
- **`avg_pnl_bps`**: Already computed on all moves (`np.sign(y_pred) * y_test`). Zero returns contribute 0 P&L — already correct.
- **Pass/fail verdict**: Still uses `avg_sp` (Spearman), not dir_accuracy. Unaffected.
- **Feature computation, inference, MC simulation**: No changes anywhere outside the two files above.
- **`tick_inference.py`**: No changes — the daemon inference engine is unaffected.
- **`monte_carlo_server.py`**: No changes — the server sends the same data.

---

## Verification

### Static Tests

```bash
# 1. Run existing tick inference tests (must still pass)
PYTHONPATH=. .venv/bin/python -m pytest satellite/tests/test_tick_inference.py -v

# 2. Verify training script still imports cleanly with new code
PYTHONPATH=. .venv/bin/python -c "
from satellite.training.train_tick_direction import train_tick_direction, main
print('Training script imports OK')
"

# 3. Verify HTML is valid (no unclosed braces from edit)
python3 -c "
with open('scripts/monte_carlo.html') as f:
    code = f.read()
# Count braces in the JS section
js = code.split('<script>')[1].split('</script>')[0]
opens = js.count('{')
closes = js.count('}')
assert opens == closes, f'Brace mismatch: {opens} open vs {closes} close'
print(f'JS brace check OK: {opens} open, {closes} close')
"
```

**PAUSE if:** Any test fails, import error, or brace mismatch.

### Dynamic Tests — Training

Push to VPS and retrain to see the new metric:

```bash
# 1. Push changes
git add satellite/training/train_tick_direction.py scripts/monte_carlo.html
git commit -m "Align eval metrics: production-realistic dir_accuracy + zero-return fix"
git checkout main && git merge monte-carlo-live-heatmap --no-edit
git push origin main

# 2. Pull on VPS
ssh vps "cd /opt/hynous && sudo -u hynous git pull origin main"

# 3. Retrain with new metric (models identical, metric reporting changes)
ssh vps "cd /opt/hynous && PYTHONPATH=. nohup python3 -m satellite.training.train_tick_direction \
  --db storage/satellite.db \
  --horizons 10,15,20,30,45,60,120,180 \
  --output satellite/artifacts/tick_models \
  > /tmp/tick_training.log 2>&1 &"

# 4. Wait for completion (~30s), then check output
ssh vps "tail -20 /tmp/tick_training.log"
```

**Expected output format** (new `prod=` field):

```
direction_10s RESULT: sp=0.3263±0.0351  dir=66.6%  prod=XX.X%  pnl=0.485 bps  (3 gens)
```

**Key validation:** `prod_dir_accuracy` should be:
- **Lower than `dir_accuracy`** for all horizons (evaluating on more moves is harder)
- **Higher than 50%** for models with positive Spearman (they have signal)
- **Closer to live accuracy** than `dir_accuracy` is

**PAUSE if:** `prod_dir_accuracy` is higher than `dir_accuracy` for any horizon (would indicate a bug in the mask logic), or if any value is exactly 50.0 (would indicate the `> 100` guard triggered, meaning insufficient samples — shouldn't happen with 17K test rows).

### Dynamic Tests — Live Evaluation

```bash
# 1. Copy new model artifacts locally
scp -r vps:/opt/hynous/satellite/artifacts/tick_models/ satellite/artifacts/tick_models/

# 2. Kill old MC server, start new one
kill $(lsof -t -i :8765 -i :8766) 2>/dev/null
sleep 1
.venv/bin/python scripts/monte_carlo_server.py > /tmp/mc_server.log 2>&1 &
sleep 3
cat /tmp/mc_server.log

# 3. Open in browser
open http://localhost:8766
```

**Browser verification (wait ~3 minutes for n > 100 at 10s):**

- [ ] 10s accuracy is higher than before (was 52.7% with zeros counted as wrong)
- [ ] `n` counts are lower than before for 10s/15s (zeros excluded from counting)
- [ ] No "NaN%" or display glitches in accuracy panel
- [ ] Bias accuracy panel still functions (1m, 3m, 5m windows)
- [ ] Predictions panel, MC cone, price chart all render normally

**PAUSE if:** Any accuracy shows NaN, n counts are zero for any horizon, or display breaks.

---

## File Change Summary

| File | What Changes |
|------|-------------|
| `scripts/monte_carlo.html` | Add `Math.abs(actualBps) >= 0.01` guard in `evaluateAccuracy()` (line 654) and `evaluateBiasAccuracy()` (line 741) |
| `satellite/training/train_tick_direction.py` | Add `prod_dir_accuracy` metric (7 insertion points: compute, results dict, log, summary, metadata, return, main log) |

---

## Expected Outcome

After implementation, the training summary will report both metrics:

```
  direction_10s    sp=0.3263  dir=66.6%  prod=XX.X%  pnl=0.485 bps  [PASS]
```

The `prod` number will be directly comparable to the live MC accuracy (both exclude zero returns, both include all non-zero moves). The `dir` number remains for big-move analysis.

The live MC accuracy for short horizons (especially 10s) will increase because ~26% of evaluations that were auto-wrong (zero returns) are no longer counted.

---

Last updated: 2026-04-01
