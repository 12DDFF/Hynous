"""
Market Scanner — Anomaly Detection Across All Hyperliquid Pairs

Scans ~200 perpetual futures for sudden changes in price, OI, funding,
volume, and liquidations. Wakes the agent when opportunities are detected.

Zero LLM cost — pure Python threshold checks against rolling market data.
Called from Daemon._loop() every time new data arrives.

Architecture:
  ingest_prices()       ← daemon._poll_prices() every 60s
  ingest_derivatives()  ← daemon._poll_derivatives() every 300s
  ingest_liquidations() ← Coinglass every 300s
  detect()              → list[AnomalyEvent] sorted by severity
"""

import logging
import time
from collections import deque
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


# =============================================================================
# Data Structures
# =============================================================================

@dataclass
class PriceSnapshot:
    """Point-in-time price data for all pairs."""
    timestamp: float
    prices: dict[str, float]


@dataclass
class DerivSnapshot:
    """Point-in-time derivatives data for all pairs."""
    timestamp: float
    funding: dict[str, float]       # symbol → funding rate (decimal)
    oi: dict[str, float]            # symbol → OI in base asset
    volume: dict[str, float]        # symbol → 24h notional volume USD
    prices: dict[str, float]        # symbol → mark price


@dataclass
class LiqSnapshot:
    """Point-in-time liquidation data from Coinglass."""
    timestamp: float
    coins: dict[str, dict]          # symbol → {total_1h, long_1h, short_1h, ...}


@dataclass
class AnomalyEvent:
    """A detected market anomaly."""
    type: str           # "price_spike", "oi_surge", "funding_extreme", etc.
    symbol: str         # affected pair (or "MARKET" for market-wide)
    severity: float     # 0.0-1.0 normalized score
    headline: str       # one-line summary
    detail: str         # context for agent
    fingerprint: str    # dedup key
    detected_at: float  # unix timestamp


# =============================================================================
# Rolling Buffer
# =============================================================================

class RollingBuffer:
    """Fixed-size circular buffer of snapshots."""

    def __init__(self, maxlen: int):
        self._buf: deque = deque(maxlen=maxlen)

    def append(self, snapshot):
        self._buf.append(snapshot)

    def latest(self):
        return self._buf[-1] if self._buf else None

    def previous(self):
        return self._buf[-2] if len(self._buf) >= 2 else None

    def nth_back(self, n: int):
        """Get the snapshot N entries back (0=latest, 1=previous, etc.)."""
        if n < len(self._buf):
            return self._buf[-(n + 1)]
        return None

    def is_warmed(self, min_len: int) -> bool:
        return len(self._buf) >= min_len

    def __len__(self):
        return len(self._buf)


# =============================================================================
# Market Scanner
# =============================================================================

# Warmup requirements (number of polls before detection starts)
_WARMUP_PRICES = 5    # 5 × 60s = 5 min
_WARMUP_DERIVS = 2    # 2 × 300s = 10 min
_WARMUP_DIVERGENCE = 3  # 3 × 300s = 15 min


