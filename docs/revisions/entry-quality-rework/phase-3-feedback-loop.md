# Phase 3: Entry-Outcome Feedback Loop

> **Status:** Blocked on Phase 2
> **Depends on:** Phase 2 deployed (composite entry score generating values)
> **Can run in parallel with:** Phase 4
> **Scope:** Log entry conditions at trade time, compute rolling signal quality, auto-adjust weights.

---

## Required Reading

### Storage Patterns
- **`satellite/store.py`** — `write_lock` pattern (lines 37-56): `threading.Lock()`, all mutations under `with self.write_lock:`, WAL mode. Study `save_snapshot()` (lines 63-91) and `save_condition_predictions()` (lines 274-300) for the exact INSERT pattern.
- **`satellite/schema.py`** — Table definitions and migration pattern: idempotent `ALTER TABLE ADD COLUMN` in `try/except pass` blocks (lines 202-209, 235-241). New tables use `CREATE TABLE IF NOT EXISTS`.

### Trade Execution Flow (where to hook entry logging)
- **`src/hynous/intelligence/tools/trading.py`** — After successful order fill, the trade memory is stored via `_store_trade_memory()` (around line 1177). The entry snapshot logging hooks in at the same location, after the fill is confirmed but before the response is returned. Study the `snapshot_id` used for trade_entry nodes.

### Trade Close Detection (where to hook outcome backfill)
- **`src/hynous/intelligence/daemon.py`** — Fill detection happens in `_check_triggers()` within `_fast_trigger_check()` (around line 2085) and `_check_positions()` (around line 1874). When a close is detected, `_wake_for_fill()` is called (lines 4125-4241). The exit classification (`_override_sl_classification()`) determines the close reason. Study the flow to find where `roe_pct` and `pnl_usd` are computed for the closed position.

### Atomic Write Pattern
- **`src/hynous/intelligence/daemon.py`** — `_persist_mechanical_state()` (lines 4561-4581): imports `_atomic_write` from `core.persistence`, writes JSON to `storage/` directory. Follow this pattern for weight persistence.

### Composite Score (input)
- **`satellite/entry_score.py`** (created in Phase 2) — `EntryScoreConfig.weights` dict is what gets adjusted by the feedback loop.

---

## Step 3.1: Create entry_snapshots Table

**File:** `satellite/schema.py`

**Location:** In the `SCHEMA` string or in `run_migrations()`, add after the existing `condition_predictions` table:

```python
    # Entry-outcome feedback loop (Phase 3)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS entry_snapshots (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            trade_id            TEXT NOT NULL,
            coin                TEXT NOT NULL,
            side                TEXT NOT NULL,
            entry_time          REAL NOT NULL,
            composite_score     REAL NOT NULL,
            vol_1h_regime       TEXT,
            vol_1h_pctl         INTEGER,
            entry_quality_pctl  INTEGER,
            funding_4h_pctl     INTEGER,
            volume_1h_regime    TEXT,
            mae_long_pctl       INTEGER,
            mae_short_pctl      INTEGER,
            direction_signal    TEXT,
            direction_long_roe  REAL,
            direction_short_roe REAL,
            score_components    TEXT,
            outcome_roe         REAL,
            outcome_pnl_usd     REAL,
            outcome_won         INTEGER,
            close_time          REAL,
            close_reason        TEXT
        )
    """)
    for idx in [
        "CREATE INDEX IF NOT EXISTS idx_es_coin ON entry_snapshots(coin)",
        "CREATE INDEX IF NOT EXISTS idx_es_time ON entry_snapshots(entry_time)",
        "CREATE INDEX IF NOT EXISTS idx_es_outcome ON entry_snapshots(outcome_won)",
    ]:
        conn.execute(idx)
```

Follow the same `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` pattern used throughout schema.py.

---

## Step 3.2: Log Entry Snapshot on Trade Fill

**File:** `src/hynous/intelligence/tools/trading.py`

**Location:** After successful order fill and before the response is returned. The exact insertion point is after `daemon.record_trade_entry()` (around line 1154) and the `_record_trade_span("daemon_record", ...)` call. Insert before `_store_trade_memory()`.

**Insert:**

```python
        # --- Log entry conditions for feedback loop ---
        try:
            _cond = ml_cond  # Already fetched at top of function
            if _cond and hasattr(daemon, '_satellite_store') and daemon._satellite_store:
                import json as _json
                daemon._satellite_store.conn.execute(
                    "INSERT INTO entry_snapshots ("
                    "trade_id, coin, side, entry_time, composite_score, "
                    "vol_1h_regime, vol_1h_pctl, entry_quality_pctl, "
                    "funding_4h_pctl, volume_1h_regime, mae_long_pctl, "
                    "mae_short_pctl, direction_signal, direction_long_roe, "
                    "direction_short_roe, score_components"
                    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        snapshot_id,  # Same ID used for trade_entry node
                        symbol, side, time.time(),
                        _cond.get("_entry_score", 50),
                        _cond.get("vol_1h", {}).get("regime"),
                        _cond.get("vol_1h", {}).get("percentile"),
                        _cond.get("entry_quality", {}).get("percentile"),
                        _cond.get("funding_4h", {}).get("percentile"),
                        _cond.get("volume_1h", {}).get("regime"),
                        _cond.get("mae_long", {}).get("percentile"),
                        _cond.get("mae_short", {}).get("percentile"),
                        _cond.get("direction_signal"),
                        _cond.get("direction_long_roe", 0),
                        _cond.get("direction_short_roe", 0),
                        _json.dumps(_cond.get("_entry_score_components", {})),
                    ),
                )
                daemon._satellite_store.conn.commit()
        except Exception:
            logger.debug("Failed to log entry snapshot", exc_info=True)
```

