"""Kill switch and safety controls for ML trading.

The kill switch can be triggered by:
  1. Manual: operator sets ml_enabled=false in config
  2. Auto — max loss: cumulative loss exceeds threshold
  3. Auto — consecutive losses: N consecutive losing trades
  4. Auto — precision collapse: precision-at-threshold drops below floor
  5. Auto — data staleness: no fresh snapshots for > 2x snapshot interval

When triggered, the system falls back to LLM-based decisions.
The kill switch can only be re-enabled manually (shadow mode first).
"""

import json
import logging
import time
from dataclasses import dataclass, field

log = logging.getLogger(__name__)


@dataclass
class SafetyConfig:
    """Safety configuration. Loaded from YAML."""

    # Master switch
    ml_enabled: bool = True

    # Auto-disable thresholds
    max_cumulative_loss_pct: float = -15.0   # disable if cumulative ROE < -15%
    max_consecutive_losses: int = 5           # disable after 5 consecutive losses
    min_precision_at_3pct: float = 0.40       # disable if precision < 40%
    precision_eval_window: int = 50           # evaluate over last N predictions
    max_data_stale_seconds: int = 900         # 15 minutes (3x snapshot interval)

    # Shadow mode: model predicts but doesn't execute (for re-validation)
    shadow_mode: bool = False

    # Re-enable requires manual override
    auto_disable_reason: str = ""
    disabled_at: float = 0.0


@dataclass
class SafetyState:
    """Runtime safety state. Persisted to satellite_metadata table."""

    cumulative_roe: float = 0.0
    consecutive_losses: int = 0
    recent_predictions: list[dict] = field(default_factory=list)
    last_snapshot_time: float = 0.0
    total_trades: int = 0
    total_wins: int = 0


