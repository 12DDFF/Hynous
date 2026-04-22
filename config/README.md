# Configuration

> All app configuration lives here. Loaded by `src/hynous/core/config.py::load_config()` at startup.

---

## Files

| File | Purpose | Restart Required |
|------|---------|------------------|
| `default.yaml` | Main app config | Yes |
| `theme.yaml` | UI styling (Reflex dashboard colors/fonts) | Yes |

---

## Environment Variables

Sensitive values live in `.env` at the repo root (never committed):

```bash
OPENROUTER_API_KEY=sk-or-...        # LLM providers via OpenRouter (analysis agent + user chat)
HYPERLIQUID_PRIVATE_KEY=...         # Exchange wallet
OPENAI_API_KEY=sk-...               # Journal + analysis embeddings (text-embedding-3-small, 512-dim matryoshka)
COINGLASS_API_KEY=...               # Derivatives data (optional)
```

---

## Config Sections

Each YAML top-level section maps (or doesn't) to a dataclass in `src/hynous/core/config.py`:

| YAML key | Dataclass | Purpose |
|----------|-----------|---------|
| `app` | — | Metadata (name, version) |
| `execution` | `ExecutionConfig` | Trading mode (paper / testnet / live_confirm / live_auto), paper balance, tracked symbols |
| `hyperliquid` | `HyperliquidConfig` | Exchange URLs, default leverage, slippage, max position cap |
| `agent` | `AgentConfig` | Legacy v1 LLM model default — see note below |
| `coinglass` | — | API plan tier only |
| `daemon` | `DaemonConfig` | Polling intervals, risk guardrails, mechanical-exit tuning, candle peak tracking, labeler/validation/ws_price_feed toggles |
| `scanner` | `ScannerConfig` | Anomaly-detection thresholds + micro L2 detectors |
| `data_layer` | `DataLayerConfig` | hynous-data service URL + timeout |
| `events` | — | Legacy event thresholds (unused in v2) |
| `satellite` | `SatelliteConfig` | ML feature engine — DB paths, snapshot interval, coins, `inference_entry_threshold` (2.0 on v3, calibrated for narrower peak-ROE distribution vs v2's ±20%), `inference_conflict_margin` (0.5), `inference_shadow_mode`. Calibration context: `docs/revisions/v2-debug/README.md § C1`. |
| `logging` | — | Log level + format |
| `l2_subscriber` | (data-layer config) | Enable WS L2 collection |
| `tick_collector` | (data-layer config) | Enable tick-level feature collection |
| `v2` | `V2Config` | v2 sub-configs — `journal`, `analysis_agent`, `mechanical_entry`, `consolidation`, `user_chat`, `kronos_shadow` |

### Note on `agent` section

`AgentConfig` is a legacy v1 structure. In v2 the trading path has no LLM. The `agent.model` field is still read as a fallback for the user-chat agent, but `v2.user_chat.model` takes precedence (see `src/hynous/user_chat/agent.py`).

### Legacy DaemonConfig fields with no v2 consumer

`DaemonConfig` still carries several intervals that were wired to v1 LLM-wake cycles (curiosity queue, FSRS decay, Nous health check, embedding backfill, consolidation, periodic review, wake rate limiting, playbook cache TTL):

```
curiosity_threshold, curiosity_check_interval, decay_interval,
conflict_check_interval, health_check_interval,
embedding_backfill_interval, consolidation_interval,
max_wakes_per_hour, wake_cooldown_seconds, playbook_cache_ttl,
periodic_interval
```

These are loaded from YAML into the dataclass but no v2 code consumes them (M6 in the v2-debug audit). Leave them at defaults; retuning has no effect.

---

## v2 Sub-Configs (`v2:` section)

```yaml
v2:
  enabled: true                      # Master switch for v2 features (must be true on v2 branch)

  journal:                           # Phase 2 — SQLite journal at storage/v2/journal.db
    db_path: "storage/v2/journal.db"
    embeddings_model: "openai/text-embedding-3-small"
    embeddings_dim: 1536
    comparison_dim: 512              # matryoshka truncation for fast similarity
    wal_mode: true
    busy_timeout_ms: 5000

  analysis_agent:                    # Phase 3 — post-trade LLM pipeline
    model: "openrouter/anthropic/claude-sonnet-4.5"  # openrouter/ prefix required — direct anthropic/ raises NotFoundError (VPS only has OPENROUTER_API_KEY)
    max_tokens: 4096
    temperature: 0.2
    retry_on_failure: false          # single-attempt; operator re-runs manually
    batch_rejection_interval_s: 3600 # hourly batch analysis cron
    timeout_s: 60
    prompt_version: "v1"             # bumped when prompt surface changes

  mechanical_entry:                  # Phase 5 — entry trigger gates
    trigger_source: "ml_signal_driven"
    composite_entry_threshold: 50
    direction_confidence_threshold: 0.55        # gate passes when max(|long_roe|,|short_roe|) / 5.0 >= 0.55, i.e. max_roe >= 2.75%
    require_entry_quality_pctl: 60
    max_vol_regime: "high"
    roe_target_pct: 10.0
    coin: "BTC"
    tick_confirmation_enabled: false            # opt-in gate: require tick horizon sign agreement
    tick_confirmation_horizon: "direction_10s"

  consolidation:                     # Phase 6 — edge building + weekly rollup
    edges_enabled: true
    edge_types: ["preceded_by", "followed_by", "same_regime_bucket",
                 "same_rejection_reason", "rejection_vs_contemporaneous_trade"]
    pattern_rollup_enabled: true
    pattern_rollup_interval_hours: 168           # weekly
    pattern_rollup_window_days: 30

  user_chat:                         # Phase 5 M6 — read-only journal analyst
    enabled: true
    model: "openrouter/anthropic/claude-opus-4"     # same openrouter/ prefix rule as analysis_agent
    max_tokens: 4096
    temperature: 0.2
    tool_timeout_s: 30

  kronos_shadow:                     # Post-v2 — read-only foundation-model predictor
    enabled: false                                # opt-in, requires `pip install -e '.[kronos-shadow]'`
    symbol: "BTC"
    model_name: "NeoQuasar/Kronos-small"
    tokenizer_name: "NeoQuasar/Kronos-Tokenizer-base"
    max_context: 512
    lookback_bars: 360
    pred_len: 24
    sample_count: 5
    temperature: 1.0
    top_p: 0.9
    tick_interval_s: 300
    long_threshold: 0.60
    short_threshold: 0.40
```

---

## Config Loading

```python
from hynous.core import load_config

config = load_config()
print(config.execution.mode)
print(config.v2.journal.db_path)
print(config.v2.mechanical_entry.composite_entry_threshold)
```

---

## Adding New Config

1. Add the key to `config/default.yaml`
2. Add the field to the appropriate dataclass in `src/hynous/core/config.py`
3. Wire it through `load_config()` with a matching default (**the Python default MUST match the YAML default**)
4. Access via `config.section.key`

---

Last updated: 2026-04-22 (v2-debug C1 calibration: annotated `inference_entry_threshold` / `inference_conflict_margin` values with v3-distribution context, and the `direction_confidence_threshold` comment now documents the `/5.0` normalizer that backs it)
