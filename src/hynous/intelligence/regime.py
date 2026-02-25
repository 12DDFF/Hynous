"""
Regime Detection v4 — Hybrid macro/micro market regime classification.

Two axes:
  Direction: BULL / BEAR / NEUTRAL (score -1.0 to +1.0)
  Structure: TRENDING / RANGING / VOLATILE / SQUEEZE

Combined labels (6):
  TREND_BULL, TREND_BEAR, RANGING, VOLATILE_BULL, VOLATILE_BEAR, SQUEEZE

v4 changes (from v3):
  - Split into independent macro_score (5 structural signals, hours) and
    micro_score (3 real-time signals, minutes)
  - Dropped 3 weak signals: Fear & Greed (daily noise), BTC 7d (weekly lag),
    orderbook imbalance (text label, redundant with CVD)
  - Direction label + hysteresis driven by macro_score
  - format_regime_line shows both scores

Zero LLM cost — pure Python. Called from daemon every 300s.
"""

import logging
import math
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


# ============================================================
# RegimeState
# ============================================================

@dataclass
class RegimeState:
    """Current market regime classification (2-axis, dual-score)."""
    direction_score: float = 0.0       # backward compat — always equals macro_score
    macro_score: float = 0.0           # -1.0 to +1.0 (5 structural signals, hours)
    micro_score: float = 0.0           # -1.0 to +1.0 (3 real-time signals, minutes)
    direction_label: str = "NEUTRAL"   # BULL / BEAR / NEUTRAL
    structure_label: str = "RANGING"   # TRENDING / RANGING / VOLATILE / SQUEEZE
    combined_label: str = "RANGING"    # one of 6 labels
    bias: str = "neutral"              # long / short / neutral
    micro_safe: bool = True
    session: str = "QUIET"
    reversal_flag: bool = False
    reversal_detail: str = ""
    signals: dict = field(default_factory=dict)
    guidance: str = ""
    updated_at: str = ""               # ISO timestamp

    # Backwards-compatible aliases (used everywhere: daemon, briefing, context_snapshot)
    @property
    def label(self) -> str:
        return self.combined_label

    @property
    def score(self) -> float:
        return self.macro_score


# ============================================================
# Technical Indicator Functions (pure Python, from 1h candles)
# ============================================================

def _ema(values: list[float], period: int) -> list[float]:
    """Exponential Moving Average."""
    if not values:
        return []
    k = 2.0 / (period + 1)
    result = [values[0]]
    for v in values[1:]:
        result.append(v * k + result[-1] * (1 - k))
    return result


def _atr_series(highs: list[float], lows: list[float], closes: list[float],
                period: int = 14) -> list[float]:
    """ATR series (absolute). Wilder's smoothing."""
    if len(closes) < 2:
        return []
    trs = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)
    if len(trs) < period:
        return [sum(trs) / len(trs)] if trs else []
    # SMA seed
    atr = [sum(trs[:period]) / period]
    # Wilder's smoothing
    for tr in trs[period:]:
        atr.append((atr[-1] * (period - 1) + tr) / period)
    return atr


def _adx(highs: list[float], lows: list[float], closes: list[float],
         period: int = 14) -> float:
    """Average Directional Index (Wilder's method). Returns 0-100."""
    n = len(closes)
    if n < period * 2:
        return 0.0

    plus_dm = []
    minus_dm = []
    tr_list = []

    for i in range(1, n):
        high_diff = highs[i] - highs[i - 1]
        low_diff = lows[i - 1] - lows[i]

        pdm = high_diff if high_diff > low_diff and high_diff > 0 else 0.0
        mdm = low_diff if low_diff > high_diff and low_diff > 0 else 0.0
        plus_dm.append(pdm)
        minus_dm.append(mdm)

        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        tr_list.append(tr)

    if len(tr_list) < period:
        return 0.0

    # Wilder's smoothing
    def smooth(values, p):
        s = sum(values[:p])
        result = [s]
        for v in values[p:]:
            result.append(result[-1] - result[-1] / p + v)
        return result

    sm_tr = smooth(tr_list, period)
    sm_pdm = smooth(plus_dm, period)
    sm_mdm = smooth(minus_dm, period)

    dx_list = []
    for i in range(len(sm_tr)):
        if sm_tr[i] == 0:
            continue
        pdi = 100 * sm_pdm[i] / sm_tr[i]
        mdi = 100 * sm_mdm[i] / sm_tr[i]
        denom = pdi + mdi
        if denom == 0:
            continue
        dx_list.append(abs(pdi - mdi) / denom * 100)

    if not dx_list:
        return 0.0
    if len(dx_list) < period:
        return dx_list[-1]

    # ADX = Wilder's smoothed DX
    adx_val = sum(dx_list[:period]) / period
    for dx in dx_list[period:]:
        adx_val = (adx_val * (period - 1) + dx) / period
    return adx_val


