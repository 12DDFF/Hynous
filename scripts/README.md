# Scripts

> Entry points and utility scripts.

---

## Entry Points

| Script | Purpose | Usage |
|--------|---------|-------|
| `run_dashboard.py` | Launch Reflex dashboard on `:3000` + FastAPI routers (journal + user-chat) | `python -m scripts.run_dashboard` |
| `run_daemon.py` | Standalone mechanical-loop daemon + Kronos shadow tick (systemd unit `hynous-daemon`). Added 2026-04-15 to decouple the trading loop from granian's ASGI worker lifecycle. | `python -m scripts.run_daemon [--duration 300] [--log-level INFO]` |

---

## Diagnostic + Retrain Scripts

| Script | Purpose | Notes |
|--------|---------|-------|
| `diagnose_direction_inference.py` | Score recent BTC snapshots with the v2 + v3 direction artifacts and report prediction distribution + signal counts at multiple thresholds. Read-only (no writes). | Used to diagnose C1 production outage on 2026-04-22 (v3 at 3.0% threshold = 100% skip). Default `--v3` path was `satellite/artifacts/v3/v3` — fixed to `satellite/artifacts/v3` in v2-debug H7 (commit `7fe866f`). |
| `retrain_direction_v3_snapshots.py` | Retrain long/short direction models from `satellite.db` labeled snapshots. Current target: `best_long_roe_30m_net` / `best_short_roe_30m_net` (peak ROE, v2-debug H6 correction from the original `risk_adj_*` targets). | The `_v3_risk_adj_rejected_BACKUP/` artifact dir on disk is the rejected first training pass; do not restore. |
| `retrain_direction_model.py` | Retrain from the v2 journal's closed trades (uses `roe_at_exit` as label). Requires ≥ `--min-trades` closed trades. Currently unusable until live trading produces enough closed trades. | Pass target names are threaded through `train_both_models` so the resulting artifact self-documents (v2-debug H8). |
| `calibrate_composite_score.py` | Phase 8 calibration audit — stratify closed trades by composite score bucket and report win rate / average PnL. Does NOT auto-apply thresholds. | See `v2-planning/11-phase-8-quantitative.md` Task 3. |

---

## Scheduled / Utility Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `artemis_sync.sh` | Daily Artemis data pipeline — process yesterday's on-chain data and update satellite features | Cron: `0 1 * * * /path/to/artemis_sync.sh` |
| `backup_satellite.sh` | Automated SQLite backup for `satellite.db` and `hynous-data.db` — 7-day local retention, optional weekly scp to remote | Cron: `0 3 * * * /path/to/backup_satellite.sh` |
| `monte_carlo_server.py` | Local Monte Carlo viewer backend (microstructure + tick model visualization). Not wired to production. | `python scripts/monte_carlo_server.py` then open `scripts/monte_carlo.html` |

---

## Usage

```bash
# Dashboard (development)
python -m scripts.run_dashboard

# Daemon (standalone smoke / dev; VPS uses hynous-daemon.service)
python -m scripts.run_daemon --duration 300

# Diagnose direction-model predictions vs live data
PYTHONPATH=src python scripts/diagnose_direction_inference.py \
    --v2 satellite/artifacts/v2 --v3 satellite/artifacts/v3 --days 7

# Retrain direction models from satellite.db snapshots
PYTHONPATH=. python scripts/retrain_direction_v3_snapshots.py \
    --db storage/satellite.db --coin BTC --output satellite/artifacts/v4
```

---

## Adding Scripts

Keep scripts minimal — logic belongs in `src/hynous/` or `satellite/`.

```python
# scripts/my_script.py

"""Brief description of what this script does."""

from hynous.core import load_config
from hynous.something import do_thing

def main():
    config = load_config()
    do_thing(config)

if __name__ == "__main__":
    main()
```

---

Last updated: 2026-04-22 (v2-debug H6 + H8: documented diagnose + retrain scripts, target-column threading through `train_both_models`; added `run_daemon.py` which landed 2026-04-15 as the third systemd unit)
