# Scripts

> Entry points and utility scripts.

---

## Files

| Script | Purpose | Usage |
|--------|---------|-------|
| `run_dashboard.py` | Launch Reflex dashboard on `:3000` | `python -m scripts.run_dashboard` |
| `artemis_sync.sh` | Daily Artemis data pipeline — process yesterday's on-chain data and update satellite features | Cron: `0 1 * * * /path/to/artemis_sync.sh` |
| `backup_satellite.sh` | Automated SQLite backup for `satellite.db` and `hynous-data.db` — 7-day local retention, optional weekly scp to remote | Cron: `0 3 * * * /path/to/backup_satellite.sh` |

---

## Usage

```bash
# Run dashboard (development)
python -m scripts.run_dashboard

# Or use the Makefile
make dashboard

# Artemis daily sync (normally via cron)
HYNOUS_ROOT=/root/hynous bash scripts/artemis_sync.sh

# Manual backup
HYNOUS_STORAGE=/root/hynous/storage bash scripts/backup_satellite.sh
```

---

## Adding Scripts

Keep scripts minimal — logic belongs in `src/hynous/`.

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

Last updated: 2026-03-01
