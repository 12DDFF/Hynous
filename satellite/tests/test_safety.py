"""Tests for kill switch, safety controls, and health monitoring."""

import time

import pytest

from satellite.safety import KillSwitch, SafetyConfig, SafetyState
from satellite.store import SatelliteStore
from satellite.monitor import HealthReport, generate_health_report
from satellite.features import AVAIL_COLUMNS, FEATURE_NAMES


# ─── Kill Switch Tests ──────────────────────────────────────────────────────


class TestKillSwitch:

    def test_active_by_default(self):
        """Kill switch is active with default config."""
        ks = KillSwitch(SafetyConfig())
        assert ks.is_active is True

    def test_manual_disable(self):
        """Manual ml_enabled=false disables the switch."""
        cfg = SafetyConfig(ml_enabled=False)
        ks = KillSwitch(cfg)
        assert ks.is_active is False
        assert "Manual" in ks.disable_reason

    def test_auto_disable_cumulative_loss(self):
        """Auto-disable when cumulative loss exceeds threshold."""
        ks = KillSwitch(SafetyConfig(max_cumulative_loss_pct=-10.0))
        for _ in range(5):
            ks.record_trade_outcome(predicted_roe=3.0, actual_roe=-3.0)
        assert ks.is_active is False
        assert "Cumulative loss" in ks.disable_reason

    def test_auto_disable_consecutive_losses(self):
        """Auto-disable after N consecutive losing trades."""
        ks = KillSwitch(SafetyConfig(max_consecutive_losses=3))
        for _ in range(3):
            ks.record_trade_outcome(predicted_roe=3.0, actual_roe=-1.0)
        assert ks.is_active is False
        assert "consecutive" in ks.disable_reason

    def test_auto_disable_precision_collapse(self):
        """Auto-disable when precision at 3% drops below floor."""
        ks = KillSwitch(SafetyConfig(
            precision_eval_window=20,
            min_precision_at_3pct=0.50,
        ))
        # Fill window with 20 predictions where predicted > 3% but actual < 3%
        for _ in range(20):
            ks.record_trade_outcome(predicted_roe=4.0, actual_roe=1.0)
        assert ks.is_active is False
        assert "Precision" in ks.disable_reason

    def test_precision_needs_full_window(self):
        """Precision check doesn't fire until window is full."""
        ks = KillSwitch(SafetyConfig(
            precision_eval_window=20,
            min_precision_at_3pct=0.50,
        ))
        # Only 10 predictions — not enough to trigger
        for _ in range(10):
            ks.record_trade_outcome(predicted_roe=4.0, actual_roe=1.0)
        assert ks.is_active is True

    def test_win_resets_consecutive(self):
        """A winning trade resets the consecutive loss counter."""
        ks = KillSwitch(SafetyConfig(max_consecutive_losses=3))
        ks.record_trade_outcome(predicted_roe=3.0, actual_roe=-1.0)
        ks.record_trade_outcome(predicted_roe=3.0, actual_roe=-1.0)
        ks.record_trade_outcome(predicted_roe=3.0, actual_roe=2.0)  # win
        ks.record_trade_outcome(predicted_roe=3.0, actual_roe=-1.0)
        assert ks.is_active is True  # only 1 consecutive, not 3

    def test_shadow_mode(self):
        """Shadow mode: active but in shadow."""
        cfg = SafetyConfig(shadow_mode=True)
        ks = KillSwitch(cfg)
        assert ks.is_active is True
        assert ks.is_shadow is True

    def test_not_shadow_by_default(self):
        """Default config is not shadow mode."""
        ks = KillSwitch(SafetyConfig())
        assert ks.is_shadow is False

    def test_reset(self):
        """Reset clears auto-disable and state."""
        ks = KillSwitch(SafetyConfig(max_consecutive_losses=2))
        ks.record_trade_outcome(predicted_roe=3.0, actual_roe=-1.0)
        ks.record_trade_outcome(predicted_roe=3.0, actual_roe=-1.0)
        assert ks.is_active is False
        ks.reset()
        assert ks.is_active is True
        assert ks.state.cumulative_roe == 0.0
        assert ks.state.consecutive_losses == 0

    def test_state_tracks_totals(self):
        """State tracks total trades and wins correctly."""
        ks = KillSwitch(SafetyConfig())
        ks.record_trade_outcome(predicted_roe=3.0, actual_roe=2.0)
        ks.record_trade_outcome(predicted_roe=3.0, actual_roe=-1.0)
        ks.record_trade_outcome(predicted_roe=3.0, actual_roe=1.5)
        assert ks.state.total_trades == 3
        assert ks.state.total_wins == 2
        assert abs(ks.state.cumulative_roe - 2.5) < 0.01

    def test_staleness_fresh_data(self):
        """Fresh data passes staleness check."""
        ks = KillSwitch(SafetyConfig(max_data_stale_seconds=60))
        ks.record_snapshot_time(time.time())
        assert ks.check_staleness() is True

    def test_staleness_stale_data(self):
        """Stale data triggers auto-disable."""
        ks = KillSwitch(SafetyConfig(max_data_stale_seconds=60))
        ks.record_snapshot_time(time.time() - 120)  # 2 min ago, limit is 1
        assert ks.check_staleness() is False
        assert ks.is_active is False
        assert "stale" in ks.disable_reason.lower()

    def test_staleness_no_data_yet(self):
        """No snapshots yet doesn't trigger staleness."""
        ks = KillSwitch(SafetyConfig(max_data_stale_seconds=60))
        assert ks.check_staleness() is True

    def test_recent_predictions_capped(self):
        """Recent predictions list is capped at precision_eval_window."""
        ks = KillSwitch(SafetyConfig(precision_eval_window=10))
        for i in range(20):
            ks.record_trade_outcome(predicted_roe=1.0, actual_roe=0.5)
        assert len(ks.state.recent_predictions) <= 10


