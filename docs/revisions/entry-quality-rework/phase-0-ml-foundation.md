# Phase 0: Fix ML Foundation

> **Status:** Ready for implementation
> **Scope:** 10 bug fixes across 7 files. Pure correctness fixes — no design decisions.
> **Tests:** 800+ existing unit tests must still pass. New tests added per fix.

---

## Required Reading (Before Starting)

Read these files and understand the specific sections noted. Do not skip any.

### ML Normalization Pipeline
- **`satellite/normalize.py`** (entire file, 269 lines) — Understand the 5 transform types (P=passthrough, C=clip, Z=z-score, L=log+z-score, S=signed-log+z-score). Study how `FeatureScaler.fit()` (line 70) iterates `self.feature_names` and looks up `self.transform_map[name]` at line 86. Study how `transform()` (line 122) does the same at line 146. Both will KeyError on any feature not in `transform_map`.
- **`satellite/features.py`** (entire file, ~1470 lines) — Understand the canonical `FEATURE_NAMES` list (lines 37-76, 28 entries), `NEUTRAL_VALUES` dict (lines 85-114), `AVAIL_COLUMNS` list (lines 117-129, currently 11 entries). Study the `compute_features()` function (lines 178-336) to see every `_compute_*` call and which ones receive the `avail` dict.

### Feature Computation Pattern (study these 3 exemplars)
- **`_compute_realized_vol()`** (lines 625-672) — CORRECT pattern: takes `avail` param, sets `avail["realized_vol_avail"] = 0` on every early-return/exception, sets `= 1` only on success (line 666). Use this as the template for all fixes.
- **`_compute_oi_ratio()`** (lines 342-381) — CORRECT pattern: guards with `if current_oi <= 0` → avail=0 + return.
- **`_compute_liq_cascade()`** (lines 383-436) — CORRECT pattern: multiple features sharing one avail flag.

### Broken Functions (study before fixing)
- **`_compute_volume_acceleration()`** (lines 1152-1189) — Missing `avail` param entirely. No avail flag set.
- **`_compute_cvd_1h()`** (lines 1191-1229) — Same: no `avail` param, no flag.
- **`_compute_vol_of_vol()`** (lines 1108-1149) — Same: no `avail` param, no flag. Also has population std at lines 1137, 1145.
- **`_compute_realized_vol_4h()`** (lines 1062-1105) — HAS `avail` param but never sets it on success. Population std at line 1100.
- **`_compute_price_trend_4h()`** (lines 1232-1291) — HAS `avail` param but never sets it.
- **`_compute_liq_imbalance()`** (lines 968-1018) — Sets `avail["liq_imbalance_avail"] = 1` unconditionally at line 1011, even when `total < 100` returns neutral.
- **`_compute_oi_funding_pressure()`** (lines 527-570) — Sets `avail=1` at line 546 when `current_oi <= 0` returns neutral.

### Inference Pipeline
- **`satellite/inference.py`** (lines 35-36, 144-155) — `_ALL_FEATURE_NAMES` is built from current `FEATURE_NAMES + AVAIL_COLUMNS`. The scaler at line 146 iterates its SAVED feature_names (from training time). Comment on line 151 says "12 + 9 = 21" but actual values depend on when the model was trained.
- **`satellite/training/pipeline.py`** (lines 143-156) — Training conditionally includes avail columns with `if col in train_rows[0]` at line 145. Inference (inference.py:150) unconditionally includes all. This is a dimension mismatch.
- **`satellite/training/artifact.py`** (lines 138-146) — `ModelArtifact.load()` checks `feature_hash` — old artifacts will fail to load with new FEATURE_HASH (this is correct safety behavior).

### Schema & Storage
- **`satellite/schema.py`** — Study the migration pattern at lines 202-209 and 235-241: idempotent `ALTER TABLE ADD COLUMN` wrapped in `try/except pass`.
- **`satellite/store.py`** (lines 37-56, 63-91) — `write_lock = threading.Lock()`, all mutations under `with self.write_lock:`, WAL mode.

### Daemon Integration
- **`src/hynous/intelligence/daemon.py`** — `_latest_predictions` declared at line 434 (plain dict, no lock). Read sites: line 822 (condition evaluator), lines 2173-2178 (dynamic SL), lines 2361-2366 (trailing stop), lines 3723/3728-3729 (anomaly highlighting), lines 5571/5582 (briefing injection). Write sites: lines 1690-1699 (direction predictions), lines 1730-1738 (condition predictions).

