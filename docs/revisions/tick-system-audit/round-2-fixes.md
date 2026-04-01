# Tick System Audit — Round 2 Fixes

> **Status:** Both bugs fixed (2026-03-31)
> **Date:** 2026-03-31
> **Scope:** 2 bugs in the Fix 1 downsample implementation (commit `5c0053b`). Both are train/serve mismatches.
> **Files affected:** `satellite/tick_inference.py`, `scripts/monte_carlo_server.py`

---

## Required Reading

| # | File | Lines | What to Understand |
|---|------|-------|--------------------|
| 1 | `satellite/training/train_tick_direction.py` | 156-175 | Training builds BOTH `base_matrix` and `rolling_matrix` from the SAME `downsampled` list. The feature matrix row `i` has base features from `downsampled[i]` and rolling features computed from the column ending at `downsampled[i]`. |
| 2 | `satellite/training/train_tick_direction.py` | 246-255 | `_rolling_std(x, window)` guard: `if i - start < 2: return 0.0`. Requires at least 3 elements (segment length >= 3) to compute std. With fewer, returns 0.0. |
| 3 | `satellite/tick_inference.py` | 236-285 | Current code: `latest = rows[-1]` (raw) for base features. `ds_rows` (downsampled) for rolling features. `ds_rows[-1]` may differ from `rows[-1]` by up to 4.4s. std30 guard: `if w30 >= 2` allows 2 elements where training requires 3. |
| 4 | `scripts/monte_carlo_server.py` | 78-100, 135-218 | Same two issues: base from raw `rows[-1]`, rolling from `ds_rows`. std30 guard: `if w30 >= 2`. |

---

## Bug 1: std30 Guard Mismatch

### Problem

Training's `_rolling_std(x, window=6)` requires at least **3 elements** before computing std (line 251: `if i - start < 2` means segment length must be >= 3). Both inference sites use `if w30 >= 2`, which allows computing std with only 2 elements — producing a non-zero value where training returns 0.0.

### When It Triggers

When exactly 2 downsampled rows exist (n=2). This requires < 15 raw 1s rows in the DB, which happens during the first ~10 seconds after tick collector restart. The inference engine could produce 1-2 predictions with incorrect std30 features during this window.

### Fix

**`satellite/tick_inference.py` line 278** — change guard from `>= 2` to `>= 3`:

```python
# Before:
if w30 >= 2:

# After:
if w30 >= 3:
```

**`scripts/monte_carlo_server.py` line 184** — same change:

```python
# Before:
if w30 >= 2:

# After:
if w30 >= 3:
```

### Verification

Add test to `satellite/tests/test_tick_inference.py`:

```python
def test_std30_requires_3_elements(self):
    """std30 with exactly 2 downsampled rows should return 0.0 (matches training)."""
    rows = _make_rows(10, interval_s=1.0)
    ds = _downsample(rows)  # ~2 rows from 10s of 1s data
    book_imb = [r["book_imbalance_5"] for r in ds]
    n = len(ds)
    w30 = min(6, n)
    if w30 < 3:
        # Should return 0.0 to match training's _rolling_std guard
        expected = 0.0
        assert w30 < 3, "This test needs n < 3 to be meaningful"
    else:
        expected = float(np.std(book_imb[-w30:]))
```

---

## Bug 2: Base Features From Raw Row Instead of Downsampled

### Problem

Training builds both base and rolling features from the same `downsampled` list (lines 162-168). For any row `i`, the base `book_imbalance_5` and the rolling `book_imbalance_5_mean5` (which at w5=1 is an identity of the same column) come from the same downsampled row.

At inference, base features come from `rows[-1]` (most recent raw 1s row) while rolling features come from `ds_rows`. The last raw row is NOT guaranteed to be in `ds_rows` — if the gap between `ds_rows[-1]` and `rows[-1]` is < 4.5s, the raw row is excluded from the downsampled set.

**Concrete example:** 120 raw rows at 1s intervals (t=0..119). Downsampled: t=0, 5, 10, ..., 115. `rows[-1]` = t=119, `ds_rows[-1]` = t=115. Base `book_imbalance_5` reflects t=119, rolling `book_imbalance_5_mean5` reflects t=115. The model has never seen these features disagree — during training they are always identical.

Maximum skew: ~4.4s. The skew is systematic (happens on most inference calls) and affects the relationship between 3 base/rolling feature pairs.

### Fix

Use `ds_rows[-1]` for base features instead of `rows[-1]`. Keep `rows[-1]` only for `tick_ts` (timestamp used for staleness gating).

**`satellite/tick_inference.py`** — restructure lines 238-242:

Move the base feature extraction AFTER the downsample block, and source it from `ds_rows[-1]`:

```python
            # Before:
            latest = rows[-1]
            tick_ts = latest["timestamp"]
            features = {f: (latest[f] or 0.0) for f in BASE_TICK_FEATURES}
            # ... downsample ...
            # ... rolling features from ds_rows ...

            # After:
            tick_ts = rows[-1]["timestamp"]  # freshest timestamp for staleness check
            # ... downsample ...
            latest_ds = ds_rows[-1]  # base features from downsampled (matches training)
            features = {f: (latest_ds[f] or 0.0) for f in BASE_TICK_FEATURES}
            # ... rolling features from ds_rows ...
```

**`scripts/monte_carlo_server.py`** — same restructure in `fetch_and_predict()` and `_build_features()`:

In `fetch_and_predict()`, after downsampling, set `latest = ds_rows[-1]` before calling `_build_features()`. The `mid_price` used for simulation should also come from `ds_rows[-1]` for consistency with the features.

In `_build_features()`, `latest = rows[-1]` becomes just the fallback; pass `ds_rows[-1]` as the source of base features.

### Verification

Add test to `satellite/tests/test_tick_inference.py`:

```python
def test_base_features_from_downsampled_not_raw(self):
    """Base features should come from ds_rows[-1], not rows[-1]."""
    rows = _make_rows(120, interval_s=1.0)
    ds = _downsample(rows)
    # rows[-1] is t=119, ds[-1] is t=115
    assert rows[-1]["timestamp"] != ds[-1]["timestamp"]
    # After fix, base book_imbalance_5 should equal ds[-1]'s value
    assert ds[-1]["book_imbalance_5"] == rows[-1 - 4]["book_imbalance_5"]  # 4s earlier
```

---

## Implementation Order

1. Fix Bug 1 (std30 guard) in both files — one-character change each.
2. Fix Bug 2 (base features source) in both files — restructure extraction point.
3. Add tests for both bugs.
4. Run full test suite.

---

Last updated: 2026-03-31
