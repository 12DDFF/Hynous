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
from collections import defaultdict, deque
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
class BookSnapshot:
    """L2 orderbook snapshot for tracked symbols."""
    timestamp: float
    books: dict[str, dict]  # sym → {bid_depth_usd, ask_depth_usd, imbalance, top_bid_wall, top_ask_wall, best_bid, best_ask}


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
    category: str = "macro"   # "micro" or "macro" — determines wake format


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
        self._books = RollingBuffer(maxlen=10)       # L2 every 60s = 10min window
        self._candles_5m: dict[str, deque] = {}      # sym → deque(maxlen=12) = 1h of 5m candles
        self.position_directions: dict[str, str] = {}  # sym → "long"/"short" (set by daemon)

        # News buffer
        self._news: list[dict] = []           # Recent articles (last 50)
        self._seen_news_ids: set[str] = set() # Dedup by article ID
        self._alerted_news_ids: set[str] = set()  # Already alerted

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

    def ingest_orderbooks(self, books: dict[str, dict]):
        """Store an L2 orderbook snapshot for tracked symbols.

        Args:
            books: sym → raw L2 dict from provider.get_l2_book()
                   Each has keys: bids, asks, best_bid, best_ask
        """
        processed = {}
        for sym, book in books.items():
            bids = book.get("bids", [])
            asks = book.get("asks", [])

            # Top 5 levels summed (USD = price × size)
            bid_depth = sum(lv["price"] * lv["size"] for lv in bids[:5])
            ask_depth = sum(lv["price"] * lv["size"] for lv in asks[:5])
            total = bid_depth + ask_depth

            # Imbalance: 0-1, >0.5 = bid-heavy
            imbalance = bid_depth / total if total > 0 else 0.5

            # Largest single level (wall detection)
            top_bid_wall = max((lv["price"] * lv["size"] for lv in bids[:5]), default=0)
            top_ask_wall = max((lv["price"] * lv["size"] for lv in asks[:5]), default=0)

            processed[sym] = {
                "bid_depth_usd": bid_depth,
                "ask_depth_usd": ask_depth,
                "imbalance": imbalance,
                "top_bid_wall": top_bid_wall,
                "top_ask_wall": top_ask_wall,
                "best_bid": book.get("best_bid", 0),
                "best_ask": book.get("best_ask", 0),
            }

        self._books.append(BookSnapshot(timestamp=time.time(), books=processed))

    def ingest_candles(self, candles: dict[str, list[dict]]):
        """Store completed 5m candles for tracked symbols.

        Args:
            candles: sym → list of candle dicts (already trimmed by daemon).
                     Each candle has keys: t, o, h, l, c, v
        """
        for sym, candle_list in candles.items():
            if sym not in self._candles_5m:
                self._candles_5m[sym] = deque(maxlen=12)

            buf = self._candles_5m[sym]
            existing_ts = {c["t"] for c in buf}

            for c in candle_list:
                if c["t"] not in existing_ts:
                    buf.append(c)

    def ingest_news(self, articles: list[dict]):
        """Store news articles from CryptoCompare. Deduplicates by article ID."""
        for a in articles:
            aid = a.get("id", "")
            if not aid or aid in self._seen_news_ids:
                continue
            self._seen_news_ids.add(aid)
            self._news.append(a)

        # Cap buffers — rebuild seen IDs from the kept articles (deterministic)
        if len(self._news) > 50:
            self._news = self._news[-50:]
            self._seen_news_ids = {a.get("id", "") for a in self._news}

    # -----------------------------------------------------------------
    # Public Accessors
    # -----------------------------------------------------------------

    def get_recent_candles(self, symbol: str) -> list[dict]:
        """Get recent 5m candles for a symbol (up to 12, oldest first)."""
        buf = self._candles_5m.get(symbol)
        return list(buf) if buf else []

    def get_recent_news(self, symbols: list[str] | None = None, limit: int = 5) -> list[dict]:
        """Get recent news articles, optionally filtered by symbol. Newest first."""
        if not self._news:
            return []

        if symbols:
            sym_set = {s.upper() for s in symbols}
            filtered = []
            for n in reversed(self._news):
                cats = (n.get("categories", "") or "").upper()
                title = (n.get("title", "") or "").upper()
                if any(s in cats or s in title for s in sym_set):
                    filtered.append(n)
                    if len(filtered) >= limit:
                        break
            return filtered

        return list(reversed(self._news[-limit:]))

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

        # Tier 1.5: Micro (L2 + 5m candles, every 60s)
        if len(self._books) >= 3:
            anomalies.extend(self._detect_book_flip())
            anomalies.extend(self._detect_position_adverse_book())
        if any(len(c) >= 3 for c in self._candles_5m.values()):
            anomalies.extend(self._detect_momentum_burst())

        # Tier 2: Derivatives (every 300s)
        if self._deriv_polls >= _WARMUP_DERIVS:
            anomalies.extend(self._detect_funding_extremes())
            anomalies.extend(self._detect_funding_flips())
            anomalies.extend(self._detect_oi_surges())

        if self._deriv_polls >= _WARMUP_DIVERGENCE:
            anomalies.extend(self._detect_oi_price_divergence())

        # Tier 4: News alerts (no warmup needed)
        if self._news:
            anomalies.extend(self._detect_news_alert())

        # Tier 3: Liquidations (absolute thresholds, no warmup)
        if len(self._liqs) >= 1:
            anomalies.extend(self._detect_liquidation_cascades())
            anomalies.extend(self._detect_market_liq_wave())

        # Dedup (per-type TTL)
        self._cleanup_seen()
        unique = []
        for a in anomalies:
            # Book flip: non-directional dedup (ask→bid and bid→ask share key)
            dedup_key = a.fingerprint
            if a.type == "book_flip":
                dedup_key = f"book_flip:{a.symbol}"

            if not self._is_duplicate(dedup_key):
                # Per-type dedup TTL
                if a.type == "position_adverse_book":
                    ttl = 600    # 10min — risk signals need repeat
                elif a.type == "book_flip":
                    ttl = 1800   # 30min — oscillates too fast for 15min
                elif a.category == "news":
                    ttl = 3600   # 1h — news doesn't repeat
                elif a.category == "micro":
                    ttl = 900    # 15min — micro is fleeting
                else:
                    ttl = self.config.dedup_ttl_minutes * 60  # 30min — macro
                self._mark_seen(dedup_key, ttl)
                # Apply severity boosts
                a.severity = self._boost_severity(a.symbol, a.severity)
                unique.append(a)

        # --- Confluence scoring ---
        by_symbol: dict[str, list[AnomalyEvent]] = defaultdict(list)
        for a in unique:
            if a.symbol != "MARKET":
                by_symbol[a.symbol].append(a)

        confluent_remove: set[int] = set()
        for sym, events in by_symbol.items():
            if len(events) < 2:
                continue
            events.sort(key=lambda e: e.severity, reverse=True)
            top = events[0]
            others = events[1:]
            # Boost top event: +0.15 per additional signal on same symbol
            top.severity = min(top.severity + len(others) * 0.15, 1.0)
            # Append confluence context to detail
            conf_types = ", ".join(e.type for e in others)
            top.detail += f" | Confluence: +{conf_types}"
            # Mark lower events for removal
            for e in others:
                confluent_remove.add(id(e))

        if confluent_remove:
            unique = [a for a in unique if id(a) not in confluent_remove]

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
        # Recent news for dashboard (unfiltered, newest first)
        news_for_dash = []
        for n in reversed(self._news[-10:]):
            news_for_dash.append({
                "title": n.get("title", "")[:80],
                "source": n.get("source", ""),
                "published_on": n.get("published_on", 0),
                "categories": n.get("categories", ""),
            })

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
            "news": news_for_dash,
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

            # Flow direction: cross-reference OI change with price change
            curr_price = current.prices.get(sym, 0)
            prev_price = prev.prices.get(sym, 0)
            flow_label = ""
            price_pct = 0.0
            if curr_price and prev_price and prev_price > 0:
                price_pct = ((curr_price - prev_price) / prev_price) * 100
                oi_up = pct > 0
                if oi_up and price_pct > 0.5:
                    flow_label = "new longs entering"
                elif oi_up and price_pct < -0.5:
                    flow_label = "new shorts entering"
                elif not oi_up and price_pct > 0.5:
                    flow_label = "shorts covering"
                elif not oi_up and price_pct < -0.5:
                    flow_label = "longs liquidating"

            headline = f"{sym} OI {sign}{pct:.0f}% in 5min"
            if flow_label:
                headline += f" — {flow_label}"

            detail = f"OI: ${prev_oi / 1e6:.1f}M -> ${oi / 1e6:.1f}M"
            if curr_price:
                detail += f" | Price: ${curr_price:,.2f} ({price_pct:+.1f}%)"
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

    # -----------------------------------------------------------------
    # Tier 1.5: Sustained Orderbook Pressure (Micro)
    # -----------------------------------------------------------------

    def _detect_book_flip(self) -> list[AnomalyEvent]:
        """Detect sustained orderbook pressure for tracked symbols.

        Requires imbalance consistently skewed across last 3 snapshots (3+ min),
        filtering natural orderbook oscillation.
        """
        results = []
        if len(self._books) < 3:
            return results

        now = time.time()
        tracked = self.execution_symbols | self.position_symbols
        snaps = [self._books.nth_back(i) for i in range(3)]
        if any(s is None for s in snaps):
            return results

        for sym in tracked:
            imbalances = []
            for snap in snaps:
                book_data = snap.books.get(sym)
                if not book_data:
                    break
                imbalances.append(book_data["imbalance"])
            if len(imbalances) < 3:
                continue

            avg_imb = sum(imbalances) / len(imbalances)

            # ALL 3 must be consistently skewed (bid-heavy > 0.60, ask-heavy < 0.40)
            all_bid_heavy = all(imb > 0.60 for imb in imbalances)
            all_ask_heavy = all(imb < 0.40 for imb in imbalances)
            if not all_bid_heavy and not all_ask_heavy:
                continue

            direction = "ask→bid" if all_bid_heavy else "bid→ask"

            # Severity based on average deviation from balanced (0.5)
            deviation = abs(avg_imb - 0.5)
            severity = 0.5
            if deviation >= 0.25:
                severity += 0.2
            if deviation >= 0.35:
                severity += 0.1

            # Volume confirmation
            deriv = self._derivs.latest()
            if deriv:
                vol = deriv.volume.get(sym, 0)
                prev_deriv = self._derivs.previous()
                if prev_deriv:
                    prev_vol = prev_deriv.volume.get(sym, 0)
                    if prev_vol > 0 and vol > prev_vol * 1.1:
                        severity += 0.1

            curr_data = snaps[0].books.get(sym, {})
            headline = f"{sym} sustained pressure {direction} (avg {avg_imb:.2f}, 3min)"
            detail = (
                f"Imbalances: {', '.join(f'{imb:.2f}' for imb in imbalances)} | "
                f"Bid: ${curr_data.get('bid_depth_usd', 0):,.0f} | "
                f"Ask: ${curr_data.get('ask_depth_usd', 0):,.0f}"
            )

            results.append(AnomalyEvent(
                type="book_flip",
                symbol=sym,
                severity=min(severity, 1.0),
                headline=headline,
                detail=detail,
                fingerprint=f"book_flip:{sym}:{direction}",
                detected_at=now,
                category="micro",
            ))

        return results

    # -----------------------------------------------------------------
    # Tier 1.5: Momentum Burst (Micro)
    # -----------------------------------------------------------------

    def _detect_momentum_burst(self) -> list[AnomalyEvent]:
        """Detect 5m candle velocity + volume spikes."""
        results = []
        now = time.time()
        move_threshold = self.config.momentum_5m_pct / 100.0
        vol_mult = self.config.momentum_volume_mult

        for sym, buf in self._candles_5m.items():
            if len(buf) < 3:
                continue

            # Use second-to-last candle (latest may still be forming)
            candles = list(buf)
            candle = candles[-1]

            # Body move %
            if candle["o"] == 0:
                continue
            body_pct = abs(candle["c"] - candle["o"]) / candle["o"]
            if body_pct < move_threshold:
                continue

            # Volume check: compare to rolling avg of prior candles
            prior_vols = [c["v"] for c in candles[:-1]]
            if not prior_vols:
                continue
            avg_vol = sum(prior_vols) / len(prior_vols)
            if avg_vol <= 0:
                continue
            vol_ratio = candle["v"] / avg_vol
            if vol_ratio < vol_mult:
                continue

            direction = "up" if candle["c"] > candle["o"] else "down"

            severity = 0.5
            if body_pct >= move_threshold * 2:
                severity += 0.2
            # OI confirmation from derivs
            deriv = self._derivs.latest()
            prev_deriv = self._derivs.previous()
            if deriv and prev_deriv:
                curr_oi = deriv.oi.get(sym, 0)
                prev_oi = prev_deriv.oi.get(sym, 0)
                if prev_oi > 0:
                    oi_change = (curr_oi - prev_oi) / prev_oi
                    # OI moving same direction as price = confirmation
                    if (direction == "up" and oi_change > 0.01) or \
                       (direction == "down" and oi_change > 0.01):
                        severity += 0.1

            headline = f"{sym} momentum burst {direction} ({body_pct:.1%} in 5m, {vol_ratio:.1f}x vol)"
            detail = (
                f"O: ${candle['o']:,.2f} H: ${candle['h']:,.2f} "
                f"L: ${candle['l']:,.2f} C: ${candle['c']:,.2f} | "
                f"Vol: {vol_ratio:.1f}x avg"
            )

            results.append(AnomalyEvent(
                type="momentum_burst",
                symbol=sym,
                severity=min(severity, 1.0),
                headline=headline,
                detail=detail,
                fingerprint=f"momentum_burst:{sym}:{direction}",
                detected_at=now,
                category="micro",
            ))

        return results

    # -----------------------------------------------------------------
    # Tier 1.5: Position Adverse Book (Micro/Risk)
    # -----------------------------------------------------------------

    def _detect_position_adverse_book(self) -> list[AnomalyEvent]:
        """Detect orderbook flipping against open positions."""
        results = []
        current = self._books.latest()
        if not current or not self.position_directions:
            return results

        now = current.timestamp
        threshold = self.config.position_adverse_threshold

        for sym, direction in self.position_directions.items():
            book_data = current.books.get(sym)
            if not book_data:
                continue

            imbalance = book_data["imbalance"]
            adverse = False

            if direction == "long" and imbalance < threshold:
                adverse = True
            elif direction == "short" and imbalance > (1.0 - threshold):
                adverse = True

            if not adverse:
                continue

            severity = 0.65
            # Extreme adverse: <0.35 for long or >0.65 for short
            if (direction == "long" and imbalance < 0.35) or \
               (direction == "short" and imbalance > 0.65):
                severity += 0.15

            headline = f"[RISK] {sym} {direction.upper()} — book flipping against you"
            detail = (
                f"Position: {direction} | Book imbalance: {imbalance:.2f} "
                f"(threshold: {threshold}) | "
                f"Bid depth: ${book_data['bid_depth_usd']:,.0f} | "
                f"Ask depth: ${book_data['ask_depth_usd']:,.0f}"
            )

            results.append(AnomalyEvent(
                type="position_adverse_book",
                symbol=sym,
                severity=min(severity, 1.0),
                headline=headline,
                detail=detail,
                fingerprint=f"position_adverse:{sym}",
                detected_at=now,
                category="micro",
            ))

        return results


    # -----------------------------------------------------------------
    # Tier 4: News Alerts
    # -----------------------------------------------------------------

    def _detect_news_alert(self) -> list[AnomalyEvent]:
        """Detect important news articles for tracked/position symbols."""
        results = []
        now = time.time()
        max_age = getattr(self.config, "news_wake_max_age_minutes", 30) * 60
        tracked = self.execution_symbols | self.position_symbols

        for article in self._news:
            aid = article.get("id", "")
            if aid in self._alerted_news_ids:
                continue

            # Age check
            published = article.get("published_on", 0)
            if now - published > max_age:
                continue

            # Relevance check: article categories or title contain tracked symbol
            cats = (article.get("categories", "") or "").upper()
            title = (article.get("title", "") or "").upper()
            body = (article.get("body", "") or "").upper()

            relevant_syms = []
            for sym in tracked:
                if sym in cats or sym in title:
                    relevant_syms.append(sym)

            if not relevant_syms:
                continue

            # Severity
            severity = 0.6
            # Boost if article mentions a position symbol (direct risk)
            position_hit = any(s in self.position_symbols for s in relevant_syms)
            if position_hit:
                severity += 0.15
            # Boost for regulatory/exchange news
            if "REGULATION" in cats or "EXCHANGE" in cats:
                severity += 0.1

            headline = article.get("title", "")[:80]
            source = article.get("source", "")
            age_min = int((now - published) / 60)
            detail = f"Source: {source} | {age_min}m ago | {article.get('body', '')[:150]}"

            self._alerted_news_ids.add(aid)

            primary_sym = relevant_syms[0] if relevant_syms else "MARKET"
            results.append(AnomalyEvent(
                type="news_alert",
                symbol=primary_sym,
                severity=min(severity, 1.0),
                headline=headline,
                detail=detail,
                fingerprint=f"news:{aid}",
                detected_at=now,
                category="news",
            ))

        # Cap alerted IDs — keep only IDs still in news buffer (deterministic)
        if len(self._alerted_news_ids) > 200:
            current_ids = {a.get("id", "") for a in self._news}
            self._alerted_news_ids &= current_ids

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