class KillSwitch:
    """Controls whether the ML model is allowed to make trade decisions.

    Usage:
        ks = KillSwitch(config)
        if ks.is_active:
            result = engine.predict(...)
            ks.record_prediction(result)
        else:
            reason = ks.disable_reason

    After auto-disable, operator must:
      1. Investigate the failure mode
      2. Set shadow_mode=true in config
      3. Validate model performance in shadow
      4. Set ml_enabled=true, shadow_mode=false to re-enable
    """

    def __init__(self, config: SafetyConfig, store: object | None = None):
        self._cfg = config
        self._store = store
        self._state = SafetyState()
        self._load_state()

    @property
    def is_active(self) -> bool:
        """Whether the model is allowed to make predictions."""
        if not self._cfg.ml_enabled:
            return False
        if self._cfg.auto_disable_reason:
            return False
        return True

    @property
    def is_shadow(self) -> bool:
        """Whether running in shadow mode (predict but don't execute)."""
        return self._cfg.shadow_mode

    @property
    def disable_reason(self) -> str:
        """Why the model was disabled (empty if active)."""
        if not self._cfg.ml_enabled:
            return "Manual disable (ml_enabled=false)"
        return self._cfg.auto_disable_reason

    @property
    def state(self) -> SafetyState:
        """Current safety state (read-only access)."""
        return self._state

    def record_trade_outcome(
        self, predicted_roe: float, actual_roe: float,
    ) -> None:
        """Record a completed trade outcome and check safety thresholds.

        Args:
            predicted_roe: What the model predicted (%).
            actual_roe: What actually happened (%).
        """
        is_win = actual_roe > 0
        self._state.cumulative_roe += actual_roe
        self._state.total_trades += 1

        if is_win:
            self._state.total_wins += 1
            self._state.consecutive_losses = 0
        else:
            self._state.consecutive_losses += 1

        # Record for precision tracking
        self._state.recent_predictions.append({
            "predicted": predicted_roe,
            "actual": actual_roe,
            "time": time.time(),
        })
        # Keep only last N
        max_window = self._cfg.precision_eval_window
        if len(self._state.recent_predictions) > max_window:
            self._state.recent_predictions = (
                self._state.recent_predictions[-max_window:]
            )

        # Check auto-disable conditions
        self._check_safety()
        self._save_state()

    def record_snapshot_time(self, timestamp: float) -> None:
        """Record the latest snapshot time for staleness checking."""
        self._state.last_snapshot_time = timestamp

    def check_staleness(self) -> bool:
        """Check if data is stale (no snapshots for too long).

        Returns:
            True if data is fresh, False if stale.
        """
        if self._state.last_snapshot_time == 0:
            return True  # no data yet, don't trigger

        age = time.time() - self._state.last_snapshot_time
        if age > self._cfg.max_data_stale_seconds:
            self._auto_disable(
                f"Data stale: last snapshot {age:.0f}s ago",
            )
            return False
        return True

    def _check_safety(self) -> None:
        """Evaluate all auto-disable conditions."""
        # 1. Cumulative loss
        if self._state.cumulative_roe < self._cfg.max_cumulative_loss_pct:
            self._auto_disable(
                f"Cumulative loss {self._state.cumulative_roe:.1f}% "
                f"exceeds threshold {self._cfg.max_cumulative_loss_pct}%",
            )
            return

        # 2. Consecutive losses
        if self._state.consecutive_losses >= self._cfg.max_consecutive_losses:
            self._auto_disable(
                f"{self._state.consecutive_losses} consecutive losses "
                f"(threshold: {self._cfg.max_consecutive_losses})",
            )
            return

        # 3. Precision collapse
        window = self._cfg.precision_eval_window
        recent = self._state.recent_predictions[-window:]
        if len(recent) >= window:
            # Precision at 3%: of predictions > 3%, what % actually achieved 3%?
            predicted_above = [
                p for p in recent if p["predicted"] > 3.0
            ]
            if len(predicted_above) >= 10:  # need minimum sample
                actual_above = sum(
                    1 for p in predicted_above if p["actual"] > 3.0
                )
                precision = actual_above / len(predicted_above)
                if precision < self._cfg.min_precision_at_3pct:
                    self._auto_disable(
                        f"Precision collapsed to {precision:.1%} "
                        f"(floor: {self._cfg.min_precision_at_3pct:.1%})",
                    )
                    return

    def _auto_disable(self, reason: str) -> None:
        """Auto-disable the model with reason logging."""
        self._cfg.auto_disable_reason = reason
        self._cfg.disabled_at = time.time()
        log.warning("KILL SWITCH TRIGGERED: %s", reason)
        log.warning("Model disabled. Manual re-enable required.")
        self._save_state()

    def reset(self) -> None:
        """Manually reset safety state (operator action only)."""
        self._state = SafetyState()
        self._cfg.auto_disable_reason = ""
        self._cfg.disabled_at = 0.0
        self._save_state()
        log.info("Kill switch reset. Safety state cleared.")

    def _load_state(self) -> None:
        """Load safety state from satellite_metadata table."""
        if self._store is None:
            return
        try:
            row = self._store.conn.execute(
                "SELECT value FROM satellite_metadata "
                "WHERE key = 'safety_state'",
            ).fetchone()
            if row:
                data = json.loads(row["value"])
                self._state.cumulative_roe = data.get("cumulative_roe", 0)
                self._state.consecutive_losses = data.get(
                    "consecutive_losses", 0,
                )
                self._state.total_trades = data.get("total_trades", 0)
                self._state.total_wins = data.get("total_wins", 0)
                self._state.last_snapshot_time = data.get(
                    "last_snapshot_time", 0,
                )
                self._state.recent_predictions = data.get(
                    "recent_predictions", [],
                )
        except Exception:
            log.debug("Failed to load safety state", exc_info=True)

    def _save_state(self) -> None:
        """Persist safety state to satellite_metadata table."""
        if self._store is None:
            return
        try:
            data = {
                "cumulative_roe": self._state.cumulative_roe,
                "consecutive_losses": self._state.consecutive_losses,
                "total_trades": self._state.total_trades,
                "total_wins": self._state.total_wins,
                "last_snapshot_time": self._state.last_snapshot_time,
                "recent_predictions": (
                    self._state.recent_predictions[-100:]
                ),
            }
            with self._store.write_lock:
                self._store.conn.execute(
                    "INSERT OR REPLACE INTO satellite_metadata "
                    "(key, value) VALUES (?, ?)",
                    ("safety_state", json.dumps(data)),
                )
                self._store.conn.commit()
        except Exception:
            log.debug("Failed to save safety state", exc_info=True)