def _rsi(closes: list[float], period: int = 14) -> float:
    """RSI (Wilder's smoothing). Returns 0-100."""
    if len(closes) < period + 1:
        return 50.0

    gains = []
    losses = []
    for i in range(1, len(closes)):
        delta = closes[i] - closes[i - 1]
        gains.append(max(0, delta))
        losses.append(max(0, -delta))

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - 100 / (1 + rs)


def _bbw(closes: list[float], period: int = 20) -> float:
    """Bollinger Band Width: (upper - lower) / middle."""
    if len(closes) < period:
        return 0.1  # Moderate default
    window = closes[-period:]
    sma = sum(window) / period
    if sma == 0:
        return 0.1
    variance = sum((c - sma) ** 2 for c in window) / period
    std = math.sqrt(variance)
    upper = sma + 2 * std
    lower = sma - 2 * std
    return (upper - lower) / sma


def _percentile(value: float, series: list[float]) -> float:
    """Percentile rank of value in series (0-100)."""
    if not series:
        return 50.0
    below = sum(1 for v in series if v < value)
    return below / len(series) * 100


# ============================================================
# Indicator Bundle
# ============================================================

@dataclass
class _Indicators:
    ema21: list[float] = field(default_factory=list)
    ema50: list[float] = field(default_factory=list)
    ema_aligned: bool = False      # Have enough data for EMA comparison
    ema_bull: bool = False         # ema21 > ema50
    ema_slope: float = 0.0        # 5-bar slope of ema21
    adx: float = 0.0
    atr_pct: float = 0.0          # Current ATR / close × 100
    atr_percentile: float = 50.0  # vs rolling window
    bbw: float = 0.1
    rsi: float = 50.0


def _compute_indicators(candles: list[dict]) -> _Indicators | None:
    """Compute all tech indicators from 1h candles [{t,o,h,l,c,v}].

    Needs ~50 candles for reliable ADX/EMA50.
    """
    if not candles or len(candles) < 20:
        return None

    # Validate candle data — reject if any close is zero or missing
    try:
        closes = [float(c["c"]) for c in candles]
        highs = [float(c["h"]) for c in candles]
        lows = [float(c["l"]) for c in candles]
    except (KeyError, TypeError, ValueError):
        logger.warning("Malformed candle data — skipping indicator computation")
        return None

    if not all(c > 0 for c in closes):
        logger.warning("Zero/negative close prices in candles — skipping indicators")
        return None

    ind = _Indicators()

    # EMAs
    ind.ema21 = _ema(closes, 21)
    ind.ema50 = _ema(closes, 50)

    if len(ind.ema21) >= 5 and len(ind.ema50) >= 1:
        ind.ema_bull = ind.ema21[-1] > ind.ema50[-1]
        ind.ema_aligned = True
        # Slope: 5-bar change in ema21
        if ind.ema21[-5] != 0:
            ind.ema_slope = (ind.ema21[-1] - ind.ema21[-5]) / ind.ema21[-5]

    # ADX
    ind.adx = _adx(highs, lows, closes)

    # ATR % + percentile
    atr_raw = _atr_series(highs, lows, closes)
    if atr_raw and closes[-1] > 0:
        ind.atr_pct = atr_raw[-1] / closes[-1] * 100
        # Percentile: rank current ATR against rolling window (absolute values).
        # Using absolute ATR avoids spurious variation from close price changes.
        ind.atr_percentile = _percentile(atr_raw[-1], atr_raw)

    # BBW
    ind.bbw = _bbw(closes)

    # RSI
    ind.rsi = _rsi(closes)

    return ind


# ============================================================
# Session Awareness
# ============================================================

def _get_session(utc_hour: int) -> str:
    if 0 <= utc_hour < 7:
        return "ASIA"
    if 7 <= utc_hour < 12:
        return "LONDON"
    if 12 <= utc_hour < 14:
        return "US_OPEN"
    if 14 <= utc_hour < 20:
        return "US"
    if 20 <= utc_hour < 22:
        return "LATE_US"
    return "QUIET"


