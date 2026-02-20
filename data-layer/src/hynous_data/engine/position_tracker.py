"""Position change tracker — detects entry/exit/increase/flip events."""

import time
import logging
import threading

from hynous_data.core.db import Database

log = logging.getLogger(__name__)


class PositionChangeTracker:
    """Compares position snapshots to detect changes for watched wallets.

    In-memory state: last known positions per address.
    Writes detected changes to position_changes table.
    Thread-safe — _snapshots protected by a lock (accessed from poller threads).
    """

    def __init__(self, db: Database):
        self._db = db
        self._lock = threading.Lock()
        # address → {coin: {"side": str, "size_usd": float}}
        self._snapshots: dict[str, dict[str, dict]] = {}

    def load_snapshots(self):
        """Initialize snapshots from current positions table.

        Called once at startup to avoid false alerts on restart.
        Also seeds empty snapshots for watched wallets with no positions,
        so they don't trigger false entries on first poll.
        """
        conn = self._db.conn

        # All active watched addresses (even those with no positions)
        watched_rows = conn.execute(
            "SELECT address FROM watched_wallets WHERE is_active = 1"
        ).fetchall()

        # Positions for watched wallets
        pos_rows = conn.execute(
            """
            SELECT p.address, p.coin, p.side, p.size_usd, p.mark_px
            FROM positions p
            INNER JOIN watched_wallets w ON p.address = w.address
            WHERE w.is_active = 1
            """,
        ).fetchall()

        with self._lock:
            # Seed ALL watched addresses (empty dict = no positions)
            for r in watched_rows:
                self._snapshots.setdefault(r["address"], {})

            # Fill in position data
            for r in pos_rows:
                addr = r["address"]
                if addr not in self._snapshots:
                    self._snapshots[addr] = {}
                self._snapshots[addr][r["coin"]] = {
                    "side": r["side"],
                    "size_usd": r["size_usd"],
                    "mark_px": r["mark_px"],
                }

        log.info(
            "Loaded position snapshots for %d watched wallets (%d positions)",
            len(self._snapshots),
            sum(len(v) for v in self._snapshots.values()),
        )

    def check_changes(
        self, address: str, new_positions: list[dict]
    ) -> list[dict]:
        """Compare new positions against last snapshot, detect changes.

        Thread-safe. If the address has never been seen, seeds the snapshot
        without generating alerts (prevents false entries on first poll).

        Args:
            address: The wallet address.
            new_positions: List of position dicts with keys:
                coin, side, size_usd, mark_px

        Returns:
            List of change dicts: {address, coin, action, side, size_usd, price, detected_at}
        """
        new_map = {}
        for p in new_positions:
            coin = p.get("coin", "")
            if not coin:
                continue
            new_map[coin] = {
                "side": p.get("side", ""),
                "size_usd": p.get("size_usd", 0),
                "mark_px": p.get("mark_px", 0),
            }

        with self._lock:
            # First time seeing this address — seed snapshot, no alerts
            if address not in self._snapshots:
                self._snapshots[address] = new_map
                if new_map:
                    log.debug("Seeded snapshot for %s (%d positions)", address[:10], len(new_map))
                return []

            old = self._snapshots[address]
            now = time.time()
            changes = []

            # Check for entries, flips, increases
            for coin, new_data in new_map.items():
                old_data = old.get(coin)

                if old_data is None:
                    # New position — entry
                    changes.append({
                        "address": address,
                        "coin": coin,
                        "action": "entry",
                        "side": new_data["side"],
                        "size_usd": new_data["size_usd"],
                        "price": new_data["mark_px"],
                        "detected_at": now,
                    })
                elif old_data["side"] != new_data["side"]:
                    # Side changed — flip
                    changes.append({
                        "address": address,
                        "coin": coin,
                        "action": "flip",
                        "side": new_data["side"],
                        "size_usd": new_data["size_usd"],
                        "price": new_data["mark_px"],
                        "detected_at": now,
                    })
                elif new_data["size_usd"] > old_data["size_usd"] * 1.2:
                    # Size increased >20% — increase
                    changes.append({
                        "address": address,
                        "coin": coin,
                        "action": "increase",
                        "side": new_data["side"],
                        "size_usd": new_data["size_usd"],
                        "price": new_data["mark_px"],
                        "detected_at": now,
                    })

            # Check for exits
            for coin, old_data in old.items():
                if coin not in new_map:
                    changes.append({
                        "address": address,
                        "coin": coin,
                        "action": "exit",
                        "side": old_data["side"],
                        "size_usd": old_data["size_usd"],
                        "price": old_data["mark_px"],
                        "detected_at": now,
                    })

            # Update snapshot
            self._snapshots[address] = new_map

        # Write to DB outside lock (DB has its own write_lock)
        if changes:
            self._write_changes(changes)

        return changes

    def _write_changes(self, changes: list[dict]):
        """Batch insert position changes."""
        conn = self._db.conn
        try:
            with self._db.write_lock:
                conn.executemany(
                    """
                    INSERT INTO position_changes
                    (address, coin, action, side, size_usd, price, detected_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            c["address"], c["coin"], c["action"], c["side"],
                            c["size_usd"], c["price"], c["detected_at"],
                        )
                        for c in changes
                    ],
                )
                conn.commit()
        except Exception:
            log.exception("Failed to write %d position changes", len(changes))

    def get_watched_addresses(self) -> set[str]:
        """Get set of active watched wallet addresses."""
        rows = self._db.conn.execute(
            "SELECT address FROM watched_wallets WHERE is_active = 1"
        ).fetchall()
        return {r["address"] for r in rows}
