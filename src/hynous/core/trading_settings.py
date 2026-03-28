"""
Trading Settings — runtime-adjustable trading parameters.

Central dataclass with all tunable thresholds, persisted to
storage/trading_settings.json. Thread-safe singleton with lazy loading.
"""

import json
import os
import tempfile
import threading
from dataclasses import asdict, dataclass, field
from pathlib import Path


def _storage_path() -> Path:
    """Get the trading settings file path."""
    current = Path(__file__).resolve().parent
    for _ in range(10):
        if (current / "config").is_dir():
            return current / "storage" / "trading_settings.json"
        current = current.parent
    return Path("storage/trading_settings.json")


@dataclass
class TradingSettings:
    """All adjustable trading parameters."""

    # --- Macro trade limits ---
    macro_sl_min_pct: float = 1.0
    macro_sl_max_pct: float = 5.0
    macro_tp_min_pct: float = 2.0
    macro_tp_max_pct: float = 15.0
    macro_leverage_min: int = 5
    macro_leverage_max: int = 20

    # --- Micro trade limits ---
    micro_sl_min_pct: float = 0.2
    micro_sl_warn_pct: float = 0.3
    micro_sl_max_pct: float = 0.8
    micro_tp_min_pct: float = 0.20  # Minimum TP distance — must clear round-trip fees
    micro_tp_max_pct: float = 1.0
    micro_leverage: int = 20

    # --- Risk management ---
    rr_floor_reject: float = 1.0
    rr_floor_warn: float = 1.5
    portfolio_risk_cap_reject: float = 10.0
    portfolio_risk_cap_warn: float = 5.0
    roe_at_stop_reject: float = 25.0
    roe_at_stop_warn: float = 15.0
    roe_target: float = 15.0

    # --- Conviction sizing (margin % of portfolio) ---
    tier_high_margin_pct: int = 30
    tier_medium_margin_pct: int = 20
    tier_speculative_margin_pct: int = 10
    tier_pass_threshold: float = 0.6

    # --- Fee structure ---
    taker_fee_pct: float = 0.07  # ROUND-TRIP fee as % of notional — covers BOTH entry AND exit
                                  # 0.07% total = ~0.035% per side (3.5bps/side)
                                  # Hyperliquid mid-tier: ~0.025-0.05% per side depending on volume

    # --- General limits ---
    max_position_usd: float = 10000
    max_open_positions: int = 3
    max_daily_loss_usd: float = 100

    # --- Scanner ---
    scanner_wake_threshold: float = 0.5
    scanner_micro_enabled: bool = True
    scanner_max_wakes_per_cycle: int = 5
    scanner_news_enabled: bool = True

    # --- Smart Money ---
    sm_copy_alerts: bool = True
    sm_exit_alerts: bool = True
    sm_min_win_rate: float = 0.55
    sm_min_size: float = 50000

    # --- Smart Money Auto-Curation ---
    sm_auto_curate: bool = True
    sm_auto_min_wr: float = 0.55
    sm_auto_min_trades: int = 10
    sm_auto_min_pf: float = 1.5
    sm_auto_max_wallets: int = 20

    # --- Small Wins Mode ---
    # When enabled: daemon mechanically exits positions at small_wins_roe_pct gross ROE.
    # The fee break-even for the position's leverage is always enforced as a floor,
    # so exits always net a profit after fees. No agent involvement in the exit.
    # Use this to build win-rate and profit factor; disable once metrics recover.
    small_wins_mode: bool = False
    small_wins_roe_pct: float = 3.0  # Gross ROE % to exit at (fee BE enforced as floor)

    # --- Trailing Stop ---
    # Mechanical trailing stop — code handles exits, LLM handles entries.
    # Once ROE exceeds trailing_activation_roe, the stop trails at (1 - trailing_retracement_pct/100) * peak_roe.
    # Stop moves upward only, executes immediately when hit. No LLM involvement.
    trailing_stop_enabled: bool = True
    trailing_activation_roe: float = 2.8    # ROE % threshold to begin trailing
    trailing_retracement_pct: float = 50.0  # % of peak ROE allowed as giveback before exit

    # --- ML-Adaptive Trailing Stop ---
    # Vol-regime activation: lower activation in high vol (moves are real),
    # higher in low vol (need more confirmation).
    trail_activation_extreme: float = 1.5   # Activation ROE % in extreme vol
    trail_activation_high: float = 2.0      # Activation ROE % in high vol
    trail_activation_normal: float = 2.5    # Activation ROE % in normal vol
    trail_activation_low: float = 3.0       # Activation ROE % in low vol
    # Continuous exponential retracement: r(p) = floor + amplitude * exp(-k * p)
    # where p = peak ROE %. Replaces the 3-tier + vol-modifier system.
    # Vol regime is absorbed into the decay rate k (no separate modifier).
    trail_ret_floor: float = 0.20           # Asymptotic minimum retracement
    trail_ret_amplitude: float = 0.30       # Range: ceiling = floor + amplitude
    trail_ret_k_extreme: float = 0.160      # Decay rate in extreme vol (fastest)
    trail_ret_k_high: float = 0.100         # Decay rate in high vol
    trail_ret_k_normal: float = 0.080       # Decay rate in normal vol
    trail_ret_k_low: float = 0.040          # Decay rate in low vol (slowest)
    # Minimum trail distance above fee-BE (guarantees net profit when trail fires).
    trail_min_distance_above_fee_be: float = 0.5  # ROE % above fee-BE floor

    # --- Autonomous Close Lockout ---
    # When True, the agent cannot call close_position or cancel_orders during
    # daemon wakes. Only user-initiated closes (chat, Discord) are allowed.
    # Mechanical exits (trailing stop, dynamic SL, fee-BE, small wins) are unaffected.
    autonomous_close_lockout: bool = True

    # --- Dynamic Protective SL (replaces capital-breakeven) ---
    dynamic_sl_enabled: bool = True
    dynamic_sl_low_vol: float = 2.5       # ROE % SL distance in low vol
    dynamic_sl_normal_vol: float = 7.0    # ROE % SL distance in normal vol
    dynamic_sl_high_vol: float = 8.0      # ROE % SL distance in high vol
    dynamic_sl_extreme_vol: float = 3.0   # ROE % SL distance in extreme vol
    dynamic_sl_floor: float = 1.5         # minimum SL distance (ROE %)
    dynamic_sl_cap: float = 10.0          # maximum SL distance (ROE %)

    # --- ML Adaptive Trading ---
    # The execute_trade tool uses live ML predictions to adapt leverage,
    # sizing, and gating — so trades are context-aware, not hardcoded.
    ml_adaptive_leverage: bool = True       # Cap leverage when vol is high/extreme
    ml_adaptive_sizing: bool = True         # Scale position size by ML quality factor
    ml_entry_reject_pctl: int = 20          # Reject trades below this entry quality percentile
    ml_entry_warn_pctl: int = 35            # Warn trades below this percentile
    ml_mae_sl_warn: bool = True             # Warn when predicted MAE > SL distance
    ml_vol_leverage_cap_extreme: int = 10   # Max leverage in extreme vol
    ml_vol_leverage_cap_high: int = 15      # Max leverage in high vol

    # --- ML Condition Wakes ---
    ml_condition_wakes: bool = True            # Master switch
    ml_condition_cooldown_s: int = 900         # Per alert-type per-coin cooldown
    ml_condition_max_alerts: int = 3           # Max alerts bundled per wake
    ml_stale_threshold_s: int = 330            # Suppress if prediction older than this
    ml_extreme_vol_pctl: int = 90             # Percentile threshold for extreme vol wake
    ml_vol_expansion_threshold: float = 1.8   # vol_expand value threshold
    ml_entry_quality_pctl: int = 85           # Percentile for golden entry wake
    ml_drawdown_risk_wake: bool = True        # Wake on extreme MAE
    ml_regime_shift_wake: bool = True         # Wake on vol regime transitions
    ml_funding_extreme_wake: bool = False     # Wake on extreme funding (OFF — noisy)

    # --- Composite Entry Score ---
    composite_reject_score: float = 25.0    # Hard block entries below this score (0-100)
    composite_warn_score: float = 45.0      # Warn below this score

    # --- Trade History Warnings ---
    trade_history_warnings: bool = True       # Warn on near-certain loser patterns from Nous trade history


