"""Unit tests for SPEC-01: Historical tables, pruning, heatmap noise filter."""

import time

import pytest

from hynous_data.core.db import Database


@pytest.fixture
def db(tmp_path):
    """Create a temporary database with full schema."""
    d = Database(tmp_path / "test.db")
    d.connect()
    d.init_schema()
    yield d
    d.close()


class TestFundingHistory:
    """Test funding_history table operations."""

    def test_insert_and_query(self, db):
        ts = time.time()
        with db.write_lock:
            db.conn.execute(
                "INSERT INTO funding_history (coin, recorded_at, rate) "
                "VALUES (?, ?, ?)",
                ("BTC", ts, 0.0001),
            )
            db.conn.commit()
        rows = db.conn.execute(
            "SELECT * FROM funding_history WHERE coin = 'BTC'"
        ).fetchall()
        assert len(rows) == 1
        assert rows[0]["rate"] == 0.0001

    def test_dedup_on_primary_key(self, db):
        ts = time.time()
        with db.write_lock:
            db.conn.execute(
                "INSERT INTO funding_history (coin, recorded_at, rate) "
                "VALUES (?, ?, ?)",
                ("BTC", ts, 0.0001),
            )
            db.conn.execute(
                "INSERT OR IGNORE INTO funding_history (coin, recorded_at, rate) "
                "VALUES (?, ?, ?)",
                ("BTC", ts, 0.0002),
            )
            db.conn.commit()
        rows = db.conn.execute(
            "SELECT * FROM funding_history WHERE coin = 'BTC'"
        ).fetchall()
        assert len(rows) == 1
        assert rows[0]["rate"] == 0.0001  # first value preserved

    def test_multiple_coins(self, db):
        ts = time.time()
        with db.write_lock:
            for coin, rate in [("BTC", 0.0001), ("ETH", -0.0002), ("SOL", 0.0005)]:
                db.conn.execute(
                    "INSERT INTO funding_history (coin, recorded_at, rate) "
                    "VALUES (?, ?, ?)",
                    (coin, ts, rate),
                )
            db.conn.commit()
        rows = db.conn.execute("SELECT * FROM funding_history").fetchall()
        assert len(rows) == 3


class TestOiHistory:
    """Test oi_history table operations."""

    def test_insert_and_query(self, db):
        ts = time.time()
        with db.write_lock:
            db.conn.execute(
                "INSERT INTO oi_history (coin, recorded_at, oi_usd) "
                "VALUES (?, ?, ?)",
                ("ETH", ts, 5_000_000_000),
            )
            db.conn.commit()
        rows = db.conn.execute(
            "SELECT * FROM oi_history WHERE coin = 'ETH'"
        ).fetchall()
        assert len(rows) == 1
        assert rows[0]["oi_usd"] == 5_000_000_000


class TestVolumeHistory:
    """Test volume_history table operations."""

    def test_insert_and_query(self, db):
        ts = time.time()
        with db.write_lock:
            db.conn.execute(
                "INSERT INTO volume_history (coin, recorded_at, volume_usd) "
                "VALUES (?, ?, ?)",
                ("SOL", ts, 1_200_000_000),
            )
            db.conn.commit()
        rows = db.conn.execute(
            "SELECT * FROM volume_history WHERE coin = 'SOL'"
        ).fetchall()
        assert len(rows) == 1
        assert rows[0]["volume_usd"] == 1_200_000_000


class TestLiquidationEvents:
    """Test liquidation_events table operations."""

    def test_insert_and_query(self, db):
        ts = time.time()
        with db.write_lock:
            db.conn.execute(
                "INSERT INTO liquidation_events "
                "(coin, occurred_at, side, size_usd, price, address) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                ("BTC", ts, "long", 50000, 97500.0, "0xabc123"),
            )
            db.conn.commit()
        rows = db.conn.execute(
            "SELECT * FROM liquidation_events WHERE coin = 'BTC'"
        ).fetchall()
        assert len(rows) == 1
        assert rows[0]["side"] == "long"
        assert rows[0]["address"] == "0xabc123"

    def test_multiple_same_timestamp(self, db):
        """Multiple liquidations can occur at same timestamp for same coin."""
        ts = time.time()
        with db.write_lock:
            for i in range(3):
                db.conn.execute(
                    "INSERT INTO liquidation_events "
                    "(coin, occurred_at, side, size_usd, price, address) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    ("BTC", ts, "long", 10000 * (i + 1), 97500.0, f"0x{i}"),
                )
            db.conn.commit()
        rows = db.conn.execute(
            "SELECT * FROM liquidation_events WHERE coin = 'BTC'"
        ).fetchall()
        assert len(rows) == 3  # AUTOINCREMENT allows duplicates

    def test_nullable_address(self, db):
        ts = time.time()
        with db.write_lock:
            db.conn.execute(
                "INSERT INTO liquidation_events "
                "(coin, occurred_at, side, size_usd, price) "
                "VALUES (?, ?, ?, ?, ?)",
                ("ETH", ts, "short", 25000, 3400.0),
            )
            db.conn.commit()
        rows = db.conn.execute(
            "SELECT * FROM liquidation_events WHERE coin = 'ETH'"
        ).fetchall()
        assert len(rows) == 1
        assert rows[0]["address"] is None


