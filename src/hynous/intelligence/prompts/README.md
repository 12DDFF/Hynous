# Prompts

> Hynous's identity and knowledge, defined in text.

---

## Structure

| File | Contains | Source |
|------|----------|--------|
| `identity.py` | Who Hynous is | storm-011 |
| `trading.py` | Trading principles | storm-010 |
| `builder.py` | Assembles full prompt | - |

---

## Prompt Assembly

```python
# builder.py combines everything

def build_system_prompt(context: Context) -> str:
    parts = [
        get_identity(),           # Who I am
        get_trading_knowledge(),  # How I think about trading
        format_current_state(context),  # What's happening now
    ]
    return "\n\n---\n\n".join(parts)
```

---

## Editing Guidelines

- **Identity** — Edit sparingly, this is Hynous's core
- **Trading** — Add principles, never hard rules
- **Keep it natural** — Write like a human would think

---

## Context Injection

The builder injects dynamic context:

```python
# Current state (positions, balance)
# Recent memories (auto-retrieved)
# Current event (if triggered by event)
```

This gives Hynous situational awareness.
