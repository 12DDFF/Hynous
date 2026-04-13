"""Phase-8 new-M1 regression tests for the tightened weight-update loop.

The weight updater's default ``min_trades`` was lowered from 30 to 10 so
the daily feedback scheduler reacts to shorter-horizon signal-quality
shifts (see ``satellite/weight_updater.py`` module docstring). A smaller
window is more sensitive to noise, so these tests simulate closed trades
with a deterministically-seeded signal + noise structure and assert the
EMA-smoothed weight trajectory exhibits bounded per-step change.

Convergence-to-terminal is intentionally NOT asserted: at window=10,
rolling IC legitimately drifts as the trailing window slides;
per-step boundedness (``test_tail_step_delta_bounded``) is the correct
smoothness guarantee.

Three test functions:

1. ``test_smoke_tight_window_loop_runs`` — end-to-end loop exercise
   without crashing, using the lowered default window.
2. ``test_tail_step_delta_bounded`` — across the final 50 trades the
   per-step L2 delta between consecutive weight vectors stays under a
   noise-justified threshold (see docstring below for derivation).
3. ``test_ema_cold_start_equals_raw`` — first-run (no prior weights
   file) must equal raw IC weights bit-for-bit even with α=0.3.
"""

from __future__ import annotations

import json
import math
import random
from pathlib import Path

import pytest

from satellite.store import SatelliteStore
from satellite.weight_updater import update_weights

# Deterministic RNG seed — changing this will change the exact signal
# draws and therefore the expected weight trajectory.
_RNG_SEED = 20260412

# IC-positive signal structure: composite_score is mildly predictive of
# outcome_roe, the three feature-level signals are weakly correlated
# with outcome (so their IC is bounded but non-zero), and we inject
# Gaussian noise on top.
_TRADES_TOTAL = 100
_BATCH_SIZE = 10


def _seed_one_trade(
    store: SatelliteStore,
    trade_idx: int,
    rng: random.Random,
) -> None:
    """Insert a single closed trade row with a controlled signal-to-noise ratio.

    composite_score and the percentile signals carry mild predictive
    power over outcome_roe; added Gaussian noise keeps the IC modest
    (~0.1-0.3 range) so the weight update has to average out the noise.
    """
    composite_score = rng.uniform(30.0, 70.0)
    vol_1h_pctl = rng.randint(20, 80)
    entry_quality_pctl = rng.randint(20, 80)
    funding_4h_pctl = rng.randint(20, 80)
    mae_long_pctl = rng.randint(20, 80)
    mae_short_pctl = rng.randint(20, 80)

    # Signal → outcome link: weighted sum of centred percentiles plus
    # noise. composite_score dominates so its IC should be strongest.
    centred_cs = (composite_score - 50.0) / 20.0
    centred_eq = (entry_quality_pctl - 50.0) / 30.0
    centred_vol = (vol_1h_pctl - 50.0) / 30.0
    centred_fund = (funding_4h_pctl - 50.0) / 30.0
    signal = (
        0.6 * centred_cs
        + 0.25 * centred_eq
        + 0.10 * centred_vol
        + 0.05 * centred_fund
    )
    noise = rng.gauss(0.0, 1.0)
    outcome_roe = signal + noise
    outcome_won = 1 if outcome_roe > 0 else 0

    store.conn.execute(
        "INSERT INTO entry_snapshots ("
        "trade_id, coin, side, entry_time, composite_score, "
        "vol_1h_pctl, entry_quality_pctl, funding_4h_pctl, "
        "mae_long_pctl, mae_short_pctl, "
        "outcome_roe, outcome_pnl_usd, outcome_won, close_time, close_reason"
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            f"trade-{trade_idx:04d}",
            "BTC",
            "long" if trade_idx % 2 == 0 else "short",
            1_700_000_000.0 + trade_idx,
            composite_score,
            vol_1h_pctl,
            entry_quality_pctl,
            funding_4h_pctl,
            mae_long_pctl,
            mae_short_pctl,
            outcome_roe,
            outcome_roe * 10.0,
            outcome_won,
            1_700_000_000.0 + trade_idx + 60.0,
            "trailing_stop",
        ),
    )
    store.conn.commit()


def _run_trajectory(
    tmp_path: Path,
) -> tuple[list[dict[str, float]], list[int]]:
    """Seed 100 trades in 10-trade batches and record the weight vector
    returned after each batch.

    Returns:
        (weights_per_batch, trade_count_per_batch) tuple of parallel lists.
    """
    rng = random.Random(_RNG_SEED)
    store = SatelliteStore(":memory:")
    store.connect()

    output_path = tmp_path / "entry_score_weights.json"

    weights_trajectory: list[dict[str, float]] = []
    trade_counts: list[int] = []

    for batch_start in range(0, _TRADES_TOTAL, _BATCH_SIZE):
        for i in range(_BATCH_SIZE):
            _seed_one_trade(store, batch_start + i, rng)

        result = update_weights(store, output_path)
        assert result is not None, (
            f"update_weights returned None at trade count "
            f"{batch_start + _BATCH_SIZE} — with default min_trades=10 "
            "the loop must produce weights after the first batch."
        )
        weights_trajectory.append(dict(result))
        trade_counts.append(batch_start + _BATCH_SIZE)

    # Sanity: updater should have written JSON after the final batch.
    on_disk = json.loads(output_path.read_text())
    assert on_disk == weights_trajectory[-1]

    return weights_trajectory, trade_counts


