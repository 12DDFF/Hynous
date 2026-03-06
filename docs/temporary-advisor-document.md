# Trade Performance Advisory — Revision Spec Input

> Analysis session: 2026-03-05
> Data: 66 trades, March 2-5 2026 (paper trading, mainnet prices)
> Purpose: Findings and specifications for the architect agent to produce revision plans.

---

## For the Architect: Required Reading

Before producing revision plans, read these files to understand the systems involved:

**Exit management (primary focus):**
- `src/hynous/intelligence/daemon.py` — Core daemon loop, breakeven stop (lines 1790-1852), profit alerts (lines 2322-2622), MFE/MAE tracking (lines 1784-1788), small wins mode (lines 1854-1906), wake system (lines 4314-4510)
- `src/hynous/intelligence/tools/trading.py` — Trade execution (lines 485-596), close position + fee-loss block (lines 1364-1384), position modification, PnL calculation (lines 1462-1492)
- `src/hynous/data/providers/paper.py` — Paper trading simulation, fee model (line 69: `TAKER_FEE = 0.00035`), trigger checking (lines 555-625), position close (lines 631-658)
- `src/hynous/intelligence/prompts/builder.py` — System prompt ground rules (lines 105-200), prompt sections that will need updating when exits become mechanical

**Agent context (secondary):**
- `src/hynous/intelligence/briefing.py` — Wake briefing builder (lines 291-376), portfolio section (lines 379-476), stats line (lines 730-739)
- `src/hynous/intelligence/context_snapshot.py` — Activity counters (lines 322-333)
- `src/hynous/intelligence/memory_manager.py` — Working window (4 exchanges), compression system

**Data infrastructure (for MFE/MAE fix):**
- `data-layer/` — Standalone data service with WebSocket trade stream already capturing real-time trades
- `docs/integration.md` — Cross-system data flows (daemon ↔ data-layer ↔ satellite)

**Configuration:**
- `config/default.yaml` — All daemon/scanner/trading config values
- `src/hynous/core/config.py` — Config dataclasses (breakeven buffer values, taker fee, polling intervals)
- `src/hynous/core/trading_settings.py` — Runtime trading settings (conviction sizing, R:R floors, leverage rules)

---

## Executive Summary

### The Problem

The system lost -56.68% ROE across 66 trades with a 28.8% win rate. Every trade has negative expected value (-0.86% per trade).

### The Hidden Strength

The directional predictions are strong. 100% of trades with MFE data moved in the predicted direction. 67% moved meaningfully (MFE >= 2%). Gross return from price movement alone is +35.72% — the system is profitable before transaction costs.

### Why It Still Loses

**1. No profit protection.** 27 of 47 losing trades were winning at some point (MFE > fee break-even) but reversed into losses because nothing locked in the profit. No trailing stop exists. Exit decisions are delegated to the LLM, which rationalizes holding. The one mechanical exit — the breakeven stop — has an inverted formula that guarantees a loss when hit.

**2. Fee erosion.** 66 trades at 1.4% ROE fee each = -92.40% in fees, consuming 258% of gross profit. Fees are a fixed cost — the root cause is that profit is given back through bad exits before fees matter.

### The Fix

A realistic trailing stop model on the same 66 trades:

| Metric | Current | With Trailing Stop |
|--------|---------|-------------------|
| Net return | -56.68% | +42.21% |
| Win rate | 28.8% | 51.5% |
| Expectancy/trade | -0.86% | +0.64% |
| Profit factor | 0.72 | 1.34 |

### Core Principle

**LLM handles entries, code handles exits.** The agent picks direction, entry, initial SL, conviction, sizing. Everything after entry becomes mechanical. The LLM loses the ability to widen or remove protective stops.

---

## Revision Prioritization

**Priority 1: Mechanical Exit System (Critical)**
- Fixes EXIT-1 through EXIT-7 and BUG-1 in one revision
- Single highest-impact change: flips expectancy from -0.86% to +0.64% per trade
- Without this, nothing else matters — every trade has negative expected value
- Includes: trailing stop, breakeven fix, stop modification lockout, prompt updates, fee-loss block removal

**Priority 2: Real-Time Price Data (High)**
- Prerequisite for Revision 1 to work *as modeled*
- Current 60s polling misses peaks — 6 trades have PnL worse than recorded MAE (mathematically impossible)
- The trailing stop needs accurate peak tracking to trail from; polling gaps mean profit leakage
- However, Revision 1 can ship first with existing polling — it still improves outcomes significantly, just not to the full +42.21% modeled. This revision closes the gap.