class MarketScanner:
    """Market-wide anomaly detection engine.

    Zero LLM cost. Pure Python threshold checks against rolling data.
    """

    def __init__(self, config):
        self.config = config

        # Rolling data buffers
        self._prices = RollingBuffer(maxlen=30)     # 30min at 60s
        self._derivs = RollingBuffer(maxlen=12)     # 1h at 300s
        self._liqs = RollingBuffer(maxlen=6)        # 30min at 300s

        # Dedup: fingerprint → expiry timestamp
        self._seen: dict[str, float] = {}

        # Poll counters for warmup
        self._price_polls: int = 0
        self._deriv_polls: int = 0

        # Known symbols with liquidity (updated from deriv snapshots)
        self._liquid_symbols: set[str] = set()

        # Position awareness (set by daemon before detect())
        self.position_symbols: set[str] = set()
        self.execution_symbols: set[str] = set()

        # Stats
        self.anomalies_detected: int = 0
        self.wakes_triggered: int = 0

        # Recent anomaly history for dashboard display
        self._recent_anomalies: deque = deque(maxlen=20)

        self._warmup_logged = False

    # -----------------------------------------------------------------
    # Ingestion
    # -----------------------------------------------------------------

    def ingest_prices(self, prices: dict[str, float]):
        """Store a price snapshot from Hyperliquid (all pairs)."""
        self._prices.append(PriceSnapshot(
            timestamp=time.time(),
            prices=dict(prices),
        ))
        self._price_polls += 1

    def ingest_derivatives(self, contexts: dict[str, dict]):
        """Store a derivatives snapshot (all pairs)."""
        now = time.time()
        funding = {}
        oi = {}
        volume = {}
        prices = {}

        for sym, ctx in contexts.items():
            funding[sym] = ctx.get("funding", 0)
            mark = ctx.get("mark_price") or 0
            oi_base = ctx.get("open_interest", 0)
            oi[sym] = oi_base * mark if mark else 0
            volume[sym] = ctx.get("day_volume", 0)
            prices[sym] = mark

        self._derivs.append(DerivSnapshot(
            timestamp=now,
            funding=funding,
            oi=oi,
            volume=volume,
            prices=prices,
        ))
        self._deriv_polls += 1

        # Update liquid symbols set (OI > threshold)
        min_oi = self.config.min_oi_usd
        self._liquid_symbols = {sym for sym, val in oi.items() if val >= min_oi}

    def ingest_liquidations(self, liq_data: list[dict]):
        """Store a liquidation snapshot from Coinglass (all coins)."""
        coins = {}
        for coin in liq_data:
            sym = coin.get("symbol", "")
            if not sym:
                continue
            coins[sym] = {
                "total_1h": coin.get("liquidation_usd_1h", 0) or 0,
                "long_1h": coin.get("long_liquidation_usd_1h", 0) or 0,
                "short_1h": coin.get("short_liquidation_usd_1h", 0) or 0,
                "total_24h": coin.get("liquidation_usd_24h", 0) or 0,
            }
        self._liqs.append(LiqSnapshot(timestamp=time.time(), coins=coins))

    # -----------------------------------------------------------------
    # Detection — main entry point
    # -----------------------------------------------------------------

    def detect(self) -> list[AnomalyEvent]:
        """Run all detectors and return anomalies sorted by severity."""
        anomalies: list[AnomalyEvent] = []

        # Log warmup once
        if not self._warmup_logged and self._price_polls >= _WARMUP_PRICES:
            logger.info(
                "Scanner warmed up: %d price polls, %d deriv polls, %d liquid pairs",
                self._price_polls, self._deriv_polls, len(self._liquid_symbols),
            )
            self._warmup_logged = True

        # Tier 1: Fast (price data, every 60s)
        if self._price_polls >= _WARMUP_PRICES:
            anomalies.extend(self._detect_price_spikes())

        # Tier 2: Derivatives (every 300s)
        if self._deriv_polls >= _WARMUP_DERIVS:
            anomalies.extend(self._detect_volume_surges())
            anomalies.extend(self._detect_funding_extremes())
            anomalies.extend(self._detect_funding_flips())
            anomalies.extend(self._detect_oi_surges())

        if self._deriv_polls >= _WARMUP_DIVERGENCE:
            anomalies.extend(self._detect_oi_price_divergence())

        # Tier 3: Liquidations (absolute thresholds, no warmup)
        if len(self._liqs) >= 1:
            anomalies.extend(self._detect_liquidation_cascades())
            anomalies.extend(self._detect_market_liq_wave())

        # Dedup
        self._cleanup_seen()
        unique = []
        for a in anomalies:
            if not self._is_duplicate(a.fingerprint):
                self._mark_seen(a.fingerprint, self.config.dedup_ttl_minutes * 60)
                # Apply severity boosts
                a.severity = self._boost_severity(a.symbol, a.severity)
                unique.append(a)

        unique.sort(key=lambda a: a.severity, reverse=True)
        self.anomalies_detected += len(unique)

        # Store in history for dashboard
        for a in unique:
            self._recent_anomalies.append(a)

        return unique

    def _boost_severity(self, symbol: str, severity: float) -> float:
        """Boost severity for tracked/position symbols."""
        if symbol in self.execution_symbols:
            severity += 0.1
        if symbol in self.position_symbols:
            severity += 0.15
        return min(severity, 1.0)

    def get_status(self) -> dict:
        """Export scanner state for dashboard display."""
        return {
            "active": self._warmup_logged or self._price_polls >= _WARMUP_PRICES,
            "warming_up": not self._warmup_logged and self._price_polls < _WARMUP_PRICES,
            "price_polls": self._price_polls,
            "deriv_polls": self._deriv_polls,
            "pairs_count": len(self._liquid_symbols),
            "anomalies_detected": self.anomalies_detected,
            "wakes_triggered": self.wakes_triggered,
            "recent": [
                {
                    "type": a.type,
                    "symbol": a.symbol,
                    "severity": round(a.severity, 2),
                    "headline": a.headline,
                    "detected_at": a.detected_at,
                }
                for a in reversed(self._recent_anomalies)
            ],
        }

    # -----------------------------------------------------------------
    # Dedup
    # -----------------------------------------------------------------

    def _is_duplicate(self, fingerprint: str) -> bool:
        return fingerprint in self._seen and self._seen[fingerprint] > time.time()

    def _mark_seen(self, fingerprint: str, ttl: float):
        self._seen[fingerprint] = time.time() + ttl

    def _cleanup_seen(self):
        now = time.time()
        expired = [k for k, v in self._seen.items() if v <= now]
        for k in expired:
            del self._seen[k]

    # -----------------------------------------------------------------
    # Tier 1: Price Spikes
    # -----------------------------------------------------------------

    def _detect_price_spikes(self) -> list[AnomalyEvent]:
        """Detect sudden % moves over 5min and 15min windows."""
        results = []
        current = self._prices.latest()
        if not current:
            return results

        now = current.timestamp
        cfg = self.config

        # Check 5min window (~5 polls back)
        old_5m = self._prices.nth_back(5)
        if old_5m:
            results.extend(self._check_price_window(
                current.prices, old_5m.prices, "5min",
                cfg.price_spike_5min_pct, 15 * 60, now,
            ))

        # Check 15min window (~15 polls back)
        old_15m = self._prices.nth_back(15)
        if old_15m:
            results.extend(self._check_price_window(
                current.prices, old_15m.prices, "15min",
                cfg.price_spike_15min_pct, 15 * 60, now,
            ))

        return results

    def _check_price_window(
        self, current: dict, old: dict, window: str,
        threshold_pct: float, ttl: float, now: float,
    ) -> list[AnomalyEvent]:
        results = []
        for sym, price in current.items():
            if sym not in self._liquid_symbols:
                continue
            old_price = old.get(sym)
            if not old_price or old_price == 0:
                continue

            pct = ((price - old_price) / old_price) * 100
            abs_pct = abs(pct)

            if abs_pct < threshold_pct:
                continue

            # Severity tiers
            if abs_pct >= threshold_pct * 2.5:
                severity = 0.9
            elif abs_pct >= threshold_pct * 1.7:
                severity = 0.7
            else:
                severity = 0.5

            direction = "+" if pct > 0 else ""
            headline = f"{sym} {direction}{pct:.1f}% in {window}"

            # Build detail with available deriv data
            detail_parts = [f"Price: ${old_price:,.2f} -> ${price:,.2f}"]
            deriv = self._derivs.latest()
            if deriv:
                oi = deriv.oi.get(sym, 0)
                vol = deriv.volume.get(sym, 0)
                fund = deriv.funding.get(sym, 0)
                if oi > 0:
                    detail_parts.append(f"OI: ${oi / 1e6:.1f}M")
                if vol > 0:
                    detail_parts.append(f"24h Vol: ${vol / 1e6:.1f}M")
                if fund != 0:
                    detail_parts.append(f"Funding: {fund:.4%}")

            results.append(AnomalyEvent(
                type="price_spike",
                symbol=sym,
                severity=severity,
                headline=headline,
                detail=" | ".join(detail_parts),
                fingerprint=f"price_spike:{sym}:{window}",
                detected_at=now,
            ))

        return results

    # -----------------------------------------------------------------
    # Tier 2: Volume Surges
    # -----------------------------------------------------------------

    def _detect_volume_surges(self) -> list[AnomalyEvent]:
        """Detect 24h volume significantly above rolling average."""
        results = []
        if len(self._derivs) < 3:
            return results

        current = self._derivs.latest()
        now = current.timestamp

        # Compute average volume from buffer (excluding latest)
        avg_vol: dict[str, float] = {}
        count = 0
        for i in range(1, len(self._derivs)):
            snap = self._derivs.nth_back(i)
            if snap:
                for sym, vol in snap.volume.items():
                    avg_vol[sym] = avg_vol.get(sym, 0) + vol
                count += 1

        if count == 0:
            return results

        for sym in avg_vol:
            avg_vol[sym] /= count

        for sym, vol in current.volume.items():
            if sym not in self._liquid_symbols:
                continue
            avg = avg_vol.get(sym, 0)
            if avg <= 0:
                continue

            ratio = vol / avg
            if ratio < 2.0:
                continue

            if ratio >= 5.0:
                severity = 0.9
            elif ratio >= 3.0:
                severity = 0.7
            else:
                severity = 0.5

            headline = f"{sym} volume {ratio:.1f}x avg"
            detail = f"24h Vol: ${vol / 1e6:.1f}M (avg: ${avg / 1e6:.1f}M)"
            price = current.prices.get(sym, 0)
            if price:
                detail += f" | Price: ${price:,.2f}"

            results.append(AnomalyEvent(
                type="volume_surge",
                symbol=sym,
                severity=severity,
                headline=headline,
                detail=detail,
                fingerprint=f"volume_surge:{sym}",
                detected_at=now,
            ))

        return results

    # -----------------------------------------------------------------
    # Tier 2: Funding Extremes
    # -----------------------------------------------------------------

    def _detect_funding_extremes(self) -> list[AnomalyEvent]:
        """Detect funding rates in top/bottom percentiles across all pairs."""
        results = []
        current = self._derivs.latest()
        if not current:
            return results

        now = current.timestamp
        cfg = self.config

        # Collect funding rates for liquid pairs
        rates = []
        for sym, rate in current.funding.items():
            if sym in self._liquid_symbols:
                rates.append((sym, rate))

        if len(rates) < 10:
            return results

        # Compute percentiles
        sorted_rates = sorted(r[1] for r in rates)
        n = len(sorted_rates)
        pctl_low = sorted_rates[max(0, int(n * (100 - cfg.funding_extreme_percentile) / 100))]
        pctl_high = sorted_rates[min(n - 1, int(n * cfg.funding_extreme_percentile / 100))]

        for sym, rate in rates:
            is_extreme = False
            reason = ""

            if rate >= pctl_high or rate >= cfg.funding_extreme_absolute:
                is_extreme = True
                reason = "high"
            elif rate <= pctl_low or rate <= -cfg.funding_extreme_absolute:
                is_extreme = True
                reason = "low"

            if not is_extreme:
                continue

            abs_rate = abs(rate)
            # Severity based on absolute magnitude
            if abs_rate >= cfg.funding_extreme_absolute * 3:
                severity = 0.8
            elif abs_rate >= cfg.funding_extreme_absolute * 1.5:
                severity = 0.6
            else:
                severity = 0.4

            ann_pct = abs_rate * 3 * 365 * 100  # 3 fundings/day * 365 * 100 for %
            headline = f"{sym} funding {rate:.4%}/8h ({reason})"
            detail_parts = [f"Annualized: {ann_pct:.0f}%"]
            oi = current.oi.get(sym, 0)
            if oi:
                detail_parts.append(f"OI: ${oi / 1e6:.1f}M")

            results.append(AnomalyEvent(
                type="funding_extreme",
                symbol=sym,
                severity=severity,
                headline=headline,
                detail=" | ".join(detail_parts),
                fingerprint=f"funding_extreme:{sym}:{reason}",
                detected_at=now,
            ))

        return results

    # -----------------------------------------------------------------
    # Tier 2: Funding Flips
    # -----------------------------------------------------------------

    def _detect_funding_flips(self) -> list[AnomalyEvent]:
        """Detect funding rate sign changes between polls."""
        results = []
        current = self._derivs.latest()
        prev = self._derivs.previous()
        if not current or not prev:
            return results

        now = current.timestamp

        for sym, rate in current.funding.items():
            if sym not in self._liquid_symbols:
                continue
            prev_rate = prev.funding.get(sym)
            if prev_rate is None:
                continue

            # Only flag if previous was meaningfully non-zero
            if abs(prev_rate) < 0.0001:
                continue

            # Check for sign flip
            if (prev_rate > 0 and rate < 0) or (prev_rate < 0 and rate > 0):
                severity = 0.4
                oi = current.oi.get(sym, 0)
                if oi > 5_000_000:
                    severity += 0.2
                # Check if price also moved
                curr_price = current.prices.get(sym, 0)
                prev_price = prev.prices.get(sym, 0)
                if prev_price and curr_price:
                    pct = abs((curr_price - prev_price) / prev_price) * 100
                    if pct > 1.0:
                        severity += 0.2

                direction = "negative → positive" if rate > 0 else "positive → negative"
                headline = f"{sym} funding flipped {direction}"
                detail = f"Was {prev_rate:.4%} → now {rate:.4%}"
                if oi:
                    detail += f" | OI: ${oi / 1e6:.1f}M"

                results.append(AnomalyEvent(
                    type="funding_flip",
                    symbol=sym,
                    severity=min(severity, 1.0),
                    headline=headline,
                    detail=detail,
                    fingerprint=f"funding_flip:{sym}",
                    detected_at=now,
                ))

        return results

    # -----------------------------------------------------------------
    # Tier 2: OI Surges
    # -----------------------------------------------------------------

    def _detect_oi_surges(self) -> list[AnomalyEvent]:
        """Detect significant OI changes since last poll."""
        results = []
        current = self._derivs.latest()
        prev = self._derivs.previous()
        if not current or not prev:
            return results

        now = current.timestamp
        threshold = self.config.oi_surge_pct

        for sym, oi in current.oi.items():
            if sym not in self._liquid_symbols:
                continue
            prev_oi = prev.oi.get(sym, 0)
            if prev_oi <= 0:
                continue

            pct = ((oi - prev_oi) / prev_oi) * 100
            abs_pct = abs(pct)

            if abs_pct < threshold:
                continue

            if abs_pct >= threshold * 3:
                severity = 0.9
            elif abs_pct >= threshold * 2:
                severity = 0.7
            else:
                severity = 0.5

            direction = "up" if pct > 0 else "down"
            sign = "+" if pct > 0 else ""
            headline = f"{sym} OI {sign}{pct:.0f}% in 5min"
            detail = f"OI: ${prev_oi / 1e6:.1f}M -> ${oi / 1e6:.1f}M"
            price = current.prices.get(sym, 0)
            if price:
                detail += f" | Price: ${price:,.2f}"
            fund = current.funding.get(sym, 0)
            if fund:
                detail += f" | Funding: {fund:.4%}"

            results.append(AnomalyEvent(
                type="oi_surge",
                symbol=sym,
                severity=severity,
                headline=headline,
                detail=detail,
                fingerprint=f"oi_surge:{sym}:{direction}",
                detected_at=now,
            ))

        return results

    # -----------------------------------------------------------------
    # Tier 2: OI-Price Divergence
    # -----------------------------------------------------------------

    def _detect_oi_price_divergence(self) -> list[AnomalyEvent]:
        """Detect OI rising while price is flat (compression signal)."""
        results = []
        current = self._derivs.latest()
        old = self._derivs.nth_back(2)  # 2 polls back = ~10min
        if not current or not old:
            return results

        now = current.timestamp

        for sym in self._liquid_symbols:
            curr_oi = current.oi.get(sym, 0)
            old_oi = old.oi.get(sym, 0)
            if old_oi <= 0:
                continue

            oi_pct = ((curr_oi - old_oi) / old_oi) * 100
            if oi_pct < 5.0:
                continue

            # Check price is flat
            curr_price = current.prices.get(sym, 0)
            old_price = old.prices.get(sym, 0)
            if not old_price:
                continue

            price_pct = abs((curr_price - old_price) / old_price) * 100
            if price_pct > 1.0:
                continue  # Price moved too much — not a compression

            severity = 0.5
            if oi_pct >= 10.0:
                severity += 0.2
            vol = current.volume.get(sym, 0)
            prev_vol = old.volume.get(sym, 0)
            if prev_vol > 0 and vol > prev_vol * 1.2:
                severity += 0.1

            headline = f"{sym} OI +{oi_pct:.0f}% but price flat — compression"
            detail = f"OI: ${old_oi / 1e6:.1f}M -> ${curr_oi / 1e6:.1f}M | Price ~${curr_price:,.2f} ({price_pct:+.1f}%)"

            results.append(AnomalyEvent(
                type="oi_price_divergence",
                symbol=sym,
                severity=min(severity, 1.0),
                headline=headline,
                detail=detail,
                fingerprint=f"oi_divergence:{sym}",
                detected_at=now,
            ))

        return results

    # -----------------------------------------------------------------
    # Tier 3: Liquidation Cascades
    # -----------------------------------------------------------------

    def _detect_liquidation_cascades(self) -> list[AnomalyEvent]:
        """Detect sudden spikes in 1h liquidations for individual coins."""
        results = []
        current = self._liqs.latest()
        if not current:
            return results

        now = current.timestamp
        threshold = self.config.liq_cascade_min_usd

        for sym, data in current.coins.items():
            total = data.get("total_1h", 0)
            if total < threshold:
                continue

            long_liq = data.get("long_1h", 0)
            short_liq = data.get("short_1h", 0)
            dominant = "longs" if long_liq > short_liq else "shorts"
            dom_pct = max(long_liq, short_liq) / total * 100 if total > 0 else 50

            if total >= threshold * 10:
                severity = 0.9
            elif total >= threshold * 4:
                severity = 0.7
            else:
                severity = 0.5

            headline = f"{sym} ${total / 1e6:.1f}M liquidated in 1h ({dominant} rekt)"
            detail = (
                f"Longs: ${long_liq / 1e6:.1f}M | Shorts: ${short_liq / 1e6:.1f}M | "
                f"{dominant} {dom_pct:.0f}%"
            )
            # Add 24h context
            total_24h = data.get("total_24h", 0)
            if total_24h:
                detail += f" | 24h total: ${total_24h / 1e6:.1f}M"

            results.append(AnomalyEvent(
                type="liq_cascade",
                symbol=sym,
                severity=severity,
                headline=headline,
                detail=detail,
                fingerprint=f"liq_cascade:{sym}",
                detected_at=now,
            ))

        return results

    # -----------------------------------------------------------------
    # Tier 3: Market-Wide Liquidation Wave
    # -----------------------------------------------------------------

    def _detect_market_liq_wave(self) -> list[AnomalyEvent]:
        """Detect total market 1h liquidations above threshold."""
        results = []
        current = self._liqs.latest()
        if not current:
            return results

        now = current.timestamp
        threshold = self.config.liq_wave_min_usd

        total = sum(d.get("total_1h", 0) for d in current.coins.values())
        if total < threshold:
            return results

        total_longs = sum(d.get("long_1h", 0) for d in current.coins.values())
        total_shorts = sum(d.get("short_1h", 0) for d in current.coins.values())
        dominant = "longs" if total_longs > total_shorts else "shorts"

        if total >= threshold * 4:
            severity = 0.9
        elif total >= threshold * 2:
            severity = 0.7
        else:
            severity = 0.5

        # Top 3 coins by 1h liquidation
        top_coins = sorted(
            current.coins.items(),
            key=lambda x: x[1].get("total_1h", 0),
            reverse=True,
        )[:3]
        top_str = ", ".join(
            f"{sym} ${d.get('total_1h', 0) / 1e6:.1f}M"
            for sym, d in top_coins
        )

        headline = f"Market liq wave: ${total / 1e6:.0f}M in 1h ({dominant} rekt)"
        detail = f"Longs: ${total_longs / 1e6:.0f}M | Shorts: ${total_shorts / 1e6:.0f}M | Top: {top_str}"

        results.append(AnomalyEvent(
            type="market_liq_wave",
            symbol="MARKET",
            severity=severity,
            headline=headline,
            detail=detail,
            fingerprint="market_liq_wave",
            detected_at=now,
        ))

        return results


