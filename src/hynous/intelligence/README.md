# Intelligence Module

> Background daemon that runs the mechanical trading loop plus read-only
> agent tool surface used by user-chat. v2 removed the autonomous LLM
> trading agent -- entries and exits are mechanical, and LLM post-trade
> analysis lives in `src/hynous/analysis/` instead.

---

## Structure

```
intelligence/
├── daemon.py             # Background loop: polling, fast-trigger checks, mechanical exit layers,
│                         # journal capture, scanner-driven + periodic mechanical entry
├── scanner.py            # Market-wide anomaly detection (producer of AnomalyEvent)
├── regime.py             # Hybrid macro/micro regime detection (dual scoring, no LLM)
│
└── tools/                # Tool definitions — 15 tools total (see tools/README.md)
    ├── registry.py       # Tool dataclass + registration
    ├── market.py         # get_market_data
    ├── orderbook.py      # get_orderbook
    ├── funding.py        # get_funding_history
    ├── multi_timeframe.py # get_multi_timeframe
    ├── liquidations.py   # get_liquidations
    ├── sentiment.py      # get_global_sentiment
    ├── options.py        # get_options_flow
    ├── institutional.py  # get_institutional_flow
    ├── costs.py          # get_my_costs
    ├── trading.py        # close_position, modify_position, get_account (no execute_trade in v2)
    ├── data_layer.py     # data_layer (heatmap, orderflow, whales, HLP, smart money, wallets)
    ├── get_trade_by_id.py # get_trade_by_id (v2 journal)
    └── search_trades.py  # search_trades (v2 journal semantic search)
```

---

## Key Patterns

### Adding a New Tool

See `tools/README.md`. In short:

1. Create `tools/my_tool.py` with handler + `register()` function
2. Import and call `register()` from `tools/registry.py`
3. If the tool is user-chat-invocable, add guidance to
   `src/hynous/user_chat/prompt.py` -- registering alone is not enough;
   the agent will not discover a tool absent from its prompt. The
   analysis agent (`src/hynous/analysis/prompts.py`) does not call
   external tools.

### Daemon Cron Tasks

The daemon runs 24/7 and has timed tasks:

| Task | Interval | Method |
|------|----------|--------|
| Price polling | 60s | `_poll_prices()` |
| Fast trigger check (SL/TP guard) | 10s | `_fast_trigger_check()` |
| Derivatives/sentiment | 5m | `_poll_derivatives()` |
| Market scanner (mechanical entry eval) | every deriv poll | `_evaluate_entry_signals()` |
| Counterfactual recomputation (v2 journal) | 30m | `_recompute_pending_counterfactuals()` |
| Satellite tick (feature compute + inference) | 300s | `satellite.tick()` + `_run_satellite_inference()` |

To add a new cron task: add a timing tracker in `__init__`, add an
interval check in the main loop, implement the method.

---

## Journal Integration (v2)

- `daemon.py` opens a `JournalStore` at startup (auto-runs one-shot
  staging→journal migration if `staging.db` exists) and emits lifecycle
  events at every mechanical state mutation.
- `trading.py` (tool) calls `build_entry_snapshot()` after every order
  fill; the daemon exit path calls `build_exit_snapshot()` before
  position eviction.
- Full details in `src/hynous/journal/README.md`.

---

## Dependencies

- `journal/` -- v2 SQLite journal (trade persistence, embeddings, semantic search)
- `analysis/` -- v2 LLM post-trade analysis agent (phase 3 populates)
- `data/` -- Market data providers + execution layer
- `litellm` -- Multi-provider LLM wrapper (used by user-chat + analysis agent)

---

Last updated: 2026-04-12 (phase 7 complete)