**Priority 3: Agent Trade Memory (Medium)**
- Improves entry quality, not exit quality
- Low implementation cost (~100-150 tokens per briefing, structured block in `build_briefing()`)
- Independent of Revisions 1-2 — can be built in parallel
- Impact is harder to quantify but prevents repeated entries on the same losing setup

**Dependency note:** Revision 1 can be implemented independently using existing polling. Revision 2 enhances Revision 1's accuracy but isn't a hard blocker. Revision 3 is fully independent.

---

## Revision 1: Mechanical Exit System (Critical Priority)

This revision addresses EXIT-1 through EXIT-7 and BUG-1 simultaneously. It is the single highest-impact change — without it, no other optimization matters.

### FINDING: EXIT-1 — No Trailing Stop Mechanism Exists

**Location:** `daemon.py` lines 1790-1852

The breakeven stop locks at one price and never moves higher. No code anywhere progressively raises the stop as profit grows. A trade can peak at +15% ROE and the stop remains at entry (or below entry per BUG-1). All accumulated profit is unprotected.

### FINDING: EXIT-2 — Profit Alerts Delegate Exit Decisions to LLM

**Location:** `daemon.py` lines 2464-2492, 2534-2622

The daemon detects profit tiers (nudge at +7/20%, take at +10/35%, urgent at +15/50%) and profit fading (50% giveback macro, 40% micro), but all of these just wake the agent and ask it to decide. The LLM can reason its way out of closing. There is no mechanical enforcement.

### FINDING: EXIT-3 — System Prompt Encourages Holding Over Exiting

**Location:** `prompts/builder.py` lines 139-147, 153-167

The prompt trains the agent to hold: "I do NOT close micros early with tiny green", "fee loss means I exited too early — not a skill problem, a patience problem." Combined with EXIT-2, the agent has both permission and prompting to hold through drawdowns.

### FINDING: EXIT-4 — Fee-Loss Block Prevents Rational Exits

**Location:** `tools/trading.py` lines 1364-1384

If a trade is in gross profit but would net a fee loss, `close_position` blocks the close unless `force=True`. This prevents cutting a deteriorating trade in the fee-loss zone. The trade reverses into a real loss. Converts ~0% outcomes into -3% to -10% losses.

### FINDING: EXIT-5 — Profit Fading Alert Fires Too Late and Only Once

**Location:** `daemon.py` lines 2472-2479, config `peak_reversion_threshold_macro: 0.50`

The fading alert fires when profit drops 50% from peak (macro) or 40% (micro). A +10% peak only alerts at +5%. After firing once, it goes on cooldown. Even when it fires, it's still just a suggestion to the LLM.

### FINDING: EXIT-6 — SL/TP Are Static and LLM Can Modify Freely

**Location:** `tools/trading.py` lines 642-664, `modify_position` tool

SL/TP are set at entry and never mechanically adjusted. The LLM retains full access to `modify_position` and can widen, move, or remove any stop — including mechanical ones. This must be locked to tightening only or removed entirely when mechanical exits are implemented.

### FINDING: EXIT-7 — Small Wins Mode Is Right Idea, Wrong Execution

**Location:** `daemon.py` lines 1854-1906, 2352-2438

Small wins is the only mechanical exit. It places a TP order and has a polling fallback. But it exits at a flat ROE target regardless of trade strength, is off by default, and clips runners at the same level as trades barely clearing fees.

### FINDING: BUG-1 — Breakeven Stop Formula Is Inverted

**Location:** `daemon.py` lines 1804-1808

```python
# CURRENT (broken):
be_price = (
    entry_px * (1 - buffer_pct) if is_long
    else entry_px * (1 + buffer_pct)
)

# CORRECT:
be_price = (
    entry_px * (1 + buffer_pct) if is_long
    else entry_px * (1 - buffer_pct)
)
```

For longs, stop is placed below entry, guaranteeing a loss. Buffer values (0.10% micro, 0.30% macro) at 20x leverage mean the "breakeven" stop triggers at -2% ROE (micro) or -6% ROE (macro). The -3.4% loss cluster in the journal maps directly to this bug. The buffer should equal the round-trip taker fee (0.07%) to actually break even.

### SPECIFICATION: What to Build

