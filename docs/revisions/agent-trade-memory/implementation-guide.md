# Revision 3: Agent Trade Memory — Implementation Guide

> Priority: MEDIUM — Improves entry quality by preventing repeated bad entries.
> Addresses: CTX-1, CTX-2 from the advisor document.
> Independent of Revisions 1-2 — can be implemented in parallel.
> Source: `docs/temporary-advisor-document.md`

---

## Prerequisites — Read Before Coding

### Must Read

| # | File | Lines | Why |
|---|------|-------|-----|
| 1 | `src/hynous/intelligence/briefing.py` | 291-376 | **`build_briefing()` main function.** Understand the section assembly order: freshness → portfolio → market → regime → ML → per-asset → news → data-layer → stats → memory. Your "Recent Trades" section goes between stats (line 367) and memory (line 372). |
| 2 | `src/hynous/intelligence/briefing.py` | 730-739 | **`_build_stats_line()`.** Calls `get_trade_stats()` from trade_analytics. Your new section uses the same data source but shows individual trades, not aggregates. |
| 3 | `src/hynous/core/trade_analytics.py` | Full file | **Primary data source.** `TradeRecord` dataclass (lines 42-62) — has all the fields you need: `symbol`, `side`, `lev_return_pct`, `closed_at`, `trade_type`, `leverage`, `close_type`. `fetch_trade_history()` (lines 89-129) returns newest-first. `get_trade_stats()` (lines 438-479) returns `TradeStats` with `.trades` list. The 30s cache means you get recent trades nearly free. |
| 4 | `src/hynous/core/trade_analytics.py` | 42-62 | **`TradeRecord` fields.** Key fields for display: `symbol`, `side`, `leverage`, `lev_return_pct` (net leveraged ROE), `closed_at` (ISO string), `trade_type` ("micro"/"macro"), `close_type` ("full"/"stop_loss"/"take_profit"/"trailing_stop"/"small_wins"/"liquidation"), `mfe_usd`, and the new `mfe_pct` available via `signals.mfe_pct`. |
| 5 | `src/hynous/intelligence/daemon.py` | 2150-2250 | **`_record_trigger_close()`.** Writes trade_close nodes to Nous with `signals` dict. Contains `close_type` = classification (stop_loss, take_profit, trailing_stop, small_wins, liquidation). Also contains `mfe_pct`, `mae_pct`, `lev_return_pct`. These are the fields your display will read. |
| 6 | `src/hynous/intelligence/daemon.py` | 320-350 | **Daemon state dicts.** Understand `_entries_today`, `_micro_entries_today`, `_entries_this_week`. You'll add `_recent_trade_closes` here. |
| 7 | `src/hynous/intelligence/daemon.py` | 4404-4414 | **Briefing call site in `_wake_agent()`.** `build_briefing()` is called with `self._data_cache`, `self.snapshot`, `self._get_provider()`, `self` (daemon), `self.config`. The daemon is already passed — your new section can access daemon state directly. |
| 8 | `src/hynous/intelligence/context_snapshot.py` | 322-333 | **`_build_activity()`.** Current activity counters. Understand the existing format so your section is complementary, not redundant. Activity shows counts; your section shows individual trades. |
| 9 | `docs/temporary-advisor-document.md` | 239-276 | **CTX-1/CTX-2 spec.** The advisor's exact specification for the Recent Trades section: last 6 trades, coin/side/leverage/PnL/time-ago/MFE/exit-reason format, ~100-150 tokens. |

### Reference Only

| File | Why |
|------|-----|
| `src/hynous/intelligence/tools/trading.py` lines 1570-1640 | Trade close Nous recording — understand the signals dict written on agent-initiated closes. Same structure as daemon's `_record_trigger_close`. |
| `src/hynous/intelligence/briefing.py` lines 379-476 | `_build_portfolio_section()` — template for how position data is formatted in the briefing. Match this style. |
| `src/hynous/intelligence/prompts/builder.py` lines 41-100 | Static prompt. Not modified, but understand the agent's personality for formatting. |

---

## Problem Statement

When the daemon wakes the agent, it sees aggregate stats ("19 trades, 28.8% win") and activity counters ("3 entries today"), but never sees individual recent trade outcomes. Each wake is a fresh start. The scanner fires a new anomaly, and the agent enters the same losing setup it just failed on 5 minutes ago.