This follows the same try/except/debug pattern used throughout the trading tool (e.g., the `_store_trade_memory()` block).

---

## Step 3.3: Backfill Outcome on Trade Close

**File:** `src/hynous/intelligence/daemon.py`

**Location:** In `_wake_for_fill()` (lines 4125-4241), after the exit classification is determined and before the wake message is assembled. Find where `roe_pct` and `pnl_usd` are computed for the closed position. The exit classification comes from `_override_sl_classification()`.

**Insert after the PnL/ROE computation:**

```python
            # Backfill entry snapshot outcome for feedback loop
            try:
                if self._satellite_store:
                    self._satellite_store.conn.execute(
                        "UPDATE entry_snapshots "
                        "SET outcome_roe = ?, outcome_pnl_usd = ?, "
                        "outcome_won = ?, close_time = ?, close_reason = ? "
                        "WHERE coin = ? AND outcome_won IS NULL "
                        "ORDER BY entry_time DESC LIMIT 1",
                        (
                            roe_pct, pnl_usd,
                            1 if pnl_usd > 0 else 0,
                            time.time(), exit_classification, symbol,
                        ),
                    )
                    self._satellite_store.conn.commit()
            except Exception:
                logger.debug("Failed to backfill entry snapshot outcome", exc_info=True)
```

**Note:** The `UPDATE ... ORDER BY ... LIMIT 1` syntax works in SQLite 3.35+ (2021-03-12). If the deployed SQLite is older, use a subquery: `WHERE id = (SELECT id FROM entry_snapshots WHERE coin = ? AND outcome_won IS NULL ORDER BY entry_time DESC LIMIT 1)`.

---

## Step 3.4: Create Signal Evaluator

**New file:** `satellite/signal_evaluator.py`

```python
"""Rolling signal quality evaluation for entry-outcome feedback.

Computes per-signal IC (Spearman rank correlation) and composite
score ECE (Expected Calibration Error) from entry_snapshots table.
Called periodically by daemon (daily or after N closed trades).
"""

import logging
import math

log = logging.getLogger(__name__)


def compute_rolling_ic(store, window: int = 30) -> dict[str, float]:
    """Compute Spearman IC for each signal against trade outcome ROE.

    Args:
        store: SatelliteStore with entry_snapshots table.
        window: Last N closed trades to evaluate.

    Returns:
        Dict of {signal_name: spearman_rho}. Positive = signal predicts winners.
    """
    rows = store.conn.execute(
        "SELECT composite_score, entry_quality_pctl, vol_1h_pctl, "
        "funding_4h_pctl, mae_long_pctl, mae_short_pctl, outcome_roe "
        "FROM entry_snapshots WHERE outcome_won IS NOT NULL "
        "ORDER BY close_time DESC LIMIT ?",
        (window,),
    ).fetchall()

    if len(rows) < 10:
        return {}

    rows = [dict(r) for r in rows]
    outcomes = [r["outcome_roe"] for r in rows]
    ics = {}

    # Per-signal IC
    signal_cols = {
        "composite_score": "composite_score",
        "entry_quality": "entry_quality_pctl",
        "vol_1h": "vol_1h_pctl",
        "funding_4h": "funding_4h_pctl",
    }

    for name, col in signal_cols.items():
        vals = [r[col] for r in rows if r[col] is not None]
        if len(vals) >= 10:
            rho = _spearman(vals[:len(outcomes)], outcomes[:len(vals)])
            if rho is not None:
                ics[name] = round(rho, 4)

    return ics


def compute_calibration_error(store, n_bins: int = 5, window: int = 50) -> float:
    """Compute Expected Calibration Error for composite score.

    Bins entries by composite score, compares score/100 (predicted win rate)
    vs actual win rate per bin.

    Returns:
        ECE (0-1, lower is better). -1.0 if insufficient data.
    """
    rows = store.conn.execute(
        "SELECT composite_score, outcome_won FROM entry_snapshots "
        "WHERE outcome_won IS NOT NULL ORDER BY close_time DESC LIMIT ?",
        (window,),
    ).fetchall()

    if len(rows) < 10:
        return -1.0

    rows = [dict(r) for r in rows]
    bin_size = 100.0 / n_bins
    ece = 0.0
    total = len(rows)

    for i in range(n_bins):
        lo = i * bin_size
        hi = (i + 1) * bin_size
        bin_rows = [r for r in rows if lo <= r["composite_score"] < hi]
        if not bin_rows:
            continue
        predicted = sum(r["composite_score"] / 100.0 for r in bin_rows) / len(bin_rows)
        actual = sum(r["outcome_won"] for r in bin_rows) / len(bin_rows)
        ece += len(bin_rows) / total * abs(predicted - actual)

    return round(ece, 4)


def _spearman(x: list, y: list) -> float | None:
    """Compute Spearman rank correlation without scipy dependency."""
    n = min(len(x), len(y))
    if n < 5:
        return None

    def _rank(vals):
        indexed = sorted(range(n), key=lambda i: vals[i])
        ranks = [0.0] * n
        for rank, idx in enumerate(indexed):
            ranks[idx] = rank + 1.0
        return ranks

    rx = _rank(x[:n])
    ry = _rank(y[:n])
    d_sq = sum((rx[i] - ry[i]) ** 2 for i in range(n))
    rho = 1.0 - (6 * d_sq) / (n * (n * n - 1))
    return rho
```

