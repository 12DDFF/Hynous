"""
Regime Detection — Deterministic market regime classification.

Synthesizes existing data (prices, funding, F&G, liquidations, OI, orderbook)
into a single regime label + directional bias. Zero new API calls — all signals
already exist in daemon snapshot, scanner buffers, and DataCache.

Called from daemon every deriv poll (300s). Result cached on daemon instance
and injected into briefing, context_snapshot, and scanner wakes.

Score range: -1.0 (extreme bear) to +1.0 (extreme bull).
Labels: BEARISH / LEAN BEAR / NEUTRAL / LEAN BULL / BULLISH.
"""

import logging
import time
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Sentinel: signal method has data but nothing worth displaying.
# Distinct from None (= no data at all).
_NO_TEXT = ""


@dataclass
class RegimeState:
    """Current market regime classification."""
    score: float = 0.0            # -1.0 to +1.0
    label: str = "NEUTRAL"        # BEARISH / LEAN BEAR / NEUTRAL / LEAN BULL / BULLISH
    bias: str = "NEUTRAL"         # SHORTS / NEUTRAL / LONGS
    signals: list[str] = field(default_factory=list)
    guidance: str = ""            # Behavioral instruction for agent
    updated_at: float = 0.0       # Unix timestamp


# Score-to-label thresholds
_THRESHOLDS = [
    (-0.50, "BEARISH",   "SHORTS"),
    (-0.15, "LEAN BEAR", "SHORTS"),
    ( 0.15, "NEUTRAL",   "NEUTRAL"),
    ( 0.50, "LEAN BULL", "LONGS"),
]
# Anything > 0.50 is BULLISH / LONGS


def _score_to_label(score: float) -> tuple[str, str]:
    """Map score to (label, bias)."""
    for threshold, label, bias in _THRESHOLDS:
        if score <= threshold:
            return label, bias
    return "BULLISH", "LONGS"


# Guidance templates keyed by label
_GUIDANCE = {
    "BEARISH":   "DEFAULT SHORT. Look for short entries on bounces and resistance rejections. Do NOT dip buy or try to catch the reversal. Longs need exceptional thesis to justify counter-trend.",
    "LEAN BEAR": "Lean short. Short setups on bounces are higher probability than longs. Longs need stronger-than-usual thesis.",
    "NEUTRAL":   "No directional bias. Trade setups on merit, both sides valid.",
    "LEAN BULL": "Lean long. Dip buying and support holds are higher probability than shorts. Shorts need stronger-than-usual thesis.",
    "BULLISH":   "DEFAULT LONG. Look for long entries on dips and support holds. Do NOT short into strength or try to call the top. Shorts need exceptional thesis to justify counter-trend.",
}

# Weights for each signal
_W = {
    "btc_24h":    0.20,
    "btc_7d":     0.15,
    "funding":    0.20,
    "fear_greed": 0.15,
    "liqs":       0.10,
    "oi_div":     0.10,
    "orderbook":  0.10,
}


