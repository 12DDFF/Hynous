# Hynous v2 Journal Module

> Trade journal replacing the Nous TypeScript memory server.
> See `v2-planning/00-master-plan.md` for full context.

---

## Phase 1 (current): Data Capture

Phase 1 establishes the data capture pipeline that feeds the journal. Every trade entry captures an exhaustive snapshot. Every mechanical exit event is logged as a lifecycle event. Every exit captures trade outcomes with counterfactuals.

### Files

| File | Purpose |
|------|---------|
| `schema.py` | 19 dataclasses defining entry/exit snapshot format |
| `staging_store.py` | Thin SQLite wrapper (3 staging tables) for phase 1 |
| `capture.py` | `build_entry_snapshot()`, `build_exit_snapshot()`, `emit_lifecycle_event()` |
| `counterfactuals.py` | Post-exit analysis (TP hit later? SL hunted? optimal exit?) |

### Staging Database

Located at `storage/v2/staging.db`. Three tables:

- `trade_entry_snapshots_staging` — one row per trade entry with full JSON snapshot
- `trade_exit_snapshots_staging` — one row per trade exit with outcome + counterfactuals
- `trade_events_staging` — lifecycle events (dynamic_sl_placed, fee_be_set, trail_activated, etc.)

### Entry Snapshot Contents

Each `TradeEntrySnapshot` captures 12 components:

1. **TradeBasics** — trade_id, symbol, side, fill price/size, leverage, SL/TP, fees
2. **TriggerContext** — what caused the entry (scanner, ML signal, manual)
3. **MLSnapshot** — all 14 condition model outputs, composite score, direction model
4. **MarketState** — L2 book, spread, depth, price changes, realized vol
5. **DerivativesState** — funding rate, OI, OI z-score
6. **LiquidationTerrain** — cascade active flag, liq clusters
7. **OrderFlowState** — CVD, buy/sell ratios
8. **SmartMoneyContext** — HLP positions, whale activity
9. **TimeContext** — hour UTC, day of week, trading session
10. **AccountContext** — portfolio value, daily PnL, open positions
11. **SettingsSnapshot** — SHA256 hash of active trading_settings.json
12. **PriceHistoryContext** — last 15 1m candles + last 48 5m candles

### Lifecycle Events

Emitted at every mechanical state mutation during a trade hold:

| Event Type | When |
|------------|------|
| `peak_roe_new` | Peak ROE reaches new high |
| `trough_roe_new` | Trough ROE reaches new low |
| `dynamic_sl_placed` | Dynamic protective SL placed after position detection |
| `fee_be_set` | Fee-breakeven SL set when ROE clears fee threshold |
| `trail_activated` | Trailing stop activated at vol-regime threshold |
| `trail_updated` | Trailing stop price tightened |
| `vol_regime_change` | Vol regime transitions (e.g., normal → high) |
| `trade_exit` | Position closed by any exit path |

### Counterfactuals

Computed after trade exit with a deferred recomputation pass:

- **Immediate** (at exit): MFE/MAE from hold-period candles, optimal exit within hold
- **Deferred** (30-min daemon check): did TP hit post-exit? Was SL hunted (touch then >1% reversal)?

---

## Phase 2 (next): Full Journal Store

Phase 2 promotes staging to a full 8-table journal with CRUD, embeddings, semantic search, and FastAPI routes. See `v2-planning/05-phase-2-journal-module.md`.

---

## Integration Points

- **daemon.py** initializes `StagingStore` at startup, emits lifecycle events at mutation points
- **trading.py** calls `build_entry_snapshot()` after every order fill
- **daemon.py** calls `build_exit_snapshot()` before position eviction on trigger close
- **daemon.py** runs `_recompute_pending_counterfactuals()` every 30 minutes

---

*Created: 2026-04-10 (phase 1)*
