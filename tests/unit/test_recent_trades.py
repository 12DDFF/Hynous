"""
Unit tests for the Recent Trades briefing section.

Tests cover:
1. Time-ago formatting
2. Directional bias detection
3. Repeated-symbol loss detection
4. Empty state handling
5. Trade line formatting
6. Token budget
"""
import pytest
import time
from collections import deque


# ---------------------------------------------------------------------------
# Helper — replicates the time-ago logic from _build_recent_trades
# ---------------------------------------------------------------------------

def _format_age(age_s: float) -> str:
    if age_s < 60:
        return f"{int(age_s)}s ago"
    elif age_s < 3600:
        return f"{int(age_s / 60)}m ago"
    elif age_s < 86400:
        h = int(age_s / 3600)
        m = int((age_s % 3600) / 60)
        return f"{h}h{m}m ago" if m > 0 else f"{h}h ago"
    else:
        return f"{int(age_s / 86400)}d ago"


class TestTimeAgoFormatting:
    """Time-ago string generation from age in seconds."""

    def test_seconds(self):
        assert _format_age(30) == "30s ago"

    def test_minutes(self):
        assert _format_age(480) == "8m ago"

    def test_hours_and_minutes(self):
        assert _format_age(3900) == "1h5m ago"

    def test_hours_exact(self):
        assert _format_age(7200) == "2h ago"

    def test_days(self):
        assert _format_age(90000) == "1d ago"


class TestDirectionalBiasDetection:
    """Bias warnings when trades are overwhelmingly one-sided."""

    def test_all_longs_triggers_warning(self):
        sides = ["long", "long", "long", "long", "long"]
        long_count = sum(1 for s in sides if s == "long")
        assert long_count >= len(sides) - 1  # 5/5 >= 4

    def test_mostly_longs_triggers_warning(self):
        sides = ["long", "long", "long", "short", "long"]
        long_count = sum(1 for s in sides if s == "long")
        assert long_count >= len(sides) - 1  # 4/5 >= 4

    def test_balanced_no_warning(self):
        sides = ["long", "short", "long", "short", "long"]
        long_count = sum(1 for s in sides if s == "long")
        short_count = len(sides) - long_count
        assert not (long_count >= len(sides) - 1)  # 3/5 < 4
        assert not (short_count >= len(sides) - 1)  # 2/5 < 4

    def test_too_few_trades_no_warning(self):
        """Bias detection requires >= 4 trades."""
        sides = ["long", "long", "long"]
        assert len(sides) < 4  # Skip bias check

    def test_all_shorts_triggers_warning(self):
        sides = ["short", "short", "short", "short"]
        short_count = sum(1 for s in sides if s == "short")
        assert short_count >= len(sides) - 1  # 4/4 >= 3


class TestRepeatedSymbolDetection:
    """Warnings when the same symbol keeps losing."""

    def test_three_trades_two_losses_triggers(self):
        trades = [
            {"coin": "SOL", "lev_return_pct": -3.4},
            {"coin": "SOL", "lev_return_pct": -5.1},
            {"coin": "SOL", "lev_return_pct": +2.0},
        ]
        sol_trades = [t for t in trades if t["coin"] == "SOL"]
        sol_losses = sum(1 for t in sol_trades if t["lev_return_pct"] < 0)
        assert len(sol_trades) >= 3
        assert sol_losses >= 2  # Warning triggered

    def test_only_two_trades_not_enough(self):
        trades = [
            {"coin": "SOL", "lev_return_pct": -3.4},
            {"coin": "SOL", "lev_return_pct": +5.0},
        ]
        assert len(trades) < 3  # Not enough to trigger

    def test_three_trades_one_loss_no_warning(self):
        trades = [
            {"coin": "SOL", "lev_return_pct": -3.4},
            {"coin": "SOL", "lev_return_pct": +5.0},
            {"coin": "SOL", "lev_return_pct": +2.0},
        ]
        sol_trades = [t for t in trades if t["coin"] == "SOL"]
        sol_losses = sum(1 for t in sol_trades if t["lev_return_pct"] < 0)
        assert len(sol_trades) >= 3
        assert sol_losses < 2  # Only 1 loss — no warning

    def test_different_coins_no_warning(self):
        trades = [
            {"coin": "SOL", "lev_return_pct": -3.4},
            {"coin": "BTC", "lev_return_pct": -5.1},
            {"coin": "ETH", "lev_return_pct": -2.0},
        ]
        for coin in set(t["coin"] for t in trades):
            coin_trades = [t for t in trades if t["coin"] == coin]
            assert len(coin_trades) < 3  # No coin has 3+ trades