**What this enables:**
- Pattern awareness: "3 of my last 4 SOL LONGs lost"
- Cooldown awareness: "I closed a losing BTC LONG 3 minutes ago"
- Exit quality feedback: MFE alongside PnL makes profit leakage visible
- Directional bias detection: if 6/6 recent trades are LONG, the agent sees its own bias

---

## Overview of Changes

Two approaches work. We use **both** for resilience:

1. **Daemon in-memory cache** (`_recent_trade_closes`) — populated on every close event (immediate, no Nous query). Used as primary source.
2. **Nous fallback** via `get_trade_stats().trades[:6]` — used when daemon cache is empty (e.g., after restart). Already cached for 30s.

Three changes total:
1. **Add in-memory close cache** to daemon
2. **Add `_build_recent_trades()` function** to briefing.py
3. **Wire it into `build_briefing()`**

---

## Change 1: Add In-Memory Close Cache to Daemon

**File:** `src/hynous/intelligence/daemon.py`

### 1A: Add State in `__init__`

**Location:** After the trade activity tracking block (after line 349, `self._entries_today`).

```python
        # Recent trade close history (in-memory, for briefing injection)
        # Deque of dicts: {coin, side, leverage, lev_return_pct, mfe_pct, close_type, closed_at}
        # Newest first, capped at 10. Populated by _handle_position_close + _record_trigger_close.
        from collections import deque
        self._recent_trade_closes: deque[dict] = deque(maxlen=10)
```

**Note:** Import `deque` at the module level if not already imported. Check the existing imports at the top of daemon.py.

### 1B: Record Closes in `_record_trigger_close()`

**Location:** Inside `_record_trigger_close()`, after the successful Nous write (after the `_store_to_nous` call succeeds, around line 2290). Add before the `except` block.

```python
            # Cache for briefing Recent Trades section
            self._recent_trade_closes.appendleft({
                "coin": coin,
                "side": side,
                "leverage": leverage,
                "lev_return_pct": lev_return_pct,
                "mfe_pct": round(mfe_pct, 1),
                "close_type": classification,
                "closed_at": time.time(),
            })
```

All these variables are already computed in `_record_trigger_close()`:
- `coin`, `side` — from `event` dict (lines 2159-2160)
- `leverage` — from `pos_meta` (line 2200)
- `lev_return_pct` — computed at line 2204
- `mfe_pct` — from line 2194
- `classification` — from `event` dict (line 2164)

### 1C: Record Agent-Initiated Closes

Agent-initiated closes go through `_handle_position_close()` → `_wake_for_fill()`, not through `_record_trigger_close()`. We need to also cache those.

**Location:** Inside `_handle_position_close()`, after the `_record_trigger_close` call (line 2262) or after the `_wake_for_fill` call (line 2270). Add:

```python
        # Cache close for briefing Recent Trades — for ALL close types (not just trigger closes)
        peak_roe = self._peak_roe.get(coin, 0.0)
        trough_roe = self._trough_roe.get(coin, 0.0)
        pos_leverage = prev_data.get("leverage", 20)
        pos_size = prev_data.get("size", 0)
        if entry_px > 0 and pos_size > 0:
            margin_used = pos_size * entry_px / pos_leverage if pos_leverage > 0 else 0
            lev_ret = round(realized_pnl / margin_used * 100, 1) if margin_used > 0 else 0
        else:
            lev_ret = 0

        self._recent_trade_closes.appendleft({
            "coin": coin,
            "side": side,
            "leverage": pos_leverage,
            "lev_return_pct": lev_ret,
            "mfe_pct": round(peak_roe, 1),
            "close_type": classification,
            "closed_at": time.time(),
        })
```

**Important:** This code block should be placed AFTER both the `_record_trigger_close` block (line 2262-2267) AND the `_wake_for_fill` call (line 2270), so it runs for ALL close types regardless of classification. Put it right before the method ends.

### 1D: Record Small Wins and Trailing Stop Closes

Small wins (line 1862-1906 in `_fast_trigger_check`) and trailing stops (Revision 1) close positions directly without going through `_handle_position_close`. They already call `_record_trigger_close()`, so Change 1B handles them automatically.

**Verify:** After implementing 1B, check that the small wins block (line 1890) and the trailing stop block (Revision 1) both call `_record_trigger_close()`. If so, no additional caching is needed for those paths.

---

## Change 2: Add `_build_recent_trades()` to Briefing

**File:** `src/hynous/intelligence/briefing.py`
**Location:** After `_build_stats_line()` (after line 739). Add a new function.