def _l2(a: dict[str, float], b: dict[str, float]) -> float:
    keys = set(a) | set(b)
    return math.sqrt(sum((a.get(k, 0.0) - b.get(k, 0.0)) ** 2 for k in keys))


def test_smoke_tight_window_loop_runs(tmp_path: Path) -> None:
    """End-to-end: seed 100 trades in 10-trade batches with the lowered
    default min_trades=10 and confirm the loop runs without crashing and
    yields a normalised weight vector after every batch."""
    weights_trajectory, trade_counts = _run_trajectory(tmp_path)

    assert len(weights_trajectory) == 10
    assert trade_counts == [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

    for weights in weights_trajectory:
        assert weights, "empty weight dict should not occur"
        total = sum(weights.values())
        # Weights are normalised to sum to 1 (either IC-proportional or
        # equal-weight fallback).
        assert math.isclose(total, 1.0, abs_tol=1e-6), (
            f"weights did not sum to 1: {weights} (sum={total})"
        )
        for v in weights.values():
            assert v >= 0.0, f"negative weight produced: {weights}"


def test_tail_step_delta_bounded(tmp_path: Path) -> None:
    """Across the final 50 trades (trailing 5 of 10 batches) the L2
    distance between consecutive weight vectors stays below 0.20.

    Threshold derivation: the weight vector is a probability simplex
    (sum = 1, entries in [0, 1]). The maximum possible L2 distance
    between two simplex points on 4 signals is sqrt(2) ≈ 1.414 (two
    weights swapping between 0 and 1). With a 10-trade window and
    modest IC, once the loop has seen ≥50 trades a single 10-trade
    shift should only reorder signal weights by a fraction of their
    mass, not flip them. 0.20 is well under half the max distance and
    leaves headroom for legitimate signal re-ranking; a violation would
    indicate the window is thrashing."""
    weights_trajectory, _ = _run_trajectory(tmp_path)

    tail = weights_trajectory[-5:]
    deltas: list[float] = []
    for prev, curr in zip(tail, tail[1:]):
        deltas.append(_l2(prev, curr))

    assert deltas, "tail must contain at least two batches"
    max_delta = max(deltas)
    assert max_delta < 0.20, (
        f"tail L2 delta exceeded 0.20 — window likely too noisy: "
        f"deltas={deltas}, trajectory_tail={tail}"
    )


def test_ema_cold_start_equals_raw(tmp_path: Path) -> None:
    """Cold start (no prior weights file) must write the raw IC weights
    unchanged — blending against an empty prior would bias new signals
    toward zero, which is not the intended EMA behaviour for a
    first-run appearance.

    Strategy: seed exactly one 10-trade batch, run ``update_weights``
    once, then re-run the same deterministic batch against a *fresh*
    store with ``smoothing_alpha=1.0`` (pure raw). The two weight
    vectors must match bit-for-bit, confirming that the cold-start
    branch returned raw for every key even with the default α=0.3.
    """
    output_path = tmp_path / "entry_score_weights.json"
    assert not output_path.exists(), "test precondition: path must not exist"

    # First run — cold start with the default α=0.3.
    rng_cold = random.Random(_RNG_SEED)
    store_cold = SatelliteStore(":memory:")
    store_cold.connect()
    for i in range(_BATCH_SIZE):
        _seed_one_trade(store_cold, i, rng_cold)
    cold_weights = update_weights(store_cold, output_path)
    assert cold_weights is not None

    # Reference run — fresh store + fresh path + α=1.0 (pure raw).
    reference_path = tmp_path / "entry_score_weights_reference.json"
    rng_ref = random.Random(_RNG_SEED)
    store_ref = SatelliteStore(":memory:")
    store_ref.connect()
    for i in range(_BATCH_SIZE):
        _seed_one_trade(store_ref, i, rng_ref)
    raw_weights = update_weights(store_ref, reference_path, smoothing_alpha=1.0)
    assert raw_weights is not None

    # Cold-start result equals raw result for every key.
    assert set(cold_weights) == set(raw_weights)
    for k in cold_weights:
        assert math.isclose(cold_weights[k], raw_weights[k], abs_tol=1e-12), (
            f"cold-start weight for {k} diverged from raw: "
            f"cold={cold_weights[k]}, raw={raw_weights[k]}"
        )

    # Persisted JSON must match the returned dict.
    on_disk = json.loads(output_path.read_text())
    assert on_disk == cold_weights


if __name__ == "__main__":  # pragma: no cover
    pytest.main([__file__, "-v"])