_lock = threading.Lock()
_cached: TradingSettings | None = None


def _atomic_write(path: Path, data: str) -> None:
    """Write to file atomically via temp file + rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def get_trading_settings() -> TradingSettings:
    """Get the current trading settings (lazy-loaded, cached)."""
    global _cached
    if _cached is not None:
        return _cached

    with _lock:
        if _cached is not None:
            return _cached

        path = _storage_path()
        if path.exists():
            try:
                data = json.loads(path.read_text())
                ts = TradingSettings()
                for k, v in data.items():
                    if hasattr(ts, k):
                        setattr(ts, k, type(getattr(ts, k))(v))
                _cached = ts
                return _cached
            except Exception:
                pass

        _cached = TradingSettings()
        return _cached


def save_trading_settings(ts: TradingSettings) -> None:
    """Persist trading settings to disk and update cache."""
    global _cached
    with _lock:
        path = _storage_path()
        _atomic_write(path, json.dumps(asdict(ts), indent=2))
        _cached = ts


def update_setting(key: str, value) -> TradingSettings:
    """Update a single setting by key, save, and return updated settings."""
    from dataclasses import replace
    ts = get_trading_settings()
    if not hasattr(ts, key):
        raise KeyError(f"Unknown setting: {key}")
    expected_type = type(getattr(ts, key))
    new_ts = replace(ts, **{key: expected_type(value)})
    save_trading_settings(new_ts)
    return new_ts


def reset_trading_settings() -> TradingSettings:
    """Reset all settings to defaults, save, and return."""
    ts = TradingSettings()
    save_trading_settings(ts)
    return ts