class RegimeClassifier:
    """Deterministic market regime classifier. Zero LLM cost."""

    def compute(self, snapshot, data_cache, scanner) -> RegimeState:
        """Compute current regime from existing data sources.

        Signal methods return (score, signal_text):
          - (0.0, None) = no data available → skip entirely
          - (score, None) = data available, below display threshold → count weight, no text
          - (score, "text") = data available, noteworthy → count weight + show text

        This ensures neutral-but-present data anchors the score toward zero
        rather than inflating other signals.
        """
        weighted_score = 0.0
        total_weight = 0.0
        signals = []

        for name, weight, method_args in [
            ("btc_24h",    _W["btc_24h"],    (snapshot,)),
            ("btc_7d",     _W["btc_7d"],     (data_cache,)),
            ("funding",    _W["funding"],     (snapshot,)),
            ("fear_greed", _W["fear_greed"],  (snapshot,)),
            ("liqs",       _W["liqs"],        (scanner,)),
            ("oi_div",     _W["oi_div"],      (scanner,)),
            ("orderbook",  _W["orderbook"],   (data_cache,)),
        ]:
            method = getattr(self, f"_signal_{name}")
            score, signal = method(*method_args)

            if score == 0.0 and signal is None:
                continue  # No data — skip weight entirely

            # Data exists: always count weight (anchors neutral readings)
            weighted_score += score * weight
            total_weight += weight
            if signal:  # Has displayable text
                signals.append(signal)

        # Normalize by available weight
        if total_weight > 0:
            final_score = weighted_score / total_weight
        else:
            final_score = 0.0

        final_score = max(-1.0, min(1.0, final_score))

        label, bias = _score_to_label(final_score)
        guidance = _GUIDANCE.get(label, "")

        state = RegimeState(
            score=final_score,
            label=label,
            bias=bias,
            signals=signals,
            guidance=guidance,
            updated_at=time.time(),
        )

        logger.debug("Regime: %s (%.2f) — %s | %d/%d signals (weight %.2f)",
                      label, final_score, bias, len(signals), 7, total_weight)
        return state

    # ================================================================
    # Individual signal scorers
    # Each returns (score, signal_text):
    #   (0.0, None) = no data available
    #   (score, None) = data present, below display threshold
    #   (score, "text") = data present, noteworthy
    # ================================================================

    @staticmethod
    def _signal_btc_24h(snapshot) -> tuple[float, str | None]:
        """BTC 24h price change."""
        if not snapshot or not snapshot.prices:
            return 0.0, None

        btc_price = snapshot.prices.get("BTC", 0)
        btc_prev = snapshot.prev_day_price.get("BTC", 0)
        if not btc_price or not btc_prev:
            return 0.0, None

        pct = (btc_price - btc_prev) / btc_prev * 100
        # Linear scale: -5% = -1.0, +5% = +1.0, clamped
        score = max(-1.0, min(1.0, pct / 5.0))

        if abs(pct) < 0.5:
            return score, None  # Data exists but too small to display

        direction = "up" if pct > 0 else "down"
        return score, f"BTC {pct:+.1f}% 24h ({direction})"

    @staticmethod
    def _signal_btc_7d(data_cache) -> tuple[float, str | None]:
        """BTC 7d trend from DataCache candle analysis."""
        if data_cache is None:
            return 0.0, None

        btc = data_cache.get("BTC")
        if not btc or not btc.trend_7d:
            return 0.0, None

        trend = btc.trend_7d.lower()
        if "bullish" in trend:
            score = 0.7
        elif "bearish" in trend:
            score = -0.7
        else:
            score = 0.0

        if btc.change_7d:
            return score, f"BTC 7d: {btc.trend_7d} ({btc.change_7d:+.1f}%)"
        return score, f"BTC 7d: {btc.trend_7d}"

    @staticmethod
    def _signal_funding(snapshot) -> tuple[float, str | None]:
        """BTC funding direction. High positive = bearish (longs paying), negative = bullish."""
        if not snapshot:
            return 0.0, None

        btc_funding = snapshot.funding.get("BTC")
        if btc_funding is None:
            return 0.0, None

        # Funding is a contrarian signal:
        # High positive = longs paying = crowded long = bearish bias
        # High negative = shorts paying = crowded short = bullish bias
        # Scale: 0.03% maps to +/-1.0
        score = -btc_funding / 0.0003
        score = max(-1.0, min(1.0, score))

        # Neutral band: below ±0.005% → still count weight, no display text
        if abs(btc_funding) < 0.00005:
            return score, None

        pct = btc_funding * 100
        if btc_funding > 0:
            return score, f"Funding {pct:+.4f}% (longs paying)"
        return score, f"Funding {pct:+.4f}% (shorts paying)"

    @staticmethod
    def _signal_fear_greed(snapshot) -> tuple[float, str | None]:
        """Fear & Greed index."""
        if not snapshot or snapshot.fear_greed == 0:
            return 0.0, None

        fg = snapshot.fear_greed
        # Linear map: 0 = -1.0, 50 = 0.0, 100 = +1.0
        score = (fg - 50) / 50.0
        score = max(-1.0, min(1.0, score))

        # 30-70 range: data exists but not extreme — count weight, no display
        if 30 <= fg <= 70:
            return score, None

        if fg <= 20:
            label = "Extreme Fear"
        elif fg <= 40:
            label = "Fear"
        elif fg >= 80:
            label = "Extreme Greed"
        else:
            label = "Greed"

        return score, f"F&G {fg} ({label})"

    @staticmethod
    def _signal_liqs(scanner) -> tuple[float, str | None]:
        """Liquidation ratio — long liqs dominating = bearish, short liqs = bullish."""
        if scanner is None:
            return 0.0, None

        liqs_buf = getattr(scanner, '_liqs', None)
        if liqs_buf is None or len(liqs_buf) < 1:
            return 0.0, None

        latest = liqs_buf.latest()
        if not latest or not latest.coins:
            return 0.0, None

        # Aggregate BTC + ETH liquidations (most representative)
        total_long = 0.0
        total_short = 0.0
        for sym in ("BTC", "ETH"):
            coin = latest.coins.get(sym, {})
            total_long += coin.get("long_1h", 0)
            total_short += coin.get("short_1h", 0)

        total = total_long + total_short
        if total < 100_000:  # Too low to be meaningful
            return 0.0, None

        long_ratio = total_long / total
        # 0.5 = balanced, >0.6 = long-dominant (bearish), <0.4 = short-dominant (bullish)
        score = -(long_ratio - 0.5) * 4  # 0.75 → -1.0
        score = max(-1.0, min(1.0, score))

        if abs(long_ratio - 0.5) < 0.1:
            return score, None  # Balanced — count weight, no display

        if long_ratio > 0.5:
            return score, f"Long liqs dominating ({long_ratio:.0%} of total)"
        return score, f"Short liqs dominating ({1 - long_ratio:.0%} of total)"

    @staticmethod
    def _signal_oi_div(scanner) -> tuple[float, str | None]:
        """OI trend vs price — OI up + price down = bearish, OI up + price up = bullish."""
        if scanner is None:
            return 0.0, None

        derivs_buf = getattr(scanner, '_derivs', None)
        if derivs_buf is None or len(derivs_buf) < 2:
            return 0.0, None

        latest = derivs_buf.latest()
        prev = derivs_buf.previous()
        if not latest or not prev:
            return 0.0, None

        btc_oi_now = latest.oi.get("BTC", 0)
        btc_oi_prev = prev.oi.get("BTC", 0)
        btc_px_now = latest.prices.get("BTC", 0)
        btc_px_prev = prev.prices.get("BTC", 0)

        if not btc_oi_prev or not btc_px_prev:
            return 0.0, None

        oi_chg = (btc_oi_now - btc_oi_prev) / btc_oi_prev
        px_chg = (btc_px_now - btc_px_prev) / btc_px_prev

        # OI barely moved — no data signal
        if abs(oi_chg) < 0.005:
            return 0.0, None

        if oi_chg > 0 and px_chg < -0.005:
            return -0.6, "OI rising + price falling (bearish divergence)"
        elif oi_chg > 0 and px_chg > 0.005:
            return 0.6, "OI rising + price rising (bullish conviction)"

        # OI moved but price didn't diverge meaningfully
        return 0.0, None

    @staticmethod
    def _signal_orderbook(data_cache) -> tuple[float, str | None]:
        """BTC orderbook imbalance from DataCache."""
        if data_cache is None:
            return 0.0, None

        btc = data_cache.get("BTC")
        if not btc or not btc.imbalance:
            return 0.0, None

        imb = btc.imbalance.lower()
        if "bid-heavy" in imb:
            return 0.5, f"BTC book: {btc.imbalance}"
        elif "ask-heavy" in imb:
            return -0.5, f"BTC book: {btc.imbalance}"

        # Balanced book — data exists, contributes neutral weight
        return 0.0, f"BTC book: {btc.imbalance}"


def format_regime_line(regime: RegimeState, compact: bool = False) -> str:
    """Format regime state for injection.

    Args:
        regime: Current RegimeState.
        compact: If True, single line for context_snapshot.
                 If False, full block with signals + guidance for briefing.
    """
    if compact:
        return f"Regime: {regime.label} ({regime.score:+.2f}) — bias {regime.bias}"

    lines = [
        f"Regime: {regime.label} (score: {regime.score:+.2f}) — directional bias: {regime.bias}",
    ]
    if regime.signals:
        lines.append("  " + ", ".join(regime.signals))
    if regime.guidance:
        lines.append(f"  -> {regime.guidance}")

    return "\n".join(lines)