# ============================================================
# Guidance Templates (keyed by combined label)
# ============================================================

_GUIDANCE = {
    "TREND_BULL":    "Bullish trend backdrop. Momentum favors longs.",
    "TREND_BEAR":    "Bearish trend backdrop. Momentum favors shorts.",
    "RANGING":       "Sideways chop. No clear directional edge from structure.",
    "VOLATILE_BULL": "High volatility, bullish lean. Expect wide swings.",
    "VOLATILE_BEAR": "High volatility, bearish lean. Expect wide swings.",
    "SQUEEZE":       "Low volatility compression. Breakout building — direction unclear.",
}


# ============================================================
# Signal Weights — Macro (structural, hours) + Micro (real-time, minutes)
# ============================================================

_W_MACRO = {
    "ema":      0.25,   # EMA alignment + slope
    "btc_4h":   0.25,   # BTC 4h change
    "funding":  0.20,   # Funding rate (contrarian)
    "oi_div":   0.20,   # OI divergence
    "liqs":     0.10,   # Liquidations
}

_W_MICRO = {
    "cvd":   0.50,   # CVD trend (sub-second)
    "whale": 0.30,   # Whale net bias (30s-10min)
    "hlp":   0.20,   # HLP vault side (60s)
}


# ============================================================
# RegimeClassifier
# ============================================================

