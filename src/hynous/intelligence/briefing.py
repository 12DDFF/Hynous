"""
Briefing System — Pre-fetched market data injected before Sonnet responds.

DataCache fetches deep market data (orderbook, 7d candles, 7d funding) during
the daemon's poll cycle — free Python HTTP calls, zero LLM tokens.

build_briefing() formats the cached data into a ~500-800 token document that
replaces the [Live State] snapshot for daemon wakes. Sonnet sees everything
upfront and doesn't need read tool calls.

build_code_questions() generates deterministic signal-based questions from the
data (funding extremes, F&G, orderbook imbalance, etc.). These are threshold
checks code can do perfectly — no LLM needed.

get_briefing_injection() provides the smart injection for user chats:
- First message or stale (>5 min): full [Briefing] block (~600 tokens)
- Subsequent messages: [Update] delta with only what changed (~30-80 tokens)
- Nothing changed: None (no injection needed)

Cost: zero (Python only).
"""

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)


# ====================================================================
# AssetData — pre-fetched deep data for one asset
# ====================================================================

@dataclass
class AssetData:
    """Pre-fetched deep data for one asset."""
    symbol: str
    # From asset context
    prev_day_price: float = 0.0
    # Orderbook summary
    spread_pct: float = 0.0
    bid_depth_usd: float = 0.0
    ask_depth_usd: float = 0.0
    imbalance: str = ""         # "Bid-heavy (62%)", "Ask-heavy (58%)", "Balanced (51/49)"
    bid_wall: tuple = (0.0, 0.0)  # (price, usd_notional)
    ask_wall: tuple = (0.0, 0.0)
    liquidity: str = ""         # "Thick", "Normal", "Thin"
    # Funding trend (7d)
    funding_avg_7d: float = 0.0
    funding_trend: str = ""     # "Rising", "Falling", "Stable"
    funding_sentiment: str = "" # "Crowded long", "Neutral", etc.
    funding_cumulative_7d: float = 0.0
    # 7d price analysis
    change_7d: float = 0.0
    trend_7d: str = ""          # "Bullish", "Bearish", "Sideways"
    vol_label_7d: str = ""      # "Low", "Moderate", "High", "Extreme"
    high_7d: float = 0.0
    low_7d: float = 0.0
    # Meta
    fetched_at: float = 0.0


# ====================================================================
# InjectedState — snapshot of last-injected values for delta computation
# ====================================================================

@dataclass
class InjectedState:
    """Snapshot of values at last injection, for delta computation."""
    timestamp: float
    datacache_poll_time: float
    prices: dict[str, float] = field(default_factory=dict)
    portfolio_value: float = 0.0
    unrealized_pnl: float = 0.0
    daily_pnl: float = 0.0
    trading_paused: bool = False
    positions: dict[str, dict] = field(default_factory=dict)
    fear_greed: int = 0
    funding: dict[str, float] = field(default_factory=dict)
    book_imbalance: dict[str, str] = field(default_factory=dict)
    memory_counts: tuple[int, int, int] = (0, 0, 0)


# ====================================================================
# DataCache — pre-fetches deep market data for briefing
# ====================================================================

