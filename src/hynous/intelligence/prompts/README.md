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
    "# I am Hynous\n\n{IDENTITY}",          # Soul: personality, values, style
    "## Today\n\n{date + model label}",      # Clock + model awareness
    _build_ground_rules(),                    # Dynamic rules (see below)
    ML_CONDITIONS,                            # ML condition model guidance
]
```

An optional `## Mode` section (paper/testnet/live) is inserted at index 1 when `context["execution_mode"]` is provided.

### Dynamic Ground Rules

`_build_ground_rules()` is not static text. It reads `TradingSettings` (from `core/trading_settings.py`) at call time and injects live values into:

- **Conviction sizing table** -- margin percentages per tier (High/Medium/Pass thresholds)
- **Risk rules** -- R:R floor, portfolio risk cap, leverage-by-SL formulas
- **Trade type specs** -- micro vs macro SL/TP ranges, leverage, fee break-even calculations
- **Mechanical exits** -- dynamic protective SL, fee-breakeven, trailing stop (all mechanical; agent cannot override during autonomous operation)
- **Small wins mode** -- conditional block, only injected when `ts.small_wins_mode` is active
- **Profit-taking rules** -- mechanical-only reminder

This means the system prompt reflects runtime settings changes without restarting the agent.

### ML Conditions

A dedicated `ML_CONDITIONS` constant describes the 14 ML condition models, the composite entry score, and how the `execute_trade` tool enforces ML-derived guardrails (leverage caps, entry-quality gates, MAE-vs-SL checks).

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
- **Tool additions** -- Any new tool needs a mention somewhere the agent will read it (inside ground rules or a new section); registration alone is not enough

---

Last updated: 2026-04-12 (phase 4 M9 — prompt surface slimmed to identity + ground rules + ML conditions after M7 simplification)