The `_spearman()` helper avoids adding scipy as a dependency (satellite module doesn't currently require it). If scipy is already available, replace with `scipy.stats.spearmanr`.

---

## Step 3.5: Adaptive Weight Adjustment

**New file:** `satellite/weight_updater.py`

```python
"""Adaptive composite score weight adjustment.

After accumulating >= 30 closed trades with entry snapshots,
recompute signal weights proportional to their rolling IC.
Persist to storage/entry_score_weights.json.
"""

import json
import logging
from pathlib import Path

from satellite.signal_evaluator import compute_rolling_ic

log = logging.getLogger(__name__)


def update_weights(store, output_path: Path, min_trades: int = 30) -> dict[str, float] | None:
    """Recompute composite score weights from rolling IC.

    Args:
        store: SatelliteStore with entry_snapshots table.
        output_path: Path to write weights JSON (atomic write).
        min_trades: Minimum closed trades before adjusting.

    Returns:
        New weights dict, or None if insufficient data.
    """
    # Check minimum trades
    row = store.conn.execute(
        "SELECT COUNT(*) as cnt FROM entry_snapshots WHERE outcome_won IS NOT NULL"
    ).fetchone()
    if row["cnt"] < min_trades:
        log.info("Weight update skipped: %d/%d trades", row["cnt"], min_trades)
        return None

    ics = compute_rolling_ic(store, window=min_trades)
    if not ics:
        return None

    # Positive IC = signal predicts winners → keep weight
    # Negative IC = anti-predictive → zero weight
    # Scale by IC magnitude
    positive_ics = {k: max(0.0, v) for k, v in ics.items()}
    total_ic = sum(positive_ics.values())

    if total_ic < 0.01:
        log.warning("All signals have zero/negative IC — using equal weights")
        weights = {k: 1.0 / len(ics) for k in ics}
    else:
        weights = {k: v / total_ic for k, v in positive_ics.items()}

    # Persist (atomic write pattern from core.persistence)
    try:
        from hynous.core.persistence import _atomic_write
        output_path.parent.mkdir(parents=True, exist_ok=True)
        _atomic_write(output_path, json.dumps(weights, indent=2))
        log.info("Updated entry score weights: %s", weights)
    except Exception:
        log.debug("Failed to persist weights", exc_info=True)

    return weights
```

### Load weights in daemon

**File:** `src/hynous/intelligence/daemon.py`

At daemon startup (after `_inference_engine` init around line 533), load persisted weights:

```python
        # Load composite score weights if available
        _weights_path = config.project_root / "storage" / "entry_score_weights.json"
        if _weights_path.exists():
            try:
                import json as _json
                self._entry_score_weights = _json.loads(_weights_path.read_text())
                logger.info("Loaded entry score weights: %s", self._entry_score_weights)
            except Exception:
                self._entry_score_weights = None
        else:
            self._entry_score_weights = None
```

Then in the composite score computation (Phase 2 integration, around line 1744), pass weights:

```python
                        from satellite.entry_score import EntryScoreConfig
                        _score_cfg = EntryScoreConfig()
                        if self._entry_score_weights:
                            _score_cfg.weights = self._entry_score_weights
                        _entry_score = compute_entry_score(..., config=_score_cfg, ...)
```

### Periodic weight update

Add a daily timer (similar to `consolidation_interval`) that calls `update_weights()`. Follow the existing interval pattern in the daemon main loop.

---

## Verification

1. **Entry snapshot logged:** Execute paper trade. Query: `SELECT * FROM entry_snapshots ORDER BY entry_time DESC LIMIT 1` — should show the trade with composite_score and condition values, outcome columns NULL.
2. **Outcome backfilled:** Let SL/TP/trailing close the trade. Query same row — `outcome_roe`, `outcome_won`, `close_time`, `close_reason` should be filled.
3. **Rolling IC:** After >= 10 closed trades, run `compute_rolling_ic()` — should return dict with non-zero values.
4. **ECE:** After >= 10 closed trades, run `compute_calibration_error()` — should return 0-1 value.
5. **Weight update:** After >= 30 closed trades, weights file appears at `storage/entry_score_weights.json`.
6. **All tests pass.**

---

Last updated: 2026-03-22
