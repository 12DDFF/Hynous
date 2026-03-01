# Data Module

> Market data providers and execution layer -- Hynous's connection to the outside world.

---

## Structure

```
data/
├── providers/
│   ├── hyperliquid.py     # Exchange data + order execution (Hyperliquid SDK)
│   ├── paper.py           # Paper trading simulator (wraps HyperliquidProvider)
│   ├── coinglass.py       # Cross-exchange derivatives data (Coinglass API v4)
│   ├── cryptocompare.py   # Crypto news articles (CryptoCompare News API v2)
│   ├── hynous_data.py     # HTTP client for hynous-data service (liquidations, whales, order flow)
│   ├── perplexity.py      # Web search via Perplexity Sonar API
│   └── __init__.py
└── __init__.py
```

---

## Providers

All providers follow the singleton pattern via a module-level `get_provider()` (or `get_client()`) function. All are synchronous, using `requests.Session` for connection reuse.

### HyperliquidProvider (`hyperliquid.py`)

The primary provider. Wraps the Hyperliquid Python SDK for both market data reads (always mainnet) and order execution (mainnet, testnet, or paper mode).

**Market Data Methods:**

| Method | Returns |
|--------|---------|
| `get_price(symbol)` | Current mid price for one symbol |
| `get_all_prices()` | All mid prices `{symbol: float}` |
| `get_candles(symbol, interval, start_ms, end_ms)` | OHLCV candle list |
| `get_l2_book(symbol)` | L2 orderbook snapshot (20 levels/side, spread, mid) |
| `get_funding_history(symbol, start_ms, end_ms)` | Historical funding rates |
| `get_asset_context(symbol)` | Funding, OI, volume, mark price for one symbol |
| `get_multi_asset_contexts(symbols)` | Same as above, batched (single API call) |
| `get_all_asset_contexts()` | Context for every trading pair (used by market scanner) |

**Account Methods** (require wallet):

| Method | Returns |
|--------|---------|
| `get_user_state()` | Account value, margin, withdrawable, unrealized PnL, positions |
| `get_open_orders()` | Resting limit orders |
| `get_trigger_orders(symbol?)` | Stop loss / take profit trigger orders |
| `get_user_fills(start_ms, end_ms?)` | Trade fill history |

**Trading Methods** (require exchange initialization via private key):

| Method | Description |
|--------|-------------|
| `market_open(symbol, is_buy, size_usd, slippage)` | Market order (aggressive IoC limit) |
| `market_close(symbol, size?, slippage)` | Close position (full or partial) |
| `limit_open(symbol, is_buy, limit_px, size_usd/sz, tif)` | Limit order (GTC, ALO, or IOC) |
| `place_trigger_order(symbol, is_buy, sz, trigger_px, tpsl)` | Stop loss or take profit |
| `cancel_order(symbol, oid)` | Cancel single order |
| `cancel_all_orders(symbol)` | Cancel all orders for a symbol |
| `update_leverage(symbol, leverage, is_cross)` | Set leverage for a symbol |

**Configuration:**

- Mode is controlled by `config.execution.mode`: `"paper"`, `"testnet"`, or `"live"`
- Private key: `HYPERLIQUID_PRIVATE_KEY` env var
- Data reads always use mainnet regardless of mode
- Exchange is lazily initialized only when a private key is available

**Singleton:** `get_provider(config)` returns `PaperProvider` (paper mode) or `HyperliquidProvider` (testnet/live).

---

### PaperProvider (`paper.py`)

Drop-in replacement for `HyperliquidProvider` that simulates all trading operations internally while delegating all market data reads to mainnet.

- Uses real mainnet prices for accurate PnL math
- Simulates margin, leverage, liquidation prices, taker fees (0.035%)
- Supports SL/TP trigger orders (checked by daemon each price poll via `check_triggers()`)
- Persists state to `storage/paper-state.json` (survives restarts)
- `reset_paper_stats()` marks a new session boundary for stats filtering

All data methods (`get_price`, `get_candles`, `get_l2_book`, etc.) pass through to the real `HyperliquidProvider`.

---

### CoinglassProvider (`coinglass.py`)

Cross-exchange derivatives data from the Coinglass API v4.

