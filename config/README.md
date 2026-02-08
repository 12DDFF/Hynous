# Configuration

> All app configuration lives here.

---

## Files

| File | Purpose | Restart Required |
|------|---------|------------------|
| `default.yaml` | Main app config | Yes |
| `theme.yaml` | UI styling | Yes |

---

## Environment Variables

Sensitive values should be in environment variables, not config files:

```bash
# .env (create this, don't commit)
ANTHROPIC_API_KEY=sk-ant-...
HYPERLIQUID_API_KEY=...
HYPERLIQUID_API_SECRET=...
```

---

## Changing the Accent Color

Edit `theme.yaml`:

```yaml
colors:
  accent:
    primary: "#6366F1"  # Change this to any color
```

The entire app will update to use the new color.

---

## Config Loading

Config is loaded once at startup:

```python
from hynous.core import load_config

config = load_config()
print(config.execution.mode)
```

---

## Adding New Config

1. Add to appropriate YAML file
2. Update type definitions in `core/config.py`
3. Access via `config.section.key`