# ─── State Persistence Tests ────────────────────────────────────────────────


class TestKillSwitchPersistence:

    def test_save_and_load_state(self):
        """Safety state persists across KillSwitch instances."""
        store = SatelliteStore(":memory:")
        store.connect()

        # First instance: record some trades
        cfg1 = SafetyConfig()
        ks1 = KillSwitch(cfg1, store=store)
        ks1.record_trade_outcome(predicted_roe=4.0, actual_roe=-2.0)
        ks1.record_trade_outcome(predicted_roe=3.5, actual_roe=1.5)

        # Second instance: should load persisted state
        cfg2 = SafetyConfig()
        ks2 = KillSwitch(cfg2, store=store)
        assert ks2.state.total_trades == 2
        assert ks2.state.total_wins == 1
        assert abs(ks2.state.cumulative_roe - (-0.5)) < 0.01
        assert ks2.state.consecutive_losses == 0  # last was a win

        store.close()

    def test_no_store_doesnt_crash(self):
        """KillSwitch works without a store (no persistence)."""
        ks = KillSwitch(SafetyConfig(), store=None)
        ks.record_trade_outcome(predicted_roe=3.0, actual_roe=-1.0)
        assert ks.state.total_trades == 1


# ─── Health Report Tests ────────────────────────────────────────────────────


class TestHealthReport:

    def test_healthy_report(self):
        """Report with enough snapshots and small gaps is healthy."""
        report = HealthReport(
            report_time=time.time(),
            report_date="2026-02-28",
            snapshots_24h=800,
            snapshots_expected=864,
            snapshot_gap_max_seconds=350,
            labeling_backlog=10,
            predictions_24h=50,
            trades_24h=3,
            win_rate_24h=0.67,
            cumulative_roe_24h=4.5,
            mean_predicted_roe=3.8,
            mean_actual_roe=2.1,
        )
        assert report.is_healthy is True
        assert "HEALTHY" in report.summary

    def test_degraded_low_snapshots(self):
        """Report with too few snapshots is degraded."""
        report = HealthReport(
            report_time=time.time(),
            report_date="2026-02-28",
            snapshots_24h=100,       # way below expected
            snapshots_expected=864,
            snapshot_gap_max_seconds=300,
            labeling_backlog=10,
            predictions_24h=0,
            trades_24h=0,
            win_rate_24h=0.0,
            cumulative_roe_24h=0.0,
            mean_predicted_roe=0.0,
            mean_actual_roe=None,
        )
        assert report.is_healthy is False
        assert "DEGRADED" in report.summary

    def test_degraded_large_gap(self):
        """Report with >15min snapshot gap is degraded."""
        report = HealthReport(
            report_time=time.time(),
            report_date="2026-02-28",
            snapshots_24h=800,
            snapshots_expected=864,
            snapshot_gap_max_seconds=1200,  # 20 min gap
            labeling_backlog=10,
            predictions_24h=0,
            trades_24h=0,
            win_rate_24h=0.0,
            cumulative_roe_24h=0.0,
            mean_predicted_roe=0.0,
            mean_actual_roe=None,
        )
        assert report.is_healthy is False

    def test_degraded_labeling_backlog(self):
        """Report with large labeling backlog is degraded."""
        report = HealthReport(
            report_time=time.time(),
            report_date="2026-02-28",
            snapshots_24h=800,
            snapshots_expected=864,
            snapshot_gap_max_seconds=300,
            labeling_backlog=600,  # over 500 threshold
            predictions_24h=0,
            trades_24h=0,
            win_rate_24h=0.0,
            cumulative_roe_24h=0.0,
            mean_predicted_roe=0.0,
            mean_actual_roe=None,
        )
        assert report.is_healthy is False

    def test_summary_contains_key_metrics(self):
        """Summary includes snapshot count, predictions, win rate, ROE."""
        report = HealthReport(
            report_time=time.time(),
            report_date="2026-02-28",
            snapshots_24h=800,
            snapshots_expected=864,
            snapshot_gap_max_seconds=300,
            labeling_backlog=10,
            predictions_24h=42,
            trades_24h=5,
            win_rate_24h=0.60,
            cumulative_roe_24h=3.2,
            mean_predicted_roe=3.5,
            mean_actual_roe=2.0,
        )
        s = report.summary
        assert "800" in s
        assert "864" in s
        assert "42" in s