**Breakeven stop (fix BUG-1):**
- Flip formula: `1 + buffer` for longs, `1 - buffer` for shorts
- Buffer = round-trip fee (0.07% of notional) so trade nets ~0% when hit
- Activates when ROE clears fee break-even (taker_fee_pct × leverage)

**Trailing stop (new):**
- Once ROE exceeds trail activation threshold (to be determined, modeled at 2.8%), the stop begins trailing
- Trail distance: percentage-based retracement from peak ROE (modeled at 50%)
- Stop moves upward only, never down
- Executes immediately when hit — no LLM wake, no delay

**Stop modification lockout:**
- `modify_position` restricted to tightening only (stop can move closer to current price, never further)
- Or remove `modify_position` entirely in favor of mechanical management
- Mechanical stops set by daemon cannot be overridden by the LLM

**Exit execution:**
- When trailing/breakeven stop is hit, close position immediately via code
- No waking the agent, no asking permission

**Prompt updates:**
- Remove/revise EXIT-3 prompt language that encourages holding
- Remove fee-loss block (EXIT-4) or make it subordinate to mechanical stops
- Update prompt to reflect that exit management is no longer the agent's responsibility

**What this replaces:**
- EXIT-1: Trailing stop directly solves
- EXIT-2: Mechanical execution replaces LLM decisions
- EXIT-3: Code doesn't read the prompt
- EXIT-4: Trail protects trades before they re-enter fee-loss zone
- EXIT-5: Continuous trailing replaces one-shot fading alert
- EXIT-6: SL moves dynamically, LLM lockout prevents override
- EXIT-7: Trailing captures proportional profit instead of flat target
- BUG-1: Fixed as part of new breakeven step

**What the LLM keeps:**
- Entry decisions (direction, symbol, conviction, sizing, thesis)
- Initial SL placement (LLM reads market structure for invalidation levels)

**Fixed TP consideration:**
- With trailing, fixed TP may cap upside unnecessarily. Trades that ran +13-15% ROE would have been clipped. Trailing lets winners run.
- Exception: micro/scalp trades may still benefit from a defined TP for quick exit
- To be resolved during architecture phase

---

## Revision 2: Real-Time Price Data for Exit Logic (High Priority)

This is a prerequisite for Revision 1 to work as modeled. The trailing stop needs real-time price data to detect peaks and reversals.

### FINDING: OBS-1 — MFE/MAE Tracking Is Polling-Based (60s), Not Price-Based

**Location:** `daemon.py` lines 1784-1788, 2346-2350

MFE (`_peak_roe`) and MAE (`_trough_roe`) are sampled every 60 seconds. If price spikes and reverses between polls, the peak/trough is never recorded. Proven inaccurate — 6 trades have PnL worse than recorded MAE, which is mathematically impossible:

| Trade | PnL% | MAE% | Unrecorded gap |
|-------|------|------|----------------|
| SOL LONG | -7.26 | -5.99 | 1.27% |
| BTC LONG | -7.93 | -4.37 | 3.56% |
| SOL LONG | -10.24 | -6.10 | 4.14% |
| SOL LONG | -10.78 | -9.37 | 1.41% |
| ETH LONG | -9.19 | -7.45 | 1.74% |
| SOL LONG | -13.59 | -11.81 | 1.78% |

### SPECIFICATION: What to Build

The trailing stop and breakeven stop check prices during `_fast_trigger_check()` (every 10s) and `_poll_prices()` (every 60s). Both are too slow — a trade can spike to +8%, reverse, and hit -3% between polls.

**Options (choose one or combine):**
1. **Use data-layer WebSocket trade stream** — Already captures real-time trades via WebSocket (`data-layer/collectors/trade_stream.py`). Subscribe the daemon to this stream for tracked positions. Highest accuracy.
2. **Use 1-minute candle high/low** — Hyperliquid candles include high/low. Check candle extremes instead of just the close price. Moderate accuracy, simpler implementation.
3. **Increase polling frequency** — Poll every 5-10s instead of 60s. Least accurate of the three, but simplest. The fast trigger check already runs every 10s — extend MFE/MAE tracking to use it.

The trailing stop evaluation should run at the same frequency as the price data source. If using WebSocket, evaluate on every trade. If using candles, evaluate on every candle close. If polling, evaluate every 10s at minimum.

---

## Revision 3: Agent Trade Memory (Medium Priority)

