"""Seed addresses from Artemis data into the data-layer addresses table.

Artemis Perp Balances contains EVERY address that ever held a position.
This is more complete than TradeStream discovery (which only sees active
traders).
"""

import logging
from datetime import datetime, timezone

log = logging.getLogger(__name__)


def seed_addresses(
    db: object,
    addresses: list[str],
    date_str: str,
    batch_size: int = 1000,
) -> int:
    """Insert discovered addresses into the data-layer addresses table.

    Uses INSERT OR IGNORE — existing addresses are not overwritten.
    New addresses get tier=3 (lowest polling priority) until profiled.

    Args:
        db: data-layer Database instance.
        addresses: List of wallet addresses.
        date_str: Date of discovery (for first_seen).
        batch_size: Rows per batch insert.

    Returns:
        Number of new addresses inserted.
    """
    epoch = datetime.strptime(date_str, "%Y-%m-%d").replace(
        tzinfo=timezone.utc,
    ).timestamp()
    inserted = 0

    for i in range(0, len(addresses), batch_size):
        batch = addresses[i:i + batch_size]
        rows = [
            (addr, epoch, epoch, 0, None, 3, 0)
            for addr in batch
        ]

        with db.write_lock:
            cursor = db.conn.executemany(
                "INSERT OR IGNORE INTO addresses "
                "(address, first_seen, last_seen, trade_count, "
                "last_polled, tier, total_size_usd) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                rows,
            )
            inserted += cursor.rowcount
            db.conn.commit()

    if inserted:
        log.info(
            "Seeded %d new addresses from %s (total batch: %d)",
            inserted, date_str, len(addresses),
        )

    return inserted