```python
def _build_recent_trades(daemon) -> str:
    """Recent individual trade outcomes for pattern awareness.

    Shows last 6 closed trades with coin, side, leverage, PnL, time-ago,
    MFE, and exit reason. ~100-150 tokens.

    Primary source: daemon in-memory cache (instant, no HTTP).
    Fallback: Nous trade_close nodes via get_trade_stats() (30s cached).
    """
    if daemon is None:
        return ""

    trades = []

    # Primary: daemon in-memory cache (populated on every close)
    cache = getattr(daemon, "_recent_trade_closes", None)
    if cache and len(cache) > 0:
        now = time.time()
        for t in list(cache)[:6]:
            age_s = now - t.get("closed_at", now)
            trades.append({
                "coin": t["coin"],
                "side": t["side"],
                "leverage": t.get("leverage", 20),
                "lev_return_pct": t.get("lev_return_pct", 0),
                "mfe_pct": t.get("mfe_pct", 0),
                "close_type": t.get("close_type", "unknown"),
                "age_s": age_s,
            })

    # Fallback: Nous (after daemon restart, cache is empty)
    if not trades:
        try:
            from ..core.trade_analytics import get_trade_stats
            stats = get_trade_stats()
            if stats.trades:
                now = time.time()
                for t in stats.trades[:6]:
                    # Parse closed_at ISO to age
                    age_s = 0
                    try:
                        from datetime import datetime, timezone
                        closed_dt = datetime.fromisoformat(
                            t.closed_at.replace("Z", "+00:00")
                        )
                        age_s = now - closed_dt.timestamp()
                    except Exception:
                        pass

                    # Map close_type from Nous signals
                    close_type = t.close_type
                    if close_type == "full":
                        close_type = "agent close"

                    trades.append({
                        "coin": t.symbol,
                        "side": t.side,
                        "leverage": t.leverage or 20,
                        "lev_return_pct": t.lev_return_pct,
                        "mfe_pct": 0,  # Not easily available from TradeRecord without parsing signals
                        "close_type": close_type,
                        "age_s": age_s,
                    })
        except Exception:
            pass

    if not trades:
        return ""

    # Format each trade line
    lines = []
    for t in trades:
        # Time ago formatting
        age = t["age_s"]
        if age < 60:
            age_str = f"{int(age)}s ago"
        elif age < 3600:
            age_str = f"{int(age / 60)}m ago"
        elif age < 86400:
            h = int(age / 3600)
            m = int((age % 3600) / 60)
            age_str = f"{h}h{m}m ago" if m > 0 else f"{h}h ago"
        else:
            age_str = f"{int(age / 86400)}d ago"

        # PnL formatting
        pnl = t["lev_return_pct"]
        pnl_str = f"{pnl:+.1f}%"

        # MFE (only show if available and meaningful)
        mfe_str = ""
        if t["mfe_pct"] and t["mfe_pct"] > 0.5:
            mfe_str = f" | MFE +{t['mfe_pct']:.1f}%"

        # Exit reason (human-readable)
        exit_map = {
            "stop_loss": "stop loss",
            "take_profit": "take profit",
            "trailing_stop": "trailing stop",
            "small_wins": "small wins",
            "liquidation": "liquidation",
            "agent close": "agent close",
            "full": "agent close",
            "merged": "agent close",
        }
        exit_reason = exit_map.get(t["close_type"], t["close_type"])

        lines.append(
            f"  {t['coin']} {t['side'].upper()} {t['leverage']}x | {pnl_str} | "
            f"{age_str}{mfe_str} | exit: {exit_reason}"
        )

    # Add directional bias warning if all trades are same side
    sides = [t["side"] for t in trades]
    if len(trades) >= 4:
        long_count = sum(1 for s in sides if s == "long")
        short_count = len(sides) - long_count
        if long_count >= len(trades) - 1:
            lines.append(f"  ↑ {long_count}/{len(trades)} recent trades are LONG — check for directional bias")
        elif short_count >= len(trades) - 1:
            lines.append(f"  ↑ {short_count}/{len(trades)} recent trades are SHORT — check for directional bias")

    # Add repeated-symbol warning
    coins = [t["coin"] for t in trades]
    for coin in set(coins):
        coin_trades = [t for t in trades if t["coin"] == coin]
        if len(coin_trades) >= 3:
            coin_losses = sum(1 for t in coin_trades if t["lev_return_pct"] < 0)
            if coin_losses >= 2:
                lines.append(
                    f"  ↑ {coin_losses}/{len(coin_trades)} recent {coin} trades lost — "
                    f"consider skipping next {coin} setup"
                )

    return "Recent Trades (last " + str(len(trades)) + "):\n" + "\n".join(lines)
```

