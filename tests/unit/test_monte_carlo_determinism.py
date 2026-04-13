"""Determinism tests for Monte Carlo simulation in scripts/monte_carlo_server.py.

Phase 8 / new-M2: verify that `_simulate` produces reproducible cones when
`MC_DETERMINISTIC` is True, and that disabling the flag restores stochastic
behaviour.

Test strategy
-------------
`TickPredictor.__init__` loads XGBoost artifacts from disk, which is expensive
and irrelevant to `_simulate` (which only reads its three arguments — no
`self.*` state). We therefore use `TickPredictor.__new__(TickPredictor)` to
obtain an uninitialised instance and call `_simulate` on it directly. This
pattern is documented here and is the sanctioned approach for THIS milestone;
a follow-up may promote `_simulate` to a staticmethod.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MC_SERVER_PATH = PROJECT_ROOT / "scripts" / "monte_carlo_server.py"


@pytest.fixture(scope="module")
def mc_module():
    """Load scripts/monte_carlo_server.py as a module without running __main__.

    Importing the file triggers instantiation of a module-level `TickPredictor`
    (line 293), which loads XGBoost artifacts. We don't need that for these
    tests — we construct our own bare instance via __new__ inside each test.
    The module-level instantiation is unavoidable via a normal import, but it
    only runs once here thanks to module scope.
    """
    spec = importlib.util.spec_from_file_location("monte_carlo_server", MC_SERVER_PATH)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["monte_carlo_server"] = mod
    spec.loader.exec_module(mod)
    return mod


def _make_predictor(mc_module):
    """Return a bare TickPredictor without running __init__ (skips model load)."""
    return mc_module.TickPredictor.__new__(mc_module.TickPredictor)


def test_same_inputs_produce_identical_cones(mc_module):
    predictor = _make_predictor(mc_module)
    predictions = {30: 5.0, 60: 10.0, 180: 20.0}
    price = 100000.0
    vol = 0.0001

    out_a = predictor._simulate(price, predictions, vol)
    out_b = predictor._simulate(price, predictions, vol)

    assert out_a["percentile_bands"] == out_b["percentile_bands"]
    assert out_a["sample_paths"] == out_b["sample_paths"]


def test_different_price_produces_different_cones(mc_module):
    predictor = _make_predictor(mc_module)
    predictions = {30: 5.0, 60: 10.0, 180: 20.0}
    vol = 0.0001

    out_a = predictor._simulate(100000.0, predictions, vol)
    out_b = predictor._simulate(100001.0, predictions, vol)

    bands_a = out_a["percentile_bands"][180]
    bands_b = out_b["percentile_bands"][180]
    assert any(abs(bands_a[k] - bands_b[k]) > 1e-9 for k in bands_a)


def test_deterministic_flag_disabled_falls_back(mc_module, monkeypatch):
    monkeypatch.setattr(mc_module, "MC_DETERMINISTIC", False)
    predictor = _make_predictor(mc_module)
    predictions = {30: 5.0, 60: 10.0, 180: 20.0}
    price = 100000.0
    vol = 0.0001

    out_a = predictor._simulate(price, predictions, vol)
    out_b = predictor._simulate(price, predictions, vol)

    assert out_a["percentile_bands"] != out_b["percentile_bands"]