| Method | Data |
|--------|------|
| `get_liquidation_coins()` | Aggregate liquidation stats across all coins (1h/4h/12h/24h) |
| `get_liquidation_by_exchange(symbol, range)` | Per-exchange liquidation breakdown |
| `get_oi_by_exchange(symbol)` | Cross-exchange open interest with % changes |
| `get_oi_history_chart(symbol, range)` | OI over time by exchange |
| `get_funding_by_exchange(symbol)` | Current funding rates across exchanges |
| `get_funding_history_weighted(symbol, weight, interval, limit)` | OI/volume-weighted funding OHLC history |
| `get_options_max_pain(symbol, exchange)` | Options max pain per expiry |
| `get_options_info(symbol, exchange)` | Options OI, volume, market share by exchange |
| `get_coinbase_premium(interval, limit)` | Coinbase premium/discount index over time |
| `get_etf_flows(asset)` | Daily BTC/ETH ETF net flows |
| `get_etf_list(asset)` | ETF listings |
| `get_exchange_balance(symbol)` | Per-exchange on-chain holdings with 1d/7d/30d changes |
| `get_exchange_balance_chart(symbol, exchange)` | Historical exchange balance time series |
| `get_fear_greed()` | Fear & Greed index history |
| `get_puell_multiple(limit)` | Puell Multiple history (mining indicator) |

**Configuration:** `COINGLASS_API_KEY` environment variable (required).

---

### CryptoCompareProvider (`cryptocompare.py`)

Crypto news articles from the CryptoCompare News API v2.

| Method | Data |
|--------|------|
| `get_news(categories?, limit)` | Latest articles filtered by coin/topic (e.g., `["BTC", "Regulation"]`) |

Returns cleaned dicts with: `id`, `title`, `body` (truncated to 200 chars), `source`, `published_on`, `categories`, `url`.

**Configuration:** `CRYPTOCOMPARE_API_KEY` environment variable (optional -- works without one at lower rate limits).

---

### HynousDataClient (`hynous_data.py`)

HTTP client for the `hynous-data` service running on `:8100`. Provides data that requires persistent state or specialized scrapers.

| Method | Data |
|--------|------|
| `heatmap(coin)` / `heatmap_summary(coin)` | Liquidation heatmap (buckets, densest zones) |
| `hlp_positions()` / `hlp_summary()` | HLP vault positions (top by size) |
| `hlp_sentiment(hours)` | HLP sentiment (side flips, deltas) |
| `order_flow(coin)` / `order_flow_summary(coin)` | CVD / order flow by time window |
| `whales(coin, top_n)` / `whale_summary(coin)` | Largest positions (net bias, long/short USD) |
| `smart_money(top_n, min_win_rate, style, ...)` | Most profitable traders with filters |
| `sm_watchlist()` / `sm_watch()` / `sm_unwatch()` | Smart money wallet tracker CRUD |
| `sm_profile(address, days)` / `sm_trades(address, limit)` | Individual wallet profiles and trades |
| `sm_changes(minutes)` | Recent wallet position changes |
| `sm_create_alert()` / `sm_list_alerts()` / `sm_delete_alert()` | Wallet alert management |
| `record_historical(funding, oi, volume)` | Record snapshot data to historical tables |
| `health()` / `stats()` | Service health and statistics |

All methods return `None` on connection failure (graceful degradation). The `is_available` property tracks reachability.

**Configuration:** `data_layer.url` and `data_layer.timeout` in `config/default.yaml` (default: `http://127.0.0.1:8100`, 5s timeout).

---

### PerplexityProvider (`perplexity.py`)

Real-time web search via the Perplexity Sonar API. Gives the agent access to current news, macro events, and knowledge gaps.

| Method | Data |
|--------|------|
| `search(query, context?, max_tokens)` | Web search answer + citations |

- Model: `sonar` ($1/M tokens, 128K context)
- Temperature: 0.2 (factual)
- System prompt steers toward crypto/finance context
- Token usage is recorded for cost tracking via `core.costs`

**Configuration:** `PERPLEXITY_API_KEY` environment variable (required).

---

## Adding a New Provider

1. Create `providers/my_provider.py` with a class and `get_provider()` singleton
2. Export in `providers/__init__.py` if needed
3. Create corresponding tool(s) in `intelligence/tools/`
4. Register the tool in `intelligence/tools/registry.py`
5. Add tool strategy guidance in `intelligence/prompts/builder.py`

---

Last updated: 2026-03-01