---

## Fix 0.1: Add Missing TRANSFORM_MAP Entries

**File:** `satellite/normalize.py`
**What:** TRANSFORM_MAP at lines 27-51 has 14 entries. FEATURE_NAMES has 28. Add the 14 missing v3/v4 features.

**Replace the entire TRANSFORM_MAP dict** (lines 27-51) with:

```python
TRANSFORM_MAP: dict[str, str] = {
    # TYPE P — Passthrough (already bounded, semantically meaningful)
    "liq_cascade_active": "P",      # {0, 1}
    "cvd_ratio_30m": "P",           # [-1, +1], already a ratio
    "cvd_acceleration": "P",        # [-2, +2], difference of ratios
    "close_position_5m": "P",       # [0, 1], already bounded
    "oi_price_direction": "P",      # {-1, 0, +1}, discrete
    "liq_imbalance_1h": "P",        # [-1, +1], already a ratio
    "cvd_ratio_1h": "P",            # [-1, +1], same semantics as cvd_30m
    "return_autocorrelation": "P",  # [-1, +1], bounded correlation
    "body_ratio_1h": "P",           # [0, 1], bounded ratio
    "upper_wick_ratio_1h": "P",     # [0, 1], bounded ratio
    "hour_sin": "P",                # [-1, +1], cyclical encoding
    "hour_cos": "P",                # [-1, +1], cyclical encoding

    # TYPE C — Clip only (already a z-score, don't re-normalize)
    "funding_vs_30d_zscore": "C",   # already a market z-score

    # TYPE Z — Z-score (normal continuous, center + scale)
    "hours_to_funding": "Z",        # 0-8, continuous
    "realized_vol_1h": "Z",         # %, continuous
    "price_trend_1h": "Z",          # %, continuous, directional
    "oi_change_rate_1h": "Z",       # %, continuous OI change rate
    "realized_vol_4h": "Z",         # %, same distribution as vol_1h
    "vol_of_vol": "Z",              # %, continuous volatility-of-vol
    "price_trend_4h": "Z",          # %, same distribution as trend_1h

    # TYPE L — Log transform + Z-score (skewed ratios, always positive)
    "oi_vs_7d_avg_ratio": "L",      # ratio > 0, skewed right
    "liq_1h_vs_4h_avg": "L",        # ratio > 0, spike-prone
    "volume_vs_1h_avg_ratio": "L",  # ratio > 0, skewed right
    "liq_total_1h_usd": "L",        # log10(USD) >= 0, heavily skewed
    "volume_acceleration": "L",     # ratio > 0, unbounded, skewed right

    # TYPE S — Signed log + Z-score (any sign, skewed)
    "oi_funding_pressure": "S",     # interaction term, large range
    "funding_rate_raw": "S",        # small values, any sign, skewed tails
    "funding_velocity": "S",        # rate difference, any sign, skewed
}
```

**Type assignment rationale:**
- P features are already bounded to a known range — no transform needed.
- Z features are continuous percentages — center and scale.
- L features are ratios > 0 that are right-skewed — log transform first, then z-score.
- S features can be positive or negative with skewed tails — signed log, then z-score.
- Each new feature matches the type of its closest existing analog (e.g., `cvd_ratio_1h` → P like `cvd_ratio_30m`; `realized_vol_4h` → Z like `realized_vol_1h`).

**Verify after applying:**
```bash
PYTHONPATH=. python -c "
from satellite.normalize import TRANSFORM_MAP
from satellite.features import FEATURE_NAMES
tm_keys = set(TRANSFORM_MAP.keys())
fn_keys = set(FEATURE_NAMES)
missing = fn_keys - tm_keys
extra = tm_keys - fn_keys
assert not missing, f'Missing from TRANSFORM_MAP: {missing}'
assert not extra, f'Extra in TRANSFORM_MAP: {extra}'
assert len(TRANSFORM_MAP) == 28, f'Expected 28, got {len(TRANSFORM_MAP)}'
print(f'OK: {len(TRANSFORM_MAP)} transform entries match {len(FEATURE_NAMES)} features')
"
```

---

## Fix 0.2: Add Missing Availability Flags

**File:** `satellite/features.py`

### 0.2a: Expand AVAIL_COLUMNS

**Location:** Lines 117-129. Add 5 new entries at the end of the list.

