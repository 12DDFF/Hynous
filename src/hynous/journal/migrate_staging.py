"""One-shot migration from the phase-1 staging store to the phase-2 journal store.

Phase 1 wrote captured snapshots + events into ``storage/v2/staging.db`` using
:class:`StagingStore`. Phase 2 replaces that with :class:`JournalStore` at
``storage/v2/journal.db``. This module replays the staging data into the
journal — once, on startup (wired in M7), or manually via
``python -m hynous.journal.migrate_staging``.

Idempotent: every write path in :class:`JournalStore` uses
``ON CONFLICT DO UPDATE`` or ``INSERT OR IGNORE``, so re-running the
migration converges on the same end state.

Corrupt-row isolation: each row is wrapped in its own try/except so a single
malformed snapshot (schema drift, truncated JSON) cannot strand the rest.
Corrupt rows are logged at WARNING and counted in the ``skipped_*`` fields
of the return value.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path

from .schema import (
    TradeEntrySnapshot,
    TradeExitSnapshot,
    entry_snapshot_from_dict,
    exit_snapshot_from_dict,
)
from .store import JournalStore

logger = logging.getLogger(__name__)


def migrate_staging_to_journal(
    staging_db_path: str,
    journal_db_path: str,
) -> dict[str, int]:
    """Copy all data from the phase-1 staging DB into the phase-2 journal DB.

    Args:
        staging_db_path: path to the staging SQLite file.
        journal_db_path: path to the journal SQLite file (created if missing).

    Returns:
        Counts of migrated and skipped rows per table:
        ``{"entries": int, "exits": int, "events": int,
           "skipped_entries": int, "skipped_exits": int, "skipped_events": int}``.
    """
    counts = {
        "entries": 0, "exits": 0, "events": 0,
        "skipped_entries": 0, "skipped_exits": 0, "skipped_events": 0,
    }

    if not Path(staging_db_path).exists():
        logger.info(
            "No staging DB at %s — nothing to migrate", staging_db_path,
        )
        return counts

    journal = JournalStore(journal_db_path)

    # Open staging read-only — migration never mutates the source.
    staging = sqlite3.connect(f"file:{staging_db_path}?mode=ro", uri=True)
    staging.row_factory = sqlite3.Row
    try:
        counts["entries"], counts["skipped_entries"] = _migrate_entries(
            staging, journal,
        )
        counts["exits"], counts["skipped_exits"] = _migrate_exits(
            staging, journal,
        )
        counts["events"], counts["skipped_events"] = _migrate_events(
            staging, journal,
        )
    finally:
        staging.close()

    logger.info(
        "staging→journal migration complete: entries=%d exits=%d events=%d "
        "(skipped e=%d x=%d ev=%d)",
        counts["entries"], counts["exits"], counts["events"],
        counts["skipped_entries"], counts["skipped_exits"], counts["skipped_events"],
    )
    return counts


def _migrate_entries(
    staging: sqlite3.Connection, journal: JournalStore,
) -> tuple[int, int]:
    """Replay trade_entry_snapshots_staging → journal.insert_entry_snapshot."""
    migrated = 0
    skipped = 0
    for row in staging.execute(
        "SELECT trade_id, snapshot_json FROM trade_entry_snapshots_staging",
    ):
        try:
            snap: TradeEntrySnapshot = entry_snapshot_from_dict(
                json.loads(row["snapshot_json"]),
            )
        except (KeyError, TypeError, json.JSONDecodeError):
            logger.warning(
                "skipped corrupt entry snapshot trade_id=%s", row["trade_id"],
                exc_info=True,
            )
            skipped += 1
            continue
        try:
            journal.insert_entry_snapshot(snap)
            migrated += 1
        except Exception:
            logger.warning(
                "skipped entry snapshot (journal write failed) trade_id=%s",
                row["trade_id"], exc_info=True,
            )
            skipped += 1
    return migrated, skipped


def _migrate_exits(
    staging: sqlite3.Connection, journal: JournalStore,
) -> tuple[int, int]:
    """Replay trade_exit_snapshots_staging → journal.insert_exit_snapshot."""
    migrated = 0
    skipped = 0
    for row in staging.execute(
        "SELECT trade_id, snapshot_json FROM trade_exit_snapshots_staging",
    ):
        try:
            snap: TradeExitSnapshot = exit_snapshot_from_dict(
                json.loads(row["snapshot_json"]),
            )
        except (KeyError, TypeError, json.JSONDecodeError):
            logger.warning(
                "skipped corrupt exit snapshot trade_id=%s", row["trade_id"],
                exc_info=True,
            )
            skipped += 1
            continue
        try:
            journal.insert_exit_snapshot(snap)
            migrated += 1
        except Exception:
            logger.warning(
                "skipped exit snapshot (journal write failed) trade_id=%s",
                row["trade_id"], exc_info=True,
            )
            skipped += 1
    return migrated, skipped


def _migrate_events(
    staging: sqlite3.Connection, journal: JournalStore,
) -> tuple[int, int]:
    """Replay trade_events_staging → journal.insert_lifecycle_event.

    Events lack an idempotency key — the journal table has an auto-increment
    PK. Re-running migration re-inserts events (unlike snapshots, which
    upsert on trade_id). Callers that need strict idempotency on events
    should drop the journal DB first, or check counts before re-running.
    """
    migrated = 0
    skipped = 0
    for row in staging.execute(
        "SELECT trade_id, ts, event_type, payload_json FROM trade_events_staging",
    ):
        try:
            payload = json.loads(row["payload_json"])
        except json.JSONDecodeError:
            logger.warning(
                "skipped corrupt event trade_id=%s type=%s",
                row["trade_id"], row["event_type"], exc_info=True,
            )
            skipped += 1
            continue
        try:
            journal.insert_lifecycle_event(
                trade_id=row["trade_id"],
                ts=row["ts"],
                event_type=row["event_type"],
                payload=payload,
            )
            migrated += 1
        except Exception:
            logger.warning(
                "skipped event (journal write failed) trade_id=%s type=%s",
                row["trade_id"], row["event_type"], exc_info=True,
            )
            skipped += 1
    return migrated, skipped


if __name__ == "__main__":
    import argparse

    from hynous.core.config import load_config

    parser = argparse.ArgumentParser(
        description="Migrate phase-1 staging store into phase-2 journal store.",
    )
    parser.add_argument(
        "--staging", help="Path to staging.db (default: derive from config)",
    )
    parser.add_argument(
        "--journal", help="Path to journal.db (default: config v2.journal.db_path)",
    )
    args = parser.parse_args()

    cfg = load_config()
    journal_path = args.journal or cfg.v2.journal.db_path
    staging_path = args.staging or journal_path.replace("journal.db", "staging.db")

    logging.basicConfig(level=logging.INFO)
    result = migrate_staging_to_journal(staging_path, journal_path)
    print(json.dumps(result, indent=2))