class DataCache:
    """Pre-fetches deep market data for briefing injection.

    Called during daemon's derivative poll cycle (every 300s).
    Only fetches for position assets + BTC.
    """

    def __init__(self):
        self._data: dict[str, AssetData] = {}
        self._last_fetch: float = 0

    def poll(self, provider, symbols: list[str]):
        """Fetch deep data for given symbols. Called from daemon._poll_derivatives()."""
        now = time.time()

        for sym in symbols:
            try:
                asset = AssetData(symbol=sym, fetched_at=now)
                self._fetch_orderbook(provider, sym, asset)
                self._fetch_candles_7d(provider, sym, asset)
                self._fetch_funding_7d(provider, sym, asset)
                self._data[sym] = asset
            except Exception as e:
                logger.debug("DataCache: failed to fetch %s: %s", sym, e)

        self._last_fetch = now

    def get(self, symbol: str) -> AssetData | None:
        return self._data.get(symbol)

    @property
    def symbols(self) -> list[str]:
        return list(self._data.keys())

    @property
    def age_seconds(self) -> float:
        if self._last_fetch == 0:
            return float('inf')
        return time.time() - self._last_fetch

    # ---- Data fetchers ----

    @staticmethod
    def _fetch_orderbook(provider, symbol: str, asset: AssetData):
        """Fetch L2 book and compute spread, depth, imbalance, walls."""
        book = provider.get_l2_book(symbol)
        if not book:
            return

        bids = book["bids"]
        asks = book["asks"]
        mid = book["mid_price"]

        if not mid or mid == 0:
            return

        # Spread
        asset.spread_pct = (book["spread"] / mid) * 100 if mid else 0

        # Depth (sum of all levels in USD)
        bid_depth = sum(b["price"] * b["size"] for b in bids)
        ask_depth = sum(a["price"] * a["size"] for a in asks)
        asset.bid_depth_usd = bid_depth
        asset.ask_depth_usd = ask_depth

        # Imbalance
        total = bid_depth + ask_depth
        if total > 0:
            bid_pct = bid_depth / total * 100
            ask_pct = ask_depth / total * 100
            if bid_pct > 60:
                asset.imbalance = f"Bid-heavy ({bid_pct:.0f}%)"
            elif ask_pct > 60:
                asset.imbalance = f"Ask-heavy ({ask_pct:.0f}%)"
            else:
                asset.imbalance = f"Balanced ({bid_pct:.0f}/{ask_pct:.0f})"

        # Walls (largest single level)
        if bids:
            best_bid = max(bids, key=lambda b: b["price"] * b["size"])
            asset.bid_wall = (best_bid["price"], best_bid["price"] * best_bid["size"])
        if asks:
            best_ask = max(asks, key=lambda a: a["price"] * a["size"])
            asset.ask_wall = (best_ask["price"], best_ask["price"] * best_ask["size"])

        # Liquidity classification
        if total > 10_000_000:
            asset.liquidity = "Thick"
        elif total > 2_000_000:
            asset.liquidity = "Normal"
        else:
            asset.liquidity = "Thin"

    @staticmethod
    def _fetch_candles_7d(provider, symbol: str, asset: AssetData):
        """Fetch 7d of 4h candles and compute trend, volatility, range."""
        now = datetime.now(timezone.utc)
        start = now - timedelta(days=7)
        start_ms = int(start.timestamp() * 1000)
        end_ms = int(now.timestamp() * 1000)

        candles = provider.get_candles(symbol, "4h", start_ms, end_ms)
        if not candles:
            return

        closes = [c["c"] for c in candles]
        highs = [c["h"] for c in candles]
        lows = [c["l"] for c in candles]

        open_price = candles[0]["o"]
        close_price = closes[-1]

        # Change
        asset.change_7d = ((close_price - open_price) / open_price) * 100 if open_price else 0

        # High/Low
        asset.high_7d = max(highs)
        asset.low_7d = min(lows)

        # Trend (first-third vs last-third)
        n = len(closes)
        third = max(n // 3, 1)
        first_avg = sum(closes[:third]) / third
        last_avg = sum(closes[-third:]) / third
        trend_pct = ((last_avg - first_avg) / first_avg) * 100 if first_avg else 0

        if trend_pct > 2:
            asset.trend_7d = "Bullish"
        elif trend_pct < -2:
            asset.trend_7d = "Bearish"
        else:
            asset.trend_7d = "Sideways"

        # Volatility (avg absolute candle-to-candle returns)
        returns = []
        for i in range(1, len(closes)):
            if closes[i - 1] > 0:
                ret = abs((closes[i] - closes[i - 1]) / closes[i - 1]) * 100
                returns.append(ret)
        avg_return = sum(returns) / len(returns) if returns else 0

        if avg_return < 0.5:
            asset.vol_label_7d = "Low"
        elif avg_return < 1.5:
            asset.vol_label_7d = "Moderate"
        elif avg_return < 3.0:
            asset.vol_label_7d = "High"
        else:
            asset.vol_label_7d = "Extreme"

    @staticmethod
    def _fetch_funding_7d(provider, symbol: str, asset: AssetData):
        """Fetch 7d funding history and compute avg, trend, sentiment."""
        now = datetime.now(timezone.utc)
        start = now - timedelta(days=7)
        start_ms = int(start.timestamp() * 1000)
        end_ms = int(now.timestamp() * 1000)

        rates = provider.get_funding_history(symbol, start_ms, end_ms)
        if not rates:
            return

        values = [r["rate"] for r in rates]
        asset.funding_avg_7d = sum(values) / len(values) if values else 0
        asset.funding_cumulative_7d = sum(values)

        # Trend: compare first half avg vs second half avg
        mid = len(values) // 2
        if mid > 0:
            first_half = sum(values[:mid]) / mid
            second_half = sum(values[mid:]) / (len(values) - mid)
            if second_half > first_half * 1.3:
                asset.funding_trend = "Rising"
            elif second_half < first_half * 0.7:
                asset.funding_trend = "Falling"
            else:
                asset.funding_trend = "Stable"
        else:
            asset.funding_trend = "Stable"

        # Sentiment based on avg funding
        avg = asset.funding_avg_7d
        if avg > 0.0003:
            asset.funding_sentiment = "Crowded long"
        elif avg > 0.0001:
            asset.funding_sentiment = "Long-biased"
        elif avg < -0.0003:
            asset.funding_sentiment = "Crowded short"
        elif avg < -0.0001:
            asset.funding_sentiment = "Short-biased"
        else:
            asset.funding_sentiment = "Neutral"


# ====================================================================
# build_briefing() — format DataCache into injection text
# ====================================================================

def build_briefing(
    data_cache: DataCache,
    snapshot,       # MarketSnapshot from daemon
    provider,       # For portfolio/position data
    daemon,         # For daily PnL, circuit breaker
    config,
    user_state: dict | None = None,
) -> str:
    """Build a ~500-800 token briefing document for daemon wakes.

    Replaces [Live State] for daemon wakes — Sonnet sees all data upfront.
    Pass user_state to avoid redundant provider.get_user_state() calls.
    """
    sections = []

    # --- Portfolio + Positions (reuses context_snapshot logic) ---
    portfolio_section = _build_portfolio_section(provider, daemon, config, user_state=user_state)
    if portfolio_section:
        sections.append(portfolio_section)

    # --- Market line (prices, F&G) ---
    market_section = _build_market_line(snapshot, config)
    if market_section:
        sections.append(market_section)

    # --- Per-asset deep data ---
    for sym in data_cache.symbols:
        asset = data_cache.get(sym)
        if asset:
            sections.append(_format_asset_section(asset, snapshot, daemon=daemon))

    # --- News headlines (from scanner) ---
    if daemon and getattr(daemon, "_scanner", None):
        news_section = _build_news_section(daemon, config)
        if news_section:
            sections.append(news_section)

    # --- Performance stats ---
    stats_line = _build_stats_line()
    if stats_line:
        sections.append(stats_line)

    # --- Memory counts (from daemon cache) ---
    memory_line = _build_memory_line(daemon)
    if memory_line:
        sections.append(memory_line)

    return "\n\n".join(sections)


def _build_portfolio_section(provider, daemon, config, user_state: dict | None = None) -> str:
    """Portfolio value + positions with SL/TP."""
    if provider is None:
        return ""

    try:
        state = user_state or provider.get_user_state()
    except Exception:
        return "Portfolio: unavailable"

    acct = state["account_value"]
    unrealized = state["unrealized_pnl"]
    initial = config.execution.paper_balance if config else 1000
    ret_pct = ((acct - initial) / initial * 100) if initial > 0 else 0

    daily_pnl = ""
    if daemon is not None:
        dpnl = daemon._daily_realized_pnl
        daily_pnl = f" | Daily PnL: {'+' if dpnl >= 0 else ''}${dpnl:.0f}"
        if daemon._trading_paused:
            daily_pnl += " [CIRCUIT BREAKER]"

    header = (
        f"Portfolio: ${acct:,.0f} ({ret_pct:+.1f}%) | "
        f"Unrealized: {'+' if unrealized >= 0 else ''}${unrealized:.0f}"
        f"{daily_pnl}"
    )

    positions = state.get("positions", [])
    if not positions:
        return header

    # Build trigger map
    trigger_map = {}
    try:
        triggers = provider.get_trigger_orders()
        for t in triggers:
            coin = t["coin"]
            if coin not in trigger_map:
                trigger_map[coin] = {}
            otype = t.get("order_type", "")
            px = t.get("trigger_px")
            if px:
                if otype == "stop_loss":
                    trigger_map[coin]["sl"] = px
                elif otype == "take_profit":
                    trigger_map[coin]["tp"] = px
    except Exception:
        pass

    # Position type info from daemon (for scalp/swing labels)
    pos_types = {}
    if daemon:
        pos_types = getattr(daemon, '_position_types', {})

    lines = [header]
    for p in positions:
        coin = p["coin"]
        side = p["side"].upper()
        entry = p["entry_px"]
        mark = p["mark_px"]
        pnl_pct = p["return_pct"]
        pnl_usd = p["unrealized_pnl"]
        leverage = p.get("leverage", 20)

        # Trade type label (e.g., "Scalp 20x, 12m" or "Swing 10x, 4h")
        ptype = pos_types.get(coin, {})
        type_name = "Scalp" if ptype.get("type") == "micro" else "Swing"
        hold_str = ""
        entry_time = ptype.get("entry_time", 0)
        if entry_time > 0:
            hold_mins = max(0, int((time.time() - entry_time) / 60))
            if hold_mins < 60:
                hold_str = f", {hold_mins}m"
            else:
                hold_str = f", {hold_mins // 60}h{hold_mins % 60}m"
        type_tag = f" ({type_name} {leverage}x{hold_str})"

        pos_str = (
            f"  {coin} {side}{type_tag} @ ${entry:,.0f} -> ${mark:,.0f} "
            f"({pnl_pct:+.1f}%, {'+' if pnl_usd >= 0 else ''}${pnl_usd:.0f})"
        )

        triggers = trigger_map.get(coin, {})
        sl = triggers.get("sl")
        tp = triggers.get("tp")
        if sl or tp:
            parts = []
            if sl:
                parts.append(f"SL ${sl:,.0f}")
            if tp:
                parts.append(f"TP ${tp:,.0f}")
            pos_str += f" | {' '.join(parts)}"

        lines.append(pos_str)

    return "\n".join(lines)


def _build_market_line(snapshot, config) -> str:
    """Market prices + F&G from daemon's cached snapshot."""
    if snapshot is None or not snapshot.prices:
        return ""

    symbols = config.execution.symbols if config else []
    parts = []
    for sym in symbols:
        price = snapshot.prices.get(sym)
        if not price:
            continue
        prev = snapshot.prev_day_price.get(sym, 0)
        if prev and prev > 0:
            change = ((price - prev) / prev) * 100
            if price >= 1000:
                parts.append(f"{sym} ${price / 1000:.1f}K ({change:+.1f}%)")
            else:
                parts.append(f"{sym} ${price:,.0f} ({change:+.1f}%)")
        else:
            if price >= 1000:
                parts.append(f"{sym} ${price / 1000:.1f}K")
            else:
                parts.append(f"{sym} ${price:,.0f}")

    fg = snapshot.fear_greed
    if fg > 0:
        label = _fg_label(fg)
        parts.append(f"F&G {fg} ({label})")

    return f"Market: {' | '.join(parts)}" if parts else ""


def _format_asset_section(asset: AssetData, snapshot, daemon=None) -> str:
    """Format deep data for one asset."""
    sym = asset.symbol
    lines = [f"{sym}:"]

    # Current funding from snapshot
    current_funding = snapshot.funding.get(sym) if snapshot else None

    # Book line
    if asset.spread_pct or asset.bid_depth_usd:
        book_parts = []
        if asset.spread_pct:
            book_parts.append(f"Spread {asset.spread_pct:.2f}%")
        if asset.bid_depth_usd and asset.ask_depth_usd:
            book_parts.append(
                f"Bids {_fmt_big(asset.bid_depth_usd)} / "
                f"Asks {_fmt_big(asset.ask_depth_usd)}"
            )
        if asset.imbalance:
            book_parts.append(asset.imbalance)
        if asset.liquidity:
            book_parts.append(asset.liquidity)
        lines.append(f"  Book: {' | '.join(book_parts)}")

    # Funding line
    if current_funding is not None or asset.funding_avg_7d:
        fund_parts = []
        if current_funding is not None:
            fund_parts.append(f"{current_funding:+.4%} now")
        if asset.funding_avg_7d:
            fund_parts.append(f"{asset.funding_avg_7d:+.4%} avg 7d")
        if asset.funding_trend:
            trend_part = asset.funding_trend
            if asset.funding_sentiment and asset.funding_sentiment != "Neutral":
                trend_part += f", {asset.funding_sentiment.lower()}"
            fund_parts.append(f"({trend_part})")
        if asset.funding_cumulative_7d:
            fund_parts.append(f"7d cost: {abs(asset.funding_cumulative_7d):.2%}")
        lines.append(f"  Funding: {' '.join(fund_parts)}")

    # Trend line
    if asset.change_7d or asset.trend_7d:
        trend_parts = []
        if asset.change_7d:
            trend_parts.append(f"{asset.change_7d:+.1f}%")
        if asset.trend_7d:
            trend_parts.append(asset.trend_7d)
        if asset.vol_label_7d:
            trend_parts.append(f"Vol {asset.vol_label_7d}")
        if asset.high_7d and asset.low_7d:
            trend_parts.append(f"{_fmt_price(asset.low_7d)} - {_fmt_price(asset.high_7d)}")
        lines.append(f"  Trend 7d: {' | '.join(trend_parts)}")

    # 5m sparkline (from scanner candle buffer)
    if daemon and getattr(daemon, "_scanner", None):
        candles = daemon._scanner.get_recent_candles(sym)
        if candles:
            sparkline = _format_sparkline(candles, sym)
            if sparkline:
                lines.append(sparkline)

    return "\n".join(lines)


def _build_news_section(daemon, config) -> str:
    """Build news headlines section from scanner's news buffer."""
    try:
        # Gather symbols to filter by
        pos_coins = list(daemon._prev_positions.keys()) if hasattr(daemon, "_prev_positions") else []
        symbols = list(set(config.execution.symbols) | set(pos_coins))
        news = daemon._scanner.get_recent_news(symbols=symbols, limit=5)
        if not news:
            return ""

        lines = ["News:"]
        for n in news:
            age_sec = time.time() - n.get("published_on", 0)
            age_min = int(age_sec / 60)
            if age_min < 60:
                age_str = f"{age_min}m ago"
            else:
                age_str = f"{age_min // 60}h ago"
            title = n.get("title", "")[:60]
            source = n.get("source", "")
            lines.append(f'  "{title}" ({source}, {age_str})')
        return "\n".join(lines)
    except Exception:
        return ""


def _format_sparkline(candles: list[dict], symbol: str) -> str:
    """Format recent 5m candles into a compact sparkline for the briefing.

    Shows close prices as a sequence, plus range/trend/volume summary.
    ~30 tokens per symbol.
    """
    if not candles:
        return ""

    closes = [c["c"] for c in candles]
    volumes = [c["v"] for c in candles]

    # Format prices compactly
    def _compact(px: float) -> str:
        if px >= 10000:
            return f"{px / 1000:.1f}k"
        elif px >= 1000:
            return f"{px / 1000:.2f}k"
        elif px >= 1:
            return f"{px:.1f}"
        elif px >= 0.01:
            return f"{px:.4f}"
        else:
            return f"{px:.6f}"

    price_seq = "->".join(_compact(c) for c in closes)

    # Range
    high = max(c["h"] for c in candles)
    low = min(c["l"] for c in candles)

    # Trend: first-third vs last-third avg
    n = len(closes)
    third = max(n // 3, 1)
    first_avg = sum(closes[:third]) / third
    last_avg = sum(closes[-third:]) / third
    trend_pct = ((last_avg - first_avg) / first_avg) * 100 if first_avg else 0

    if trend_pct > 0.5:
        trend = f"up +{trend_pct:.1f}%"
    elif trend_pct < -0.5:
        trend = f"down {trend_pct:.1f}%"
    else:
        trend = "flat"

    # Volume: last 3 vs first 3
    if len(volumes) >= 6:
        early_vol = sum(volumes[:3]) / 3
        late_vol = sum(volumes[-3:]) / 3
        if early_vol > 0:
            ratio = late_vol / early_vol
            if ratio > 1.3:
                vol_label = "rising"
            elif ratio < 0.7:
                vol_label = "falling"
            else:
                vol_label = "steady"
        else:
            vol_label = "steady"
    else:
        vol_label = "warming up"

    warmup = " (warming up)" if n < 6 else ""
    lines = [
        f"  Price 1h (5m): {price_seq}{warmup}",
        f"    Range: {_fmt_price(low)}-{_fmt_price(high)} | Trend: {trend} | Vol: {vol_label}",
    ]
    return "\n".join(lines)


def _build_stats_line() -> str:
    """Performance stats one-liner from trade analytics."""
    try:
        from ..core.trade_analytics import get_trade_stats, format_stats_compact
        stats = get_trade_stats()
        if stats.total_trades > 0:
            return format_stats_compact(stats)
    except Exception:
        pass
    return ""


def _build_memory_line(daemon) -> str:
    """Memory counts from daemon's cached values."""
    if daemon is None:
        return ""

    parts = []
    wp = getattr(daemon, "_active_watchpoint_count", 0)
    th = getattr(daemon, "_active_thesis_count", 0)
    cu = getattr(daemon, "_pending_curiosity_count", 0)
    parts.append(f"{wp} watchpoints")
    parts.append(f"{th} theses")
    parts.append(f"{cu} curiosity")
    return f"Memory: {' | '.join(parts)}"


# ====================================================================
# build_code_questions() — deterministic threshold-based questions
# ====================================================================

def build_code_questions(
    data_cache: DataCache,
    snapshot,               # MarketSnapshot
    positions: list[dict],  # From provider.get_user_state()["positions"]
    config,
    daemon=None,
) -> list[str]:
    """Generate deterministic signal-based questions from pre-fetched data.

    These are threshold checks code can do perfectly.
    NOT overlapping with wake_warnings (no SL/TP, thesis, staleness checks).
    Returns 0-4 questions.
    """
    questions = []

    # Build position coin set
    position_coins = {p["coin"] for p in positions} if positions else set()

    for sym in data_cache.symbols:
        asset = data_cache.get(sym)
        if not asset:
            continue

        current_funding = snapshot.funding.get(sym) if snapshot else None

        # 1. Funding vs 7d avg — divergence check
        if current_funding is not None and asset.funding_avg_7d:
            avg = asset.funding_avg_7d
            if avg != 0:
                deviation = (current_funding - avg) / abs(avg)
                if abs(deviation) > 0.3:
                    direction = "above" if deviation > 0 else "below"
                    questions.append(
                        f"{sym} funding {current_funding:+.4%} is "
                        f"{abs(deviation) * 100:.0f}% {direction} 7d avg "
                        f"({avg:+.4%}) — crowded?"
                    )

        # 3. Orderbook imbalance >60%
        if asset.bid_depth_usd and asset.ask_depth_usd:
            total = asset.bid_depth_usd + asset.ask_depth_usd
            if total > 0:
                bid_pct = asset.bid_depth_usd / total * 100
                ask_pct = asset.ask_depth_usd / total * 100
                if ask_pct > 60:
                    questions.append(
                        f"{sym} ask-heavy ({ask_pct:.0f}%) — selling pressure above?"
                    )
                elif bid_pct > 60 and sym in position_coins:
                    # Only flag bid-heavy if we have a position (otherwise noise)
                    questions.append(
                        f"{sym} bid-heavy ({bid_pct:.0f}%) — support or absorption?"
                    )

        # 4. 24h price move >3%
        current_price = snapshot.prices.get(sym) if snapshot else None
        prev_price = snapshot.prev_day_price.get(sym, 0) if snapshot else 0
        if current_price and prev_price > 0:
            change_24h = ((current_price - prev_price) / prev_price) * 100
            if abs(change_24h) > 3:
                direction = "up" if change_24h > 0 else "down"
                questions.append(
                    f"{sym} {direction} {abs(change_24h):.1f}% in 24h — "
                    f"pullback or trend change?"
                )

        # 5. Position near 7d support/resistance (<2%)
        if sym in position_coins and current_price and asset.high_7d and asset.low_7d:
            dist_to_high = abs(current_price - asset.high_7d) / asset.high_7d * 100
            dist_to_low = abs(current_price - asset.low_7d) / asset.low_7d * 100
            if dist_to_high < 2 and current_price < asset.high_7d:
                questions.append(
                    f"{sym} at {_fmt_price(current_price)}, near 7d resistance "
                    f"{_fmt_price(asset.high_7d)} — plan if rejected?"
                )
            elif dist_to_low < 2 and current_price > asset.low_7d:
                questions.append(
                    f"{sym} at {_fmt_price(current_price)}, near 7d support "
                    f"{_fmt_price(asset.low_7d)} — plan if broken?"
                )

        # 6. Funding cost for open positions
        if sym in position_coins and current_funding is not None and abs(current_funding) > 0.0001:
            # Find position size for cost calc
            for p in positions:
                if p["coin"] == sym:
                    daily_cost = abs(current_funding) * 3 * p.get("size_usd", 0)
                    if daily_cost > 0.5:  # Only mention if >$0.50/day
                        questions.append(
                            f"Your {sym} position costs {current_funding:+.4%}/8h "
                            f"(~${daily_cost:.2f}/day) in funding"
                        )
                    break

    # 2. F&G extreme zone (<25 or >75)
    fg = snapshot.fear_greed if snapshot else 0
    if fg > 0:
        if fg >= 75:
            questions.append(
                f"F&G at {fg} (Extreme Greed) — what flips your bias?"
            )
        elif fg <= 25:
            questions.append(
                f"F&G at {fg} (Extreme Fear) — what flips your bias?"
            )

    # Cap at 4 questions
    return questions[:4]


# ====================================================================
# Delta briefing injection for user chats
# ====================================================================

_last_state: InjectedState | None = None
_last_full_briefing_time: float = 0
_FULL_BRIEFING_TTL = 300  # 5 minutes — full briefing every 5 min


def _get_daemon():
    """Get active daemon (inline import to avoid circular)."""
    from .daemon import get_active_daemon
    return get_active_daemon()


def _capture_state(daemon, now: float, user_state: dict | None = None) -> InjectedState:
    """Capture current market/portfolio state for delta computation.

    Pass user_state to avoid redundant provider.get_user_state() calls.
    """
    state = InjectedState(
        timestamp=now,
        datacache_poll_time=daemon._data_cache._last_fetch,
    )

    # Prices, funding, F&G from daemon snapshot
    if daemon.snapshot:
        state.prices = dict(daemon.snapshot.prices)
        state.funding = dict(daemon.snapshot.funding)
        state.fear_greed = daemon.snapshot.fear_greed

    # Portfolio + positions from provider (reuse if passed)
    try:
        if user_state is None:
            from ..data.providers.hyperliquid import get_provider
            user_state = get_provider().get_user_state()
        state.portfolio_value = user_state.get("account_value", 0)
        state.unrealized_pnl = user_state.get("unrealized_pnl", 0)
        for p in user_state.get("positions", []):
            state.positions[p["coin"]] = {
                "side": p["side"],
                "entry_px": p["entry_px"],
                "mark_px": p["mark_px"],
                "pnl_usd": p["unrealized_pnl"],
                "pnl_pct": p["return_pct"],
            }
    except Exception:
        pass

    # Daily PnL + circuit breaker
    state.daily_pnl = daemon._daily_realized_pnl
    state.trading_paused = daemon._trading_paused

    # Memory counts
    state.memory_counts = (
        getattr(daemon, "_active_watchpoint_count", 0),
        getattr(daemon, "_active_thesis_count", 0),
        getattr(daemon, "_pending_curiosity_count", 0),
    )

    # Book imbalance from DataCache
    for sym in daemon._data_cache.symbols:
        asset = daemon._data_cache.get(sym)
        if asset and asset.imbalance:
            state.book_imbalance[sym] = asset.imbalance

    return state


def get_briefing_injection() -> str | None:
    """Get briefing injection for user chats — full or delta.

    Returns:
        "[Briefing ...] ... [End Briefing]"  — full briefing (~600 tokens)
        "[Update ...] ... [End Update]"      — delta only (~30-80 tokens)
        None                                  — nothing changed, or daemon not running
    """
    global _last_state, _last_full_briefing_time

    daemon = _get_daemon()
    if daemon is None or not daemon._data_cache.symbols:
        return None

    now = time.time()
    datacache_time = daemon._data_cache._last_fetch

    need_full = (
        _last_state is None
        or datacache_time != _last_state.datacache_poll_time
        or (now - _last_full_briefing_time) > _FULL_BRIEFING_TTL
    )

    if need_full:
        return _build_and_store_full(daemon, now, datacache_time)
    else:
        return _build_delta(daemon, now)


def _build_and_store_full(daemon, now: float, datacache_time: float) -> str | None:
    """Build full briefing, store state, return wrapped text."""
    global _last_state, _last_full_briefing_time

    try:
        from ..data.providers.hyperliquid import get_provider
        provider = get_provider()

        # Fetch user state ONCE — shared by briefing and state capture
        user_state = provider.get_user_state()

        briefing = build_briefing(
            daemon._data_cache, daemon.snapshot, provider, daemon, daemon.config,
            user_state=user_state,
        )
        if not briefing:
            return None

        _last_state = _capture_state(daemon, now, user_state=user_state)
        _last_full_briefing_time = now

        return (
            f"[Briefing — auto-updated, no tool calls needed]\n"
            f"{briefing}\n"
            f"[End Briefing]"
        )
    except Exception as e:
        logger.debug("Full briefing build failed: %s", e)
        return None


def _build_delta(daemon, now: float) -> str | None:
    """Compare current state to last injection, return delta or None."""
    global _last_state

    try:
        current = _capture_state(daemon, now)
    except Exception as e:
        logger.debug("Delta capture failed: %s", e)
        return None

    old = _last_state
    changes: list[str] = []

    # Price changes (>0.1% move)
    price_parts = []
    for sym in current.prices:
        new_px = current.prices[sym]
        old_px = old.prices.get(sym, 0)
        if old_px > 0 and abs(new_px - old_px) / old_px > 0.001:
            pct = ((new_px - old_px) / old_px) * 100
            price_parts.append(
                f"{sym} {_fmt_price(old_px)} -> {_fmt_price(new_px)} ({pct:+.1f}%)"
            )
    if price_parts:
        changes.append("Prices: " + " | ".join(price_parts))

    # Position PnL changes (>$1 or new/closed positions)
    old_coins = set(old.positions.keys())
    new_coins = set(current.positions.keys())

    for coin in new_coins - old_coins:
        p = current.positions[coin]
        changes.append(f"NEW: {coin} {p['side']} @ {_fmt_price(p['entry_px'])}")

    for coin in old_coins - new_coins:
        changes.append(f"CLOSED: {coin}")

    for coin in old_coins & new_coins:
        old_p = old.positions[coin]
        new_p = current.positions[coin]
        old_usd = old_p["pnl_usd"]
        new_usd = new_p["pnl_usd"]
        if abs(new_usd - old_usd) > 1:
            changes.append(
                f"{coin}: {'+' if old_usd >= 0 else ''}${old_usd:.0f} -> "
                f"{'+' if new_usd >= 0 else ''}${new_usd:.0f} "
                f"({old_p['pnl_pct']:+.1f}% -> {new_p['pnl_pct']:+.1f}%)"
            )

    # Portfolio value (>$5 change)
    if abs(current.portfolio_value - old.portfolio_value) > 5:
        changes.append(
            f"Portfolio: ${old.portfolio_value:,.0f} -> ${current.portfolio_value:,.0f}"
        )

    # F&G (>2 points)
    if current.fear_greed > 0 and abs(current.fear_greed - old.fear_greed) > 2:
        changes.append(f"F&G: {old.fear_greed} -> {current.fear_greed}")

    # Book imbalance label changed
    for sym in current.book_imbalance:
        new_label = current.book_imbalance[sym]
        old_label = old.book_imbalance.get(sym, "")
        if new_label != old_label:
            changes.append(f"{sym} book: {old_label or '?'} -> {new_label}")

    # Funding rate (>1bp change)
    for sym in current.funding:
        new_f = current.funding[sym]
        old_f = old.funding.get(sym, 0)
        if abs(new_f - old_f) > 0.0001:
            changes.append(f"{sym} funding: {old_f:+.4%} -> {new_f:+.4%}")

    # Memory counts
    if current.memory_counts != old.memory_counts:
        old_wp, old_th, old_cu = old.memory_counts
        new_wp, new_th, new_cu = current.memory_counts
        parts = []
        if new_wp != old_wp:
            parts.append(f"watchpoints {old_wp}->{new_wp}")
        if new_th != old_th:
            parts.append(f"theses {old_th}->{new_th}")
        if new_cu != old_cu:
            parts.append(f"curiosity {old_cu}->{new_cu}")
        if parts:
            changes.append("Memory: " + ", ".join(parts))

    # Circuit breaker
    if current.trading_paused != old.trading_paused:
        if current.trading_paused:
            changes.append("CIRCUIT BREAKER TRIGGERED")
        else:
            changes.append("Circuit breaker reset")

    # Update stored state
    _last_state = current

    if not changes:
        return None

    # Age is from last FULL briefing (not last delta)
    age_sec = now - _last_full_briefing_time
    if age_sec < 120:
        age_str = f"{int(age_sec)}s"
    else:
        age_str = f"{int(age_sec / 60)}m"

    body = "\n".join(changes)
    return f"[Update — {age_str} since briefing]\n{body}\n[End Update]"


def invalidate_briefing_cache():
    """Force full briefing on next access (call after trades/position changes)."""
    global _last_state
    _last_state = None


# ====================================================================
# Formatting helpers
# ====================================================================

def _fmt_price(price: float) -> str:
    """Format a price for compact display."""
    if price >= 1000:
        return f"${price:,.0f}"
    elif price >= 1:
        return f"${price:,.2f}"
    elif price >= 0.01:
        return f"${price:.4f}"
    else:
        return f"${price:.6f}"


def _fmt_big(n: float) -> str:
    """Format large numbers compactly."""
    if n >= 1_000_000_000:
        return f"${n / 1_000_000_000:.1f}B"
    elif n >= 1_000_000:
        return f"${n / 1_000_000:.1f}M"
    elif n >= 1_000:
        return f"${n / 1_000:.1f}K"
    else:
        return f"${n:.0f}"


def _fg_label(value: int) -> str:
    """Human label for Fear & Greed index."""
    if value <= 20:
        return "Extreme Fear"
    elif value <= 40:
        return "Fear"
    elif value <= 60:
        return "Neutral"
    elif value <= 80:
        return "Greed"
    else:
        return "Extreme Greed"
