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
OPENAI_API_KEY=sk-...                # OpenAI — required for Nous vector embeddings (used by nous-server)
DISCORD_BOT_TOKEN=...               # Discord bot token (optional)
COINGLASS_API_KEY=...               # Coinglass derivatives data (optional)
CRYPTOCOMPARE_API_KEY=...           # CryptoCompare news API (optional — works without one at lower rate limits)
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

## Config Sections

All sections in `default.yaml` and their corresponding dataclass in `src/hynous/core/config.py`:

### `app`

Application metadata. Not mapped to a dedicated dataclass — values accessed from raw YAML.

```yaml
app:
  name: "Hynous"
  version: "0.1.0"
```

### `execution` -> `ExecutionConfig`

Trading execution mode and symbol list.

```yaml
execution:
  mode: "paper"              # paper | testnet | live_confirm | live_auto
  paper_balance: 1000        # Starting balance for paper trading (USD)
  symbols:                   # Symbols to track
    - "BTC"
    - "ETH"
    - "SOL"
```

### `hyperliquid` -> `HyperliquidConfig`

Exchange connection settings.

```yaml
hyperliquid:
  default_leverage: 10
  max_position_usd: 10000
  default_slippage: 0.05       # 5% slippage tolerance for market orders
```

### `agent` -> `AgentConfig`

LLM model and generation settings.

```yaml
agent:
  model: "openrouter/anthropic/claude-sonnet-4-5-20250929"
  max_tokens: 2048
  temperature: 0.7
```

### `coinglass`

Coinglass API plan tier. Not mapped to a dedicated dataclass.

```yaml
coinglass:
  plan: "hobbyist"             # hobbyist | analyst | professional
```

### `daemon` -> `DaemonConfig`

Background autonomous agent. Controls poll intervals, rate limits, risk guardrails, and feature toggles.

```yaml
daemon:
  enabled: false
  price_poll_interval: 60          # Hyperliquid price polling (seconds)
  deriv_poll_interval: 300         # Derivatives/sentiment polling (seconds)
  periodic_interval: 3600          # Periodic market review wake (seconds)
  curiosity_threshold: 1           # Pending items before learning session
  curiosity_check_interval: 900    # Curiosity queue check (seconds)
  decay_interval: 21600            # FSRS batch decay cycle (seconds)
  conflict_check_interval: 1800    # Contradiction queue polling (seconds)
  health_check_interval: 3600      # Nous health check (seconds)
  embedding_backfill_interval: 43200  # Embedding backfill (seconds)
  consolidation_interval: 86400    # Cross-episode generalization (seconds)
  max_daily_loss_usd: 100          # Circuit breaker
  max_open_positions: 3
  max_wakes_per_hour: 6
  wake_cooldown_seconds: 120
  playbook_cache_ttl: 1800         # Playbook matcher cache refresh (seconds)
```

`DaemonConfig` also has keys not present in the YAML (loaded from dataclass defaults): `phantom_check_interval` (1800), `phantom_max_age_seconds` (14400), `peak_reversion_threshold_micro` (0.40), `peak_reversion_threshold_macro` (0.50), `breakeven_stop_enabled` (true), `breakeven_buffer_micro_pct` (0.10), `breakeven_buffer_macro_pct` (0.30), `taker_fee_pct` (0.07).

### `scanner` -> `ScannerConfig`

Market scanner — anomaly detection across all Hyperliquid pairs. Includes macro detectors (price spikes, funding extremes, OI surges, liquidation cascades), micro/L2 detectors (book imbalance flips, momentum bursts, adverse book signals), and news integration (CryptoCompare polling).

```yaml
scanner:
  enabled: true
  wake_threshold: 0.6
  max_anomalies_per_wake: 5
  dedup_ttl_minutes: 30
  # Macro detectors
  price_spike_5min_pct: 3.0
  price_spike_15min_pct: 5.0
  funding_extreme_percentile: 95
  oi_surge_pct: 10.0
  liq_cascade_min_usd: 5000000
  liq_wave_min_usd: 50000000
  min_oi_usd: 1000000
  # Micro / L2 detectors
  book_poll_enabled: true
  book_imbalance_flip_pct: 15.0
  momentum_5m_pct: 1.5
  momentum_volume_mult: 2.0
  position_adverse_threshold: 0.40
  # News (CryptoCompare)
  news_poll_enabled: true
  news_wake_max_age_minutes: 30
```

### `discord` -> `DiscordConfig`

Discord bot — chat relay and daemon notifications. Requires `DISCORD_BOT_TOKEN` env var.

```yaml
discord:
  enabled: true
  channel_id: 1469952346028245097
  stats_channel_id: 1469946713471975476
  allowed_user_ids:
    - 1415781451474927657
    - 614868895643205639
```

### `data_layer` -> `DataLayerConfig`

Connection settings for the hynous-data service (Hyperliquid market intelligence, port 8100).

```yaml
data_layer:
  url: "http://127.0.0.1:8100"
  enabled: true
  timeout: 5
```

### `nous` -> `NousConfig`

Nous memory server connection.

```yaml
nous:
  url: "http://localhost:3100"
  server_dir: "nous-server/server"
  db_path: "storage/nous.db"
  auto_retrieve_limit: 5
```

### `orchestrator` -> `OrchestratorConfig`

Intelligent Retrieval Orchestrator — multi-pass memory search. See `docs/archive/memory-search/`.

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

### `memory` -> `MemoryConfig`

Tiered memory — working window + Nous-backed compression.

```yaml
memory:
  window_size: 4
  max_context_tokens: 4000
  retrieve_limit: 20
  compression_model: "openrouter/anthropic/claude-haiku-4-5-20251001"
  compress_enabled: true
```

`MemoryConfig` also has `gate_filter_enabled` (default `true`) not present in the YAML.

### `sections` -> `SectionsConfig`

Memory sections — brain-inspired bias layer on retrieval and decay. Maps subtypes to 4 sections (KNOWLEDGE, EPISODIC, SIGNALS, PROCEDURAL) for differentiated retrieval weights and decay curves. See `docs/archive/memory-sections/`.

```yaml
sections:
  enabled: true
  intent_boost: 1.3               # Score multiplier for query-relevant sections
  default_section: "KNOWLEDGE"    # Fallback section for unknown subtypes
```

### `satellite` -> `SatelliteConfig`

ML satellite — feature engine + XGBoost inference. Computes feature snapshots from Hyperliquid market data, stores in SQLite, runs predictions. Requires `xgboost`, `shap`, and `numpy` (declared in `pyproject.toml`).

```yaml
satellite:
  enabled: false
  db_path: "storage/satellite.db"
  data_layer_db_path: "data-layer/storage/hynous-data.db"
  snapshot_interval: 300
  coins:
    - "BTC"
    - "ETH"
    - "SOL"
  min_position_size_usd: 1000
  liq_cascade_threshold: 2.5
  liq_cascade_min_usd: 500000
  store_raw_data: true
  funding_settlement_hours:
    - 0
    - 8
    - 16
```

### `events`

Event detection thresholds. Not mapped to a dedicated dataclass.

```yaml
events:
  funding:
    extreme_positive: 0.001
    extreme_negative: -0.0005
  price:
    spike_percent: 0.05
  cooldown_minutes: 30
```

### `logging`

Log level and format. Not mapped to a dedicated dataclass.

```yaml
logging:
  level: "INFO"
  format: "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
```

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

---

Last updated: 2026-03-01
