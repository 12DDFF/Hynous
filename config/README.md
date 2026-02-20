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
OPENROUTER_API_KEY=sk-or-...        # Single key for all LLM providers via OpenRouter
HYPERLIQUID_PRIVATE_KEY=...          # Hyperliquid wallet private key
DISCORD_BOT_TOKEN=...               # Discord bot token (optional)
COINGLASS_API_KEY=...               # Coinglass derivatives data (optional)
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

## Orchestrator Config

The retrieval orchestrator section in `default.yaml` controls intelligent multi-pass memory search:

```yaml
orchestrator:
  enabled: true               # Master switch (false = single search, zero overhead)
  quality_threshold: 0.20      # Min top-result score to accept
  relevance_ratio: 0.4         # Dynamic cutoff: score >= top * ratio
  max_results: 20              # Hard cap on merged results (token budget is the real limiter)
  max_sub_queries: 4           # Max decomposition parts
  max_retries: 1               # Reformulation attempts per sub-query
  timeout_seconds: 3.0         # Total orchestration timeout
  search_limit_per_query: 25   # Overfetch per sub-query
```

See `src/hynous/core/config.py` → `OrchestratorConfig` dataclass.

---

## Adding New Config

1. Add to appropriate YAML file
2. Update type definitions in `core/config.py`
3. Access via `config.section.key`