**Replace lines 117-129** with:

```python
AVAIL_COLUMNS: list[str] = [
    "oi_7d_avail",
    "liq_cascade_avail",
    "funding_zscore_avail",
    "oi_funding_pressure_avail",
    "volume_avail",
    "realized_vol_avail",
    "cvd_30m_avail",
    "price_trend_1h_avail",
    "close_position_avail",
    "oi_price_dir_avail",
    "liq_imbalance_avail",
    # v3/v4 availability flags
    "realized_vol_4h_avail",
    "vol_of_vol_avail",
    "volume_acceleration_avail",
    "cvd_1h_avail",
    "price_trend_4h_avail",
]
```

### 0.2b: Add `avail` param to `_compute_volume_acceleration()`

**Location:** Lines 1152-1189.

**Current signature (line 1152-1157):**
```python
def _compute_volume_acceleration(
    coin: str,
    features: dict,
    raw_data: dict,
    data_layer_db: object,
    now: float,
) -> None:
```

**Change signature to:**
```python
def _compute_volume_acceleration(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    data_layer_db: object,
    now: float,
) -> None:
```

**Add avail flag on success path** — after `features["volume_acceleration"] = vol_5m / avg_5m` (around line 1182), add:
```python
            avail["volume_acceleration_avail"] = 1
```

**Add avail=0 on the neutral fallback** — after `features["volume_acceleration"] = NEUTRAL_VALUES[...]` (around line 1184), add:
```python
            avail["volume_acceleration_avail"] = 0
```

**Add avail=0 in exception handler** — after the existing `features["volume_acceleration"] = NEUTRAL_VALUES[...]` in the except block (around line 1188), add:
```python
        avail["volume_acceleration_avail"] = 0
```

**Update call site in `compute_features()`** — line 295-297. Current:
```python
    _compute_volume_acceleration(
        coin, features, raw_data, data_layer_db, now,
    )
```
Change to:
```python
    _compute_volume_acceleration(
        coin, features, avail, raw_data, data_layer_db, now,
    )
```

### 0.2c: Add `avail` param to `_compute_cvd_1h()`

**Location:** Lines 1191-1229. Same pattern as 0.2b.

**Change signature** (lines 1191-1196) — add `avail: dict` after `features: dict`.

**Add `avail["cvd_1h_avail"] = 1`** after the success assignment (line 1223 area, where `features["cvd_ratio_1h"]` is set).

**Add `avail["cvd_1h_avail"] = 0`** on the early-return neutral path (line 1215 area) and in the exception handler (line 1229 area).

**Update call site** at line 300-302 — add `avail` as second positional arg after `features`.

### 0.2d: Add `avail` param to `_compute_vol_of_vol()`

**Location:** Lines 1108-1149. Same pattern.

**Current signature (lines 1108-1110):**
```python
def _compute_vol_of_vol(
    features: dict,
    candles_1m: list[dict] | None = None,
) -> None:
```

**Change to:**
```python
def _compute_vol_of_vol(
    features: dict,
    avail: dict,
    candles_1m: list[dict] | None = None,
) -> None:
```

**Add `avail["vol_of_vol_avail"] = 1`** after `features["vol_of_vol"] = math.sqrt(var_vol)` (line 1146).

**Add `avail["vol_of_vol_avail"] = 0`** on: the early-return when `len(candles_1m) < 60` (after line 1115), the early-return when `len(window_vols) < 3` (after line 1141), and in the exception handler (after line 1149).

**Update call site** at line 292. Current:
```python
    _compute_vol_of_vol(features, candles_1m=candles_1m)
```
Change to:
```python
    _compute_vol_of_vol(features, avail, candles_1m=candles_1m)
```

### 0.2e: Set avail flag in `_compute_realized_vol_4h()`

**Location:** Lines 1062-1105. Function already takes `avail` param but never sets it on success.

**Add `avail["realized_vol_4h_avail"] = 1`** after `features["realized_vol_4h"] = math.sqrt(variance) * ...` (line 1101).

**Add `avail["realized_vol_4h_avail"] = 0`** on: early-return when `not candles_1m` (after line 1073), early-return when `len(candles_4h) < 30` (after line 1085), early-return when `len(returns) < 20` (after line 1096), and in the exception handler (after line 1105).

Follow the exact same pattern as `_compute_realized_vol()` at lines 625-672 — that function correctly sets `avail["realized_vol_avail"]` on every path.