class RegimeClassifier:
    """2-axis market regime classifier with hysteresis + reversal detection.

    Must be persistent (stored on daemon instance) to maintain hysteresis
    state and reversal tracking across cycles.
    """

    def __init__(self):
        # Hysteresis state
        self._last_combined_label: str = ""
        self._last_label_change: float = 0.0
        self._prev_macro_score: float = 0.0

        # Reversal tracking (last 2 cycles)
        self._prev_funding_sign: float | None = None
        self._prev_ema_bull: bool | None = None
        self._prev_oi_diverging: bool = False
        self._prev_cvd_sign: float | None = None  # CVD 15m sign for flip detection
        self._prev_flip_buffer: list[str] = []  # Flips from previous cycle

        # Liq cascade detection
        self._liq_history: list[float] = []
        self._last_liq_ts: float = 0.0  # Dedup by snapshot timestamp

    def classify(self, snapshot, data_cache, scanner,
                 candles_1h: list[dict] | None = None,
                 fast_signals: dict | None = None) -> RegimeState:
        """Compute current 2-axis regime from data sources + candle indicators.

        Args:
            snapshot: DaemonSnapshot with prices, funding, F&G, etc.
            data_cache: Unused (kept for caller compat).
            scanner: MarketScanner with derivative/liq buffers.
            candles_1h: Optional list of 1h BTC candles [{t,o,h,l,c,v}].
            fast_signals: Optional dict from data layer (CVD, whales, HLP).

        Returns:
            RegimeState with full 2-axis classification.
        """
        now = time.time()
        utc_hour = datetime.now(timezone.utc).hour
        session = _get_session(utc_hour)

        # Compute technical indicators from candles
        indicators = _compute_indicators(candles_1h) if candles_1h else None

        raw_signals: dict = {}

        # === Macro scoring (5 structural signals, hours timescale) ===
        macro_weighted = 0.0
        macro_total_w = 0.0
        for name, weight, scorer_args in [
            ("ema",     _W_MACRO["ema"],     (indicators,)),
            ("btc_4h",  _W_MACRO["btc_4h"],  (snapshot, candles_1h)),
            ("funding", _W_MACRO["funding"],  (snapshot,)),
            ("oi_div",  _W_MACRO["oi_div"],   (scanner,)),
            ("liqs",    _W_MACRO["liqs"],     (scanner,)),
        ]:
            method = getattr(self, f"_signal_{name}")
            score, detail = method(*scorer_args)
            if score is None:
                continue
            macro_weighted += score * weight
            macro_total_w += weight
            raw_signals[name] = {"score": round(score, 3), "detail": detail or ""}

        macro_score = max(-1.0, min(1.0, macro_weighted / macro_total_w)) if macro_total_w > 0 else 0.0

        # === Micro scoring (3 real-time signals, minutes timescale) ===
        micro_weighted = 0.0
        micro_total_w = 0.0
        for name, weight, scorer_args in [
            ("cvd",   _W_MICRO["cvd"],   (fast_signals,)),
            ("whale", _W_MICRO["whale"], (fast_signals,)),
            ("hlp",   _W_MICRO["hlp"],   (fast_signals,)),
        ]:
            method = getattr(self, f"_signal_{name}")
            score, detail = method(*scorer_args)
            if score is None:
                continue
            micro_weighted += score * weight
            micro_total_w += weight
            raw_signals[name] = {"score": round(score, 3), "detail": detail or ""}

        micro_available = micro_total_w > 0
        micro_score = max(-1.0, min(1.0, micro_weighted / micro_total_w)) if micro_available else 0.0

        # Track micro data availability for consumers
        raw_signals["_micro_available"] = micro_available

        # Store indicator summary in signals for formatting
        if indicators:
            raw_signals["_indicators"] = {
                "atr_pct": round(indicators.atr_pct, 2),
                "atr_percentile": round(indicators.atr_percentile, 0),
                "adx": round(indicators.adx, 1),
                "bbw": round(indicators.bbw, 4),
                "rsi": round(indicators.rsi, 1),
            }

        # === Liq cascade check (compute ONCE, used by reversal + micro safety) ===
        liq_cascade = self._check_liq_cascade(scanner)

        # === Reversal detection ===
        reversal_flag, reversal_detail = self._check_reversal(
            snapshot, scanner, indicators, liq_cascade,
            fast_signals=fast_signals,
        )

        # Nudge macro_score if reversal detected — amplify the direction signals
        # already point toward. Use delta from previous score to break ties at 0.
        if reversal_flag:
            delta = macro_score - self._prev_macro_score
            if macro_score > 0 or (macro_score == 0 and delta > 0):
                nudge = 0.15
            elif macro_score < 0 or (macro_score == 0 and delta < 0):
                nudge = -0.15
            else:
                nudge = 0.0  # Truly ambiguous — don't nudge
            macro_score = max(-1.0, min(1.0, macro_score + nudge))

        # === Direction label (driven by macro_score) ===
        if macro_score > 0.15:
            direction_label = "BULL"
            bias = "long"
        elif macro_score < -0.15:
            direction_label = "BEAR"
            bias = "short"
        else:
            direction_label = "NEUTRAL"
            bias = "neutral"

        # === Structure classification ===
        if indicators:
            structure = self._classify_structure(
                indicators.adx, indicators.atr_percentile,
                indicators.bbw, indicators.ema_aligned and indicators.adx >= 25,
                atr_pct=indicators.atr_pct,
            )
        else:
            # No candle data — preserve last known structure to avoid
            # false RANGING transitions when the candle API is down.
            if self._last_combined_label:
                # Extract structure from last label
                if "VOLATILE" in self._last_combined_label:
                    structure = "VOLATILE"
                elif "TREND" in self._last_combined_label:
                    structure = "TRENDING"
                elif "SQUEEZE" in self._last_combined_label:
                    structure = "SQUEEZE"
                else:
                    structure = "RANGING"
            else:
                structure = "RANGING"

        # === Combined label ===
        combined = self._combine_labels(direction_label, structure)

        # === Hysteresis (uses macro_score for buffer checks) ===
        combined = self._apply_hysteresis(
            combined, macro_score, session, reversal_flag, now,
        )

        # === Micro safety gate ===
        micro_safe = (
            (indicators is None or indicators.atr_percentile < 75)
            and not liq_cascade
            and structure not in ("VOLATILE", "SQUEEZE")
            and session != "US_OPEN"
        )

        # === Guidance ===
        guidance = _GUIDANCE.get(combined, "No directional bias. Trade on merit.")

        rounded_macro = round(macro_score, 3)
        state = RegimeState(
            direction_score=rounded_macro,
            macro_score=rounded_macro,
            micro_score=round(micro_score, 3) if micro_available else 0.0,
            direction_label=direction_label,
            structure_label=structure,
            combined_label=combined,
            bias=bias,
            micro_safe=micro_safe,
            session=session,
            reversal_flag=reversal_flag,
            reversal_detail=reversal_detail,
            signals=raw_signals,
            guidance=guidance,
            updated_at=datetime.now(timezone.utc).isoformat(),
        )

        self._prev_macro_score = macro_score

        logger.debug(
            "Regime: %s (macro %.2f, micro %.2f, struct %s) | micro_safe=%s session=%s reversal=%s",
            combined, macro_score, micro_score, structure, micro_safe, session, reversal_flag,
        )
        return state

    # ============================================================
    # Structure Classification
    # ============================================================

    @staticmethod
    def _classify_structure(adx: float, atr_percentile: float,
                            bbw: float, ema_trending: bool,
                            atr_pct: float = 0.0) -> str:
        # SQUEEZE: low BBW + low ATR + NOT trending (ADX < 20).
        # A clean trend has low BBW but high ADX — that's a trend, not a squeeze.
        if bbw < 0.03 and atr_percentile < 40 and adx < 20:
            return "SQUEEZE"
        # VOLATILE: ATR must be spiking relative to history AND above a minimum
        # absolute floor to prevent false VOLATILE reads in low-ATR environments
        # (e.g. BTC in a tight range where even a 0.4% candle ranks at P80).
        # 1.0% per 1h candle ≈ 24% annualised — a reasonable "actually volatile" floor.
        # The second clause catches uniformly extreme volatility where every candle
        # is wild and percentile stays moderate.
        if (atr_percentile >= 75 and atr_pct >= 1.0) or atr_pct >= 3.0:
            return "VOLATILE"
        if adx >= 25 and ema_trending:
            return "TRENDING"
        return "RANGING"

    @staticmethod
    def _combine_labels(direction: str, structure: str) -> str:
        if structure == "SQUEEZE":
            return "SQUEEZE"
        if structure == "RANGING":
            return "RANGING"
        if structure == "VOLATILE":
            if direction != "NEUTRAL":
                return f"VOLATILE_{direction}"
            return "RANGING"
        if structure == "TRENDING":
            if direction != "NEUTRAL":
                return f"TREND_{direction}"
            return "RANGING"
        return "RANGING"

    # ============================================================
    # Hysteresis
    # ============================================================

    def _apply_hysteresis(self, proposed: str, score: float,
                          session: str, reversal: bool, now: float) -> str:
        if not self._last_combined_label:
            # First classification — accept immediately
            self._last_combined_label = proposed
            self._last_label_change = now
            return proposed

        if proposed == self._last_combined_label:
            return proposed

        # Reversal bypass (5-min minimum)
        if reversal:
            if now - self._last_label_change >= 300:
                self._last_combined_label = proposed
                self._last_label_change = now
                return proposed
            return self._last_combined_label

        # Normal hysteresis: 30-min minimum
        if now - self._last_label_change < 1800:
            return self._last_combined_label

        # Direction score must exceed threshold by buffer
        buffer = 0.15 if session == "US_OPEN" else 0.10
        if abs(score) < 0.15 + buffer and proposed not in ("RANGING", "SQUEEZE"):
            return self._last_combined_label

        self._last_combined_label = proposed
        self._last_label_change = now
        return proposed

    # ============================================================
    # Reversal Detection
    # ============================================================

    def _check_reversal(self, snapshot, scanner, indicators,
                        liq_cascade: bool = False,
                        fast_signals: dict | None = None) -> tuple[bool, str]:
        """Check for reversal signals. Fire if >= 2 flip within last 2 cycles.

        Args:
            liq_cascade: Pre-computed liq cascade flag (to avoid double-counting).
            fast_signals: Data-layer signals dict (CVD for flip detection).
        """
        flips: list[str] = []

        # 1. Funding flip — sign change (must be meaningful, not noise near zero)
        if snapshot:
            btc_funding = snapshot.funding.get("BTC")
            if btc_funding is not None and self._prev_funding_sign is not None:
                # Only count as flip if BOTH values are above the noise floor (0.005%)
                # so we don't trigger on tiny oscillations around zero
                noise_floor = 0.00005  # 0.005%
                if (abs(btc_funding) > noise_floor and abs(self._prev_funding_sign) > noise_floor
                        and (btc_funding > 0) != (self._prev_funding_sign > 0)):
                    flips.append("funding_flip")
            if btc_funding is not None:
                self._prev_funding_sign = btc_funding

        # 2. OI-price divergence
        if scanner:
            derivs_buf = getattr(scanner, '_derivs', None)
            if derivs_buf and len(derivs_buf) >= 2:
                latest = derivs_buf.latest()
                prev = derivs_buf.previous()
                if latest and prev:
                    oi_now = latest.oi.get("BTC", 0)
                    oi_prev = prev.oi.get("BTC", 0)
                    px_now = latest.prices.get("BTC", 0)
                    px_prev = prev.prices.get("BTC", 0)
                    if oi_prev and px_prev:
                        oi_chg = (oi_now - oi_prev) / oi_prev
                        px_chg = (px_now - px_prev) / px_prev
                        diverging = (
                            (oi_chg < -0.01 and px_chg > 0.005)
                            or (oi_chg > 0.01 and px_chg < -0.005)
                        )
                        if diverging and not self._prev_oi_diverging:
                            flips.append("oi_divergence")
                        self._prev_oi_diverging = diverging

        # 3. EMA cross — ema21 crosses ema50 with ADX > 20
        if indicators and indicators.ema_aligned:
            if self._prev_ema_bull is not None and indicators.ema_bull != self._prev_ema_bull:
                if indicators.adx > 20:
                    flips.append("ema_cross")
            self._prev_ema_bull = indicators.ema_bull

        # 4. Liq cascade (pre-computed, passed in to avoid double-counting)
        if liq_cascade:
            flips.append("liq_cascade")

        # 5. CVD flip — 15m CVD sign reversal with magnitude
        if fast_signals and "cvd_15m" in fast_signals:
            cvd_now = fast_signals["cvd_15m"]
            if self._prev_cvd_sign is not None:
                # Only count if magnitude is meaningful (> $50k) and sign flipped
                if abs(cvd_now) > 50_000 and (cvd_now > 0) != (self._prev_cvd_sign > 0):
                    flips.append("cvd_flip")
            self._prev_cvd_sign = cvd_now

        # Combine with previous cycle's flips (2-cycle window)
        all_flips = list(set(flips + self._prev_flip_buffer))
        self._prev_flip_buffer = flips

        if len(all_flips) >= 2:
            return True, " + ".join(sorted(all_flips))
        return False, ""

    def _check_liq_cascade(self, scanner) -> bool:
        """Check if recent liquidation volume > 3x rolling average."""
        if scanner is None:
            return False

        liqs_buf = getattr(scanner, '_liqs', None)
        if liqs_buf is None or len(liqs_buf) < 2:
            return False

        latest = liqs_buf.latest()
        if not latest or not latest.coins:
            return False

        # Deduplicate: don't re-append if we've already seen this snapshot
        if latest.timestamp <= self._last_liq_ts:
            # Still check cascade against existing history
            if len(self._liq_history) < 3:
                return False
            avg = sum(self._liq_history[:-1]) / len(self._liq_history[:-1])
            return avg > 0 and self._liq_history[-1] > avg * 3

        self._last_liq_ts = latest.timestamp

        total = 0.0
        for coin_data in latest.coins.values():
            if isinstance(coin_data, dict):
                total += coin_data.get("total_1h", 0)

        self._liq_history.append(total)
        if len(self._liq_history) > 12:
            self._liq_history = self._liq_history[-12:]

        if len(self._liq_history) < 3:
            return False

        avg = sum(self._liq_history[:-1]) / len(self._liq_history[:-1])
        return avg > 0 and total > avg * 3

    # ============================================================
    # Signal Scorers
    # Each returns (score | None, detail | None).
    #   (None, None) = no data → skip weight
    #   (score, None) = data present, below display threshold
    #   (score, "text") = data present, noteworthy
    # ============================================================

    @staticmethod
    def _signal_ema(indicators: "_Indicators | None") -> tuple[float | None, str | None]:
        """EMA alignment + slope."""
        if indicators is None or not indicators.ema_aligned:
            return None, None
        # Need at least 30 candles for EMA50 to be meaningful (first-value seed
        # needs time to wash out). Below that, EMA50 is too noisy for crossovers.
        if len(indicators.ema50) < 30:
            return None, None

        # Base: EMA alignment direction
        base = 0.5 if indicators.ema_bull else -0.5

        # Slope boost (5-bar momentum): 1% slope maps to +-1.0
        slope_factor = max(-1.0, min(1.0, indicators.ema_slope * 100))
        score = base + slope_factor * 0.5
        score = max(-1.0, min(1.0, score))

        direction = "bull" if indicators.ema_bull else "bear"
        return score, f"EMA21/50 {direction}, slope {indicators.ema_slope:+.4f}"

    @staticmethod
    def _signal_btc_4h(snapshot, candles_1h: list[dict] | None = None
                       ) -> tuple[float | None, str | None]:
        """BTC 4h change. Uses candles if available, else prev_day_price proxy."""
        # Prefer actual 4h from candles
        if candles_1h and len(candles_1h) >= 5:
            current = candles_1h[-1]["c"]
            four_h_ago = candles_1h[-5]["c"]
            if four_h_ago > 0:
                pct = (current - four_h_ago) / four_h_ago * 100
                score = max(-1.0, min(1.0, pct / 3.0))
                if abs(pct) < 0.3:
                    return score, None
                return score, f"BTC {pct:+.1f}% 4h"

        # Fallback: snapshot prev_day_price
        if not snapshot or not snapshot.prices:
            return None, None

        btc_price = snapshot.prices.get("BTC", 0)
        btc_prev = snapshot.prev_day_price.get("BTC", 0)
        if not btc_price or not btc_prev:
            return None, None

        pct = (btc_price - btc_prev) / btc_prev * 100
        score = max(-1.0, min(1.0, pct / 5.0))
        if abs(pct) < 0.5:
            return score, None
        return score, f"BTC {pct:+.1f}% 24h"

    @staticmethod
    def _signal_funding(snapshot) -> tuple[float | None, str | None]:
        """BTC funding (contrarian). High positive = bearish, negative = bullish."""
        if not snapshot:
            return None, None
        btc_funding = snapshot.funding.get("BTC")
        if btc_funding is None:
            return None, None

        score = -btc_funding / 0.0003
        score = max(-1.0, min(1.0, score))

        if abs(btc_funding) < 0.00005:
            return score, None
        pct = btc_funding * 100
        side = "longs paying" if btc_funding > 0 else "shorts paying"
        return score, f"Funding {pct:+.4f}% ({side})"

    @staticmethod
    def _signal_oi_div(scanner) -> tuple[float | None, str | None]:
        """OI-price divergence."""
        if scanner is None:
            return None, None

        derivs_buf = getattr(scanner, '_derivs', None)
        if derivs_buf is None or len(derivs_buf) < 2:
            return None, None

        latest = derivs_buf.latest()
        prev = derivs_buf.previous()
        if not latest or not prev:
            return None, None

        btc_oi_now = latest.oi.get("BTC", 0)
        btc_oi_prev = prev.oi.get("BTC", 0)
        btc_px_now = latest.prices.get("BTC", 0)
        btc_px_prev = prev.prices.get("BTC", 0)

        if not btc_oi_prev or not btc_px_prev:
            return None, None

        oi_chg = (btc_oi_now - btc_oi_prev) / btc_oi_prev
        px_chg = (btc_px_now - btc_px_prev) / btc_px_prev

        if abs(oi_chg) < 0.005:
            return 0.0, None

        if oi_chg > 0 and px_chg < -0.005:
            return -0.6, "OI rising + price falling (bearish divergence)"
        elif oi_chg > 0 and px_chg > 0.005:
            return 0.6, "OI rising + price rising (bullish conviction)"
        return 0.0, None

    @staticmethod
    def _signal_liqs(scanner) -> tuple[float | None, str | None]:
        """Liquidation ratio — long liqs dominating = bearish."""
        if scanner is None:
            return None, None

        liqs_buf = getattr(scanner, '_liqs', None)
        if liqs_buf is None or len(liqs_buf) < 1:
            return None, None

        latest = liqs_buf.latest()
        if not latest or not latest.coins:
            return None, None

        total_long = 0.0
        total_short = 0.0
        for sym in ("BTC", "ETH"):
            coin = latest.coins.get(sym, {})
            total_long += coin.get("long_1h", 0)
            total_short += coin.get("short_1h", 0)

        total = total_long + total_short
        if total < 100_000:
            return None, None

        long_ratio = total_long / total
        score = -(long_ratio - 0.5) * 4
        score = max(-1.0, min(1.0, score))

        if abs(long_ratio - 0.5) < 0.1:
            return score, None

        if long_ratio > 0.5:
            return score, f"Long liqs dominating ({long_ratio:.0%})"
        return score, f"Short liqs dominating ({1 - long_ratio:.0%})"

    @staticmethod
    def _signal_cvd(fast_signals: dict | None) -> tuple[float | None, str | None]:
        """CVD trend across multiple windows. Weighted: 1m=0.5, 5m=0.3, 15m=0.2."""
        if not fast_signals:
            return None, None

        weights = {"cvd_1m": 0.5, "cvd_5m": 0.3, "cvd_15m": 0.2}
        total_w = 0.0
        weighted = 0.0
        parts = []

        for key, w in weights.items():
            cvd = fast_signals.get(key)
            if cvd is None:
                continue
            # Normalize: $500k CVD maps to +-1.0
            normalized = max(-1.0, min(1.0, cvd / 500_000))
            weighted += normalized * w
            total_w += w
            label = key.replace("cvd_", "")
            parts.append(f"{label} ${cvd:+,.0f}")

        if total_w == 0:
            return None, None

        score = max(-1.0, min(1.0, weighted / total_w))

        direction = "buy pressure" if score > 0.1 else "sell pressure" if score < -0.1 else "balanced"
        return score, f"CVD {' / '.join(parts)} -> {direction}"

    @staticmethod
    def _signal_whale(fast_signals: dict | None) -> tuple[float | None, str | None]:
        """Whale net bias. >65% long = bullish, >65% short = bearish."""
        if not fast_signals:
            return None, None

        long_pct = fast_signals.get("whale_long_pct")
        net_usd = fast_signals.get("whale_net_usd")
        if long_pct is None:
            return None, None

        # Map: 50% = 0, 65% = +-0.6, 80%+ = +-1.0
        deviation = (long_pct - 50) / 50  # -1 to +1
        if abs(deviation) < 0.15:  # Within 42.5-57.5% — balanced
            score = deviation * 2  # Small score, proportional
        else:
            score = max(-1.0, min(1.0, deviation * 2))

        if abs(long_pct - 50) < 10:
            return score, None

        side = "long" if long_pct > 50 else "short"
        net_str = f" (${abs(net_usd or 0):,.0f} net {side})" if net_usd else ""
        return score, f"Whales: {long_pct:.0f}% long{net_str}"

    @staticmethod
    def _signal_hlp(fast_signals: dict | None) -> tuple[float | None, str | None]:
        """HLP vault BTC side. Long = bullish, short = bearish."""
        if not fast_signals:
            return None, None

        side = fast_signals.get("hlp_btc_side", "")
        size_usd = fast_signals.get("hlp_btc_size_usd", 0)
        if not side:
            return None, None

        side_lower = side.lower()
        if "long" in side_lower:
            score = 0.5
        elif "short" in side_lower:
            score = -0.5
        else:
            return 0.0, None

        return score, f"HLP: BTC {side} ${abs(size_usd):,.0f}"