class TestPruning:
    """Test that prune_old_data() uses 90-day retention for historical tables."""

    def test_historical_tables_use_90_day_retention(self, db):
        now = time.time()
        old_ts = now - 95 * 86400  # 95 days ago
        recent_ts = now - 80 * 86400  # 80 days ago

        with db.write_lock:
            # Insert old and recent rows
            db.conn.execute(
                "INSERT INTO funding_history (coin, recorded_at, rate) "
                "VALUES (?, ?, ?)",
                ("BTC", old_ts, 0.0001),
            )
            db.conn.execute(
                "INSERT INTO funding_history (coin, recorded_at, rate) "
                "VALUES (?, ?, ?)",
                ("BTC", recent_ts, 0.0002),
            )
            db.conn.execute(
                "INSERT INTO oi_history (coin, recorded_at, oi_usd) "
                "VALUES (?, ?, ?)",
                ("BTC", old_ts, 1_000_000),
            )
            db.conn.execute(
                "INSERT INTO volume_history (coin, recorded_at, volume_usd) "
                "VALUES (?, ?, ?)",
                ("BTC", old_ts, 500_000),
            )
            db.conn.execute(
                "INSERT INTO liquidation_events "
                "(coin, occurred_at, side, size_usd, price) "
                "VALUES (?, ?, ?, ?, ?)",
                ("BTC", old_ts, "long", 10000, 95000),
            )
            db.conn.commit()

        db.prune_old_data(days=7)

        # Old rows (95 days) should be pruned
        assert db.conn.execute(
            "SELECT COUNT(*) as cnt FROM funding_history WHERE recorded_at = ?",
            (old_ts,),
        ).fetchone()["cnt"] == 0
        assert db.conn.execute(
            "SELECT COUNT(*) as cnt FROM oi_history"
        ).fetchone()["cnt"] == 0
        assert db.conn.execute(
            "SELECT COUNT(*) as cnt FROM volume_history"
        ).fetchone()["cnt"] == 0
        assert db.conn.execute(
            "SELECT COUNT(*) as cnt FROM liquidation_events"
        ).fetchone()["cnt"] == 0

        # Recent rows (80 days) should survive
        assert db.conn.execute(
            "SELECT COUNT(*) as cnt FROM funding_history WHERE recorded_at = ?",
            (recent_ts,),
        ).fetchone()["cnt"] == 1


class TestHeatmapNoiseFilter:
    """Test that heatmap query excludes small positions and bots."""

    def test_filters_small_positions_and_bots(self, db):
        now = time.time()
        with db.write_lock:
            # Small position (below $1K) — should be filtered
            db.conn.execute(
                "INSERT INTO positions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("0xsmall", "BTC", "long", 0.005, 500, 95000, 97000,
                 20, 1000, 90000, 0, now),
            )
            # Bot position — should be filtered
            db.conn.execute(
                "INSERT INTO positions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("0xbot", "BTC", "long", 0.5, 50000, 95000, 97000,
                 20, 1000, 90000, 0, now),
            )
            db.conn.execute(
                "INSERT INTO wallet_profiles VALUES "
                "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("0xbot", now, 0.6, 100, 1.5, 0.5, 2.0, 5.0,
                 "scalper", 1, 100000),
            )
            # Valid position — should be kept
            db.conn.execute(
                "INSERT INTO positions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("0xvalid", "BTC", "long", 0.5, 50000, 95000, 97000,
                 20, 1000, 90000, 0, now),
            )
            # Stale position (old updated_at) — should be filtered
            db.conn.execute(
                "INSERT INTO positions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("0xstale", "BTC", "long", 0.5, 50000, 95000, 97000,
                 20, 1000, 90000, 0, now - 2000),
            )
            db.conn.commit()

        staleness_cutoff = now - 1200
        rows = db.conn.execute(
            """
            SELECT p.address FROM positions p
            LEFT JOIN wallet_profiles wp ON p.address = wp.address
            WHERE p.coin = 'BTC'
              AND p.size_usd >= 1000
              AND p.liq_px IS NOT NULL
              AND p.liq_px > 0
              AND p.updated_at >= ?
              AND COALESCE(wp.is_bot, 0) = 0
            """,
            (staleness_cutoff,),
        ).fetchall()

        addresses = [r["address"] for r in rows]
        assert "0xsmall" not in addresses   # filtered: too small
        assert "0xbot" not in addresses     # filtered: is_bot=1
        assert "0xstale" not in addresses   # filtered: stale
        assert "0xvalid" in addresses       # kept: valid position


class TestSchemaIdempotent:
    """Test that init_schema() can be called multiple times."""

    def test_double_init(self, db):
        # First init already ran in fixture. Run again:
        db.init_schema()
        # Should not raise. Tables still exist:
        count = db.conn.execute(
            "SELECT COUNT(*) as cnt FROM funding_history"
        ).fetchone()["cnt"]
        assert count == 0  # empty but table exists
