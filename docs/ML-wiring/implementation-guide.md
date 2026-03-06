# ML Wiring Implementation Guide

> Wire the trained v1 XGBoost model into the live daemon for real-time inference, fix the live candle feature gap, and inject ML signals into the agent's decision context.

**Status**: Complete (2026-03-05)
**Priority**: P0 — blocks Phase 5 (Live Trading)
**Estimated scope**: ~10 files modified, ~400 lines of new code

---

## Table of Contents

1. [Required Reading](#1-required-reading)
2. [Current State Summary](#2-current-state-summary)
3. [Architecture Overview](#3-architecture-overview)
4. [Task 1: Fix Live Candle Feature Gap](#4-task-1-fix-live-candle-feature-gap)
5. [Task 2: Add save_prediction to SatelliteStore](#5-task-2-add-save_prediction-to-satellitestore)
6. [Task 3: Wire Inference into the Daemon](#6-task-3-wire-inference-into-the-daemon)
7. [Task 4: Inject ML Signals into Agent Briefing](#7-task-4-inject-ml-signals-into-agent-briefing)
8. [Task 5: Fix Dashboard Prediction Query Bug](#8-task-5-fix-dashboard-prediction-query-bug)
9. [Task 6: Add Inference Config Fields](#9-task-6-add-inference-config-fields)
10. [Static Analysis Checklist](#10-static-analysis-checklist)
11. [Dynamic Verification](#11-dynamic-verification)
12. [File Change Summary](#12-file-change-summary)

---

## 1. Required Reading

The engineer agent **MUST** read these files before making any changes. Read them in this order — each builds context for the next.

### Architecture & Integration (read first)
| File | Why |
|------|-----|
| `CLAUDE.md` | Project conventions, extension patterns, testing commands |
| `ARCHITECTURE.md` | System overview, component diagram, all data flows |
| `docs/integration.md` | All 10 cross-system data flows with code path traces |

### Satellite ML Engine (read second)
| File | Why |
|------|-----|
| `satellite/README.md` | Feature list, normalization types, kill switch, v1 model status, **known limitations section** |
| `satellite/features.py` | SINGLE SOURCE OF TRUTH for feature computation — understand all 12 features, neutral values, availability flags |
| `satellite/inference.py` | Full file — InferenceEngine, InferenceResult, _decide(), compute_position_size() |
| `satellite/safety.py` | Full file — KillSwitch, SafetyConfig, SafetyState, 5 auto-disable conditions |
| `satellite/training/artifact.py` | Full file — ModelArtifact load/save, feature hash verification |
| `satellite/normalize.py` | FeatureScaler.transform() and from_dict() — understand the 5 normalization types |
| `satellite/training/explain.py` | PredictionExplanation dataclass, create_explainer(), explain_prediction() |
| `satellite/store.py` | Full file — confirm NO save_prediction() method exists |
| `satellite/schema.py` | Full file — predictions table DDL (lines 132-149), understand all column definitions |
| `satellite/config.py` | SatelliteConfig + SafetyConfig — note: no inference fields exist yet |
| `satellite/__init__.py` | tick() entry point — understand the current flow |

### Daemon Integration Points (read third)
| File | Why | Lines |
|------|-----|-------|
| `src/hynous/intelligence/daemon.py` | Satellite init | 406-452 |
| `src/hynous/intelligence/daemon.py` | Satellite tick call | 1143-1188 |
| `src/hynous/intelligence/daemon.py` | _wake_agent() message assembly | 4067-4294 |
| `src/hynous/intelligence/briefing.py` | build_briefing() structure | 291-369 |
| `src/hynous/intelligence/briefing.py` | build_code_questions() | 754-861 |

### Data Sources (read fourth)
| File | Why | Lines |
|------|-----|-------|
| `src/hynous/data/providers/hyperliquid.py` | get_candles() API — supports 1m/5m/1h intervals | 618-650 |
| `satellite/artemis/reconstruct.py` | How backfill computes price_change_5m_pct and realized_vol_1h from candles | 223-287 |

### Dashboard (read fifth)
| File | Why | Lines |
|------|-----|-------|
| `dashboard/dashboard/dashboard.py` | `/api/ml/predictions` endpoint — has a SQL bug (line 592) | 576-673 |

### Config
| File | Why |
|------|-----|
| `config/default.yaml` | satellite section (lines 127-143) — needs inference fields added |
| `src/hynous/core/config.py` | SatelliteConfig dataclass — must match YAML changes |

---

## 2. Current State Summary

### What EXISTS and works:
- `satellite.tick()` runs every 300s via daemon, computes 12 features per coin, stores to `satellite.db`
- Model v1 artifacts in `satellite/artifacts/v1/` (long + short XGBoost regressors, sealed scaler, metadata)
- `InferenceEngine` class — complete predict pipeline (compute → normalize → predict → SHAP → decide)
- `KillSwitch` class — 5 auto-disable conditions, shadow mode, state persistence
- `predictions` table schema in satellite.db — defined but never written to
- Dashboard `/api/ml/predictions` and `/api/ml/predictions/history` endpoints — ready to read predictions

### What DOES NOT exist (gaps this guide fills):
1. `SatelliteStore` has no `save_prediction()` method
2. Daemon does NOT load `ModelArtifact` or create `InferenceEngine`
3. Daemon does NOT call inference after `tick()`
4. ML signals are NOT injected into agent briefing
5. No config fields for inference parameters
6. `price_change_5m_pct` and `realized_vol_1h` stub out in live (avail=0)
7. Dashboard `/api/ml/predictions` has a SQL column name bug

---

## 3. Architecture Overview

### Target Data Flow (after implementation)

```
Daemon._poll_derivatives() (every 300s)
    │
    ├── _record_historical_snapshots()  ← existing
    │
    ├── satellite.tick()                ← existing (compute features → satellite.db)
    │       │
    │       └── returns List[FeatureResult]
    │
    ├── [NEW] _run_satellite_inference()
    │       │
    │       ├── KillSwitch.check_staleness()
    │       ├── For each coin:
    │       │   ├── InferenceEngine.predict(coin, snapshot, dl_db, ...)
    │       │   ├── store.save_prediction(result)        ← NEW method
    │       │   └── KillSwitch.record_snapshot_time()
    │       │
    │       ├── Cache predictions for briefing injection
    │       │
    │       └── If strong signal AND not shadow → _wake_agent(source="daemon:ml_signal")
    │
    └── (continue with rest of poll cycle)

On any daemon wake:
    │
    ├── build_briefing()
    │       └── [NEW] ML Signals section (after regime, before per-asset data)
    │
    └── build_code_questions()
            └── [NEW] ML signal questions (if strong signal for held/unheld coins)
```

### Shadow Mode (default for initial deployment)

The system starts in **shadow mode**: the model predicts and logs every 300s, but predictions are advisory-only. The agent sees them in the briefing as context but no automatic trades are triggered. This allows validation of live prediction quality before enabling autonomous ML-driven entries.

---

## 4. Task 1: Fix Live Candle Feature Gap

### Problem

`price_change_5m_pct` (SHAP importance #2) and `realized_vol_1h` (SHAP importance #1) are stubbed out in live `compute_features()`, returning neutral values with `avail=0`. The model runs at ~30% of its trained capability without these.

### Root Cause

`features.py:_compute_price_change()` (line 642) and `_compute_realized_vol()` (line 715) have no candle data source in live mode. The Artemis backfill computes these from reconstructed candles, but the live path was never connected.

### Solution

Pass candles directly to `compute_features()` via a new optional `candles` parameter. The daemon already fetches candles from Hyperliquid for regime classification — extend this to also fetch 5m and 1m candles and pass them through.

### Step 1a: Modify `compute_features()` signature

**File**: `satellite/features.py`
**Line**: 154 (function signature)

Add an optional `candles` parameter:

```python
def compute_features(
    coin: str,
    snapshot: object,
    data_layer_db: object,
    heatmap_engine: object | None = None,
    order_flow_engine: object | None = None,
    config: SatelliteConfig | None = None,
    timestamp: float | None = None,
    candles_5m: list[dict] | None = None,   # NEW: [{t, o, h, l, c, v}, ...]
    candles_1m: list[dict] | None = None,   # NEW: [{t, o, h, l, c, v}, ...]
) -> FeatureResult:
```

Pass the new parameters through to the individual feature computers:

```python
# 9. price_change_5m_pct
_compute_price_change(
    coin, features, avail, raw_data, snapshot, data_layer_db, now,
    candles_5m=candles_5m,   # NEW
)

# 11. realized_vol_1h
_compute_realized_vol(
    coin, features, avail, raw_data, data_layer_db, now,
    candles_1m=candles_1m,   # NEW
)
```

### Step 1b: Implement `_compute_price_change()` with candle data

**File**: `satellite/features.py`
**Replace**: Lines 642-660 (the entire stub function)

```python
def _compute_price_change(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    snapshot: object,
    data_layer_db: object,
    now: float,
    candles_5m: list[dict] | None = None,
) -> None:
    """Compute price_change_5m_pct from 5m candle data.

    Formula: (close_now - close_5m_ago) / close_5m_ago * 100
    Matches Artemis backfill logic (reconstruct.py lines 223-235).

    Args:
        candles_5m: List of 5m candles [{t, o, h, l, c, v}, ...] sorted by t asc.
                    t is Unix milliseconds. Expects at least 2 candles.
    """
    if not candles_5m or len(candles_5m) < 2:
        features["price_change_5m_pct"] = NEUTRAL_VALUES["price_change_5m_pct"]
        avail["price_change_5m_avail"] = 0
        return

    try:
        # Use the last two completed candles (drop the forming one if present).
        # Candles are sorted ascending by timestamp.
        # The last candle may be still forming — use second-to-last as "current"
        # and third-to-last as "previous" to ensure both are complete.
        # If we only have 2 candles, use them directly (best effort).
        if len(candles_5m) >= 3:
            current = candles_5m[-2]   # last completed
            previous = candles_5m[-3]  # 5m before that
        else:
            current = candles_5m[-1]
            previous = candles_5m[-2]

        close_now = float(current.get("c", 0))
        close_prev = float(previous.get("c", 0))

        if close_prev <= 0:
            features["price_change_5m_pct"] = NEUTRAL_VALUES["price_change_5m_pct"]
            avail["price_change_5m_avail"] = 0
            return

        pct = (close_now - close_prev) / close_prev * 100
        features["price_change_5m_pct"] = pct
        avail["price_change_5m_avail"] = 1

    except Exception:
        log.debug("Failed to compute price_change_5m_pct for %s", coin, exc_info=True)
        features["price_change_5m_pct"] = NEUTRAL_VALUES["price_change_5m_pct"]
        avail["price_change_5m_avail"] = 0
```

### Step 1c: Implement `_compute_realized_vol()` with candle data

**File**: `satellite/features.py`
**Replace**: Lines 715-729 (the entire stub function)

```python
def _compute_realized_vol(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    data_layer_db: object,
    now: float,
    candles_1m: list[dict] | None = None,
) -> None:
    """Compute realized_vol_1h: stdev of 1m log returns * sqrt(60) * 100.

    Matches Artemis backfill logic (reconstruct.py lines 258-287).

    Args:
        candles_1m: List of 1m candles [{t, o, h, l, c, v}, ...] sorted by t asc.
                    t is Unix milliseconds. Needs at least 10 candles in the last hour.
    """
    if not candles_1m:
        features["realized_vol_1h"] = NEUTRAL_VALUES["realized_vol_1h"]
        avail["realized_vol_avail"] = 0
        return

    try:
        # Filter to candles within the last hour
        cutoff_ms = (now - 3600) * 1000
        hour_candles = [c for c in candles_1m if float(c.get("t", 0)) >= cutoff_ms]

        if len(hour_candles) < 10:
            features["realized_vol_1h"] = NEUTRAL_VALUES["realized_vol_1h"]
            avail["realized_vol_avail"] = 0
            return

        # Compute log returns
        returns = []
        for i in range(1, len(hour_candles)):
            prev_close = float(hour_candles[i - 1].get("c", 0))
            curr_close = float(hour_candles[i].get("c", 0))
            if prev_close > 0 and curr_close > 0:
                returns.append(math.log(curr_close / prev_close))

        if len(returns) < 5:
            features["realized_vol_1h"] = NEUTRAL_VALUES["realized_vol_1h"]
            avail["realized_vol_avail"] = 0
            return

        mean_ret = sum(returns) / len(returns)
        variance = sum((r - mean_ret) ** 2 for r in returns) / len(returns)
        realized_vol = math.sqrt(variance) * math.sqrt(60) * 100

        features["realized_vol_1h"] = realized_vol
        avail["realized_vol_avail"] = 1

    except Exception:
        log.debug("Failed to compute realized_vol_1h for %s", coin, exc_info=True)
        features["realized_vol_1h"] = NEUTRAL_VALUES["realized_vol_1h"]
        avail["realized_vol_avail"] = 0
```

### Step 1d: Fetch candles in the daemon and pass them through

**File**: `src/hynous/intelligence/daemon.py`

Add a candle cache and fetching method to the Daemon class. Place near the existing `_fetch_regime_candles()` method (around line 1222).

```python
def _fetch_satellite_candles(self, coin: str) -> tuple[list[dict], list[dict]]:
    """Fetch 5m and 1m candles for satellite features.

    Returns:
        (candles_5m, candles_1m) — both sorted ascending by timestamp.
        Either list may be empty on failure.
    """
    provider = self._get_provider()
    now_ms = int(time.time() * 1000)
    candles_5m = []
    candles_1m = []

    try:
        # 5m candles: need 3 for price_change (current + previous + one extra)
        # Fetch 30 min of 5m candles (6 candles)
        start_5m = now_ms - 30 * 60 * 1000
        candles_5m = provider.get_candles(coin, "5m", start_5m, now_ms)
    except Exception:
        logger.debug("Failed to fetch 5m candles for %s", coin)

    try:
        # 1m candles: need 60+ for realized vol (1 hour)
        # Fetch 70 minutes of 1m candles (buffer for forming candle)
        start_1m = now_ms - 70 * 60 * 1000
        candles_1m = provider.get_candles(coin, "1m", start_1m, now_ms)
    except Exception:
        logger.debug("Failed to fetch 1m candles for %s", coin)

    return candles_5m, candles_1m
```

### Step 1e: Update `satellite.tick()` to accept and pass candles

**File**: `satellite/__init__.py`

Update `tick()` to accept a `candles_map` parameter:

```python
def tick(
    snapshot: object,
    data_layer_db: object,
    heatmap_engine: object | None = None,
    order_flow_engine: object | None = None,
    store: "SatelliteStore | None" = None,
    config: "SatelliteConfig | None" = None,
    candles_map: dict[str, tuple[list, list]] | None = None,  # NEW: {coin: (candles_5m, candles_1m)}
) -> list["FeatureResult"]:
```

Pass candles through to `compute_features()`:

```python
for coin in cfg.coins:
    try:
        c5m, c1m = (candles_map or {}).get(coin, (None, None))
        result = compute_features(
            coin=coin,
            snapshot=snapshot,
            data_layer_db=data_layer_db,
            heatmap_engine=heatmap_engine,
            order_flow_engine=order_flow_engine,
            config=cfg,
            candles_5m=c5m,
            candles_1m=c1m,
        )
        # ... rest unchanged
```

### Step 1f: Update daemon's satellite.tick() call to pass candles

**File**: `src/hynous/intelligence/daemon.py`
**Location**: Around line 1179 (the existing `satellite.tick()` call)

Before the tick call, fetch candles for each configured coin:

```python
# Fetch candles for satellite features (price_change_5m, realized_vol_1h)
candles_map = {}
for coin in self._satellite_config.coins:
    try:
        c5m, c1m = self._fetch_satellite_candles(coin)
        candles_map[coin] = (c5m, c1m)
    except Exception:
        logger.debug("Candle fetch failed for %s", coin)

satellite.tick(
    snapshot=self.snapshot,
    data_layer_db=dl_db,
    heatmap_engine=heatmap_adapter,
    order_flow_engine=flow_adapter,
    store=self._satellite_store,
    config=self._satellite_config,
    candles_map=candles_map,  # NEW
)
```

**Rate limit awareness**: This adds 2 API calls per coin per 300s tick (6 total for BTC/ETH/SOL). Hyperliquid's candle endpoint is public and rate-generous — this is well within limits. If rate limits are hit, the calls fail gracefully (empty candle lists → features fall back to neutral with avail=0).

### Step 1g: Update `InferenceEngine.predict()` to accept candles

**CRITICAL**: `InferenceEngine.predict()` (`satellite/inference.py` line 107) calls `compute_features()` internally (line 132). Without this step, Task 1 only fixes the storage path (`satellite.tick()` → `compute_features()`), but live inference predictions still get `price_change_5m_avail=0` and `realized_vol_avail=0` — the model's top two SHAP features remain blind during actual predictions.

**File**: `satellite/inference.py`
**Location**: `predict()` method signature (line 107) and `compute_features()` call (line 132)

1. Add `candles_5m` and `candles_1m` parameters to `predict()`:

```python
def predict(
    self,
    coin: str,
    snapshot: object,
    data_layer_db: object,
    heatmap_engine: object | None = None,
    order_flow_engine: object | None = None,
    explain: bool = True,
    candles_5m: list[dict] | None = None,   # NEW
    candles_1m: list[dict] | None = None,   # NEW
) -> InferenceResult:
```

2. Pass candles through to `compute_features()` (line 132):

```python
        # 1. Compute features (SPEC-02 — single source of truth)
        feature_result = compute_features(
            coin=coin,
            snapshot=snapshot,
            data_layer_db=data_layer_db,
            heatmap_engine=heatmap_engine,
            order_flow_engine=order_flow_engine,
            candles_5m=candles_5m,     # NEW
            candles_1m=candles_1m,     # NEW
        )
```

Then in Task 3 (Step 3b), the `_run_satellite_inference()` method passes candles to `predict()`. See below — the candles_map is fetched once and shared between `tick()` and inference.

---

## 5. Task 2: Add `save_prediction()` to SatelliteStore

### Problem

The `predictions` table exists in the schema (`schema.py` lines 132-149) but `SatelliteStore` has no method to write to it.

### Solution

**File**: `satellite/store.py`
**Location**: After `save_snapshot()` method (after line 91)

Add this method:

```python
def save_prediction(
    self,
    predicted_at: float,
    coin: str,
    model_version: int,
    predicted_long_roe: float,
    predicted_short_roe: float,
    signal: str,
    entry_threshold: float,
    inference_time_ms: float = 0.0,
    snapshot_id: str | None = None,
    shap_top5_json: str | None = None,
) -> None:
    """Write a prediction to the predictions table.

    Args:
        predicted_at: Unix timestamp of prediction.
        coin: Coin symbol (BTC, ETH, SOL).
        model_version: Artifact version number.
        predicted_long_roe: Long prediction (%).
        predicted_short_roe: Short prediction (%).
        signal: Decision: "long", "short", "skip", "conflict".
        entry_threshold: Threshold used for decision.
        inference_time_ms: Inference duration (ms).
        snapshot_id: Link to feature snapshot (optional).
        shap_top5_json: JSON string of top 5 SHAP contributions (optional).
    """
    with self.write_lock:
        self._conn.execute(
            "INSERT INTO predictions "
            "(predicted_at, coin, model_version, predicted_long_roe, "
            "predicted_short_roe, signal, entry_threshold, inference_time_ms, "
            "snapshot_id, shap_top5_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                predicted_at, coin, model_version,
                predicted_long_roe, predicted_short_roe,
                signal, entry_threshold, inference_time_ms,
                snapshot_id, shap_top5_json,
            ),
        )
        self._conn.commit()
```

**Note**: Follow the existing `save_snapshot()` pattern — use `write_lock`, commit after insert.

---

## 6. Task 3: Wire Inference into the Daemon

This is the core integration. The daemon loads the model at startup and runs inference after every `satellite.tick()`.

### Step 3a: Add daemon instance variables

**File**: `src/hynous/intelligence/daemon.py`

**CRITICAL**: The new instance variables MUST be initialized **unconditionally** alongside the existing `self._satellite_store = None` (lines 407-409), NOT inside the `if config.satellite.enabled:` block. This is because `_wake_agent()` references `self._latest_predictions` on every wake regardless of satellite state. Placing them inside the conditional causes `AttributeError` when satellite is disabled.

**Location**: Lines 407-409 (the unconditional init block)

Add these three lines right after `self._satellite_dl_conn = None` (line 409):

```python
        self._satellite_store = None
        self._satellite_config = None
        self._satellite_dl_conn = None  # read-only conn to data-layer DB
        self._inference_engine = None              # NEW — unconditional
        self._kill_switch = None                   # NEW — unconditional
        self._latest_predictions: dict[str, dict] = {}  # NEW — unconditional
```

Then, inside the existing `if config.satellite.enabled:` try block (after line 446, where `logger.info("Satellite initialized: %s", sat_db)`), add only the model-loading logic:

```python
if self._satellite_store:
    try:
        from satellite.training.artifact import ModelArtifact
        from satellite.inference import InferenceEngine
        from satellite.safety import KillSwitch

        # Find latest artifact version
        artifacts_dir = config.project_root / "satellite" / "artifacts"
        if artifacts_dir.exists():
            versions = sorted(
                [d for d in artifacts_dir.iterdir()
                 if d.is_dir() and d.name.startswith("v")],
                key=lambda d: int(d.name.lstrip("v")),
            )
            if versions:
                latest = versions[-1]
                artifact = ModelArtifact.load(latest)

                # Read threshold from config (with default)
                threshold = getattr(
                    config.satellite, "inference_entry_threshold", 3.0
                )
                self._inference_engine = InferenceEngine(
                    artifact, entry_threshold=threshold,
                )

                # Kill switch — starts in shadow mode by default
                self._kill_switch = KillSwitch(
                    self._satellite_config.safety,
                    store=self._satellite_store,
                )

                # Apply shadow mode from config (Step 6c)
                shadow_mode = getattr(
                    config.satellite, "inference_shadow_mode", True
                )
                self._kill_switch._cfg.shadow_mode = shadow_mode

                logger.info(
                    "Satellite inference loaded: v%d (%d samples, threshold %.1f%%, shadow=%s)",
                    artifact.metadata.version,
                    artifact.metadata.training_samples,
                    threshold,
                    shadow_mode,
                )
            else:
                logger.info("No model artifacts found in %s", artifacts_dir)
        else:
            logger.info("Artifacts directory not found: %s", artifacts_dir)

    except Exception:
        logger.exception("Satellite inference init failed, continuing without ML")
        self._inference_engine = None
        self._kill_switch = None
```

### Step 3b: Add the `_run_satellite_inference()` method

**File**: `src/hynous/intelligence/daemon.py`
**Location**: After the `_record_historical_snapshots()` method (after line ~1220)

```python
def _run_satellite_inference(
    self,
    dl_db: object,
    heatmap_adapter: object | None,
    flow_adapter: object | None,
    candles_map: dict[str, tuple[list, list]] | None = None,
) -> None:
    """Run ML inference on all configured coins after satellite.tick().

    Stores predictions to satellite.db and caches them for briefing injection.
    Optionally wakes agent on strong signals (if not in shadow mode).
    """
    if not self._inference_engine or not self._satellite_store:
        return

    # Check kill switch
    if self._kill_switch and not self._kill_switch.is_active:
        logger.debug(
            "Satellite inference skipped: kill switch active (%s)",
            self._kill_switch.disable_reason,
        )
        return

    # Check staleness
    if self._kill_switch:
        self._kill_switch.check_staleness()
        if not self._kill_switch.is_active:
            return

    import json
    import time as _time

    shadow = self._kill_switch.is_shadow if self._kill_switch else True
    signals = []

    for coin in self._satellite_config.coins:
        try:
            c5m, c1m = (candles_map or {}).get(coin, (None, None))
            result = self._inference_engine.predict(
                coin=coin,
                snapshot=self.snapshot,
                data_layer_db=dl_db,
                heatmap_engine=heatmap_adapter,
                order_flow_engine=flow_adapter,
                explain=True,
                candles_5m=c5m,
                candles_1m=c1m,
            )

            # Build SHAP top 5 JSON for storage
            shap_json = None
            exp = (
                result.explanation_long
                if result.signal == "long"
                else result.explanation_short
            )
            if exp is None:
                exp = result.explanation_long  # fallback
            if exp and exp.top_contributors:
                shap_data = [
                    {"feature": name, "value": round(val, 4), "shap": round(shap_val, 4)}
                    for name, val, shap_val in exp.top_contributors[:5]
                ]
                shap_json = json.dumps(shap_data)

            # Save prediction to DB
            self._satellite_store.save_prediction(
                predicted_at=_time.time(),
                coin=coin,
                model_version=self._inference_engine._artifact.metadata.version,
                predicted_long_roe=result.predicted_long_roe,
                predicted_short_roe=result.predicted_short_roe,
                signal=result.signal,
                entry_threshold=self._inference_engine.entry_threshold,
                inference_time_ms=result.inference_time_ms,
                snapshot_id=None,  # Could link to latest snapshot if desired
                shap_top5_json=shap_json,
            )

            # Update kill switch snapshot time
            if self._kill_switch:
                self._kill_switch.record_snapshot_time(_time.time())

            # Cache for briefing injection
            self._latest_predictions[coin] = {
                "signal": result.signal,
                "long_roe": result.predicted_long_roe,
                "short_roe": result.predicted_short_roe,
                "confidence": result.confidence,
                "summary": result.summary,
                "inference_time_ms": result.inference_time_ms,
                "timestamp": _time.time(),
                "shadow": shadow,
            }

            # Collect actionable signals for potential wake
            if result.signal in ("long", "short"):
                signals.append(result)

            logger.debug(
                "ML inference %s: %s (long=%.1f%%, short=%.1f%%, %.1fms)%s",
                coin, result.signal,
                result.predicted_long_roe, result.predicted_short_roe,
                result.inference_time_ms,
                " [shadow]" if shadow else "",
            )

        except Exception:
            logger.debug("Inference failed for %s", coin, exc_info=True)

    # Wake agent on strong signals (only if NOT in shadow mode)
    if signals and not shadow:
        # Only wake if no position already open in the signaled direction
        wake_signals = []
        for sig in signals:
            coin = sig.coin
            existing = self._prev_positions.get(coin)
            if existing:
                # Already holding this coin — skip wake
                # (agent will see signal in next regular briefing)
                continue
            wake_signals.append(sig)

        if wake_signals:
            summary_parts = [s.summary for s in wake_signals[:3]]
            msg = (
                "[ML Signal]\n"
                + "\n".join(summary_parts)
                + "\n\nModel detected actionable signal. Evaluate and decide."
            )
            self._wake_agent(
                msg,
                source="daemon:ml_signal",
                max_tokens=1536,
                max_coach_cycles=0,
            )
```

### Step 3c: Call `_run_satellite_inference()` after tick

**File**: `src/hynous/intelligence/daemon.py`
**Location**: After the `satellite.tick()` call (line ~1188), within the same `if self._satellite_store:` block

Add this after the existing `satellite.tick()` call and within the same try/except:

```python
# Run ML inference on fresh features
try:
    self._run_satellite_inference(
        dl_db=dl_db,
        heatmap_adapter=heatmap_adapter,
        flow_adapter=flow_adapter,
        candles_map=candles_map,
    )
except Exception:
    logger.debug("Satellite inference failed", exc_info=True)
```

**IMPORTANT**: Reuse the same `dl_db`, `heatmap_adapter`, `flow_adapter`, and `candles_map` variables that were already constructed for the `satellite.tick()` call. Do not recreate them. The candles are fetched once and shared between `tick()` (stores features with live candle data) and inference (predicts with live candle data).

---

## 7. Task 4: Inject ML Signals into Agent Briefing

### Step 4a: Add ML section to `build_briefing()`

**File**: `src/hynous/intelligence/briefing.py`
**Location**: After the regime classification section (line 326) and before the per-asset deep data section (line 328)

Add a new parameter and section:

1. Add `ml_predictions` parameter to `build_briefing()`:

```python
def build_briefing(
    data_cache: DataCache,
    snapshot,
    provider,
    daemon,
    config,
    user_state: dict | None = None,
    ml_predictions: dict[str, dict] | None = None,  # NEW
) -> str:
```

2. Add ML section after regime (after line 326):

```python
    # --- ML Signals (satellite inference) ---
    if ml_predictions:
        ml_section = _build_ml_section(ml_predictions)
        if ml_section:
            sections.append(ml_section)
```

3. Add the `_build_ml_section()` helper function (place near other `_build_*` helpers):

```python
def _build_ml_section(predictions: dict[str, dict]) -> str:
    """Format ML prediction signals for briefing injection.

    Args:
        predictions: {coin: {signal, long_roe, short_roe, confidence, shadow, timestamp, ...}}
    """
    if not predictions:
        return ""

    now = time.time()
    lines = ["ML Signals:"]

    for coin, pred in sorted(predictions.items()):
        age_s = now - pred.get("timestamp", 0)
        if age_s > 600:  # Skip predictions older than 10 minutes
            continue

        signal = pred.get("signal", "skip")
        long_roe = pred.get("long_roe", 0)
        short_roe = pred.get("short_roe", 0)
        shadow = pred.get("shadow", True)
        mode = " [shadow]" if shadow else ""

        if signal in ("long", "short"):
            roe = long_roe if signal == "long" else short_roe
            lines.append(
                f"  {coin}: {signal.upper()} (predicted {roe:+.1f}% ROE){mode}"
            )
        elif signal == "conflict":
            lines.append(
                f"  {coin}: CONFLICT (long {long_roe:+.1f}%, short {short_roe:+.1f}%){mode}"
            )
        else:
            lines.append(
                f"  {coin}: skip (long {long_roe:+.1f}%, short {short_roe:+.1f}%){mode}"
            )

    if len(lines) == 1:  # Only header, no data
        return ""

    return "\n".join(lines)
```

### Step 4b: Add ML questions to `build_code_questions()`

**File**: `src/hynous/intelligence/briefing.py`
**Location**: After the F&G check (line 858), before `return questions[:4]` (line 861)

Add a new parameter and ML signal questions:

1. Add `ml_predictions` parameter to `build_code_questions()`:

```python
def build_code_questions(
    data_cache: DataCache,
    snapshot,
    positions: list[dict],
    config,
    daemon=None,
    ml_predictions: dict[str, dict] | None = None,  # NEW
) -> list[str]:
```

2. Add ML signal questions (after F&G, before cap):

```python
    # 7. ML model signals
    if ml_predictions:
        for sym, pred in ml_predictions.items():
            signal = pred.get("signal", "skip")
            if signal not in ("long", "short"):
                continue
            age = time.time() - pred.get("timestamp", 0)
            if age > 600:
                continue

            roe = pred.get("long_roe", 0) if signal == "long" else pred.get("short_roe", 0)
            shadow_tag = " (shadow mode)" if pred.get("shadow") else ""

            if sym in position_coins:
                # Has a position — check if signal agrees
                for p in positions:
                    if p["coin"] == sym:
                        pos_side = p["side"].lower()
                        if pos_side != signal:
                            questions.append(
                                f"ML model signals {signal.upper()} {sym} "
                                f"({roe:+.1f}% ROE) but you're {pos_side.upper()} "
                                f"— re-evaluate or hedge?{shadow_tag}"
                            )
                        break
            else:
                # No position — flag opportunity
                questions.append(
                    f"ML signals {signal.upper()} {sym} "
                    f"(predicted {roe:+.1f}% ROE) — thesis?{shadow_tag}"
                )

    # Cap at 4 questions
    return questions[:4]
```

### Step 4c: Pass predictions through daemon's `_wake_agent()` to briefing

**File**: `src/hynous/intelligence/daemon.py`
**Location**: In `_wake_agent()`, where `build_briefing()` is called (around line 4162)

Pass `self._latest_predictions` to both `build_briefing()` and `build_code_questions()`:

```python
briefing_text = build_briefing(
    self._data_cache, self.snapshot, provider, self,
    self.config, user_state=user_state,
    ml_predictions=self._latest_predictions,   # NEW
)
```

And for `build_code_questions()` (around line 4173):

```python
code_questions = build_code_questions(
    self._data_cache, self.snapshot, positions,
    self.config, daemon=self,
    ml_predictions=self._latest_predictions,   # NEW
)
```

---

## 8. Task 5: Fix Dashboard Prediction Query Bug

### Problem

**File**: `dashboard/dashboard/dashboard.py`
**Line**: 592

The SQL query uses `ORDER BY created_at DESC` but the predictions table column is `predicted_at`, not `created_at`. This will cause a "no such column" error when predictions exist.

### Fix

Change line 592 from:
```python
"SELECT * FROM predictions WHERE coin = ? ORDER BY created_at DESC LIMIT 1",
```
To:
```python
"SELECT * FROM predictions WHERE coin = ? ORDER BY predicted_at DESC LIMIT 1",
```

---

## 9. Task 6: Add Inference Config Fields

### Step 6a: Update `config/default.yaml`

**File**: `config/default.yaml`
**Location**: Inside the `satellite:` section (after line 143)

Add these fields:

```yaml
  # Inference (SPEC-05)
  inference_entry_threshold: 3.0         # Min predicted ROE (%) to generate entry signal
  inference_conflict_margin: 1.0         # Both sides must differ by this to avoid "conflict"
  inference_shadow_mode: true            # Shadow mode: predict but don't execute trades
```

### Step 6b: Update `src/hynous/core/config.py`

Find the `SatelliteConfig` dataclass in `config.py` and add matching fields:

```python
# Inference (SPEC-05)
inference_entry_threshold: float = 3.0
inference_conflict_margin: float = 1.0
inference_shadow_mode: bool = True
```

**IMPORTANT**: Config dataclass defaults must match YAML values (project convention from CLAUDE.md).

### Step 6c: Update satellite `SafetyConfig` defaults

**File**: `satellite/config.py`

The `SafetyConfig` dataclass (imported from `satellite/safety.py`) already has `shadow_mode: bool = False`. The daemon should read the config value and set it:

In daemon init (Step 3a), after creating the KillSwitch:

```python
# Apply shadow mode from config
shadow_mode = getattr(config.satellite, "inference_shadow_mode", True)
self._kill_switch._cfg.shadow_mode = shadow_mode
```

---

## 10. Static Analysis Checklist

After implementing all tasks, verify the following. Run each check and confirm it passes.

### 10.1 Import Verification

```bash
# Verify all new imports resolve
cd /path/to/hynous
PYTHONPATH=src python -c "
from satellite.features import compute_features, FEATURE_NAMES, AVAIL_COLUMNS
from satellite.inference import InferenceEngine, InferenceResult
from satellite.safety import KillSwitch, SafetyConfig
from satellite.training.artifact import ModelArtifact
from satellite.store import SatelliteStore
print('All satellite imports OK')
"
```

### 10.2 Feature Hash Consistency

```bash
# Verify model artifact loads without feature hash mismatch
PYTHONPATH=. python -c "
from satellite.training.artifact import ModelArtifact
a = ModelArtifact.load('satellite/artifacts/v1')
print(f'Model v{a.metadata.version} loaded, {a.metadata.training_samples} samples')
print(f'Feature hash: {a.metadata.feature_hash}')
"
```

### 10.3 Signature Compatibility

Verify these function signatures are backward-compatible (all new parameters are optional with defaults):

- `compute_features()` — new params `candles_5m=None`, `candles_1m=None`
- `tick()` — new param `candles_map=None`
- `build_briefing()` — new param `ml_predictions=None`
- `build_code_questions()` — new param `ml_predictions=None`

```bash
# Verify tick() still works without candles (backward compat)
PYTHONPATH=. python -c "
from satellite import tick
# tick() should accept no candles_map (default None)
import inspect
sig = inspect.signature(tick)
assert 'candles_map' in sig.parameters
assert sig.parameters['candles_map'].default is None
print('tick() signature OK')
"
```

### 10.4 Store Method Verification

```bash
# Verify save_prediction method exists and has correct signature
PYTHONPATH=. python -c "
from satellite.store import SatelliteStore
import inspect
assert hasattr(SatelliteStore, 'save_prediction'), 'save_prediction missing!'
sig = inspect.signature(SatelliteStore.save_prediction)
required = ['predicted_at', 'coin', 'model_version', 'predicted_long_roe',
            'predicted_short_roe', 'signal', 'entry_threshold']
for p in required:
    assert p in sig.parameters, f'{p} missing from save_prediction'
print('save_prediction signature OK')
"
```

### 10.5 Config Consistency

```bash
# Verify YAML and dataclass defaults match
PYTHONPATH=src python -c "
from hynous.core.config import load_config
c = load_config()
assert hasattr(c.satellite, 'inference_entry_threshold'), 'Missing inference_entry_threshold'
assert hasattr(c.satellite, 'inference_shadow_mode'), 'Missing inference_shadow_mode'
print(f'inference_entry_threshold: {c.satellite.inference_entry_threshold}')
print(f'inference_shadow_mode: {c.satellite.inference_shadow_mode}')
print('Config OK')
"
```

### 10.6 Dashboard SQL Fix

```bash
# Verify the SQL in dashboard uses predicted_at, not created_at
grep -n "created_at" dashboard/dashboard/dashboard.py | grep -i predict
# Should return NO matches in the predictions query context
```

### 10.7 Test Suites

```bash
# Run satellite tests (should all pass)
PYTHONPATH=. pytest satellite/tests/ -v

# Run main tests (should not regress)
PYTHONPATH=src pytest tests/ -v

# Run data-layer tests (should not regress)
cd data-layer && pytest tests/ -v
```

---

## 11. Dynamic Verification

### 11.1 Prerequisites

Before testing, ensure all services can start:

```bash
# 1. Nous server (memory system)
cd nous-server && pnpm --filter server start
# Should bind to :3100

# 2. Data layer (market data)
cd data-layer && make run
# Should bind to :8100

# 3. Have a .env with required keys:
#    OPENROUTER_API_KEY, HYPERLIQUID_PRIVATE_KEY (for paper mode)
```

### 11.2 Satellite Feature Test (Candle Gap Fix)

```bash
# Verify candle-based features now compute in live mode
PYTHONPATH=. python -c "
import time
from satellite.features import compute_features
from satellite.config import SatelliteConfig

# Create a minimal mock snapshot
class MockSnapshot:
    prices = {'BTC': 90000.0}
    funding = {'BTC': 0.0001}
    oi_usd = {'BTC': 5000000000.0}
    volume_usd = {'BTC': 1000000.0}

# Simulate 5m candles (3 candles)
now_ms = int(time.time() * 1000)
candles_5m = [
    {'t': now_ms - 600000, 'o': 89800, 'h': 89900, 'l': 89700, 'c': 89850, 'v': 100},
    {'t': now_ms - 300000, 'o': 89850, 'h': 89950, 'l': 89800, 'c': 89900, 'v': 110},
    {'t': now_ms,          'o': 89900, 'h': 90100, 'l': 89850, 'c': 90000, 'v': 120},
]

# Simulate 1m candles (15 candles for test)
candles_1m = []
base = 89800
for i in range(15):
    px = base + i * 10 + (i % 3) * 5
    candles_1m.append({
        't': now_ms - (15 - i) * 60000,
        'o': px, 'h': px + 5, 'l': px - 5, 'c': px + 2, 'v': 50,
    })

result = compute_features(
    coin='BTC',
    snapshot=MockSnapshot(),
    data_layer_db=None,
    config=SatelliteConfig(),
    candles_5m=candles_5m,
    candles_1m=candles_1m,
)

# Check that features are now available
pc = result.features.get('price_change_5m_pct')
rv = result.features.get('realized_vol_1h')
pc_avail = result.availability.get('price_change_5m_avail')
rv_avail = result.availability.get('realized_vol_avail')

print(f'price_change_5m_pct: {pc:.4f} (avail={pc_avail})')
print(f'realized_vol_1h: {rv:.4f} (avail={rv_avail})')

# Without candles, should still fall back to neutral
result2 = compute_features(
    coin='BTC', snapshot=MockSnapshot(),
    data_layer_db=None, config=SatelliteConfig(),
)
assert result2.availability.get('price_change_5m_avail') == 0, 'Should be unavailable without candles'
assert result2.availability.get('realized_vol_avail') == 0, 'Should be unavailable without candles'
print('Backward compatibility OK — neutral fallback works')
"
```

### 11.3 Inference Pipeline Test

```bash
# Verify full inference pipeline works end-to-end
PYTHONPATH=. python -c "
from satellite.training.artifact import ModelArtifact
from satellite.inference import InferenceEngine
from satellite.features import compute_features
from satellite.config import SatelliteConfig
import time

# Load model
artifact = ModelArtifact.load('satellite/artifacts/v1')
engine = InferenceEngine(artifact, entry_threshold=3.0)

class MockSnapshot:
    prices = {'BTC': 90000.0}
    funding = {'BTC': 0.0001}
    oi_usd = {'BTC': 5000000000.0}
    volume_usd = {'BTC': 1000000.0}

# Run prediction (without full data — features will use neutrals)
result = engine.predict(
    coin='BTC',
    snapshot=MockSnapshot(),
    data_layer_db=None,
    explain=True,
)

print(f'Signal: {result.signal}')
print(f'Long ROE: {result.predicted_long_roe:+.2f}%')
print(f'Short ROE: {result.predicted_short_roe:+.2f}%')
print(f'Confidence: {result.confidence:.2f}')
print(f'Inference time: {result.inference_time_ms:.1f}ms')
if result.explanation_long:
    print(f'SHAP (long): {result.explanation_long.summary}')
print('Inference pipeline OK')
"
```

### 11.4 Store Prediction Test

```bash
# Verify predictions can be saved and queried
PYTHONPATH=. python -c "
import time, json, tempfile, os
from satellite.store import SatelliteStore

# Use temp DB
db_path = tempfile.mktemp(suffix='.db')
store = SatelliteStore(db_path)
store.connect()

# Save a prediction
store.save_prediction(
    predicted_at=time.time(),
    coin='BTC',
    model_version=1,
    predicted_long_roe=4.5,
    predicted_short_roe=-1.2,
    signal='long',
    entry_threshold=3.0,
    inference_time_ms=0.8,
    shap_top5_json=json.dumps([{'feature': 'realized_vol_1h', 'value': 0.5, 'shap': 1.2}]),
)

# Query it back
row = store.conn.execute(
    'SELECT * FROM predictions WHERE coin = ? ORDER BY predicted_at DESC LIMIT 1',
    ('BTC',),
).fetchone()

assert row is not None, 'Prediction not found!'
assert dict(row)['signal'] == 'long'
assert dict(row)['predicted_long_roe'] == 4.5
print(f'Saved and retrieved prediction: {dict(row)[\"signal\"]} (long={dict(row)[\"predicted_long_roe\"]}%)')

store.close()
os.unlink(db_path)
print('Store prediction OK')
"
```

### 11.5 Full System Live Test

This is the final verification — run the entire system and confirm predictions flow end-to-end.

```bash
# 1. Ensure config/default.yaml has:
#    satellite.enabled: true
#    satellite.inference_shadow_mode: true  (safety first)

# 2. Start all services:
#    Terminal 1: cd nous-server && pnpm --filter server start
#    Terminal 2: cd data-layer && make run
#    Terminal 3: cd dashboard && reflex run

# 3. Wait for daemon to complete one derivatives poll cycle (~300s)
#    Watch logs for these lines:
#      "Satellite initialized: storage/satellite.db"
#      "Satellite inference loaded: v1 (141739 samples, threshold 3.0%)"
#      "ML inference BTC: skip (long=X.X%, short=X.X%, Y.Yms) [shadow]"

# 4. Check dashboard ML page:
#    - Navigate to /ml
#    - Predictions panel should show latest prediction
#    - Prediction history should populate

# 5. Verify predictions in database:
PYTHONPATH=. python -c "
import sqlite3
conn = sqlite3.connect('storage/satellite.db')
conn.row_factory = sqlite3.Row
rows = conn.execute('SELECT * FROM predictions ORDER BY predicted_at DESC LIMIT 5').fetchall()
for r in rows:
    d = dict(r)
    print(f'{d[\"coin\"]}: {d[\"signal\"]} (long={d[\"predicted_long_roe\"]:+.1f}%, short={d[\"predicted_short_roe\"]:+.1f}%)')
conn.close()
"

# 6. Verify briefing injection:
#    Trigger a manual daemon wake (via chat: ask Hynous to review the market)
#    The [Briefing] block should include an "ML Signals:" section
#    with predictions for BTC, ETH, SOL
```

---

## 12. File Change Summary

| # | File | Action | What Changes |
|---|------|--------|-------------|
| 1 | `satellite/features.py` | MODIFY | Add `candles_5m`, `candles_1m` params to `compute_features()`. Replace stubs for `_compute_price_change()` and `_compute_realized_vol()` with real implementations. |
| 2 | `satellite/__init__.py` | MODIFY | Add `candles_map` param to `tick()`, pass through to `compute_features()`. |
| 3 | `satellite/store.py` | MODIFY | Add `save_prediction()` method. |
| 4 | `satellite/config.py` | NO CHANGE | SafetyConfig already has all needed fields. |
| 5 | `src/hynous/intelligence/daemon.py` | MODIFY | Add `_fetch_satellite_candles()`, inference engine init, `_run_satellite_inference()`, pass candles to tick(), pass predictions to briefing. |
| 6 | `src/hynous/intelligence/briefing.py` | MODIFY | Add `ml_predictions` param to `build_briefing()` and `build_code_questions()`. Add `_build_ml_section()` helper. Add ML signal questions. |
| 7 | `src/hynous/core/config.py` | MODIFY | Add inference fields to SatelliteConfig dataclass. |
| 8 | `config/default.yaml` | MODIFY | Add inference config fields under `satellite:`. |
| 9 | `dashboard/dashboard/dashboard.py` | MODIFY | Fix `created_at` → `predicted_at` in predictions query (line 592). |
| 10 | `satellite/inference.py` | MODIFY | Add `candles_5m`, `candles_1m` params to `predict()`, pass through to `compute_features()`. Without this, live inference misses the top 2 SHAP features. |

### Files NOT Modified (by design)
- `satellite/safety.py` — Already complete, no changes needed
- `satellite/training/artifact.py` — Already complete, no changes needed
- `satellite/normalize.py` — Already complete, no changes needed
- `satellite/training/explain.py` — Already complete, no changes needed
- `satellite/schema.py` — Predictions table already defined

---

## Execution Order

Implement tasks in this order to minimize risk and allow incremental testing:

1. **Task 6** (Config) — Add YAML + dataclass fields first (no behavior change)
2. **Task 5** (Dashboard bug) — One-line fix, independent
3. **Task 2** (save_prediction) — Add store method, independent
4. **Task 1** (Candle gap fix) — Feature computation changes, testable in isolation
5. **Task 3** (Daemon inference wiring) — Core integration, depends on Tasks 1-3 and 6
6. **Task 4** (Briefing injection) — UI-facing, depends on Task 3

After each task, run the relevant static analysis check from Section 10 before proceeding.

---

*Last updated: 2026-03-05*
