import sys

from .consolidation import run_weekly_rollup
from .store import JournalStore

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m hynous.journal {rollup}")
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "rollup":
        from hynous.core.config import load_config
        cfg = load_config()
        store = JournalStore(cfg.v2.journal.db_path)
        pattern_id = run_weekly_rollup(
            store, window_days=cfg.v2.consolidation.pattern_rollup_window_days,
        )
        print(f"Rollup complete: {pattern_id}")
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