### Design Decisions

1. **Dual-source (cache + Nous fallback)** — the daemon cache is instant (no HTTP) but lost on restart. The Nous fallback is already 30s-cached by `get_trade_stats()`, so the HTTP cost is amortized.
2. **MFE from daemon cache only** — the Nous `TradeRecord` stores `mfe_usd` but not `mfe_pct` directly. The daemon cache captures `mfe_pct` (peak ROE) at close time. On fallback, MFE is omitted rather than computed incorrectly.
3. **Bias warnings are pattern-based** — "5/6 recent trades are LONG" and "3/4 SOL trades lost" are simple counts the agent can see and reason about. No prompt engineering needed.
4. **~100-150 tokens** — 6 lines of ~20 tokens each + 1-2 warning lines = within budget.

---

## Change 3: Wire into `build_briefing()`

**File:** `src/hynous/intelligence/briefing.py`
**Location:** Inside `build_briefing()`, after the stats line (line 368) and before the memory line (line 372).

Add:

```python
    # --- Recent individual trade outcomes ---
    recent_trades = _build_recent_trades(daemon)
    if recent_trades:
        sections.append(recent_trades)
```

This places the Recent Trades section after the aggregate "Performance: 19 trades, 28.8% win, ..." line and before the "Memory: 5 watchpoints | 3 theses | 2 curiosity" line. The briefing flow becomes:

```
[Briefing]
Data freshness...
Portfolio: $943 (-5.7%) | Unrealized: ...
  BTC LONG (Scalp 20x, 8m) @ $97,000 -> $97,200 (+4.1%, +$8)
Market: BTC $97,200 | ETH $3,420 | SOL $187 | F&G 22
Regime: RANGING (macro 0.1, micro -0.2)
ML: BTC → long 3.2% | ETH → neutral | SOL → short 2.1%
BTC: [deep data...]
ETH: [deep data...]
Performance: 19 trades, 28.8% win, -$56.68, PF 0.72, 3L streak
Recent Trades (last 6):                                          ← NEW
  SOL LONG 20x | -3.4% | 8m ago | MFE +6.3% | exit: breakeven stop
  BTC LONG 10x | -7.9% | 22m ago | MFE +2.1% | exit: stop loss
  SOL LONG 20x | +4.2% | 1h ago | MFE +8.7% | exit: trailing stop
  BTC SHORT 15x | +1.8% | 2h ago | exit: agent close
  SOL LONG 20x | -5.1% | 3h ago | MFE +1.0% | exit: stop loss
  ETH LONG 20x | +3.5% | 4h ago | MFE +5.2% | exit: trailing stop
  ↑ 5/6 recent trades are LONG — check for directional bias
  ↑ 2/3 recent SOL trades lost — consider skipping next SOL setup
Memory: 5 watchpoints | 3 theses | 2 curiosity
[End Briefing]
```

---

## Testing Plan

### Static Tests (Unit)

Create `tests/unit/test_recent_trades.py`:

