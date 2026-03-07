"""Condition-based wake triggers — evaluates ML predictions against thresholds.

Produces position-aware alerts that frame differently depending on whether
the agent is flat or holding a position on that coin.

Usage (from daemon):
    evaluator = ConditionWakeEvaluator()
    alerts = evaluator.evaluate(conditions, contexts, settings)
"""

import logging
import time
from dataclasses import dataclass

log = logging.getLogger(__name__)


@dataclass
class WakeContext:
    """Position state for a specific coin at wake time."""

    coin: str
    is_positioned: bool
    position_side: str | None = None       # "long" / "short"
    position_roe: float | None = None      # current unrealized ROE %
    position_type: str | None = None       # "micro" / "macro"
    peak_roe: float | None = None
    leverage: int | None = None


@dataclass
class ConditionAlert:
    """A single condition-based wake trigger that fired."""

    alert_type: str          # "extreme_vol", "golden_entry", etc.
    coin: str
    headline: str            # short title for chat log
    message_flat: str        # message when agent has no position
    message_positioned: str  # message when agent has position
    priority: bool           # bypass cooldown?
    prediction_age_s: float  # seconds since prediction
    severity: float = 0.0    # for ranking (higher = more extreme)


class ConditionWakeEvaluator:
    """Evaluates ML conditions against thresholds. Produces alerts."""

    def __init__(self):
        self._prev_regimes: dict[str, dict[str, str]] = {}  # coin -> {cond -> regime}
        self._last_alert_times: dict[str, float] = {}       # "coin:type" -> timestamp

    def evaluate(
        self,
        conditions: dict[str, dict],     # coin -> conditions from _latest_predictions
        contexts: dict[str, WakeContext], # coin -> position context
        settings,                         # TradingSettings
    ) -> list[ConditionAlert]:
        """Check all triggers, return alerts (deduped, ranked, noise-filtered)."""
        now = time.time()
        alerts: list[ConditionAlert] = []

        for coin, cond in conditions.items():
            ctx = contexts.get(coin)
            if not ctx:
                continue

            # Check prediction age — skip if stale
            cond_ts = cond.get("timestamp")
            if not cond_ts:
                continue
            prediction_age = now - cond_ts
            if prediction_age > settings.ml_stale_threshold_s:
                log.debug("Skipping %s: prediction stale (%.0fs)", coin, prediction_age)
                continue

            checkers = [
                self._check_extreme_vol,
                self._check_vol_expansion,
                self._check_golden_entry,
                self._check_drawdown_risk,
                self._check_vol_regime_shift,
                self._check_funding_extreme,
                self._check_composite_green,
            ]
            for checker in checkers:
                alert = checker(coin, cond, ctx, settings, prediction_age)
                if alert and self._passes_cooldown(alert, now, settings):
                    alerts.append(alert)

        # Update regime cache for shift detection
        for coin, cond in conditions.items():
            vol_1h = cond.get("vol_1h", {})
            if coin not in self._prev_regimes:
                self._prev_regimes[coin] = {}
            if vol_1h.get("regime"):
                self._prev_regimes[coin]["vol_1h"] = vol_1h["regime"]

        if not alerts:
            return []

        # Sort: priority first, then severity descending
        alerts.sort(key=lambda a: (-int(a.priority), -a.severity))

        # Cap at max alerts
        return alerts[:settings.ml_condition_max_alerts]

    def _passes_cooldown(self, alert: ConditionAlert, now: float, settings) -> bool:
        """Check per-alert-type per-coin cooldown. Updates timestamp if passing."""
        if alert.priority:
            return True
        key = f"{alert.coin}:{alert.alert_type}"
        last = self._last_alert_times.get(key, 0)
        if now - last < settings.ml_condition_cooldown_s:
            return False
        self._last_alert_times[key] = now
        return True

    def _check_extreme_vol(self, coin, cond, ctx, settings, age) -> ConditionAlert | None:
        vol_1h = cond.get("vol_1h", {})
        pctl = vol_1h.get("percentile", 0)
        if pctl < settings.ml_extreme_vol_pctl:
            return None

        side = ctx.position_side or "position"
        return ConditionAlert(
            alert_type="extreme_vol",
            coin=coin,
            headline=f"{coin} extreme vol ({pctl}th pctl)",
            message_flat=f"Extreme vol predicted ({pctl}th percentile) — big moves ahead",
            message_positioned=(
                f"Extreme vol ({pctl}th pctl) — protect your {side}, tighten stops"
            ),
            priority=False,
            prediction_age_s=age,
            severity=pctl,
        )

    def _check_vol_expansion(self, coin, cond, ctx, settings, age) -> ConditionAlert | None:
        vol_expand = cond.get("vol_expand", {})
        value = vol_expand.get("value", 0)
        if value < settings.ml_vol_expansion_threshold:
            return None

        side = ctx.position_side or "position"
        return ConditionAlert(
            alert_type="vol_expansion",
            coin=coin,
            headline=f"{coin} vol expanding {value:.1f}x",
            message_flat=f"Vol expanding {value:.1f}x — breakout setup",
            message_positioned=f"Vol expanding {value:.1f}x — your {side} may see amplified move",
            priority=False,
            prediction_age_s=age,
            severity=value * 50,  # normalize to ~percentile scale
        )

    def _check_golden_entry(self, coin, cond, ctx, settings, age) -> ConditionAlert | None:
        # Suppressed when positioned
        if ctx.is_positioned:
            return None

        entry = cond.get("entry_quality", {})
        pctl = entry.get("percentile", 0)
        if pctl < settings.ml_entry_quality_pctl:
            return None

        vol_1h = cond.get("vol_1h", {})
        vol_regime = vol_1h.get("regime", "low")
        if vol_regime == "low":
            return None

        # Skip if extreme drawdown on both sides
        mae_long = cond.get("mae_long", {})
        mae_short = cond.get("mae_short", {})
        if mae_long.get("regime") == "extreme" and mae_short.get("regime") == "extreme":
            return None

        return ConditionAlert(
            alert_type="golden_entry",
            coin=coin,
            headline=f"{coin} golden entry ({pctl}th pctl)",
            message_flat=f"Strong entry window — quality {pctl}th percentile",
            message_positioned="",  # suppressed
            priority=False,
            prediction_age_s=age,
            severity=pctl,
        )

    def _check_drawdown_risk(self, coin, cond, ctx, settings, age) -> ConditionAlert | None:
        if not settings.ml_drawdown_risk_wake:
            return None

        mae_long = cond.get("mae_long", {})
        mae_short = cond.get("mae_short", {})

        long_extreme = mae_long.get("regime") == "extreme"
        short_extreme = mae_short.get("regime") == "extreme"

        if not long_extreme and not short_extreme:
            return None

        # Priority if positioned on the extreme-risk side
        is_priority = False
        if ctx.is_positioned:
            if ctx.position_side == "long" and long_extreme:
                is_priority = True
            elif ctx.position_side == "short" and short_extreme:
                is_priority = True

        side = ctx.position_side or "position"
        if long_extreme and short_extreme:
            risk_side = "both"
            risk_pctl = max(mae_long.get("percentile", 90), mae_short.get("percentile", 90))
        elif long_extreme:
            risk_side = "long"
            risk_pctl = mae_long.get("percentile", 90)
        else:
            risk_side = "short"
            risk_pctl = mae_short.get("percentile", 90)

        flat_msg = (
            f"Extreme drawdown risk on both sides — dangerous conditions"
            if risk_side == "both"
            else f"Extreme {risk_side} drawdown risk — avoid {risk_side} entries"
        )

        return ConditionAlert(
            alert_type="drawdown_risk",
            coin=coin,
            headline=f"{coin} extreme {risk_side} drawdown risk",
            message_flat=flat_msg,
            message_positioned=f"YOUR {side} faces extreme drawdown risk ({risk_pctl}th pctl)",
            priority=is_priority,
            prediction_age_s=age,
            severity=risk_pctl,
        )

    def _check_vol_regime_shift(self, coin, cond, ctx, settings, age) -> ConditionAlert | None:
        if not settings.ml_regime_shift_wake:
            return None

        vol_1h = cond.get("vol_1h", {})
        new_regime = vol_1h.get("regime")
        if not new_regime or new_regime not in ("high", "extreme"):
            return None

        prev = self._prev_regimes.get(coin, {}).get("vol_1h")
        if prev is None:
            return None  # first tick, don't fire
        if prev == new_regime:
            return None  # no change

        side = ctx.position_side or "position"
        return ConditionAlert(
            alert_type="vol_regime_shift",
            coin=coin,
            headline=f"{coin} vol regime {prev} -> {new_regime}",
            message_flat=f"Vol regime shifted {prev} -> {new_regime} — environment changing",
            message_positioned=f"Vol regime shifted {prev} -> {new_regime} — recalibrate stops on {side}",
            priority=False,
            prediction_age_s=age,
            severity=90 if new_regime == "extreme" else 75,
        )

    def _check_funding_extreme(self, coin, cond, ctx, settings, age) -> ConditionAlert | None:
        if not settings.ml_funding_extreme_wake:
            return None

        funding = cond.get("funding_4h", {})
        pctl = funding.get("percentile", 50)
        if 10 < pctl < 90:
            return None

        direction = "rising" if pctl >= 90 else "falling"
        side = ctx.position_side or "position"
        if ctx.is_positioned:
            # Rising funding = shorts pay longs = squeeze risk for shorts = good for longs
            # Falling funding = longs pay shorts = squeeze risk for longs = good for shorts
            aligns = (
                (direction == "rising" and side == "long")
                or (direction == "falling" and side == "short")
            )
            alignment = "aligns with" if aligns else "contradicts"
            pos_msg = f"Funding extreme ({direction}) — {alignment} your {side}"
        else:
            pos_msg = ""

        return ConditionAlert(
            alert_type="funding_extreme",
            coin=coin,
            headline=f"{coin} funding extreme ({pctl}th pctl)",
            message_flat=f"Funding trajectory extreme ({direction}) — squeeze potential",
            message_positioned=pos_msg,
            priority=False,
            prediction_age_s=age,
            severity=abs(pctl - 50),
        )

    def _check_composite_green(self, coin, cond, ctx, settings, age) -> ConditionAlert | None:
        # Suppressed when positioned
        if ctx.is_positioned:
            return None

        entry = cond.get("entry_quality", {})
        vol_1h = cond.get("vol_1h", {})
        mae_long = cond.get("mae_long", {})
        mae_short = cond.get("mae_short", {})

        entry_pctl = entry.get("percentile", 0)
        vol_regime = vol_1h.get("regime", "low")

        if entry_pctl < 75:
            return None
        if vol_regime not in ("high", "extreme"):
            return None
        if mae_long.get("regime") in ("high", "extreme") or mae_short.get("regime") in ("high", "extreme"):
            return None

        return ConditionAlert(
            alert_type="composite_green",
            coin=coin,
            headline=f"{coin} conditions align — green light",
            message_flat=(
                f"Multiple conditions align — entry quality {entry_pctl}th pctl, "
                f"vol {vol_regime}, manageable risk"
            ),
            message_positioned="",  # suppressed
            priority=False,
            prediction_age_s=age,
            severity=entry_pctl,
        )