# ============================================================
# Formatting
# ============================================================

def format_regime_line(regime: RegimeState, compact: bool = False) -> str:
    """Format regime state for injection.

    Args:
        regime: Current RegimeState.
        compact: If True, single line for context_snapshot.
                 If False, full block with signals + guidance for briefing.
    """
    micro_trade_str = "OK" if regime.micro_safe else "BLOCKED"
    micro_avail = regime.signals.get("_micro_available", False)
    micro_str = f"{regime.micro_score:+.2f}" if micro_avail else "N/A"

    # Extract indicator values if available
    ind = regime.signals.get("_indicators", {})
    atr_str = ""
    adx_str = ""
    if ind:
        atr_pct = ind.get("atr_pct", 0)
        atr_p = ind.get("atr_percentile", 0)
        adx_val = ind.get("adx", 0)
        atr_str = f"ATR: {atr_pct:.1f}% (P{atr_p:.0f})"
        adx_str = f"ADX: {adx_val:.0f}"

    if compact:
        parts = [f"Regime: {regime.combined_label}"]
        parts.append(f"Macro: {regime.macro_score:+.2f}")
        parts.append(f"Micro: {micro_str}")
        if atr_str:
            parts.append(atr_str)
        if adx_str:
            parts.append(adx_str)
        parts.append(f"MicroTrade: {micro_trade_str}")
        parts.append(f"Session: {regime.session}")
        if regime.reversal_flag:
            parts.append(f"REVERSAL: {regime.reversal_detail}")
        return " | ".join(parts)

    # Full format for briefing
    lines = [
        f"Regime: {regime.combined_label} (macro: {regime.macro_score:+.2f}, "
        f"micro: {micro_str}) — direction: {regime.direction_label}, "
        f"structure: {regime.structure_label}, bias: {regime.bias}",
    ]
    detail_parts = [f"MicroTrade: {micro_trade_str}", f"Session: {regime.session}"]
    if atr_str:
        detail_parts.insert(0, atr_str)
    if adx_str:
        detail_parts.insert(1, adx_str)
    lines.append("  " + " | ".join(detail_parts))

    # Data-layer signal details (CVD, whales, HLP)
    for key in ("cvd", "whale", "hlp"):
        sig = regime.signals.get(key, {})
        detail = sig.get("detail") if isinstance(sig, dict) else None
        if detail:
            lines.append(f"  {detail}")

    if regime.reversal_flag:
        lines.append(f"  \u26a0 REVERSAL: {regime.reversal_detail}")
    if regime.guidance:
        lines.append(f"  -> {regime.guidance}")

    return "\n".join(lines)
