"""Tick-level direction model inference engine.

Loads trained XGBoost models from artifacts/tick_models/ and runs
inference on the latest tick_snapshots row from satellite.db.

Designed to run inside the daemon's satellite tick cycle (every 300s)
or more frequently if needed. Inference is ~1ms per model.

Usage:
    engine = TickInferenceEngine(artifacts_dir, db_path)
    result = engine.predict("BTC")
    # result.signal = "long" / "short" / "skip"
    # result.predictions = {horizon: predicted_return_bps}
"""

import hashlib
import json
import logging
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import xgboost as xgb

log = logging.getLogger(__name__)

# Canonical source: satellite/tick_features.py
from satellite.tick_features import TICK_FEATURE_NAMES as BASE_TICK_FEATURES, ROLLING_FEATURES

# Model features = base + rolling, minus mid_price (used for labels, not prediction)
CODE_MODEL_FEATURES = [f for f in BASE_TICK_FEATURES + ROLLING_FEATURES if f != "mid_price"]
CODE_FEATURE_HASH = hashlib.sha256("|".join(CODE_MODEL_FEATURES).encode()).hexdigest()[:16]

# Minimum basis points to call a direction (below this = "skip")
DIRECTION_THRESHOLD_BPS = 0.5

# Max age of tick data before we refuse to predict (seconds)
MAX_TICK_AGE = 30


@dataclass
class TickPrediction:
    """Result from tick inference engine."""
    coin: str
    signal: str                          # "long", "short", "skip"
    predictions: dict[str, float]        # {horizon_name: predicted_return_bps}
    best_horizon: str                    # horizon with highest abs prediction
    predicted_return_bps: float          # predicted return at best horizon
    confidence: float                    # abs(predicted_return_bps)
    tick_age_s: float                    # age of the tick data used
    inference_time_ms: float
    timestamp: float


@dataclass
class _TickModel:
    """One loaded tick model."""
    name: str
    horizon_seconds: int
    booster: xgb.Booster
    feature_names: list[str]
    feature_hash: str
    percentiles: dict[str, float]
    metadata: dict


