# Intelligence Module

> The brain of Hynous. LLM agent with reasoning and tool use, plus the
> background daemon that runs the mechanical trading loop.

---

## Structure

```
intelligence/
├── agent.py              # Core agent (LiteLLM multi-provider wrapper, tool loop)
├── daemon.py             # Background loop: polling, fast-trigger checks, mechanical exit layers, wake dispatch
├── scanner.py            # Market-wide anomaly detection across Hyperliquid pairs
├── briefing.py           # Pre-built briefing injection for daemon wakes
├── context_snapshot.py   # Live state snapshot builder (portfolio, market, regime, data-layer signals)
├── regime.py             # Hybrid macro/micro regime detection (dual scoring)
│
├── prompts/              # System prompts
│   ├── identity.py       # Who Hynous is (personality, values)
│   ├── trading.py        # Trading knowledge (principles, not rules)
│   └── builder.py        # Assembles full prompt from parts
│
├── events/               # Event handlers
│
└── tools/                # Tool definitions (17 tools — see tools/README.md)
    ├── registry.py       # Tool dataclass + registration
    ├── market.py         # get_market_data
    ├── orderbook.py      # get_orderbook
    ├── funding.py        # get_funding_history
    ├── multi_timeframe.py # get_multi_timeframe
    ├── liquidations.py   # get_liquidations
    ├── sentiment.py      # get_global_sentiment
    ├── options.py        # get_options_flow
    ├── institutional.py  # get_institutional_flow
    ├── web_search.py     # search_web
    ├── costs.py          # get_my_costs
    ├── trading.py        # execute_trade, close_position, modify_position, get_account
    ├── data_layer.py     # data_layer (heatmap, orderflow, whales, HLP, smart money, wallets)
    └── market_watch.py   # get_book_history, monitor_signal
```

---

## Key Patterns

### Adding a New Tool

See `tools/README.md` for the full pattern. In short:

1. Create `tools/my_tool.py` with `TOOL_DEF` dict + handler function + `register()` function
2. Import and call `register()` from `tools/registry.py`
3. **Add usage guidance to `prompts/builder.py` TOOL_STRATEGY** -- registering alone is not enough; the agent will not know to use the tool without system prompt guidance

### Modifying the Prompt

Edit files in `prompts/` -- they're combined by `builder.py`.

- `identity.py` -- Hynous's personality
- `trading.py` -- Trading principles

### Daemon Cron Tasks

The daemon runs 24/7 and has timed tasks:

| Task | Interval | Method |
|------|----------|--------|
| Price polling | 60s | `_poll_prices()` |
| Fast trigger check (SL/TP guard) | 10s | `_fast_trigger_check()` |
| Profit/risk alerts | every price poll | `_wake_for_profit()` |
| Derivatives/sentiment | 5m | `_poll_derivatives()` |
| Market scanner | every deriv poll | `_wake_for_scanner()` |
| Periodic market review | 1h (2h weekends) | `_wake_for_review()` |
| Satellite labeling | 1h | `_run_labeler()` |
| Condition model validation | 24h | `_run_condition_validation()` |

Each wake type has a **max_tokens cap** to control output costs:
- 512: normal periodic review, manual fill acknowledgments
- 1024: scanner, profit alerts, manual wakes
- 1536: learning review, fill SL/TP

To add a new cron task: add a timing tracker in `__init__`, add interval check in main loop, implement method.

---

## Debug Tracing

The intelligence module is instrumented for the debug dashboard. Every
`agent.chat()` and `chat_stream()` call produces a trace with ordered spans:

- **`agent.py`** -- `source` parameter on `chat()`/`chat_stream()`, context/LLM/tool spans, content-addressed payload storage for messages and responses
- **`daemon.py`** -- `source=` tag on `_wake_agent()` call sites (e.g. `"daemon:review"`, `"daemon:scanner"`, `"daemon:profit"`)

All tracer calls are wrapped in `try/except` -- tracing can never break the agent.

---

## Dependencies

- `litellm` -- Multi-provider LLM API (Claude, GPT-4, DeepSeek, etc. via OpenRouter)
- `journal/` -- Phase-2 SQLite journal (trade persistence, embeddings, semantic search)
- `analysis/` -- Phase-3 post-trade analysis agent
- `data/` -- Market data providers

---

Last updated: 2026-04-12 (phase 4 M9 — intelligence module trimmed to v2 surface)
