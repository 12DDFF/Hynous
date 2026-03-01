"""Tests for satellite feature computation and storage."""

import hashlib
import time

from satellite.config import SatelliteConfig
from satellite.features import (
    AVAIL_COLUMNS,
    FEATURE_HASH,
    FEATURE_NAMES,
    NEUTRAL_VALUES,
    FeatureResult,
    compute_features,
    safe_extract,
    safe_float,
    to_feature_dict,
    to_feature_vector,
    _compute_hours_to_funding,
    _compute_sessions,
)
from satellite.store import SatelliteStore


# ─── safe_float tests ────────────────────────────────────────────────────────


class TestSafeFloat:

    def test_nan(self):
        assert safe_float(float("nan")) == 0.0

    def test_inf(self):
        assert safe_float(float("inf")) == 0.0

    def test_neg_inf(self):
        assert safe_float(float("-inf")) == 0.0

    def test_none(self):
        assert safe_float(None) == 0.0

    def test_string_number(self):
        assert safe_float("3.14") == 3.14

    def test_invalid_string(self):
        assert safe_float("abc") == 0.0

    def test_custom_default(self):
        assert safe_float(None, default=42.0) == 42.0

    def test_valid_float(self):
        assert safe_float(1.5) == 1.5

    def test_int(self):
        assert safe_float(10) == 10.0


# ─── safe_extract tests ──────────────────────────────────────────────────────


class TestSafeExtract:

    def test_basic(self):
        assert safe_extract({"val": 5.0}, "val") == 5.0

    def test_missing_key(self):
        assert safe_extract({}, "val", default=1.0) == 1.0

    def test_clamping_max(self):
        assert safe_extract({"val": 150}, "val", max_val=100) == 100

    def test_clamping_min(self):
        assert safe_extract({"val": -10}, "val", min_val=0) == 0

    def test_clamping_both(self):
        result = safe_extract({"val": 150}, "val", min_val=0, max_val=100)
        assert result == 100


# ─── Feature registry tests ──────────────────────────────────────────────────


class TestFeatureRegistry:

    def test_neutral_values_complete(self):
        """Every feature in FEATURE_NAMES has a neutral value."""
        for name in FEATURE_NAMES:
            assert name in NEUTRAL_VALUES, f"Missing neutral for {name}"

    def test_feature_count(self):
        """Exactly 12 structural features."""
        assert len(FEATURE_NAMES) == 12

    def test_feature_hash_deterministic(self):
        """Feature hash matches SHA-256 of feature names (NOT Python hash())."""
        expected = hashlib.sha256(
            "|".join(FEATURE_NAMES).encode()
        ).hexdigest()[:16]
        assert FEATURE_HASH == expected

    def test_feature_names_unique(self):
        """No duplicate feature names."""
        assert len(FEATURE_NAMES) == len(set(FEATURE_NAMES))


# ─── Session overlap tests ────────────────────────────────────────────────────


class TestSessionsOverlapping:

    def test_asia_only(self):
        """01:00 UTC = Asia only (0-8) = 1."""
        features = {}
        avail = {}
        _compute_sessions(features, avail, 1709514000.0)  # 01:00 UTC
        assert features["sessions_overlapping"] == 1
        assert avail["sessions_overlapping_avail"] == 1

    def test_london_us_overlap(self):
        """14:00 UTC = London (07-16) + US (13-22) = 2."""
        features = {}
        avail = {}
        _compute_sessions(features, avail, 1709560800.0)  # 14:00 UTC
        assert features["sessions_overlapping"] == 2

    def test_us_only(self):
        """20:00 UTC = US only (13-22) = 1."""
        features = {}
        avail = {}
        # 20:00 UTC = 1709514000 + 19*3600 = 1709582400
        _compute_sessions(features, avail, 1709582400.0)
        assert features["sessions_overlapping"] == 1

    def test_asia_london_overlap(self):
        """07:30 UTC = Asia (0-8) + London (7-16) = 2."""
        features = {}
        avail = {}
        # 07:30 UTC = 1709514000 + 6.5*3600 = 1709537400
        _compute_sessions(features, avail, 1709537400.0)
        assert features["sessions_overlapping"] == 2


# ─── Hours to funding tests ──────────────────────────────────────────────────


class TestHoursToFunding:

    def test_near_settlement(self):
        """07:55 UTC → 5 min to 08:00 settlement = ~0.083 hours."""
        features = {}
        avail = {}
        _compute_hours_to_funding(
            features, avail, 1709538900.0, SatelliteConfig(),
        )  # 07:55 UTC
        assert features["hours_to_funding"] < 0.1
        assert features["hours_to_funding"] > 0.0

    def test_max_distance(self):
        """Right after settlement = ~8 hours to next."""
        features = {}
        avail = {}
        # 00:01 UTC → next settlement at 08:00 = ~8 hours
        _compute_hours_to_funding(
            features, avail, 1709510460.0, SatelliteConfig(),
        )
        assert features["hours_to_funding"] > 7.9
        assert features["hours_to_funding"] < 8.0

    def test_always_available(self):
        """hours_to_funding is always available (clock math)."""
        features = {}
        avail = {}
        _compute_hours_to_funding(
            features, avail, time.time(), SatelliteConfig(),
        )
        assert avail["hours_to_funding_avail"] == 1


# ─── Store tests ──────────────────────────────────────────────────────────────


def _make_store() -> SatelliteStore:
    """Create an in-memory satellite store."""
    store = SatelliteStore(":memory:")
    store.connect()
    return store