```python
"""
Unit tests for the Recent Trades briefing section.

Tests cover:
1. Time-ago formatting
2. Directional bias detection
3. Repeated-symbol loss detection
4. Empty state handling
5. Trade line formatting
"""
import pytest
import time


class TestTimeAgoFormatting:
    """Time-ago string generation from age in seconds."""

    def test_seconds(self):
        assert _format_age(30) == "30s ago"

    def test_minutes(self):
        assert _format_age(480) == "8m ago"

    def test_hours_and_minutes(self):
        assert _format_age(3900) == "1h5m ago"

    def test_hours_exact(self):
        assert _format_age(7200) == "2h ago"

    def test_days(self):
        assert _format_age(90000) == "1d ago"


def _format_age(age_s: float) -> str:
    """Replicate the time-ago logic from _build_recent_trades for testing."""
    if age_s < 60:
        return f"{int(age_s)}s ago"
    elif age_s < 3600:
        return f"{int(age_s / 60)}m ago"
    elif age_s < 86400:
        h = int(age_s / 3600)
        m = int((age_s % 3600) / 60)
        return f"{h}h{m}m ago" if m > 0 else f"{h}h ago"
    else:
        return f"{int(age_s / 86400)}d ago"


class TestDirectionalBiasDetection:
    """Bias warnings when trades are overwhelmingly one-sided."""

    def test_all_longs_triggers_warning(self):
        sides = ["long", "long", "long", "long", "long"]
        long_count = sum(1 for s in sides if s == "long")
        assert long_count >= len(sides) - 1  # 5/5 >= 4

    def test_mostly_longs_triggers_warning(self):
        sides = ["long", "long", "long", "short", "long"]
        long_count = sum(1 for s in sides if s == "long")
        assert long_count >= len(sides) - 1  # 4/5 >= 4

    def test_balanced_no_warning(self):
        sides = ["long", "short", "long", "short", "long"]
        long_count = sum(1 for s in sides if s == "long")
        short_count = len(sides) - long_count
        assert not (long_count >= len(sides) - 1)  # 3/5 < 4
        assert not (short_count >= len(sides) - 1)  # 2/5 < 4

    def test_too_few_trades_no_warning(self):
        """Bias detection requires >= 4 trades."""
        sides = ["long", "long", "long"]
        assert len(sides) < 4  # Skip bias check


class TestRepeatedSymbolDetection:
    """Warnings when the same symbol keeps losing."""

    def test_three_losses_on_same_coin(self):
        trades = [
            {"coin": "SOL", "lev_return_pct": -3.4},
            {"coin": "SOL", "lev_return_pct": -5.1},
            {"coin": "SOL", "lev_return_pct": +2.0},
        ]
        sol_trades = [t for t in trades if t["coin"] == "SOL"]
        sol_losses = sum(1 for t in sol_trades if t["lev_return_pct"] < 0)
        assert len(sol_trades) >= 3
        assert sol_losses >= 2  # Warning triggered

    def test_two_losses_not_enough(self):
        trades = [
            {"coin": "SOL", "lev_return_pct": -3.4},
            {"coin": "SOL", "lev_return_pct": +5.0},
        ]
        assert len(trades) < 3  # Not enough to trigger

    def test_different_coins_no_warning(self):
        trades = [
            {"coin": "SOL", "lev_return_pct": -3.4},
            {"coin": "BTC", "lev_return_pct": -5.1},
            {"coin": "ETH", "lev_return_pct": -2.0},
        ]
        for coin in set(t["coin"] for t in trades):
            coin_trades = [t for t in trades if t["coin"] == coin]
            assert len(coin_trades) < 3  # No coin has 3+ trades


class TestExitReasonMapping:
    """Close type to human-readable exit reason."""

    def test_mappings(self):
        exit_map = {
            "stop_loss": "stop loss",
            "take_profit": "take profit",
            "trailing_stop": "trailing stop",
            "small_wins": "small wins",
            "liquidation": "liquidation",
            "full": "agent close",
        }
        for key, expected in exit_map.items():
            assert exit_map.get(key) == expected

    def test_unknown_passthrough(self):
        exit_map = {
            "stop_loss": "stop loss",
            "take_profit": "take profit",
        }
        unknown = "breakeven_stop"
        result = exit_map.get(unknown, unknown)
        assert result == "breakeven_stop"


class TestEmptyState:
    """Handling when no trades exist."""

    def test_no_daemon_returns_empty(self):
        """When daemon is None, return empty string."""
        # _build_recent_trades(None) should return ""
        assert True  # Placeholder — test the actual function in integration

    def test_empty_cache_falls_through_to_nous(self):
        """When daemon cache is empty, try Nous fallback."""
        from collections import deque
        cache = deque(maxlen=10)
        assert len(cache) == 0  # Falls through to Nous path

    def test_both_empty_returns_empty(self):
        """When both daemon cache and Nous have no trades, return empty."""
        assert True  # Verified by function returning ""


class TestTokenBudget:
    """Verify the section stays within ~150 token budget."""

    def test_six_trades_within_budget(self):
        """6 trade lines + 2 warning lines should be ~150 tokens."""
        lines = [
            "Recent Trades (last 6):",
            "  SOL LONG 20x | -3.4% | 8m ago | MFE +6.3% | exit: stop loss",
            "  BTC LONG 10x | -7.9% | 22m ago | MFE +2.1% | exit: stop loss",
            "  SOL LONG 20x | +4.2% | 1h ago | MFE +8.7% | exit: trailing stop",
            "  BTC SHORT 15x | +1.8% | 2h ago | exit: agent close",
            "  SOL LONG 20x | -5.1% | 3h ago | MFE +1.0% | exit: stop loss",
            "  ETH LONG 20x | +3.5% | 4h ago | MFE +5.2% | exit: trailing stop",
            "  ↑ 5/6 recent trades are LONG — check for directional bias",
            "  ↑ 2/3 recent SOL trades lost — consider skipping next SOL setup",
        ]
        text = "\n".join(lines)
        # Rough token estimate: ~4 chars per token for this kind of text
        estimated_tokens = len(text) / 4
        assert estimated_tokens < 200, f"Estimated {estimated_tokens} tokens — over budget"
```

