"""Layer 2 data collection: co-occurrence and strategy patterns.

Collects data for future smart money ML (not used in v1 model).
Starts collection NOW because we need history for training later.

Capabilities prepared:
  1. Entry co-occurrence (temporal clustering of entries)
  2. Strategy fingerprinting (which features are active at entry)
  3. Group detection (wallets that trade together)
"""

import logging
from collections import defaultdict

log = logging.getLogger(__name__)


def collect_co_occurrence(
    trades: dict[str, list],
    window_seconds: int = 300,
) -> list[tuple[str, str, str, float]]:
    """Find wallets that enter positions within a time window.

    Args:
        trades: Dict mapping address -> list of trade dicts.
        window_seconds: Co-occurrence window (default 5 min).

    Returns:
        List of (address_a, address_b, coin, co_occurrence_time) tuples.
    """
    # Group all entries by coin and time bucket
    entries_by_coin: dict[str, list] = defaultdict(list)

    for address, address_trades in trades.items():
        for t in address_trades:
            if t["side"] == "buy":  # entries only
                entries_by_coin[t["coin"]].append({
                    "address": address,
                    "time": t["time"],
                    "size_usd": t["size_usd"],
                })

    co_occurrences = []

    for coin, entries in entries_by_coin.items():
        entries.sort(key=lambda x: x["time"])

        for i, e1 in enumerate(entries):
            for j in range(i + 1, len(entries)):
                e2 = entries[j]
                time_diff = e2["time"] - e1["time"]

                if time_diff > window_seconds:
                    break  # sorted, no more matches possible

                if e1["address"] != e2["address"]:
                    co_occurrences.append((
                        e1["address"], e2["address"],
                        coin, e1["time"],
                    ))

    return co_occurrences


def save_co_occurrences(
    store: object,
    co_occurrences: list[tuple[str, str, str, float]],
) -> int:
    """Save co-occurrence data to satellite database.

    Args:
        store: SatelliteStore instance.
        co_occurrences: List of (addr_a, addr_b, coin, time) tuples.

    Returns:
        Number of rows inserted.
    """
    if not co_occurrences:
        return 0

    with store.write_lock:
        store.conn.executemany(
            "INSERT OR IGNORE INTO co_occurrences "
            "(address_a, address_b, coin, occurred_at) "
            "VALUES (?, ?, ?, ?)",
            co_occurrences,
        )
        store.conn.commit()

    return len(co_occurrences)
