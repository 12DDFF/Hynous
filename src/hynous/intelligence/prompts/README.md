# Prompts

> Hynous's identity and knowledge, defined in text.

---

## Structure

| File | Contains | Source |
|------|----------|--------|
| `identity.py` | Who Hynous is | storm-011 |
| `trading.py` | Trading principles | storm-010 |
| `builder.py` | Assembles full prompt from parts | - |

---

## Prompt Assembly

`build_system_prompt(context)` constructs the full system prompt from 4 major sections joined by `---` separators:

```python
parts = [
    "# I am Hynous\n\n{IDENTITY}",         # Soul: personality, values, style
    "## Today\n\n{date + model label}",      # Clock + model awareness
    _build_ground_rules(),                    # Dynamic rules (see below)
    TOOL_STRATEGY,                            # Tool usage guidance + memory docs
]
```

An optional `## Mode` section (paper/testnet/live) is inserted at index 1 when `context["execution_mode"]` is provided.

### Dynamic Ground Rules

`_build_ground_rules()` is not static text. It reads `TradingSettings` (from `core/trading_settings.py`) at call time and injects live values into:

- **Conviction sizing table** -- margin percentages per tier (High/Medium/Pass thresholds)
- **Risk rules** -- R:R floor, portfolio risk cap, leverage-by-SL formulas
- **Trade type specs** -- micro vs macro SL/TP ranges, leverage, fee break-even calculations
- **Peak profit protection** -- breakeven stop rules, giveback thresholds
- **Small wins mode** -- conditional block, only injected when `ts.small_wins_mode` is active
- **Profit-taking rules** -- leverage-scaled thresholds

This means the system prompt reflects runtime settings changes without restarting the agent.

### TOOL_STRATEGY

A dedicated `TOOL_STRATEGY` constant (~1,200 tokens) that tells the agent HOW to use its tools. This is critical: registering a tool in `registry.py` makes it callable, but the agent will not know when or why to use it without guidance here.

Sections covered:
- **Data tools** -- when to use each market data tool
- **Data layer** -- deep Hyperliquid intelligence (heatmap, orderflow, whales, HLP, smart money, wallet tools)
- **Research** -- web search for real-time context
- **Memory** -- store/recall/update/delete/explore/conflicts/clusters/pruning patterns
- **Fading memories** -- how to handle daemon fading alerts
- **Watchpoints** -- lifecycle and context patterns
- **Trading** -- execution requirements (leverage, thesis, SL, TP, confidence)
- **How My Memory Works** -- 4-section model, decay, consolidation, playbooks

### Context Snapshot Injection

The `context_snapshot.py` module builds a `[Live State]` block injected per-message (not in the system prompt) containing:
- Current positions with ROE, peak profit, giveback %
- Portfolio balance and equity
- Regime scores (macro + micro)
- HLP bias and CVD for position coins

---

## Editing Guidelines

- **Identity** -- Edit sparingly, this is Hynous's core
- **Trading** -- Add principles, never hard rules
- **Keep it natural** -- Write like a human would think
- **TOOL_STRATEGY** -- Update whenever a new tool is added; the agent cannot discover unmentioned tools

---

Last updated: 2026-03-01