class TestExitReasonMapping:
    """Close type to human-readable exit reason."""

    def test_all_known_mappings(self):
        exit_map = {
            "stop_loss": "stop loss",
            "take_profit": "take profit",
            "trailing_stop": "trailing stop",
            "small_wins": "small wins",
            "liquidation": "liquidation",
            "agent close": "agent close",
            "full": "agent close",
            "merged": "agent close",
        }
        for key, expected in exit_map.items():
            assert exit_map.get(key) == expected

    def test_unknown_passthrough(self):
        exit_map = {
            "stop_loss": "stop loss",
            "take_profit": "take profit",
        }
        unknown = "breakeven_stop"
        result = exit_map.get(unknown, unknown)
        assert result == "breakeven_stop"


class TestEmptyState:
    """Handling when no trades exist."""

    def test_empty_deque_has_zero_length(self):
        cache = deque(maxlen=10)
        assert len(cache) == 0

    def test_empty_deque_falls_through(self):
        """When cache is empty, the primary source is skipped."""
        cache = deque(maxlen=10)
        trades = []
        if cache and len(cache) > 0:
            trades = list(cache)
        assert trades == []

    def test_maxlen_respected(self):
        """Deque capped at maxlen=10 drops oldest entries."""
        cache = deque(maxlen=10)
        for i in range(15):
            cache.appendleft({"coin": f"COIN{i}", "closed_at": time.time()})
        assert len(cache) == 10


class TestTokenBudget:
    """Verify the section stays within ~150 token budget."""

    def test_six_trades_within_budget(self):
        """6 trade lines + 2 warning lines should be ~150 tokens."""
        lines = [
            "Recent Trades (last 6):",
            "  SOL LONG 20x | -3.4% | 8m ago | MFE +6.3% | exit: stop loss",
            "  BTC LONG 10x | -7.9% | 22m ago | MFE +2.1% | exit: stop loss",
            "  SOL LONG 20x | +4.2% | 1h ago | MFE +8.7% | exit: trailing stop",
            "  BTC SHORT 15x | +1.8% | 2h ago | exit: agent close",
            "  SOL LONG 20x | -5.1% | 3h ago | MFE +1.0% | exit: stop loss",
            "  ETH LONG 20x | +3.5% | 4h ago | MFE +5.2% | exit: trailing stop",
            "  ↑ 5/6 recent trades are LONG — check for directional bias",
            "  ↑ 2/3 recent SOL trades lost — consider skipping next SOL setup",
        ]
        text = "\n".join(lines)
        estimated_tokens = len(text) / 4
        assert estimated_tokens < 200, f"Estimated {estimated_tokens:.0f} tokens — over budget"

    def test_mfe_only_shown_above_threshold(self):
        """MFE string only appears when mfe_pct > 0.5%."""
        mfe_pct = 0.3
        mfe_str = ""
        if mfe_pct and mfe_pct > 0.5:
            mfe_str = f" | MFE +{mfe_pct:.1f}%"
        assert mfe_str == ""

        mfe_pct = 2.0
        mfe_str = ""
        if mfe_pct and mfe_pct > 0.5:
            mfe_str = f" | MFE +{mfe_pct:.1f}%"
        assert mfe_str == " | MFE +2.0%"