Improves entry quality by giving the agent awareness of its recent trade history. Secondary to exit mechanics but valuable for reducing repeated bad entries.

### FINDING: CTX-1 — Agent Has No Short-Term Trade Memory

**Location:** `briefing.py` lines 291-376, `context_snapshot.py` lines 322-333, `memory_manager.py`

When the daemon wakes the agent, it sees:
- Portfolio value + open positions with current ROE
- Aggregate stats: "19 trades, 28.8% win"
- Activity counters: "X entries today, Y this week | Last trade: Z ago"
- Working memory window of 4 past exchanges (raw conversation text)

It never sees individual recent trade outcomes. Each wake is a fresh start. The scanner fires a new anomaly, the agent enters the same losing setup it just failed on.

### SPECIFICATION: What to Build

**Inject a "Recent Trades" section into `build_briefing()` (CTX-2):**

```
Recent Trades (last 6):
  SOL LONG 20x | -3.4% | 8m ago | MFE +6.3% | exit: breakeven stop
  BTC LONG 10x | -7.9% | 22m ago | MFE +2.1% | exit: stop loss
  SOL LONG 20x | +4.2% | 1h ago | MFE +8.7% | exit: agent close
```

- Source: Nous `trade_close` nodes (already stored on every close) and/or daemon in-memory tracking
- Cost: ~100-150 tokens per briefing
- Shows: coin, side, leverage, net PnL, time ago, MFE, exit reason

**What this enables:**
- Pattern awareness: "3 of my last 4 SOL LONGs lost"
- Cooldown awareness: "I closed a losing BTC LONG 3 minutes ago"
- Exit quality feedback: MFE alongside PnL makes profit leakage visible in real-time
- Directional bias: if 6/6 recent trades are LONG, the agent sees its own bias

**Why not increase working memory window?** The window holds raw conversation text (full wake dialogues). Expanding from 4 to 8 doubles token cost with poor signal-to-noise for trade history. The structured block is cheaper and more targeted.

---

## Fee Economics Context (Not a Revision — Reference Only)

These findings inform the priority order and design constraints. No code changes needed — the fee system is correct.

**Fee system is accurate.** Paper provider uses 0.035% per side (0.07% round-trip), matching Hyperliquid's taker rate. Correctly deducted at both entry and exit. Journal PnL values are net of fees. MFE/MAE values are gross. No bugs.

**Fee decomposition (66 trades at 20x):**

| Component | ROE% |
|-----------|------|
| Gross return (price movement) | +35.72% |
| Total fees (66 × 1.4%) | -92.40% |
| Net return | -56.68% |

**Per-trade expectancy:**
- Current: +0.54% gross - 1.40% fee = -0.86% net (negative, every trade loses money)
- With trailing stop: expectancy flips to +0.64% (positive)

**Trade frequency is not a problem** with positive expectancy. 22 trades/day is fine — more trades = more profit when each trade has positive expected value. Do not add frequency caps.

**Funding rates are irrelevant.** Trades last 6-36 minutes. Funding settles every 8 hours. Paper provider doesn't simulate funding — acceptable for this trade profile.

---

## Trade Performance Data (Reference)

66 trades, March 2-5 2026:

| Metric | Value |
|--------|-------|
| Total trades | 66 |
| Wins / Losses | 19 / 47 |
| Win rate | 28.8% |
| Avg win (lev. return) | +7.63% |
| Avg loss (lev. return) | -4.29% |
| R:R ratio | 1.78:1 |
| Profit factor | 0.72 |
| Net return (sum) | -56.7% |
| Expectancy per trade | -0.86% |
| Trades per day | ~22 |
| Long/Short split | 57 long (86%) / 9 short (14%) |
| Trade duration range | 6-36 minutes (avg 12m) |

**Trailing stop model (realistic assumptions):**

| Outcome | Count | Description |
|---------|-------|-------------|
| TRAIL | 19 | Existing winners, exits improved |
| SAVED BY TRAIL | 20 | Losers converted to small winners |
| SAVED BY BE | 7 | Caught by fixed breakeven at ~0% |
| TRUE LOSS | 9 | MFE never reached fee break-even |
| ACTUAL (no MFE) | 11 | Missing data, kept at actual loss |

Model assumptions: 50% retracement trail, 15% polling penalty, 42.5% effective MFE capture, 2.8% ROE trail activation, breakeven zone for 1.4-2.8% MFE trades.

---

Last updated: 2026-03-05