class TickInferenceEngine:
    """Loads and runs tick direction models.

    Reads latest tick_snapshots from satellite.db, computes rolling
    aggregate features, runs all loaded models, and returns a combined
    direction signal.
    """

    def __init__(self, artifacts_dir: str | Path, db_path: str | Path):
        self._artifacts_dir = Path(artifacts_dir)
        self._db_path = Path(db_path)
        self._models: dict[str, _TickModel] = {}
        self._db_conn: sqlite3.Connection | None = None
        self._load_models()

    def _load_models(self):
        """Scan artifacts directory and load all tick models."""
        if not self._artifacts_dir.exists():
            log.warning("Tick artifacts dir not found: %s", self._artifacts_dir)
            return

        for model_dir in sorted(self._artifacts_dir.iterdir()):
            if not model_dir.is_dir():
                continue
            model_path = model_dir / "model.json"
            meta_path = model_dir / "metadata.json"
            if not model_path.exists() or not meta_path.exists():
                continue

            try:
                with open(meta_path) as f:
                    meta = json.load(f)

                booster = xgb.Booster()
                booster.load_model(str(model_path))

                self._models[meta["name"]] = _TickModel(
                    name=meta["name"],
                    horizon_seconds=meta["horizon_seconds"],
                    booster=booster,
                    feature_names=meta["feature_names"],
                    feature_hash=meta["feature_hash"],
                    percentiles=meta.get("percentiles", {}),
                    metadata=meta,
                )
                log.info("Loaded tick model: %s (%ds horizon, sp=%.4f)",
                         meta["name"], meta["horizon_seconds"],
                         meta.get("validation_spearman", 0))
            except Exception:
                log.warning("Failed to load tick model from %s", model_dir, exc_info=True)

        if self._models:
            log.info("TickInferenceEngine: %d models loaded", len(self._models))
        else:
            log.warning("TickInferenceEngine: no models loaded from %s", self._artifacts_dir)

    @property
    def is_ready(self) -> bool:
        return len(self._models) > 0

    @property
    def model_names(self) -> list[str]:
        return list(self._models.keys())

    def predict(self, coin: str = "BTC") -> TickPrediction | None:
        """Run all tick models on the latest tick data for a coin.

        Returns None if no models loaded or tick data is stale/unavailable.
        """
        if not self._models:
            return None

        t0 = time.time()

        # Get latest tick features from satellite.db
        features, tick_ts = self._get_latest_tick_features(coin)
        if features is None:
            return None

        tick_age = t0 - tick_ts
        if tick_age > MAX_TICK_AGE:
            log.debug("Tick data too stale (%.1fs old), skipping inference", tick_age)
            return None

        # Run each model
        predictions: dict[str, float] = {}
        for name, model in self._models.items():
            try:
                # Build feature vector in model's expected order
                fv = self._build_feature_vector(features, model.feature_names)
                if fv is None:
                    continue

                # Verify CODE feature list matches what the model was trained on.
                # This catches drift between inference code and model artifacts.
                if CODE_FEATURE_HASH != model.feature_hash:
                    log.warning(
                        "Feature hash mismatch for %s: code=%s model=%s — skipping",
                        name, CODE_FEATURE_HASH, model.feature_hash,
                    )
                    continue

                dmat = xgb.DMatrix(
                    fv.reshape(1, -1),
                    feature_names=model.feature_names,
                )
                pred_bps = float(model.booster.predict(dmat)[0])
                predictions[name] = pred_bps
            except Exception:
                log.debug("Inference failed for %s", name, exc_info=True)

        if not predictions:
            return None

        # Determine direction from the consensus of models
        # Weight shorter horizons more (they're more accurate)
        signal, best_horizon, best_return = self._resolve_signal(predictions)

        elapsed_ms = (time.time() - t0) * 1000

        return TickPrediction(
            coin=coin,
            signal=signal,
            predictions=predictions,
            best_horizon=best_horizon,
            predicted_return_bps=best_return,
            confidence=abs(best_return),
            tick_age_s=round(tick_age, 1),
            inference_time_ms=round(elapsed_ms, 2),
            timestamp=t0,
        )

    def _get_latest_tick_features(self, coin: str) -> tuple[dict | None, float]:
        """Read latest tick_snapshots row + compute rolling features."""
        try:
            if not self._db_conn:
                self._db_conn = sqlite3.connect(
                    str(self._db_path), check_same_thread=False, timeout=5,
                )
                self._db_conn.row_factory = sqlite3.Row

            # Get enough rows to fill the 60s slope window after downsampling to 5s
            # 120 raw 1s rows → ~24 downsampled 5s ticks (w60=12 needs 12 minimum)
            rows = self._db_conn.execute(
                """
                SELECT * FROM tick_snapshots
                WHERE coin = ? AND schema_version = 2
                ORDER BY timestamp DESC LIMIT 120
                """,
                (coin,),
            ).fetchall()

            if not rows:
                return None, 0.0

            # Reverse to chronological order
            rows = list(reversed(rows))
            tick_ts = rows[-1]["timestamp"]  # freshest timestamp for staleness check

            # Downsample to 5s resolution — MUST match training resolution.
            # Training uses DOWNSAMPLE_INTERVAL=5, so rolling windows are
            # computed over 5s-spaced ticks. Without this, slopes are ~5x too
            # small and means/stds differ systematically.
            ds_rows = [rows[0]]
            last_t = rows[0]["timestamp"]
            for r in rows[1:]:
                if r["timestamp"] - last_t >= 4.5:
                    ds_rows.append(r)
                    last_t = r["timestamp"]

            # Build base features from latest DOWNSAMPLED row (matches training:
            # train_tick_direction.py builds base_matrix from downsampled rows)
            features = {f: (ds_rows[-1][f] or 0.0) for f in BASE_TICK_FEATURES}

            # Rolling features at TRAINING resolution (5s ticks).
            # Window sizes match train_tick_direction.py:
            #   w5  = 5 // 5  = 1 tick   (= just the latest value)
            #   w10 = 10 // 5 = 2 ticks
            #   w30 = 30 // 5 = 6 ticks
            #   w60 = 60 // 5 = 12 ticks
            if len(ds_rows) >= 2:
                def _col(name):
                    return [r.get(name) or 0.0 for r in ds_rows]

                book_imb = _col("book_imbalance_5")
                flow_imb = _col("flow_imbalance_10s")
                price_chg = _col("price_change_10s")
                mid = _col("mid_price")
                n = len(ds_rows)

                # w5=1: mean5 = just the latest value (matches training where
                # _rolling_mean with window=1 returns x.copy())
                features["book_imbalance_5_mean5"] = book_imb[-1]
                features["flow_imbalance_10s_mean5"] = flow_imb[-1]
                features["price_change_10s_mean5"] = price_chg[-1]

                # w10=2
                w10 = min(2, n)
                features["book_imbalance_5_mean10"] = float(np.mean(book_imb[-w10:]))
                features["flow_imbalance_10s_mean10"] = float(np.mean(flow_imb[-w10:]))

                # w30=6: std of last 6 downsampled ticks
                # Training's _rolling_std requires >= 3 elements (guard: i - start < 2)
                w30 = min(6, n)
                if w30 >= 3:
                    features["book_imbalance_5_std30"] = float(np.std(book_imb[-w30:]))
                    features["flow_imbalance_10s_std30"] = float(np.std(flow_imb[-w30:]))
                    features["price_change_10s_std30"] = float(np.std(price_chg[-w30:]))
                else:
                    features["book_imbalance_5_std30"] = 0.0
                    features["flow_imbalance_10s_std30"] = 0.0
                    features["price_change_10s_std30"] = 0.0

                # w60=12 — OLS slope over 12 downsampled ticks
                w60 = min(12, n)
                for arr, slope_name in [
                    (book_imb, "book_imbalance_5_slope60"),
                    (flow_imb, "flow_imbalance_10s_slope60"),
                    (mid, "mid_price_slope60"),
                ]:
                    seg = np.array(arr[-w60:], dtype=np.float32)
                    if len(seg) >= 3:
                        t = np.arange(len(seg), dtype=np.float32)
                        t_m, y_m = t.mean(), seg.mean()
                        cov = np.sum((t - t_m) * (seg - y_m))
                        var = np.sum((t - t_m) ** 2)
                        features[slope_name] = float(cov / var) if var > 0 else 0.0
                    else:
                        features[slope_name] = 0.0
            else:
                ROLLING = [
                    "book_imbalance_5_mean5", "flow_imbalance_10s_mean5", "price_change_10s_mean5",
                    "book_imbalance_5_mean10", "flow_imbalance_10s_mean10",
                    "book_imbalance_5_std30", "flow_imbalance_10s_std30", "price_change_10s_std30",
                    "book_imbalance_5_slope60", "flow_imbalance_10s_slope60", "mid_price_slope60",
                ]
                for rf in ROLLING:
                    features.setdefault(rf, 0.0)

            # ── Feature quality check ──────────────────────────────
            # Most base features are non-zero in steady-state (book_imbalance
            # defaults to 0.5, mid_price is always positive). A high zero count
            # means missing or corrupt data — skip instead of predicting on garbage.
            _zero_count = sum(1 for f in BASE_TICK_FEATURES if features.get(f, 0.0) == 0.0)
            if _zero_count >= 10:
                log.warning(
                    "Tick features for %s: %d/%d base features are 0.0 — likely corrupt, skipping",
                    coin, _zero_count, len(BASE_TICK_FEATURES),
                )
                return None, 0.0

            return features, tick_ts

        except Exception:
            log.debug("Failed to read tick features", exc_info=True)
            return None, 0.0

    def _build_feature_vector(self, features: dict, model_features: list[str]) -> np.ndarray | None:
        """Extract features in model's expected order."""
        try:
            return np.array(
                [features.get(f, 0.0) for f in model_features],
                dtype=np.float32,
            )
        except Exception:
            return None

    def _resolve_signal(
        self, predictions: dict[str, float],
    ) -> tuple[str, str, float]:
        """Combine multi-horizon predictions into a single direction signal.

        Strategy: weighted vote. Shorter horizons get more weight (higher accuracy).
        Weight = 1 / horizon_seconds (so 10s model has 18x weight of 180s model).

        Returns: (signal, best_horizon_name, weighted_return_bps)
        """
        weighted_sum = 0.0
        total_weight = 0.0
        best_abs = 0.0
        best_name = ""

        for name, pred_bps in predictions.items():
            model = self._models.get(name)
            if not model:
                continue
            weight = 1.0 / model.horizon_seconds
            weighted_sum += pred_bps * weight
            total_weight += weight

            if abs(pred_bps) > best_abs:
                best_abs = abs(pred_bps)
                best_name = name

        if total_weight == 0:
            return "skip", "", 0.0

        weighted_return = weighted_sum / total_weight

        if weighted_return > DIRECTION_THRESHOLD_BPS:
            signal = "long"
        elif weighted_return < -DIRECTION_THRESHOLD_BPS:
            signal = "short"
        else:
            signal = "skip"

        return signal, best_name, round(weighted_return, 3)

    def get_status(self) -> dict:
        return {
            "models_loaded": len(self._models),
            "model_names": list(self._models.keys()),
            "artifacts_dir": str(self._artifacts_dir),
        }