# ─── Health Report Generation Tests ─────────────────────────────────────────


class TestGenerateHealthReport:

    def _make_store_with_data(self) -> SatelliteStore:
        """Create an in-memory store with some test snapshots."""
        store = SatelliteStore(":memory:")
        store.connect()

        now = time.time()
        # Insert 10 snapshots across 2 coins
        for i in range(10):
            ts = now - (10 - i) * 300  # 300s apart
            coin = "BTC" if i < 5 else "ETH"
            sid = f"snap-{i}"
            cols = ["snapshot_id", "created_at", "coin"]
            vals = [sid, ts, coin]

            # Add feature columns with dummy values
            for name in FEATURE_NAMES:
                cols.append(name)
                vals.append(0.5 if i % 2 == 0 else 1.0)

            for col in AVAIL_COLUMNS:
                cols.append(col)
                vals.append(1)

            cols.extend(["schema_version", "created_by"])
            vals.extend([1, "test"])

            placeholders = ", ".join(["?"] * len(cols))
            col_str = ", ".join(cols)
            store.conn.execute(
                f"INSERT INTO snapshots ({col_str}) VALUES ({placeholders})",
                vals,
            )
        store.conn.commit()
        return store

    def test_generates_report(self):
        """generate_health_report produces a valid HealthReport."""
        store = self._make_store_with_data()
        report = generate_health_report(store, coins=["BTC", "ETH"])

        assert report.snapshots_24h == 10
        assert report.snapshots_expected == 576  # 288 * 2
        assert report.report_date != ""
        assert isinstance(report.labeling_backlog, int)
        store.close()

    def test_empty_store(self):
        """Report from empty store doesn't crash."""
        store = SatelliteStore(":memory:")
        store.connect()
        report = generate_health_report(store, coins=["BTC"])

        assert report.snapshots_24h == 0
        assert report.snapshots_expected == 288
        assert report.labeling_backlog == 0
        assert report.is_healthy is False  # 0 < 90% of 288
        store.close()

    def test_zero_variance_detection(self):
        """Detects features with zero variance."""
        store = SatelliteStore(":memory:")
        store.connect()

        now = time.time()
        # Insert 5 snapshots where ALL features are exactly 1.0
        for i in range(5):
            cols = ["snapshot_id", "created_at", "coin"]
            vals = [f"snap-{i}", now - i * 300, "BTC"]
            for name in FEATURE_NAMES:
                cols.append(name)
                vals.append(1.0)  # constant value
            for col in AVAIL_COLUMNS:
                cols.append(col)
                vals.append(1)
            cols.extend(["schema_version", "created_by"])
            vals.extend([1, "test"])
            placeholders = ", ".join(["?"] * len(cols))
            col_str = ", ".join(cols)
            store.conn.execute(
                f"INSERT INTO snapshots ({col_str}) VALUES ({placeholders})",
                vals,
            )
        store.conn.commit()

        report = generate_health_report(store, coins=["BTC"])
        # All 12 features should be flagged as zero variance
        assert len(report.features_with_zero_variance) == len(FEATURE_NAMES)
        store.close()

    def test_availability_rates_computed(self):
        """Availability rates are computed from avail columns."""
        store = self._make_store_with_data()
        report = generate_health_report(store, coins=["BTC", "ETH"])
        # All avail flags set to 1, so rates should be 1.0
        for col in AVAIL_COLUMNS:
            assert report.availability_rates.get(col, 0) == 1.0
        store.close()


# ─── Config Tests ────────────────────────────────────────────────────────────


class TestSafetyConfig:

    def test_defaults(self):
        """SafetyConfig has sensible defaults."""
        cfg = SafetyConfig()
        assert cfg.ml_enabled is True
        assert cfg.max_cumulative_loss_pct == -15.0
        assert cfg.max_consecutive_losses == 5
        assert cfg.min_precision_at_3pct == 0.40
        assert cfg.precision_eval_window == 50
        assert cfg.max_data_stale_seconds == 900
        assert cfg.shadow_mode is False
        assert cfg.auto_disable_reason == ""

    def test_config_integration(self):
        """SafetyConfig integrates with SatelliteConfig."""
        from satellite.config import SatelliteConfig
        cfg = SatelliteConfig()
        assert cfg.safety.ml_enabled is True
        assert cfg.health_report_interval == 86400
        assert cfg.health_report_discord is True