def format_scanner_wake(
    anomalies: list[AnomalyEvent],
    position_types: dict[str, dict] | None = None,
) -> str:
    """Format anomalies into a daemon wake message.

    Categorizes by type and formats differently:
    - Position risk: urgent, listed first (adapts to scalp vs swing)
    - News: breaking news with position awareness
    - Pure micro: tight stops guidance
    - Pure macro: signal-or-noise assessment
    - Mixed: both micro and macro guidance

    Args:
        anomalies: Detected anomaly events.
        position_types: {coin: {"type": "micro"|"macro", ...}} from daemon.
    """
    # Separate by category
    risk = [a for a in anomalies if a.type == "position_adverse_book"]
    news = [a for a in anomalies if a.category == "news"]
    micro = [a for a in anomalies if a.category == "micro" and a.type != "position_adverse_book"]
    macro = [a for a in anomalies if a.category == "macro"]

    # Determine wake type and header
    top = anomalies[0]
    has_risk = bool(risk)
    has_news = bool(news)
    has_micro = bool(micro)
    has_macro = bool(macro)

    if has_risk:
        header = f"[DAEMON WAKE — POSITION RISK: {risk[0].headline}]"
    elif has_news and not has_micro and not has_macro:
        header = f"[DAEMON WAKE — Breaking News: {news[0].headline}]"
    elif has_micro and not has_macro and not has_news:
        header = f"[DAEMON WAKE — Micro Setup: {top.headline}]"
    elif has_macro and not has_micro and not has_news:
        header = f"[DAEMON WAKE — Market Scanner: {top.headline}]"
    else:
        header = f"[DAEMON WAKE — Market Signals: {top.headline}]"

    lines = [
        header,
        "",
        f"Scanner detected {len(anomalies)} anomal{'y' if len(anomalies) == 1 else 'ies'}:",
        "",
    ]

    # List risk signals first, then news, then micro, then macro
    ordered = risk + news + micro + macro
    for i, a in enumerate(ordered, 1):
        label = _severity_label(a.severity)
        lines.append(f"{i}. [{a.type.upper()}] {a.headline} ({label})")
        lines.append(f"   {a.detail}")
        lines.append("")

    # Footer based on wake type
    if has_risk:
        risk_coin = risk[0].symbol
        ptype = (position_types or {}).get(risk_coin, {}).get("type", "macro")
        if ptype == "micro":
            lines.append("This is a scalp — book flipped against you. Close or tighten SL now. Don't hold a micro against the flow. 1-2 sentences.")
        else:
            lines.append("Swing position — book pressure building. Check if your thesis still holds. Tighten stop or hold if conviction is strong. 1-2 sentences.")
    elif has_news and not has_micro and not has_macro:
        # Check if any news symbol matches a position
        news_syms = {a.symbol for a in news}
        # position_symbols is set on the scanner instance
        lines.append("Signal or noise? If it matters for your positions or thesis, act on it. 1-2 sentences.")
    elif has_micro and not has_macro:
        lines.append("If entering, Speculative size, tight SL/TP (0.3-0.5% SL, 0.5-1% TP). 1-3 sentences.")
    elif has_macro and not has_micro:
        lines.append("Quick assessment: signal or noise? If it matters for your positions or thesis, act on it. Keep your response to 1-3 sentences.")
    else:
        lines.append("Micro = tight stops. Macro = wider thesis. News = check your thesis. 1-3 sentences.")

    return "\n".join(lines)


