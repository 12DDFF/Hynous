"""Composite entry score — mechanical entry quality assessment.

Combines condition model outputs into a single 0-100 score.
Computed every satellite tick (300s) in the daemon. No LLM involved.

Score interpretation:
  0-30:  Poor — skip entries, set watchpoints
  30-50: Below average — reduce size, require higher conviction
  50-70: Neutral — standard sizing
  70-85: Good — favor entries, full conviction sizing
  85-100: Excellent — strong entry window, aggressive sizing allowed

Usage:
    from satellite.entry_score import compute_entry_score, EntryScoreConfig
    score = compute_entry_score(conditions.to_dict(), dir_signal, ...)
"""

import logging
import time
from dataclasses import dataclass, field

log = logging.getLogger(__name__)


@dataclass
class EntryScore:
    """Computed composite entry score for one coin."""

    coin: str
    score: float                      # 0-100
    components: dict[str, float]      # signal name → normalized contribution (0-1)
    timestamp: float
    direction_signal: str | None      # "long", "short", "skip", "conflict", None
    direction_confidence: float       # max(predicted_long_roe, predicted_short_roe)

    @property
    def label(self) -> str:
        if self.score >= 85:
            return "excellent"
        if self.score >= 70:
            return "good"
        if self.score >= 50:
            return "neutral"
        if self.score >= 30:
            return "below_average"
        return "poor"

    def to_briefing_line(self) -> str:
        """Single-line briefing injection. Matches briefing.py formatting conventions."""
        top = sorted(self.components.items(), key=lambda x: abs(x[1] - 0.5), reverse=True)[:3]
        drivers = ", ".join(f"{k}={v:.2f}" for k, v in top)
        return f"Entry score: {self.score:.0f}/100 ({self.label}) [{drivers}]"


@dataclass
class EntryScoreConfig:
    """Weights and thresholds. All configurable via TradingSettings."""

    # Per-signal weights (must sum to ~1.0 for enabled signals)
    # These are initial equal weights — Phase 3 feedback loop adjusts them.
    weights: dict[str, float] = field(default_factory=lambda: {
        "entry_quality": 0.20,
        "vol_favorability": 0.20,
        "funding_safety": 0.15,
        "volume_quality": 0.15,
        "mae_safety": 0.15,
        "direction_edge": 0.15,
    })
    # Trading tool thresholds
    reject_below: float = 25.0
    warn_below: float = 45.0


_REGIME_VOL_MAP = {"low": 0.80, "normal": 0.60, "high": 0.35, "extreme": 0.15}
_REGIME_VOL_1H_MAP = {"low": 0.30, "normal": 0.50, "high": 0.75, "extreme": 0.90}


def compute_entry_score(
    conditions: dict,
    direction_signal: str | None = None,
    direction_long_roe: float = 0.0,
    direction_short_roe: float = 0.0,
    config: EntryScoreConfig | None = None,
    side: str | None = None,
    coin: str = "BTC",
) -> EntryScore:
    """Compute composite entry score from condition predictions.

    Each signal is normalized to [0, 1] where 1 = favorable for entries.
    Signals are weighted and combined into a 0-100 score.

    Args:
        conditions: Dict from MarketConditions.to_dict(). Keys are model names,
            values are dicts with "value", "percentile", "regime".
        direction_signal: From InferenceEngine result. None if direction model unavailable.
        direction_long_roe: Predicted long ROE %.
        direction_short_roe: Predicted short ROE %.
        config: Weights and thresholds. Uses defaults if None.
        side: "long" or "short" — for side-specific MAE. None = use worse side.
        coin: Coin symbol.

    Returns:
        EntryScore with 0-100 composite score.
    """
    cfg = config or EntryScoreConfig()
    components: dict[str, float] = {}

    # --- Signal extraction (each normalized to 0-1, higher = better for entries) ---

    # 1. Entry quality percentile (direct: higher percentile = better timing)
    eq = conditions.get("entry_quality", {})
    if eq and eq.get("percentile") is not None:
        components["entry_quality"] = eq["percentile"] / 100.0

    # 2. Vol favorability (inverted: low vol = better for controlled entries,
    #    extreme vol = worse because noise overwhelms signal)
    vol = conditions.get("vol_1h", {})
    if vol and vol.get("regime"):
        components["vol_favorability"] = _REGIME_VOL_MAP.get(vol["regime"], 0.50)

    # 3. Funding safety (extreme funding = squeeze risk = unfavorable)
    fund = conditions.get("funding_4h", {})
    if fund and fund.get("percentile") is not None:
        pctl = fund["percentile"]
        # Distance from neutral (50th) — closer to 50 = safer
        components["funding_safety"] = 1.0 - abs(pctl - 50) / 50.0

    # 4. Volume quality (higher volume = better liquidity + breakout potential)
    vol_1h = conditions.get("volume_1h", {})
    if vol_1h and vol_1h.get("regime"):
        components["volume_quality"] = _REGIME_VOL_1H_MAP.get(vol_1h["regime"], 0.50)

    # 5. MAE safety (lower drawdown prediction = better entry)
    if side:
        mae = conditions.get(f"mae_{side}", {})
    else:
        # Use worse side (more conservative)
        mae_l = conditions.get("mae_long", {})
        mae_s = conditions.get("mae_short", {})
        mae = mae_l if (mae_l.get("percentile", 50) > mae_s.get("percentile", 50)) else mae_s
    if mae and mae.get("percentile") is not None:
        components["mae_safety"] = 1.0 - mae["percentile"] / 100.0

    # 6. Direction model edge (if available and has a signal)
    if direction_signal in ("long", "short"):
        max_roe = max(direction_long_roe, direction_short_roe)
        # Normalize: 3% (entry threshold) maps to 0.0, 10%+ maps to 1.0
        components["direction_edge"] = min(1.0, max(0.0, (max_roe - 3.0) / 7.0))

    # --- Weighted combination ---
    if not components:
        return EntryScore(
            coin=coin, score=50.0, components={}, timestamp=time.time(),
            direction_signal=direction_signal,
            direction_confidence=max(direction_long_roe, direction_short_roe),
        )

    weights = cfg.weights
    # Only use weights for signals that are present
    active_weight = sum(weights.get(k, 0) for k in components)
    if active_weight < 0.01:
        active_weight = len(components)  # Equal-weight fallback
        weights = {k: 1.0 for k in components}

    raw = sum(components[k] * weights.get(k, 1.0 / len(components))
              for k in components) / active_weight
    score = max(0.0, min(100.0, raw * 100.0))

    return EntryScore(
        coin=coin, score=score, components=components, timestamp=time.time(),
        direction_signal=direction_signal,
        direction_confidence=max(direction_long_roe, direction_short_roe),
    )


def score_to_sizing_factor(score: float, floor: float = 0.5, ceiling: float = 1.2) -> float:
    """Map composite score to position sizing multiplier.

    Linear interpolation: score 0 → floor (0.5x), score 100 → ceiling (1.2x).
    """
    t = max(0.0, min(1.0, score / 100.0))
    return floor + t * (ceiling - floor)
