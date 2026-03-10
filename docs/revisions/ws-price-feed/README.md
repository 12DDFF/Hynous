# WebSocket Price Feed — Daemon Real-Time Price Upgrade

> **Status:** Implemented
> **Priority:** High
> **Scope:** ~80 lines new code, 2 line changes, 1 new background thread, no breaking changes
> **Files affected:** `daemon.py`, `config.py`, `default.yaml`, `pyproject.toml`

---

## Problem

The daemon evaluates trailing stops, breakeven stops, and SL/TP triggers every 10 seconds in `_fast_trigger_check()`. Each iteration calls `provider.get_all_prices()` — a REST HTTP call to Hyperliquid's `all_mids` endpoint.

Two problems:

1. **10-second check interval** — At 20x leverage on BTC ($97K), a 10s gap means up to a 10% ROE swing between checks. A trailing stop that should fire at a specific ROE level can be blown through entirely. Breakeven eligibility can be missed.

2. **REST call per tick burns rate limit** — 6 REST calls/minute from the trigger loop alone. Combined with scanner polls, candle fetches, and derivatives polls, this pushes toward Hyperliquid's 429 rate limit. Fix 03 (S1) added retry + 2s TTL cache, but eliminating the calls entirely is better.

The daemon was designed with `skip_ws=True` — it avoids the SDK's WebSocket. The data-layer already uses Hyperliquid WebSocket (`TradeStream` for trades, `L2Subscriber` for orderbooks) but the daemon doesn't.

---

## Solution

Two changes:

1. **WebSocket price feed** — Subscribe to Hyperliquid's public `allMids` channel in a background thread. Maintain a live price cache updated sub-second. Use it in `_fast_trigger_check()` instead of REST.

2. **Reduce main loop sleep from 10s to 1s** — Only possible because the trigger check no longer makes a REST call (just a dict read). All other loop operations are already timer-gated and unaffected.

**Hyperliquid WebSocket:**
- Endpoint: `wss://api.hyperliquid.xyz/ws`
- Free and public — no API key, no rate limit
- Subscription: `{"method": "subscribe", "subscription": {"type": "allMids"}}`
- Message format: `{"channel": "allMids", "data": {"mids": {"BTC": "97432.5", ...}}}`
- Updates push on every price tick, sub-second latency

**Result:** Trigger checks go from every 10s with up to 10s-stale REST prices → every 1s with sub-second WS prices. At 20x leverage, max ROE slip drops from ~10% to ~1%.

---

## What This Fixes

| Metric | Before | After |
|--------|--------|-------|
| Trigger check frequency | Every 10s | Every 1s |
| Price freshness in trigger loop | 0-10s stale (REST per tick) | <1s (WS push, continuous) |
| Trailing stop max ROE slip (20x BTC) | ~10% ROE | ~1% ROE |
| Breakeven detection gap | 10s window (can miss brief crosses) | 1s window |
| REST calls from trigger loop | 6/min | 0 (WS is push-based) |
| 429 rate limit exposure | #1 consumer of rate budget | Eliminated from trigger loop |

## What This Does NOT Change

- `_poll_prices()` — Still 60s REST. Feeds scanner rolling buffers, L2 books, 5m candles. Scanner needs consistent historical snapshots, not sub-second ticks.
- Derivatives polling — Still 300s. OI/funding don't need sub-second updates.
- Satellite ML inference — Still 300s cycle.
- `_wake_agent()` blocking — Still 5-30s when agent reasons. Mechanical exits fire in the trigger check, not in the wake. Wake is post-facto notification only.
- `check_triggers()` (paper.py) — Already receives prices as parameter. Benefits automatically from WS prices.
- `_update_peaks_from_candles()` — Uses candle data, not spot prices. Unchanged.

---

## Architecture

```
WS Thread (background, always running)        Main Loop (1s sleep)
  wss://api.hyperliquid.xyz/ws                  │
  channel: allMids                              │
  push: every tick (<1s)                        │
       │                                        │
       ▼ (atomic dict replace)                  │
  _ws_prices ────────────────────────────► _fast_trigger_check() [EVERY 1s]
                                                │  • SL/TP trigger evaluation
                                                │  • Breakeven placement
                                                │  • Trailing stop activation/update
                                                │  • Peak/trough ROE tracking
                                                │
                                                ├── _poll_prices()      [gated 60s, REST → scanner]
                                                ├── _check_positions()  [gated 60s, REST → fills]
                                                ├── _poll_derivatives() [gated 300s, REST → OI/funding]
                                                └── everything else     [gated by own timers]
```

---

## Hyperliquid WebSocket Channels — Full Reference

All channels on `wss://api.hyperliquid.xyz/ws`.

| Channel | What it provides | Update rate | Used in Hynous? |
|---------|-----------------|-------------|-----------------|
| `allMids` | Mid price for every coin | Sub-second | **Proposed for daemon** |
| `trades` | Individual trade executions | Real-time | **Yes — data-layer `TradeStream`** |
| `l2Book` | Full L2 order book (100 levels/side) | Every update | **Yes — data-layer `L2Subscriber`** |
| `candle` | OHLCV candle updates per coin+interval | Per candle | No |
| `orderUpdates` | Your order status changes | Event-driven | No |
| `userEvents` | Your fills, funding, liquidations | Event-driven | No |
| `webData2` | OI, funding, mark prices, all positions | ~1s | No |
| `notification` | Account alerts (liquidation warnings) | Event-driven | No |

---

## Thread Safety

`_ws_prices` is replaced atomically on each WS message (full dict assignment). Python's GIL ensures the main loop reads either the old or new dict, never a partial state. The `_fast_trigger_check()` loop reads it; the WS thread writes it. Worst case: one iteration reads a dict that's ~100-500ms old. Acceptable — we're going from 10s to <1s.

No lock needed. Same thread-safety model as `snapshot.prices` updates elsewhere in the daemon.

---

## Dependencies

`websocket-client>=1.6.0` — needs to be added to `pyproject.toml` (not currently present).

---

## Risks / Edge Cases

| Case | Handling |
|------|----------|
| Cold start (WS not connected yet) | `_ws_prices` is empty → fallback to REST `get_all_prices()` |
| WS drops mid-session | `_ws_connected = False`, reconnect in 5s, REST fallback during gap |
| No messages for 30s | Health check forces reconnect (matches data-layer pattern) |
| VPS firewall | WSS uses port 443 — already open for data-layer WS connections |
| Message flood | `allMids` is server-throttled. One JSON parse + dict assign per tick. Negligible CPU. |
| Daemon shutdown | Thread is `daemon=True` — dies with process. Outer loop checks `self._running`. |

---

## Implementation

See **[implementation-guide.md](./implementation-guide.md)** for the complete step-by-step guide with exact line numbers, code, and testing instructions.

---

Last updated: 2026-03-09