def infer_phantom_direction(anomaly: AnomalyEvent) -> str | None:
    """Infer a tradeable direction from an anomaly event for phantom tracking.

    Returns "long", "short", or None if direction is ambiguous.
    Conservative — returns None for signals where direction isn't clear.
    """
    fp = anomaly.fingerprint
    atype = anomaly.type

    # funding_extreme:SYM:high → crowded longs paying shorts → fade them → SHORT
    # funding_extreme:SYM:low  → crowded shorts paying longs → fade them → LONG
    if atype == "funding_extreme":
        if fp.endswith(":high"):
            return "short"
        elif fp.endswith(":low"):
            return "long"
        return None

    # liq_cascade: "longs rekt" → capitulation → contrarian LONG
    # liq_cascade: "shorts rekt" → squeeze → contrarian SHORT
    if atype == "liq_cascade":
        hl = anomaly.headline.lower()
        if "longs" in hl:
            return "long"
        elif "shorts" in hl:
            return "short"
        return None

    # book_flip: ask→bid = buying pressure building → LONG
    # book_flip: bid→ask = selling pressure building → SHORT
    if atype == "book_flip":
        if "ask→bid" in fp:
            return "long"
        elif "bid→ask" in fp:
            return "short"
        return None

    # momentum_burst: up → LONG, down → SHORT
    if atype == "momentum_burst":
        if fp.endswith(":up"):
            return "long"
        elif fp.endswith(":down"):
            return "short"
        return None

    # price_spike: direction from headline sign
    if atype == "price_spike":
        # headline format: "SYM +3.2% in 5min" or "SYM -4.1% in 15min"
        hl = anomaly.headline
        pct_part = hl.split("%")[0] if "%" in hl else ""
        if "+" in pct_part:
            return "long"
        elif "-" in pct_part:
            return "short"
        return None

    # oi_surge: fingerprint has direction
    if atype == "oi_surge":
        if fp.endswith(":up"):
            return "long"
        elif fp.endswith(":down"):
            return "short"
        return None

    # Ambiguous signals — no phantom
    # oi_price_divergence, funding_flip, market_liq_wave,
    # position_adverse_book, news_alert
    return None