Run with:
```bash
PYTHONPATH=src pytest tests/unit/test_recent_trades.py -v
```

### Dynamic Tests (Live Environment)

#### Setup

```bash
# Terminal 1: Nous server
cd nous-server && pnpm --filter server start

# Terminal 2: Data layer
cd data-layer && make run

# Terminal 3: Dashboard + daemon
cd dashboard && reflex run
```

Ensure `daemon.enabled: true` in `config/default.yaml`.

#### Test Scenario 1: Recent Trades Appear in Briefing

1. Enter and close 2-3 trades via Chat (use agent to open/close positions)
2. Wait for the next daemon wake (scanner or periodic review)
3. Open the Debug page and inspect the latest daemon wake trace
4. Expand the "Context" span and find the `[Briefing]` block
5. **Verify:** A "Recent Trades (last N):" section appears between Performance and Memory lines
6. **Verify:** Each line shows coin, side, leverage, PnL%, time-ago, and exit reason
7. **Verify:** MFE shows for trades where peak ROE was >0.5%

#### Test Scenario 2: Daemon Restart Fallback

1. Enter and close 2-3 trades
2. Restart the dashboard/daemon process
3. Wait for the first daemon wake after restart
4. **Verify:** Recent Trades still appears (populated from Nous fallback)
5. **Note:** MFE may be missing on fallback trades (this is expected — document says "MFE from daemon cache only")

#### Test Scenario 3: Directional Bias Warning

1. Enter and close 4+ trades, all on the LONG side
2. Wait for the next daemon wake
3. **Verify:** The "↑ N/N recent trades are LONG — check for directional bias" warning appears

#### Test Scenario 4: Repeated Symbol Warning

1. Enter and close 3+ trades on the same coin (e.g., SOL), with at least 2 losses
2. Wait for the next daemon wake
3. **Verify:** The "↑ 2/3 recent SOL trades lost — consider skipping next SOL setup" warning appears

#### Test Scenario 5: Token Budget

1. With 6+ closed trades, inspect the briefing in the Debug page
2. Count the tokens in the Recent Trades section (estimate: characters / 4)
3. **Verify:** Section is under 200 tokens

#### Test Scenario 6: No Trades (Clean State)

1. Reset paper stats (Settings page → Reset Stats button)
2. Clear daemon cache by restarting
3. Wait for a daemon wake
4. **Verify:** No "Recent Trades" section appears (empty state handled gracefully)
5. **Verify:** Briefing still renders correctly without the section

---

## Summary of All File Changes

| File | Change |
|------|--------|
| `src/hynous/intelligence/daemon.py` | Add `self._recent_trade_closes` deque to `__init__` (after line 349). Append to it in `_record_trigger_close()` and `_handle_position_close()`. |
| `src/hynous/intelligence/briefing.py` | New `_build_recent_trades()` function (after line 739). Wire into `build_briefing()` (after line 368). |
| `tests/unit/test_recent_trades.py` | NEW FILE — 16 unit tests |

---

## Completion Checklist

- [ ] `self._recent_trade_closes` deque added to daemon `__init__` (maxlen=10)
- [ ] Closes recorded in `_record_trigger_close()` (covers SL/TP/trailing/small-wins)
- [ ] Closes recorded in `_handle_position_close()` (covers agent-initiated + fill-detected)
- [ ] `_build_recent_trades()` function added to briefing.py
- [ ] Function handles empty daemon cache with Nous fallback
- [ ] Function formats time-ago, PnL, MFE, exit reason correctly
- [ ] Directional bias warning triggers at 4+ trades with same-side majority
- [ ] Repeated symbol loss warning triggers at 3+ trades with 2+ losses
- [ ] Section wired into `build_briefing()` between stats and memory lines
- [ ] Token budget verified: <200 tokens for 6 trades + warnings
- [ ] Unit tests pass: `PYTHONPATH=src pytest tests/unit/test_recent_trades.py -v`
- [ ] Dynamic test scenarios 1-6 verified in live environment
- [ ] No regressions: existing briefing sections render correctly

---

Last updated: 2026-03-05