### 0.2f: Set avail flag in `_compute_price_trend_4h()`

**Location:** Lines 1232-1291. Function already takes `avail` param but never sets it.

**Add `avail["price_trend_4h_avail"] = 1`** on both success paths: after `features["price_trend_4h"] = (close_now - close_4h) / close_4h * 100` (around line 1262 and line 1284), immediately before the `return` statement on each path.

**Add `avail["price_trend_4h_avail"] = 0`** on: the neutral fallback (line 1287) and in the exception handler (line 1291).

Follow the pattern in `_compute_price_trend_1h()` (lines 769-843) — that function correctly sets `avail["price_trend_1h_avail"] = 1` on its success paths.

### 0.2g: Fix unconditional avail=1 in `_compute_liq_imbalance()`

**Location:** Line 1011. The `avail["liq_imbalance_avail"] = 1` is outside both conditional branches — it executes even when `total < 100` returns a neutral zero.

**Current code** (lines 1004-1011):
```python
        if total < 100:
            features["liq_imbalance_1h"] = 0.0
        else:
            features["liq_imbalance_1h"] = max(-1.0, min(1.0,
                (short_liq - long_liq) / total
            ))

        avail["liq_imbalance_avail"] = 1  # BUG: always 1
```

**Replace with:**
```python
        if total < 100:
            features["liq_imbalance_1h"] = 0.0
            avail["liq_imbalance_avail"] = 0
        else:
            features["liq_imbalance_1h"] = max(-1.0, min(1.0,
                (short_liq - long_liq) / total
            ))
            avail["liq_imbalance_avail"] = 1
```

### 0.2h: Fix unconditional avail=1 in `_compute_oi_funding_pressure()`

**Location:** Line 546. When `current_oi <= 0`, the function returns neutral but sets avail=1.

**Current code** (lines 544-547):
```python
        if current_oi <= 0:
            features["oi_funding_pressure"] = NEUTRAL_VALUES["oi_funding_pressure"]
            avail["oi_funding_pressure_avail"] = 1
            return
```

**Change line 546** from `= 1` to `= 0`:
```python
        if current_oi <= 0:
            features["oi_funding_pressure"] = NEUTRAL_VALUES["oi_funding_pressure"]
            avail["oi_funding_pressure_avail"] = 0
            return
```

### 0.2i: Add schema migration for new avail columns

**File:** `satellite/schema.py`

In the `run_migrations()` function, add a new migration block using the existing idempotent pattern (see lines 202-209 and 235-241 for examples):

```python
    # Phase 0: Add v3/v4 availability flag columns
    for col in [
        "realized_vol_4h_avail",
        "vol_of_vol_avail",
        "volume_acceleration_avail",
        "cvd_1h_avail",
        "price_trend_4h_avail",
    ]:
        try:
            conn.execute(
                f"ALTER TABLE snapshots ADD COLUMN {col} "
                "INTEGER NOT NULL DEFAULT 1",
            )
        except Exception:
            pass  # column already exists
```

Default `1` (available) for backward compatibility — old rows without these columns will be treated as "data available" by models, which is the safe fallback.

### 0.2j: Verify store.py picks up new columns

**File:** `satellite/store.py`

`_SNAPSHOT_COLS` at lines 17-28 is built dynamically:
```python
_SNAPSHOT_COLS = (
    ["snapshot_id", "created_at", "coin"]
    + list(FEATURE_NAMES)
    + list(AVAIL_COLUMNS)
    + ["schema_version", "created_by"]
)
```

Since it imports `AVAIL_COLUMNS` from `features.py`, it automatically picks up the 5 new columns. **No code change needed** — just verify by running:
```bash
PYTHONPATH=. python -c "
from satellite.store import _SNAPSHOT_COLS
print(f'Snapshot columns: {len(_SNAPSHOT_COLS)}')
# Should be 3 + 28 + 16 + 2 = 49
assert len(_SNAPSHOT_COLS) == 49, f'Expected 49, got {len(_SNAPSHOT_COLS)}'
print('OK')
"
```

---

## Fix 0.3: Population → Sample Standard Deviation

**File:** `satellite/features.py`

All 5 fixes follow the same pattern: change `/ len(x)` to `/ (len(x) - 1)`. Each function already has a minimum length check that ensures `len(x) >= 5`, so dividing by `(len - 1)` is safe (no division by zero).