# =============================================================================
# Wake Message Formatter
# =============================================================================

_SEVERITY_LABELS = {0.9: "HIGH", 0.7: "MEDIUM-HIGH", 0.5: "MEDIUM", 0.0: "LOW"}


def _severity_label(sev: float) -> str:
    for threshold, label in _SEVERITY_LABELS.items():
        if sev >= threshold:
            return label
    return "LOW"


def format_scanner_wake(anomalies: list[AnomalyEvent]) -> str:
    """Format anomalies into a daemon wake message."""
    top = anomalies[0]

    lines = [
        f"[DAEMON WAKE — Market Scanner: {top.headline}]",
        "",
        f"Market scanner detected {len(anomalies)} anomal{'y' if len(anomalies) == 1 else 'ies'}:",
        "",
    ]

    for i, a in enumerate(anomalies, 1):
        label = _severity_label(a.severity)
        lines.append(f"{i}. [{a.type.upper()}] {a.headline} ({label})")
        lines.append(f"   {a.detail}")
        lines.append("")

    lines.extend([
        "Assess these signals:",
        "1. Does any setup match your thesis or watchlist criteria?",
        "2. If you see a trade: research it (orderbook, funding history, trend) -> open position or store thesis",
        "3. If it's noise: note what made it look interesting but wasn't — store as a lesson",
        "4. Check existing positions — if an anomaly affects a held asset, reassess SL/TP",
        "5. Set watchpoints for any follow-up levels worth monitoring",
    ])

    return "\n".join(lines)