def _make_result(coin: str = "BTC", ts: float | None = None) -> FeatureResult:
    """Create a minimal FeatureResult for testing."""
    return FeatureResult(
        snapshot_id=f"test-{coin}-{ts or time.time()}",
        created_at=ts or time.time(),
        coin=coin,
        features={name: NEUTRAL_VALUES[name] for name in FEATURE_NAMES},
        availability={col: 0 for col in AVAIL_COLUMNS},
        raw_data={"test": True},
        schema_version=1,
    )


class TestStore:

    def test_save_and_read(self):
        store = _make_store()
        result = _make_result("BTC", 1000.0)
        store.save_snapshot(result)

        rows = store.get_snapshots("BTC")
        assert len(rows) == 1
        assert rows[0]["coin"] == "BTC"
        assert rows[0]["snapshot_id"] == result.snapshot_id

    def test_snapshot_count(self):
        store = _make_store()
        store.save_snapshot(_make_result("BTC", 1000.0))
        store.save_snapshot(_make_result("BTC", 2000.0))
        store.save_snapshot(_make_result("ETH", 1000.0))

        assert store.get_snapshot_count("BTC") == 2
        assert store.get_snapshot_count("ETH") == 1
        assert store.get_snapshot_count() == 3

    def test_time_range_query(self):
        store = _make_store()
        store.save_snapshot(_make_result("BTC", 1000.0))
        store.save_snapshot(_make_result("BTC", 2000.0))
        store.save_snapshot(_make_result("BTC", 3000.0))

        rows = store.get_snapshots("BTC", start=1500.0, end=2500.0)
        assert len(rows) == 1
        assert rows[0]["created_at"] == 2000.0

    def test_raw_data_stored(self):
        store = _make_store()
        result = _make_result("BTC", 1000.0)
        store.save_snapshot(result)

        row = store.conn.execute(
            "SELECT raw_json FROM raw_snapshots WHERE snapshot_id = ?",
            (result.snapshot_id,),
        ).fetchone()
        assert row is not None
        assert '"test": true' in row["raw_json"]

    def test_raw_data_skipped_when_none(self):
        store = _make_store()
        result = _make_result("BTC", 1000.0)
        result.raw_data = None
        store.save_snapshot(result)

        row = store.conn.execute(
            "SELECT COUNT(*) as n FROM raw_snapshots",
        ).fetchone()
        assert row["n"] == 0

    def test_duplicate_ignored(self):
        """INSERT OR IGNORE prevents duplicate (coin, created_at)."""
        store = _make_store()
        store.save_snapshot(_make_result("BTC", 1000.0))
        # Same coin + timestamp, different snapshot_id
        r2 = _make_result("BTC", 1000.0)
        r2.snapshot_id = "different-id"
        store.save_snapshot(r2)
        assert store.get_snapshot_count("BTC") == 1

    def test_unlabeled_snapshots(self):
        store = _make_store()
        # Old enough to label (created 5h ago)
        old_ts = time.time() - 18000
        store.save_snapshot(_make_result("BTC", old_ts))
        # Too recent to label (created now)
        store.save_snapshot(_make_result("BTC", time.time()))

        unlabeled = store.get_unlabeled_snapshots("BTC")
        assert len(unlabeled) == 1
        assert unlabeled[0]["created_at"] == old_ts

    def test_prune_old_data(self):
        store = _make_store()
        old_ts = time.time() - 200 * 86400  # 200 days old
        new_ts = time.time() - 10 * 86400   # 10 days old
        store.save_snapshot(_make_result("BTC", old_ts))
        store.save_snapshot(_make_result("BTC", new_ts))

        deleted = store.prune_old_data(keep_days=180)
        assert deleted >= 1
        assert store.get_snapshot_count("BTC") == 1

    def test_schema_idempotent(self):
        """Calling connect() twice doesn't crash."""
        store = SatelliteStore(":memory:")
        store.connect()
        # Re-init schema on same connection is fine
        from satellite.schema import init_schema
        init_schema(store.conn)


# ─── Feature vector export tests ──────────────────────────────────────────────


class TestFeatureExport:

    def test_to_feature_vector_order(self):
        """Vector matches FEATURE_NAMES order."""
        result = _make_result("BTC")
        result.features["liq_magnet_direction"] = 0.5
        result.features["sessions_overlapping"] = 2

        vec = to_feature_vector(result)
        assert len(vec) == 12
        assert vec[0] == 0.5   # liq_magnet_direction is first
        assert vec[11] == 2    # sessions_overlapping is last

    def test_to_feature_dict_includes_avail(self):
        """Dict includes both features and availability flags."""
        result = _make_result("BTC")
        d = to_feature_dict(result)
        assert "liq_magnet_direction" in d
        assert "liq_magnet_avail" in d


# ─── Tick integration test ────────────────────────────────────────────────────


class TestTick:

    def test_tick_stores_results(self):
        """tick() computes features for all coins and stores them."""
        from satellite import tick

        store = _make_store()
        cfg = SatelliteConfig(coins=["BTC", "ETH"])

        # Minimal mock snapshot
        class MockSnapshot:
            prices = {}
            funding = {}
            oi_usd = {}
            volume_usd = {}

        # Mock data-layer db (features will use neutral values)
        class MockDB:
            class conn:
                @staticmethod
                def execute(*a, **kw):
                    class R:
                        def fetchone(self):
                            return None
                        def fetchall(self):
                            return []
                    return R()

        results = tick(
            snapshot=MockSnapshot(),
            data_layer_db=MockDB(),
            store=store,
            config=cfg,
        )

        assert len(results) == 2
        assert results[0].coin == "BTC"
        assert results[1].coin == "ETH"
        assert store.get_snapshot_count() == 2