### 0.3a: `_compute_realized_vol()` — line 662

**Current:** `variance = sum((r - mean_ret) ** 2 for r in returns) / len(returns)`
**Change to:** `variance = sum((r - mean_ret) ** 2 for r in returns) / (len(returns) - 1)`
**Safety:** `len(returns) >= 5` guaranteed by check at line 658.

### 0.3b: `_compute_realized_vol_4h()` — line 1100

**Current:** `variance = sum((r - mean_ret) ** 2 for r in returns) / len(returns)`
**Change to:** `variance = sum((r - mean_ret) ** 2 for r in returns) / (len(returns) - 1)`
**Safety:** `len(returns) >= 20` guaranteed by check at line 1096.

### 0.3c: `_compute_vol_of_vol()` — lines 1137 and 1145

**Line 1137 (inner window variance):**
**Current:** `var_r = sum((r - mean_r) ** 2 for r in returns) / len(returns)`
**Change to:** `var_r = sum((r - mean_r) ** 2 for r in returns) / (len(returns) - 1)`
**Safety:** `len(returns) >= 5` guaranteed by check at line 1133.

**Line 1145 (outer meta-variance):**
**Current:** `var_vol = sum((v - mean_vol) ** 2 for v in window_vols) / len(window_vols)`
**Change to:** `var_vol = sum((v - mean_vol) ** 2 for v in window_vols) / (len(window_vols) - 1)`
**Safety:** `len(window_vols) >= 3` guaranteed by check at line 1140.

### 0.3d: `_compute_funding_zscore()` — line 480

**Current:** `variance = sum((r - mean_rate) ** 2 for r in rates) / len(rates)`
**Change to:** `variance = sum((r - mean_rate) ** 2 for r in rates) / (len(rates) - 1)`
**Safety:** `len(rates) >= 10` guaranteed by check at line 475.

### 0.3e: `_compute_return_autocorrelation()` — lines 1346-1347

**Current:**
```python
        std1 = math.sqrt(sum((x - mean1) ** 2 for x in r1) / n)
        std2 = math.sqrt(sum((x - mean2) ** 2 for x in r2) / n)
```

**Change to:**
```python
        std1 = math.sqrt(sum((x - mean1) ** 2 for x in r1) / (n - 1))
        std2 = math.sqrt(sum((x - mean2) ** 2 for x in r2) / (n - 1))
```

**Also fix the covariance line** (line 1345):
```python
        cov = sum((r1[i] - mean1) * (r2[i] - mean2) for i in range(n)) / (n - 1)
```

**Safety:** `n >= 3` guaranteed by the `len(log_returns) < 4` check at line 1339 (r1 has len = log_returns - 1).

---

## Fix 0.4: Training/Inference Availability Alignment

**File:** `satellite/training/pipeline.py`

**Location:** Lines 143-156.

**Current code** (conditional avail inclusion):
```python
    avail_names = []
    for col in AVAIL_COLUMNS:
        if col in train_rows[0]:
            train_avail = np.array(
                [r.get(col, 1) for r in train_rows], dtype=np.float64,
            ).reshape(-1, 1)
            val_avail = np.array(
                [r.get(col, 1) for r in val_rows], dtype=np.float64,
            ).reshape(-1, 1)
            X_train = np.hstack([X_train, train_avail])
            X_val = np.hstack([X_val, val_avail])
            avail_names.append(col)
```

**Replace with** (unconditional — always include all, default missing to 1):
```python
    avail_names = list(AVAIL_COLUMNS)
    for col in AVAIL_COLUMNS:
        train_avail = np.array(
            [r.get(col, 1) for r in train_rows], dtype=np.float64,
        ).reshape(-1, 1)
        val_avail = np.array(
            [r.get(col, 1) for r in val_rows], dtype=np.float64,
        ).reshape(-1, 1)
        X_train = np.hstack([X_train, train_avail])
        X_val = np.hstack([X_val, val_avail])
```

This ensures `all_feature_names` (line 156) = `FEATURE_NAMES (28) + AVAIL_COLUMNS (16)` = 44, matching what inference.py produces.

---

## Fix 0.5: Update Stale Comments

**File:** `satellite/inference.py`

**Line 6:** Change `(artifact's sealed scaler, 12 values)` to `(artifact's sealed scaler, 28 values)`.
**Line 35:** Change `# Full feature list used by trained models: 12 structural + 9 avail = 21` to `# Full feature list: 28 structural + 16 avail = 44`.
**Line 151:** Change `# 12 + 9 = 21` to `# 28 structural (scaler) + 16 avail (raw binary) = 44`.

---

## Fix 0.6: Add Lock to `_latest_predictions`

**File:** `src/hynous/intelligence/daemon.py`

### 0.6a: Declare lock

After line 434 (`self._latest_predictions: dict[str, dict] = {}`), add:
```python
        self._latest_predictions_lock = threading.Lock()
```

`threading` is already imported at the top of daemon.py (verify by searching for `import threading`).

### 0.6b: Wrap writes

**Write site 1: Direction predictions** (around line 1690). Current:
```python
                self._latest_predictions[coin] = {
                    "signal": result.signal,
                    ...
                }
```
Wrap with:
```python
                with self._latest_predictions_lock:
                    self._latest_predictions[coin] = {
                        "signal": result.signal,
                        ...
                    }
```

**Write site 2: Condition predictions pop** (around lines 1730-1732). Current:
```python
                if coin in self._latest_predictions:
                    self._latest_predictions[coin].pop("conditions", None)
                    self._latest_predictions[coin].pop("conditions_text", None)
```
Wrap with `with self._latest_predictions_lock:`.

**Write site 3: Condition predictions set** (around lines 1737-1738). Current:
```python
                self._latest_predictions[coin]["conditions"] = conditions.to_dict()
                self._latest_predictions[coin]["conditions_text"] = conditions.to_briefing_text()
```
Wrap with `with self._latest_predictions_lock:`.

### 0.6c: Wrap reads (copy-and-release pattern)

At each read site, acquire lock, copy to local variable, release lock, then use the local variable. This minimizes lock hold time.

**Read site 1: Condition evaluator** (line 822):
```python
            with self._latest_predictions_lock:
                pred = dict(self._latest_predictions.get(coin, {}))
```

**Read site 2: Dynamic SL** (line 2173):
```python
                        with self._latest_predictions_lock:
                            _pred = dict(self._latest_predictions.get("BTC", {}))
```

**Read site 3: Trailing stop** (line 2361):
```python
                        with self._latest_predictions_lock:
                            _pred = dict(self._latest_predictions.get("BTC", {}))
```

**Read site 4: Anomaly highlighting** (line 3728):
```python
            with self._latest_predictions_lock:
                pred = dict(self._latest_predictions.get(coin, {}))
```

**Read site 5: Briefing injection** (lines 5571, 5582). The `ml_predictions` kwarg passes the entire dict. Instead, make a snapshot copy:
```python
                    with self._latest_predictions_lock:
                        _ml_snap = {k: dict(v) for k, v in self._latest_predictions.items()}
                    briefing_text = build_briefing(
                        ..., ml_predictions=_ml_snap,
                    )
                    ...
                    code_questions = build_code_questions(
                        ..., ml_predictions=_ml_snap,
                    )
```

**Do NOT hold the lock while calling `build_briefing()` or any function that may take >1ms.** Copy first, release, then call.

---

## Fix 0.7: Candle Search and Stale Fallback

**File:** `satellite/features.py`

### 0.7a: Fix candle search in `_compute_price_trend_1h()`

**Location:** Lines 797-801. Current fragile loop:
```python
                close_1h = None
                for c in past_candles:
                    if c["t"] <= target_1h_ms:
                        close_1h = float(c["c"])
                    else:
                        break
```

**Replace with:**
```python
                candidates = [c for c in past_candles if c["t"] <= target_1h_ms]
                close_1h = float(candidates[-1]["c"]) if candidates else None
```

This picks the most recent candle at or before the target time, regardless of sort order.

### 0.7b: Fix candle search in `_compute_price_trend_4h()`

**Location:** Around line 1255. Find the identical loop pattern:
```python
                close_4h = None
                for c in past_candles:
                    if c["t"] <= target_4h_ms:
                        close_4h = float(c["c"])
                    else:
                        break
```

**Replace with:**
```python
                candidates = [c for c in past_candles if c["t"] <= target_4h_ms]
                close_4h = float(candidates[-1]["c"]) if candidates else None
```

### 0.7c: Fix stale candle fallback in `_compute_return_autocorrelation()`

**Location:** Line 1319. Current:
```python
        if len(recent) < 12:
            recent = candles_5m[-12:]
```

**Replace with:**
```python
        if len(recent) < 12:
            stale_cutoff = (now - 7200) * 1000 if now else 0
            recent = [c for c in candles_5m if c["t"] >= stale_cutoff][-12:]
            if len(recent) < 6:
                features["return_autocorrelation"] = NEUTRAL_VALUES["return_autocorrelation"]
                avail["return_autocorr_avail"] = 0
                return
```

This limits fallback to candles from the last 2 hours, and gives up entirely if fewer than 6 are available.

### 0.7d: Fix stale candle fallback in `_compute_candle_ratios()`

**Location:** Line 1383. Same pattern. Current:
```python
        if len(recent) < 12:
            recent = candles_5m[-12:]
```

**Replace with:**
```python
        if len(recent) < 12:
            stale_cutoff = (now - 7200) * 1000 if now else 0
            recent = [c for c in candles_5m if c["t"] >= stale_cutoff][-12:]
            if len(recent) < 6:
                features["body_ratio_1h"] = NEUTRAL_VALUES["body_ratio_1h"]
                features["upper_wick_ratio_1h"] = NEUTRAL_VALUES["upper_wick_ratio_1h"]
                return
```

---

## Final Verification

After applying ALL fixes:

### Static checks
```bash
# 1. TRANSFORM_MAP completeness
PYTHONPATH=. python -c "
from satellite.normalize import TRANSFORM_MAP
from satellite.features import FEATURE_NAMES, AVAIL_COLUMNS
assert set(TRANSFORM_MAP) == set(FEATURE_NAMES), f'Mismatch: {set(FEATURE_NAMES) - set(TRANSFORM_MAP)}'
assert len(AVAIL_COLUMNS) == 16, f'Expected 16 avail columns, got {len(AVAIL_COLUMNS)}'
print(f'OK: {len(TRANSFORM_MAP)} transforms, {len(AVAIL_COLUMNS)} avail cols')
"

# 2. Scaler can fit on neutral values (tests all 28 transforms)
PYTHONPATH=. python -c "
from satellite.normalize import FeatureScaler
from satellite.features import NEUTRAL_VALUES
import numpy as np
s = FeatureScaler()
data = {k: np.array([v] * 20) for k, v in NEUTRAL_VALUES.items()}
s.fit(data)
result = s.transform(NEUTRAL_VALUES)
print(f'Scaler fitted: {len(s.feature_names)} features → {len(result)} transformed values')
assert len(result) == 28
print('OK')
"

# 3. Store columns count
PYTHONPATH=. python -c "
from satellite.store import _SNAPSHOT_COLS
assert len(_SNAPSHOT_COLS) == 49, f'Expected 49, got {len(_SNAPSHOT_COLS)}'
print(f'OK: {len(_SNAPSHOT_COLS)} snapshot columns')
"
```

### Unit tests
```bash
PYTHONPATH=. pytest satellite/tests/ -x -v
PYTHONPATH=src pytest tests/ -x -v
```

All 800+ tests must pass. If any fail, stop and report the exact error with full traceback.

### Integration check (requires running services)

Start daemon briefly. After one satellite tick (~300s):
1. Check daemon logs for "Satellite inference init failed" — this is EXPECTED (old artifact, incompatible hash). It will be fixed in Phase 1.
2. Check condition predictions still work: daemon should still log condition predictions for BTC (condition models don't use the scaler).
3. Query new avail columns: `sqlite3 storage/satellite.db "PRAGMA table_info(snapshots)" | grep avail` — should show all 16 avail columns.

**Report all verification results before proceeding to Phase 1.**

---

## Files Modified (Summary)

| File | Changes |
|------|---------|
| `satellite/normalize.py` | Replace TRANSFORM_MAP: 14 → 28 entries |
| `satellite/features.py` | AVAIL_COLUMNS: 11 → 16 entries. Fix 3 signatures (add avail). Fix 2 avail-on-success. Fix 2 unconditional-avail. Fix 5 population-std. Fix 2 candle-search. Fix 2 stale-fallback. |
| `satellite/training/pipeline.py` | Remove conditional avail inclusion |
| `satellite/inference.py` | Fix 3 stale comments |
| `satellite/schema.py` | Add 5 avail column migrations |
| `satellite/store.py` | No change (verify auto-pickup) |
| `src/hynous/intelligence/daemon.py` | Add `_latest_predictions_lock`, wrap all read/write sites |

---

Last updated: 2026-03-22
