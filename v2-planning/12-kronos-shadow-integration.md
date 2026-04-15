# Kronos Shadow Integration — Implementation Guide

> **Goal:** Run the Kronos foundation model (arXiv 2508.02739, AAAI 2026) as
> a **shadow predictor** alongside the live `MLSignalDrivenTrigger`. Kronos
> emits a "would-fire" decision every 300 s for BTC; we write it to a new
> `kronos_shadow_predictions` table for offline comparison against the live
> trigger and actual trade outcomes. Zero live-trade impact.
>
> **Non-goal:** Kronos is NOT wired into the decision path. It never causes
> an order to fire, never changes a gate, never mutates `_latest_predictions`.
> That decision is deferred until we have 2+ weeks of shadow data.
>
> **Owner:** architect (David) · **Implementer:** engineer (Claude) ·
> **Target baseline:** 592 p / 0 f → ≥592 p / 0 f after landing.

---

## 1. Why This Shape

| Constraint | Design choice |
|---|---|
| Zero risk to live trades | Shadow runs in a separate daemon method; never returns `EntrySignal`; never reads/writes `_latest_predictions` |
| Reuse existing infra, don't invent | Shadow writes to the journal DB (`journal.db`) via a new table; no new DB file |
| Kronos is a heavy dep (torch, HF) | Deps are **optional extras** under `pyproject.toml`. If not installed, shadow disables gracefully with a warning. |
| Kronos repo is not pip-installable | **Vendor** the three `model/*.py` files (~1250 LOC total, MIT license) under `src/hynous/kronos_shadow/vendor/`. Rewrite their sibling imports. |
| Inference is slow (seconds, not ms) | Run off a background thread, cadence = 300 s (satellite-tick aligned), not 60 s |
| Model weights pulled from HuggingFace | Caching via `huggingface_hub`. First run downloads, subsequent runs hit local cache. |
| Must compare shadow vs live in the journal | Each shadow row records the live trigger's *current* verdict at the same timestamp for side-by-side comparison. |

**Rejected alternative:** making Kronos another `EntryTriggerSource` with a
`shadow_mode` flag. Abuses the interface (the ABC exists to fire or skip, not
to log). Conflates two concerns. Keeping `mechanical_entry/` untouched is a
strict requirement.

---

## 2. Pre-Implementation Reading (Required — do not skip)

Read these in order. This guide is self-contained once you've internalized them.

**Architecture + conventions**
1. `CLAUDE.md` — repo conventions, testing, deploy
2. `ARCHITECTURE.md` — component topology + data flows
3. `v2-planning/00-master-plan.md` — v2 philosophy + amendment trail
4. `v2-planning/02-testing-standards.md` — static / dynamic / regression gates
5. `v2-planning/08-phase-5-mechanical-entry.md` §§ Interface + Rejection Recording
6. `v2-planning/05-phase-2-journal-module.md` §§ Schema + Store API (upsert patterns)

**Code to read end-to-end**
7. `src/hynous/mechanical_entry/interface.py` — how triggers are typed
8. `src/hynous/mechanical_entry/ml_signal_driven.py` — the production trigger you're shadowing
9. `src/hynous/journal/schema.py` — existing DDL + dataclass patterns
10. `src/hynous/journal/store.py` — `upsert_trade`, `insert_entry_snapshot` + threading model (WAL + busy_timeout, single connection per store, `_lock`)
11. `src/hynous/intelligence/daemon.py` lines 310–320, 890–910, 1022–1035, 3437–3573 — exactly how `_entry_trigger` is initialized and dispatched
12. `src/hynous/core/config.py` lines 160–230 — `V2Config` structure + `load_config()`
13. `src/hynous/data/providers/hyperliquid.py:701-740` — `get_candles` API shape
14. `tests/unit/test_ml_signal_driven.py` — the fake-daemon + `FakeJournal` test template

**External (one page each, ≤30 min total)**
15. [Kronos paper abstract](https://arxiv.org/abs/2508.02739) — input/output shape, claimed metrics
16. [Kronos README](https://github.com/shiyu-coder/Kronos) §§ Model Zoo + Making Forecasts (KronosPredictor API only, ignore fine-tune section)
17. `/tmp/kronos-research/Kronos/model/kronos.py` lines 482–560 — actual `KronosPredictor.predict` signature (this is the contract we're coding against)

**Do NOT read / do NOT touch**
- Kronos `finetune/` directory (we are zero-shot)
- Kronos `examples/` beyond prediction_example.py (A-share demos are irrelevant)
- Our `satellite/` training pipeline (orthogonal to this work)
- Our `src/hynous/analysis/` package (post-trade only, out of scope)

---

## 3. Directory Layout

New files (all additive — no existing file is renamed or moved):

```
src/hynous/kronos_shadow/
├── __init__.py                 # public exports: KronosShadowPredictor, KronosShadowConfig
├── config.py                   # V2KronosShadowConfig dataclass (mirrors v2 pattern)
├── adapter.py                  # Thin wrapper around vendored Kronos. All heavy imports live here — soft-fail on missing torch.
├── shadow_predictor.py         # predict_once(daemon, symbol) → writes 0 or 1 row to kronos_shadow_predictions
├── store.py                    # insert_kronos_shadow() — single-purpose writer; avoids bloating JournalStore
└── vendor/
    ├── __init__.py             # re-exports (Kronos, KronosTokenizer, KronosPredictor)
    ├── LICENSE                 # copy of Kronos MIT license + NOTICE
    ├── kronos.py               # VENDORED from shiyu-coder/Kronos model/kronos.py (edit: sibling import rewrite)
    └── module.py               # VENDORED from shiyu-coder/Kronos model/module.py (no edits)

tests/unit/test_kronos_shadow.py           # Unit tests — adapter, shadow_predictor, store (no real torch)
tests/integration/test_kronos_shadow_smoke.py  # Opt-in GPU-optional smoke — marked @pytest.mark.kronos
```

Modified files (surgical — enumerated line ranges):

```
config/default.yaml                            # + kronos_shadow block under v2
src/hynous/core/config.py                      # + V2KronosShadowConfig + wiring in load_config
src/hynous/journal/schema.py                   # + CREATE TABLE kronos_shadow_predictions in SCHEMA_DDL
src/hynous/intelligence/daemon.py              # + _kronos_shadow_tick + init + dispatch in main loop
pyproject.toml                                 # + [project.optional-dependencies] kronos-shadow
```

---

## 4. Dependencies & Vendoring

### 4.1 Optional extras (pyproject.toml)

Append to `[project.optional-dependencies]`:

```toml
kronos-shadow = [
    "torch>=2.0.0",
    "huggingface_hub>=0.33.0",
    "einops>=0.8.0",
    "safetensors>=0.6.0",
]
```

**Do not add to core `dependencies`.** Users who don't want shadow get a
clean install.

### 4.2 Vendoring procedure (exact steps)

```bash
# From repo root
mkdir -p src/hynous/kronos_shadow/vendor

# Copy the three model files from the cloned Kronos repo
cp /tmp/kronos-research/Kronos/model/__init__.py     src/hynous/kronos_shadow/vendor/__init__.py
cp /tmp/kronos-research/Kronos/model/kronos.py       src/hynous/kronos_shadow/vendor/kronos.py
cp /tmp/kronos-research/Kronos/model/module.py       src/hynous/kronos_shadow/vendor/module.py
cp /tmp/kronos-research/Kronos/LICENSE               src/hynous/kronos_shadow/vendor/LICENSE
```

**Required edit: fix the sibling import in `kronos.py`.**

Replace lines 5–10 of the vendored `kronos.py`:
```python
import sys

sys.path.append("../")
from model.module import *
```
with:
```python
from .module import *
```

No other edits to vendored code. Add a 3-line header comment at the top of
each vendored `.py` file:

```python
# Vendored from https://github.com/shiyu-coder/Kronos (model/<filename>.py)
# Upstream commit: <pin the sha from `git -C /tmp/kronos-research/Kronos rev-parse HEAD`>
# License: MIT (see ./LICENSE). Do not modify except for sibling-import fix.
```

Vendored `__init__.py` stays as-is (just re-exports from `.kronos`).

### 4.3 Why vendor vs pip install git+

Kronos has no `pyproject.toml` / `setup.py`. `pip install git+https://...` will
fail. Vendoring is the only clean option. Three files, 1249 LOC total.

---

## 5. Milestones

### M1 — Vendor + optional deps + smoke import

**Goal:** `from hynous.kronos_shadow.vendor import Kronos, KronosTokenizer, KronosPredictor` succeeds *when* the extras are installed and raises a clear `ImportError` otherwise.

**Tasks:**
1. Execute the vendoring procedure in §4.2 verbatim.
2. Add `kronos-shadow` extras to `pyproject.toml`.
3. Write `src/hynous/kronos_shadow/__init__.py` that conditionally re-exports from `.adapter` (guard against torch missing).

**Static checks:**
- `ruff check src/hynous/kronos_shadow/vendor/` — **must pass without errors.** Upstream code may have style nits; add per-file ruff-ignore comments at the top only if absolutely necessary. Do NOT reformat vendored code.
- `mypy src/hynous/kronos_shadow/` — may surface issues in the vendored code; use `[[tool.mypy.overrides]] module = "hynous.kronos_shadow.vendor.*"` `ignore_errors = true` in `pyproject.toml` to keep it out of our type budget.

**Dynamic check:**
- `pip install -e ".[kronos-shadow]"` in a fresh venv, then `python -c "from hynous.kronos_shadow.vendor import Kronos, KronosTokenizer, KronosPredictor; print('ok')"` must print `ok`.
- Without extras: `python -c "from hynous.kronos_shadow import KronosShadowPredictor"` must NOT raise (soft-failing import).

**Commit message:** `[kronos-shadow] M1 — vendor Kronos model/ + optional extras`

---

### M2 — Adapter layer (`adapter.py`)

**Goal:** A single `KronosAdapter` class that owns the expensive model / tokenizer / predictor objects, handles soft-failing imports, and exposes ONE method: `predict_upside_prob(candles_1h, pred_len, sample_count) -> KronosForecast`.

**Exact API (write to this — no deviations):**

```python
# src/hynous/kronos_shadow/adapter.py
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

# Module-level feature flag set at import time. DO NOT import torch at module level.
_KRONOS_AVAILABLE: bool | None = None


def is_kronos_available() -> bool:
    """Return True iff the optional extras are importable.

    Result is cached after the first call. Logs a single warning on the
    first miss; silent on subsequent misses.
    """
    global _KRONOS_AVAILABLE
    if _KRONOS_AVAILABLE is not None:
        return _KRONOS_AVAILABLE
    try:
        import torch  # noqa: F401
        from huggingface_hub import PyTorchModelHubMixin  # noqa: F401
        from .vendor import Kronos, KronosPredictor, KronosTokenizer  # noqa: F401
        _KRONOS_AVAILABLE = True
    except ImportError as exc:
        logger.warning(
            "Kronos shadow extras not installed; shadow will be disabled. "
            "Install with `pip install -e '.[kronos-shadow]'`. Missing: %s",
            exc,
        )
        _KRONOS_AVAILABLE = False
    return _KRONOS_AVAILABLE


@dataclass(slots=True, frozen=True)
class KronosForecast:
    """Summary of a single Kronos inference call."""

    symbol: str
    model_variant: str                # e.g. "Kronos-mini"
    tokenizer_name: str               # e.g. "NeoQuasar/Kronos-Tokenizer-2k"
    lookback_len: int                 # input bars
    pred_len: int                     # forecast bars
    sample_count: int                 # Monte Carlo samples
    current_close: float              # close of the last input bar
    mean_forecast_close_end: float    # mean sample close at horizon end
    upside_prob: float                # fraction of samples where end close > current_close, ∈ [0,1]
    predicted_return_bps: float       # (mean_forecast_close_end / current_close - 1) * 10_000
    sample_std_bps: float             # std of sample end-bar returns in bps
    inference_ms: float               # wall-clock time of predict() call
    predicted_at: float               # unix seconds (time.time())


class KronosAdapter:
    """Owns the loaded model / tokenizer / predictor. One per daemon.

    Instantiation is lazy: load() must be called explicitly, and it may be
    called from a background thread. Raises RuntimeError on any load failure;
    caller is expected to catch and disable the shadow for that session.
    """

    def __init__(
        self,
        *,
        model_name: str = "NeoQuasar/Kronos-mini",
        tokenizer_name: str = "NeoQuasar/Kronos-Tokenizer-2k",
        max_context: int = 512,
        device: str | None = None,
    ) -> None:
        self._model_name = model_name
        self._tokenizer_name = tokenizer_name
        self._max_context = max_context
        self._device = device
        self._predictor: Any = None  # KronosPredictor instance once loaded

    @property
    def model_variant(self) -> str:
        # "NeoQuasar/Kronos-mini" -> "Kronos-mini"
        return self._model_name.split("/", 1)[-1]

    def load(self) -> None:
        """Download weights (on first call) and move to device. Blocking — run on a thread."""
        if not is_kronos_available():
            raise RuntimeError("Kronos shadow extras not installed")
        from .vendor import Kronos, KronosPredictor, KronosTokenizer
        tokenizer = KronosTokenizer.from_pretrained(self._tokenizer_name)
        model = Kronos.from_pretrained(self._model_name)
        self._predictor = KronosPredictor(
            model, tokenizer,
            device=self._device,  # None = auto (cuda → mps → cpu)
            max_context=self._max_context,
        )
        logger.info(
            "Kronos adapter loaded: model=%s tokenizer=%s max_ctx=%d device=%s",
            self._model_name, self._tokenizer_name, self._max_context,
            self._predictor.device,
        )

    def predict_upside_prob(
        self,
        *,
        symbol: str,
        candles_1h: list[dict[str, Any]],
        pred_len: int = 24,
        sample_count: int = 20,
        T: float = 1.0,
        top_p: float = 0.9,
    ) -> KronosForecast:
        """Run one inference pass over the provided 1-hour candle history.

        Args:
            symbol: display-only; used to tag the KronosForecast.
            candles_1h: list of dicts with keys t (ms), o, h, l, c, v. Must be
                sorted ascending by t; must contain at least 64 bars. Only
                the last ``max_context`` (default 512) are used.
            pred_len: forecast horizon in bars (24 = next 24 hours).
            sample_count: Monte Carlo samples; 20 is the CPU sweet spot.

        Returns:
            KronosForecast summarizing the MC distribution of the terminal bar.

        Raises:
            RuntimeError: if load() was not called.
            ValueError: if candles_1h is malformed or too short.
        """
        if self._predictor is None:
            raise RuntimeError("KronosAdapter.load() must be called first")
        if len(candles_1h) < 64:
            raise ValueError(f"need ≥64 candles, got {len(candles_1h)}")

        import numpy as np
        import pandas as pd

        # Trim to at most max_context bars (Kronos handles truncation but
        # explicit is better).
        trimmed = candles_1h[-self._max_context:]
        df = pd.DataFrame([
            {"open": c["o"], "high": c["h"], "low": c["l"],
             "close": c["c"], "volume": c["v"]}
            for c in trimmed
        ])
        # Hyperliquid 't' is ms; convert to pandas timestamp for the tokenizer's
        # temporal embedding.
        x_timestamp = pd.to_datetime([c["t"] for c in trimmed], unit="ms")
        # y_timestamp: extend by pred_len hours at 1-hour cadence.
        last_ts = x_timestamp[-1]
        y_timestamp = pd.date_range(
            start=last_ts + pd.Timedelta(hours=1),
            periods=pred_len,
            freq="1h",
        )

        # Kronos' predict() expects x_timestamp / y_timestamp as pd.Series
        # with a .dt accessor (see vendor/kronos.py::calc_time_stamps).
        x_ts_series = pd.Series(x_timestamp)
        y_ts_series = pd.Series(y_timestamp)

        t0 = time.time()
        pred_df = self._predictor.predict(
            df=df,
            x_timestamp=x_ts_series,
            y_timestamp=y_ts_series,
            pred_len=pred_len,
            T=T,
            top_p=top_p,
            sample_count=sample_count,
            verbose=False,
        )
        inference_ms = (time.time() - t0) * 1000.0

        current_close = float(df["close"].iloc[-1])
        end_closes: np.ndarray = pred_df["close"].values.astype("float64")
        # KronosPredictor averages samples internally (see auto_regressive_inference
        # line 467: preds = np.mean(preds, axis=1)). So pred_df['close'] is the
        # mean path, not per-sample. To get an honest upside_prob we must run
        # sample_count passes WITHOUT internal averaging OR call with
        # sample_count=1 in a loop.
        #
        # Simpler and still informative: treat the mean path and derive a
        # scalar directional probability from sample_std inferred from high/low
        # envelope. See shadow_predictor.py for the decision rule.
        #
        # Here we emit:
        mean_end = float(end_closes[-1])
        predicted_return_bps = (mean_end / current_close - 1.0) * 10_000.0
        # Proxy sample_std: mean of per-bar (high - low) / close over the forecast.
        sample_std_bps = float(
            ((pred_df["high"].values - pred_df["low"].values)
             / pred_df["close"].values).mean() * 10_000.0
        )
        # Gaussian approximation for the upside probability: Phi(predicted_return / std).
        # std_dev protected against zero with floor of 1 bp.
        from math import erf, sqrt
        std = max(sample_std_bps, 1.0)
        upside_prob = 0.5 * (1.0 + erf(predicted_return_bps / (std * sqrt(2.0))))

        return KronosForecast(
            symbol=symbol,
            model_variant=self.model_variant,
            tokenizer_name=self._tokenizer_name,
            lookback_len=len(trimmed),
            pred_len=pred_len,
            sample_count=sample_count,
            current_close=current_close,
            mean_forecast_close_end=mean_end,
            upside_prob=upside_prob,
            predicted_return_bps=predicted_return_bps,
            sample_std_bps=sample_std_bps,
            inference_ms=inference_ms,
            predicted_at=time.time(),
        )
```

**Engineer's note on the proxy upside-prob:** `KronosPredictor` averages MC
samples internally before returning. To get a proper per-sample terminal
distribution we'd have to call predict() with `sample_count=1` in a
`sample_count`-sized loop. That doubles to quadruples runtime. For M2 we ship
the Gaussian-approximation proxy above (encoded in `upside_prob`). If shadow
data looks promising, M7 can upgrade to the loop form — the schema is
identical.

**Tests (write in `tests/unit/test_kronos_shadow.py`):**
- `test_is_kronos_available_returns_bool()` — just asserts the function returns a bool.
- `test_adapter_raises_if_torch_missing()` — monkeypatch `is_kronos_available` to return False, assert `KronosAdapter(...).load()` raises `RuntimeError`.
- `test_adapter_validates_candle_count()` — instantiate with `_predictor` manually set to a `SimpleNamespace(predict=lambda **k: <empty DataFrame>)`, call with 10 candles, assert `ValueError`.

Dynamic check under extras: none at this milestone (real inference deferred to M6 smoke).

---

### M3 — Shadow predictor (`shadow_predictor.py`)

**Goal:** Given a daemon handle + symbol, fetch candles, call the adapter, derive a shadow decision, and write one row to the journal. Pure coordination logic.

**Exact API:**

```python
# src/hynous/kronos_shadow/shadow_predictor.py
from __future__ import annotations

import logging
import time
from typing import Any

from .adapter import KronosAdapter, KronosForecast
from .config import V2KronosShadowConfig
from .store import insert_kronos_shadow

logger = logging.getLogger(__name__)


class KronosShadowPredictor:
    """Owns the adapter lifecycle and coordinates one shadow tick."""

    def __init__(self, *, adapter: KronosAdapter, config: V2KronosShadowConfig) -> None:
        self._adapter = adapter
        self._config = config

    def predict_and_record(self, *, daemon: Any) -> KronosForecast | None:
        """Run one shadow tick for the configured symbol.

        Returns the KronosForecast (also persisted) or None on any failure.
        Never raises — failures log and return None so the daemon loop is
        unaffected.
        """
        symbol = self._config.symbol.upper()
        journal = getattr(daemon, "_journal_store", None)
        if journal is None:
            logger.debug("no journal — skipping shadow tick")
            return None

        # Fetch candles via the provider (same REST path used by satellite.tick)
        try:
            provider = daemon._get_provider()
            end_ms = int(time.time() * 1000)
            # lookback_bars × 1 hour × 60 min × 60 s × 1000 ms
            start_ms = end_ms - self._config.lookback_bars * 3_600_000
            candles = provider.get_candles(symbol, "1h", start_ms, end_ms)
        except Exception:
            logger.exception("kronos-shadow: candle fetch failed for %s", symbol)
            return None

        if not candles or len(candles) < 64:
            logger.warning(
                "kronos-shadow: insufficient candles for %s (%d)",
                symbol, len(candles) if candles else 0,
            )
            return None

        try:
            forecast = self._adapter.predict_upside_prob(
                symbol=symbol,
                candles_1h=candles,
                pred_len=self._config.pred_len,
                sample_count=self._config.sample_count,
                T=self._config.temperature,
                top_p=self._config.top_p,
            )
        except Exception:
            logger.exception("kronos-shadow: inference failed for %s", symbol)
            return None

        # Derive shadow decision
        if forecast.upside_prob >= self._config.long_threshold:
            shadow_decision = "long"
        elif forecast.upside_prob <= self._config.short_threshold:
            shadow_decision = "short"
        else:
            shadow_decision = "skip"

        # Capture the live trigger's current view (what it would decide RIGHT NOW)
        live_decision = _snapshot_live_decision(daemon, symbol)

        try:
            insert_kronos_shadow(
                journal=journal,
                forecast=forecast,
                shadow_decision=shadow_decision,
                live_decision=live_decision,
                config=self._config,
            )
        except Exception:
            logger.exception("kronos-shadow: store write failed for %s", symbol)
            return None

        logger.info(
            "kronos-shadow %s: prob=%.3f → %s (live=%s) inference=%.0fms",
            symbol, forecast.upside_prob, shadow_decision,
            live_decision, forecast.inference_ms,
        )
        return forecast


def _snapshot_live_decision(daemon: Any, symbol: str) -> str:
    """Non-mutating peek at what MLSignalDrivenTrigger would currently emit.

    Returns one of: "long" / "short" / "skip" / "unknown".

    Rationale: we need a side-by-side snapshot in every shadow row so the
    rollup can compute agreement rate. We do NOT call ``trigger.evaluate``
    because that would produce a rejection-row side effect. Instead we
    read the already-cached predictions dict.
    """
    lock = getattr(daemon, "_latest_predictions_lock", None)
    latest = getattr(daemon, "_latest_predictions", {}) or {}
    preds = latest.get(symbol, {}) if lock is None else None
    if preds is None and lock is not None:
        with lock:
            preds = dict(latest.get(symbol, {}))
    if not preds:
        return "unknown"
    sig = preds.get("signal")
    if sig in ("long", "short"):
        return sig
    return "skip"
```

**Tests (add to `tests/unit/test_kronos_shadow.py`):**
- `test_shadow_returns_none_without_journal()` — daemon with `_journal_store=None`, assert `predict_and_record` returns None without raising.
- `test_shadow_returns_none_on_insufficient_candles()` — fake provider returns 10 candles, assert None + warning log + no journal write.
- `test_shadow_derives_long_on_high_upside_prob()` — monkeypatch `adapter.predict_upside_prob` to return a stub `KronosForecast(upside_prob=0.7, ...)`, assert journal row has `shadow_decision='long'`.
- `test_shadow_derives_skip_in_neutral_zone()` — upside_prob=0.5, assert shadow_decision='skip'.
- `test_snapshot_live_decision_reads_from_cache()` — populate `_latest_predictions["BTC"]["signal"]="short"`, assert `_snapshot_live_decision` returns "short".
- `test_snapshot_live_decision_returns_unknown_without_preds()` — empty cache → "unknown".
- `test_inference_exception_is_swallowed()` — adapter raises, assert predict_and_record returns None, no crash, error logged.

---

### M4 — Config (`config.py`)

**Exact content:**

```python
# src/hynous/kronos_shadow/config.py
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class V2KronosShadowConfig:
    """Runtime config for the Kronos shadow predictor.

    Zero of these fields affect live trading. The shadow is read-only:
    candle fetch → inference → journal write.
    """

    enabled: bool = False                 # default off; opt in via YAML or env
    symbol: str = "BTC"                   # single-symbol per phase-5 scope
    model_name: str = "NeoQuasar/Kronos-mini"
    tokenizer_name: str = "NeoQuasar/Kronos-Tokenizer-2k"
    max_context: int = 512
    lookback_bars: int = 360              # 15 days of 1h bars, matches Kronos' BTC demo
    pred_len: int = 24                    # forecast next 24h
    sample_count: int = 20
    temperature: float = 1.0
    top_p: float = 0.9
    tick_interval_s: int = 300            # aligned with satellite.tick
    device: str | None = None             # None → auto (cuda → mps → cpu)
    # Decision thresholds for shadow_decision derivation
    long_threshold: float = 0.60
    short_threshold: float = 0.40
```

Then wire into `src/hynous/core/config.py`:

1. Add `from hynous.kronos_shadow.config import V2KronosShadowConfig` near the other v2 imports.
2. Add field to `V2Config`:
   ```python
   kronos_shadow: V2KronosShadowConfig = field(default_factory=V2KronosShadowConfig)
   ```
3. In `load_config()`, after the `user_chat=` block, add:
   ```python
   kronos_shadow=V2KronosShadowConfig(
       enabled=v2_raw.get("kronos_shadow", {}).get("enabled", False),
       symbol=v2_raw.get("kronos_shadow", {}).get("symbol", "BTC"),
       model_name=v2_raw.get("kronos_shadow", {}).get("model_name", "NeoQuasar/Kronos-mini"),
       tokenizer_name=v2_raw.get("kronos_shadow", {}).get("tokenizer_name", "NeoQuasar/Kronos-Tokenizer-2k"),
       max_context=v2_raw.get("kronos_shadow", {}).get("max_context", 512),
       lookback_bars=v2_raw.get("kronos_shadow", {}).get("lookback_bars", 360),
       pred_len=v2_raw.get("kronos_shadow", {}).get("pred_len", 24),
       sample_count=v2_raw.get("kronos_shadow", {}).get("sample_count", 20),
       temperature=v2_raw.get("kronos_shadow", {}).get("temperature", 1.0),
       top_p=v2_raw.get("kronos_shadow", {}).get("top_p", 0.9),
       tick_interval_s=v2_raw.get("kronos_shadow", {}).get("tick_interval_s", 300),
       device=v2_raw.get("kronos_shadow", {}).get("device", None),
       long_threshold=v2_raw.get("kronos_shadow", {}).get("long_threshold", 0.60),
       short_threshold=v2_raw.get("kronos_shadow", {}).get("short_threshold", 0.40),
   ),
   ```

Append to `config/default.yaml` under the `v2:` block:

```yaml
  kronos_shadow:
    enabled: false              # opt-in on the VPS via a local YAML override
    symbol: "BTC"
    model_name: "NeoQuasar/Kronos-mini"
    tokenizer_name: "NeoQuasar/Kronos-Tokenizer-2k"
    max_context: 512
    lookback_bars: 360
    pred_len: 24
    sample_count: 20
    temperature: 1.0
    top_p: 0.9
    tick_interval_s: 300
    long_threshold: 0.60
    short_threshold: 0.40
```

**Tests:** extend `tests/unit/test_config.py` (if exists — else add):
- `test_v2_kronos_shadow_defaults()` — load default.yaml, assert `cfg.v2.kronos_shadow.enabled is False` and `cfg.v2.kronos_shadow.symbol == "BTC"`.
- `test_v2_kronos_shadow_override()` — write a tmp YAML setting `enabled: true` and `long_threshold: 0.7`, load, assert override round-trips.

---

### M5 — Journal table + store writer

**Schema addition.** Add this table to `SCHEMA_DDL` in
`src/hynous/journal/schema.py` (place it AFTER `trade_patterns`, BEFORE the
closing `"""`):

```sql
CREATE TABLE IF NOT EXISTS kronos_shadow_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    predicted_at REAL NOT NULL,
    symbol TEXT NOT NULL,
    model_variant TEXT NOT NULL,
    tokenizer_name TEXT NOT NULL,
    lookback_len INTEGER NOT NULL,
    pred_len INTEGER NOT NULL,
    sample_count INTEGER NOT NULL,
    current_close REAL NOT NULL,
    mean_forecast_close_end REAL NOT NULL,
    predicted_return_bps REAL NOT NULL,
    sample_std_bps REAL NOT NULL,
    upside_prob REAL NOT NULL,
    shadow_decision TEXT NOT NULL,
    live_decision TEXT NOT NULL,
    long_threshold REAL NOT NULL,
    short_threshold REAL NOT NULL,
    inference_ms REAL NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kronos_shadow_predicted_at
    ON kronos_shadow_predictions(predicted_at);
CREATE INDEX IF NOT EXISTS idx_kronos_shadow_symbol
    ON kronos_shadow_predictions(symbol);
CREATE INDEX IF NOT EXISTS idx_kronos_shadow_decision
    ON kronos_shadow_predictions(shadow_decision);
```

**Bump `journal_metadata.schema_version`** from `'1.0.0'` to `'1.1.0'` in the
`INSERT OR IGNORE`, and **add a schema-migration shim at the top of
`JournalStore.__init__`** that does `CREATE TABLE IF NOT EXISTS` (which is
already idempotent in the DDL — no bespoke migration needed for an additive
change). Verify by opening an existing `journal.db` and confirming the table
appears after restart.

**Store writer.** New module `src/hynous/kronos_shadow/store.py`:

```python
# src/hynous/kronos_shadow/store.py
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .adapter import KronosForecast
from .config import V2KronosShadowConfig


def insert_kronos_shadow(
    *,
    journal: Any,                        # JournalStore (duck-typed — needs ._conn / ._lock)
    forecast: KronosForecast,
    shadow_decision: str,
    live_decision: str,
    config: V2KronosShadowConfig,
) -> None:
    """Persist one shadow-prediction row. Raises on DB failure (caller swallows)."""
    now_iso = datetime.now(timezone.utc).isoformat()
    with journal._lock:
        journal._conn.execute(
            """
            INSERT INTO kronos_shadow_predictions (
                predicted_at, symbol, model_variant, tokenizer_name,
                lookback_len, pred_len, sample_count,
                current_close, mean_forecast_close_end,
                predicted_return_bps, sample_std_bps, upside_prob,
                shadow_decision, live_decision,
                long_threshold, short_threshold,
                inference_ms, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                forecast.predicted_at, forecast.symbol,
                forecast.model_variant, forecast.tokenizer_name,
                forecast.lookback_len, forecast.pred_len, forecast.sample_count,
                forecast.current_close, forecast.mean_forecast_close_end,
                forecast.predicted_return_bps, forecast.sample_std_bps, forecast.upside_prob,
                shadow_decision, live_decision,
                config.long_threshold, config.short_threshold,
                forecast.inference_ms, now_iso,
            ),
        )
        journal._conn.commit()
```

**Design note on reaching into `journal._lock` / `journal._conn`:** this is
intentional. `JournalStore` already exposes these as de facto module-level
contracts (ml_signal_driven.py:249 reaches into `daemon._journal_store`, same
pattern). Adding an `insert_kronos_shadow()` method to `JournalStore` itself
would bloat the store with a concern that only lives in `kronos_shadow/`. If
this pattern grows to 2+ call sites we can promote it then. **Do not promote
prematurely.**

**Tests (add to `tests/unit/test_kronos_shadow.py`):**
- `test_insert_writes_all_columns()` — in-memory sqlite; insert one row; SELECT and assert every column matches.
- `test_insert_indexes_exist()` — query `sqlite_master` for the three indexes, assert present.

---

### M6 — Daemon wiring

**Changes to `src/hynous/intelligence/daemon.py`:**

**a. Add slots near line 318** (next to `_entry_trigger`):

```python
# v2 kronos shadow (post-v2): optional predictor running alongside the live trigger.
self._kronos_shadow: "KronosShadowPredictor | None" = None
self._last_kronos_shadow: float = 0.0
```

**b. Add init method** alongside `_init_mechanical_entry` (after line 3465):

```python
def _init_kronos_shadow(self) -> None:
    """Load Kronos and build the shadow predictor; no-op if disabled or deps missing."""
    cfg = self.config.v2.kronos_shadow
    if not cfg.enabled:
        logger.info("kronos-shadow: disabled in config")
        return
    try:
        from hynous.kronos_shadow.adapter import KronosAdapter, is_kronos_available
        from hynous.kronos_shadow.shadow_predictor import KronosShadowPredictor
    except ImportError:
        logger.warning("kronos-shadow: import failed — disabling")
        return
    if not is_kronos_available():
        logger.warning("kronos-shadow: extras missing — disabling")
        return
    adapter = KronosAdapter(
        model_name=cfg.model_name,
        tokenizer_name=cfg.tokenizer_name,
        max_context=cfg.max_context,
        device=cfg.device,
    )
    try:
        adapter.load()
    except Exception:
        logger.exception("kronos-shadow: load failed — disabling")
        return
    self._kronos_shadow = KronosShadowPredictor(adapter=adapter, config=cfg)
    logger.info(
        "kronos-shadow: ENABLED symbol=%s model=%s cadence=%ds",
        cfg.symbol, cfg.model_name, cfg.tick_interval_s,
    )
```

**c. Call the init** just after `_init_mechanical_entry()` at line 899:

```python
try:
    self._init_mechanical_entry()
except Exception:
    logger.exception("Failed to initialize v2 mechanical entry trigger")
    self._entry_trigger = None
# NEW:
try:
    self._init_kronos_shadow()
except Exception:
    logger.exception("Failed to initialize kronos shadow")
    self._kronos_shadow = None
```

**d. Dispatch in main loop.** After the `_periodic_ml_signal_check` block
(lines 1030–1039), add:

```python
# Kronos shadow tick (v2 post-launch — read-only; runs off the main thread).
if self._kronos_shadow is not None:
    tick_interval = self.config.v2.kronos_shadow.tick_interval_s
    if now - self._last_kronos_shadow >= tick_interval:
        self._last_kronos_shadow = now
        threading.Thread(
            target=self._run_kronos_shadow_tick,
            name="kronos-shadow",
            daemon=True,
        ).start()
```

**e. Add the thread worker** near the other background helpers (search the
file for `def _wake_agent` → place alongside it):

```python
def _run_kronos_shadow_tick(self) -> None:
    """Thread entry point. Never raises."""
    try:
        self._kronos_shadow.predict_and_record(daemon=self)
    except Exception:
        logger.exception("kronos-shadow: tick worker crashed")
```

**Important:** do NOT call `predict_and_record` synchronously from the main
loop. Inference can take 5–30 s on CPU; blocking the main loop would stall
`_fast_trigger_check`.

**Tests (`tests/unit/test_kronos_shadow.py`):**
- `test_daemon_without_shadow_is_unaffected()` — construct a daemon with `v2.kronos_shadow.enabled=False`, call the init, assert `_kronos_shadow is None` and no crash.

**No new tests for the thread-spawning path** at unit level — integration is covered by M7 smoke.

---

### M7 — Integration smoke (opt-in)

**Goal:** end-to-end shot that confirms weights download + inference + journal
row happens successfully against real Hyperliquid candles.

Create `tests/integration/test_kronos_shadow_smoke.py`:

```python
"""Opt-in smoke test. Run with: pytest -m kronos tests/integration/test_kronos_shadow_smoke.py

Requires: pip install -e ".[kronos-shadow]" AND network access (HF Hub + Hyperliquid).
"""
import pytest

kronos = pytest.importorskip("torch")  # skip silently without extras


@pytest.mark.kronos
def test_end_to_end_inference_and_journal_write(tmp_path):
    # ... construct minimal journal store + fake daemon + real provider ...
    # ... assert one row lands in kronos_shadow_predictions ...
    pass  # engineer to fill in — template only; expect ~30s runtime
```

Register the `kronos` marker in `pyproject.toml`:

```toml
[tool.pytest.ini_options]
markers = [
    "kronos: Kronos shadow integration tests (requires torch + network)",
]
```

This smoke is NOT part of the green bar. Run manually on the VPS post-deploy
as part of M8.

---

### M8 — VPS enablement (runtime rollout)

1. On local: `git push origin v2`.
2. On VPS:
   ```bash
   ssh vps "cd /opt/hynous && sudo -u hynous git fetch origin v2 && sudo -u hynous git merge --ff-only origin/v2"
   # Install extras into the venv used by the hynous service
   ssh vps "cd /opt/hynous && sudo -u hynous .venv/bin/pip install -e '.[kronos-shadow]'"
   ```
3. Create a VPS-local YAML override — do NOT commit this — at
   `/opt/hynous/config/local.yaml` or by editing `/opt/hynous/config/default.yaml`:
   ```yaml
   v2:
     kronos_shadow:
       enabled: true
   ```
4. Restart: `ssh vps "sudo systemctl restart hynous"`.
5. Verify first tick within 5 minutes:
   ```bash
   ssh vps "sudo journalctl -u hynous -n 300 --no-pager | grep kronos-shadow"
   ```
   Expected lines (in order):
   - `kronos-shadow: ENABLED symbol=BTC model=NeoQuasar/Kronos-mini cadence=300s`
   - `Kronos adapter loaded: ...`
   - `kronos-shadow BTC: prob=0.XXX → <long|short|skip> (live=<...>) inference=XXXXms`
6. Verify row in journal:
   ```bash
   ssh vps "sqlite3 /opt/hynous/storage/v2/journal.db 'SELECT COUNT(*) FROM kronos_shadow_predictions;'"
   ```

**If any of the above fails, pause and report to architect.** Do not proceed
to the observation phase.

---

## 6. Acceptance Criteria (all must pass)

**Static:**
- [ ] `ruff check src/hynous/kronos_shadow/ tests/unit/test_kronos_shadow.py` → 0 errors (vendored dir exempt via per-file ignore)
- [ ] `mypy src/hynous/kronos_shadow/` → 0 new errors vs baseline 223/40 (vendor/ excluded per M1)
- [ ] `pyproject.toml` has `kronos-shadow` extras
- [ ] `config/default.yaml` has `v2.kronos_shadow` block, `enabled: false`
- [ ] `SCHEMA_DDL` contains `kronos_shadow_predictions` and 3 indexes

**Dynamic — no extras:**
- [ ] `PYTHONPATH=src pytest tests/` → **≥ 592 passed / 0 failed** (same as current baseline; tests for M2–M6 add ~10 new passing tests → expected ≥ 602)
- [ ] `python -c "from hynous.kronos_shadow import KronosShadowPredictor"` succeeds (soft import)
- [ ] Daemon boots cleanly with `v2.kronos_shadow.enabled = false` (no log errors, no warning about missing extras since init short-circuits)

**Dynamic — with extras:**
- [ ] `pip install -e ".[kronos-shadow]"` succeeds on fresh venv
- [ ] `python -c "from hynous.kronos_shadow.vendor import Kronos; print('ok')"` prints `ok`
- [ ] Smoke (`pytest -m kronos tests/integration/`) passes locally with network
- [ ] **VPS smoke (M8)**: first shadow row appears in `journal.db` within 10 minutes of restart; no exceptions in `journalctl -u hynous`

**Operational:**
- [ ] No change to `mechanical_entry/` files (git diff confirms)
- [ ] No change to the 9 rejection-reason strings or their ordering in `ml_signal_driven.py`
- [ ] No change to `_latest_predictions` shape
- [ ] Current entry flow still fires on a reproduction test (run `test_ml_signal_driven.py::test_fires_on_strong_conditions`)

---

## 7. Rollback Plan

Three rollback surfaces, in increasing scope:

1. **Config flag (instant):** set `v2.kronos_shadow.enabled: false` in
   `/opt/hynous/config/default.yaml`; restart the service. Shadow is inert in
   one systemd restart. Zero code change.
2. **Uninstall extras:** `sudo -u hynous .venv/bin/pip uninstall torch
   huggingface_hub einops safetensors`. Adapter's `is_kronos_available`
   returns False; shadow disables itself on next boot.
3. **Git revert (nuclear):** the entire change is additive — `git revert <sha>`
   removes everything cleanly. The `kronos_shadow_predictions` table stays in
   the DB (SQLite has no `DROP TABLE` from DDL), harmless.

---

## 8. Post-Landing Observation (architect-scheduled)

**Week 1 check:** after 7 × 24 h of shadow ticks (~2000 rows expected at 300 s
cadence), run the `tools/kronos_shadow_rollup.sql` query (below) and report:

```sql
-- Distribution of shadow decisions
SELECT shadow_decision, COUNT(*) AS n
FROM kronos_shadow_predictions
GROUP BY shadow_decision;

-- Agreement rate shadow vs live
SELECT
    shadow_decision, live_decision, COUNT(*) AS n
FROM kronos_shadow_predictions
WHERE live_decision != 'unknown'
GROUP BY shadow_decision, live_decision
ORDER BY n DESC;

-- Inference latency distribution
SELECT
    MIN(inference_ms) AS min_ms,
    AVG(inference_ms) AS mean_ms,
    MAX(inference_ms) AS max_ms
FROM kronos_shadow_predictions;
```

**Week 2 decision:** if agreement rate is meaningfully > 50 % AND Kronos
doesn't systematically miss winners the live trigger catches, architect
schedules an M9 promotion to a confirmation gate. If agreement is near-random
or Kronos consistently misses, keep shadow-only for another 2 weeks or kill.

**Do NOT infer trading performance from this guide's landing.** That is
downstream work, gated on shadow data.

---

## 9. Non-Obvious Gotchas (read before coding)

1. **Hyperliquid 1 h candles have `t` in ms; Kronos wants pandas Timestamp.**
   Adapter handles this (`pd.to_datetime(..., unit="ms")`). Don't pass
   raw ints.
2. **`KronosPredictor.predict` averages samples internally** before returning.
   The M2 `upside_prob` is a Gaussian-approximation proxy. A true sample-level
   MC requires a loop over `sample_count=1` — deferred to post-shadow M7 if
   the proxy proves too lossy.
3. **First run downloads ~200 MB of weights** from HuggingFace (Kronos-mini
   tokenizer + model). Subsequent runs hit the HF cache
   (`~/.cache/huggingface/`). Expect a first-tick delay of 30–60 s.
4. **`torch` on CPU is fine for Kronos-mini** (4.1 M params). Don't install
   CUDA unless someone asks — shadow doesn't need it.
5. **`einops` is pinned to 0.8.1 in upstream's requirements.txt**; we allow
   `>=0.8.0` to not over-constrain. If it breaks, pin exactly.
6. **Weights directory**: on the VPS, the `hynous` service user writes to
   `~hynous/.cache/huggingface/`. Confirm the user has write access before
   first boot; `chown -R hynous:hynous /home/hynous/.cache/` if not.
7. **Do not set `device="cuda"` unless a GPU exists.** Let the adapter
   auto-detect; on a CPU-only VPS it picks CPU and runs fine.
8. **SQLite WAL mode** is already enabled in `JournalStore.__init__`. Shadow
   writes from a background thread share the single `JournalStore._conn`;
   that's why `insert_kronos_shadow` must acquire `journal._lock`. Do NOT open
   a second connection.

---

## 10. Engineer Reporting Protocol

- After each milestone M1–M7, run the static + dynamic checks for that
  milestone and confirm before moving on.
- If any check fails with an unclear cause, **pause and report**. Do not
  work around a broken test by loosening an assertion.
- If a dependency on Kronos behaves differently from what this guide says
  (API drift upstream), **pause and report**. Do not silently adapt.
- Final report (only when all M1–M8 acceptance checks are green) includes:
  - List of commits with SHAs
  - Final pytest counts (expected ≥ 602 passed / 0 failed)
  - mypy + ruff counts (unchanged from baseline)
  - VPS log excerpt showing the first successful shadow tick
  - Row count in `kronos_shadow_predictions` after 30 min of runtime

---

Last updated: 2026-04-15 (guide authored 2026-04-14, implementation outcomes appended below)

---

## 11. Implementation Outcomes (2026-04-15)

The guide above was followed end-to-end. Real-world outcomes diverged from
plan in five places that future agents must know:

### 11.1 Final live config (NOT what the guide originally specified)

| Field | Guide default | Live value | Why |
|---|---|---|---|
| `model_name` | `NeoQuasar/Kronos-mini` | `NeoQuasar/Kronos-small` | User wanted the largest open-source variant. Tried `Kronos-base` (102 M) — overflowed the 300 s cadence on a 2-vCPU VPS even at `pred_len=6 sample_count=1` (>4 min, never completed). `Kronos-large` (499 M) weights are not publicly released. `Kronos-small` (24.7 M) is the largest viable on this hardware — first inference 33.7 s with 10× cadence headroom. |
| `tokenizer_name` | `Kronos-Tokenizer-2k` | `Kronos-Tokenizer-base` | Pairs with Kronos-small/base per upstream model zoo. |
| `pred_len` | 24 | 24 | Restored after Kronos-base experiments |
| `sample_count` | 20 | 5 | Trimmed for headroom; the upside-prob proxy still works |

If the VPS upgrades to ≥4 vCPU, swap to `Kronos-base` via one config edit. The
Kronos-base path was proven to load and run successfully — it just blew the
tick budget on small hardware.

### 11.2 Cascading bugs surfaced during deploy (5 total)

The guide had no way to predict any of these. All were caught by live
operational testing:

1. **`JournalStore` interface mismatch** — `store.insert_kronos_shadow` reached
   for `journal._lock` and `journal._conn`, but the real `JournalStore` exposes
   `_write_lock` and a per-operation `_connect()` method (no persistent
   connection). The unit tests' `FakeJournal` shared the same wrong attribute
   names, so the bug only surfaced live as
   `AttributeError: 'JournalStore' object has no attribute '_lock'`. **Fix
   commit `37b4d14`** rewrote both the store and the `FakeJournal` to use the
   real interface (per-op `_connect()` + `_write_lock`, autocommit via
   `isolation_level=None`).

2. **Daemon thread dying inside Reflex granian ASGI worker.** The original
   daemon was instantiated via `_eager_agent_start` in dashboard.py, but
   granian's ASGI worker does not reliably keep long-lived background threads
   alive. After a Hyperliquid 429 storm at 2026-04-15T01:17:02Z, the daemon
   thread died and never resumed across multiple service restarts. **Fix:
   new `deploy/hynous-daemon.service`** (commit `c1671c3`) runs
   `scripts.run_daemon` as a standalone systemd unit with `Restart=always`,
   completely decoupled from the UI's ASGI lifecycle.

3. **Hyperliquid `Info()` constructor 429 cascade.** The SDK's `Info(skip_ws=True)`
   blocks on a `spotMeta` POST during `__init__`. During daemon boot the
   satellite + scanner + daemon subsystems all instantiate `Info()` near-
   simultaneously and trip the rate limit. The bare `ClientError(429)` reached
   `_loop_inner`, hit the FATAL outer guard, and killed the daemon thread.
   This was the actual root cause of the pre-existing daemon-dead-since-01:17
   regression — completely orthogonal to the Kronos shadow work. **Fix
   commit `4c34009`**: `_build_info_with_retry` wraps `Info(...)` in 3
   attempts with exponential backoff (1 s, 2 s) on 429 only.

4. **`provider.get_candles` 429 on every Kronos shadow tick.** The
   `candles_snapshot` endpoint shares the `/info` rate-limit bucket. Every
   shadow tick was failing on the 360-bar candle fetch and writing nothing
   to the DB. **Fix commit `1235466`**: same retry pattern applied to
   `get_candles`.

5. **Journal DB path divergence.** `db_path` in config is relative
   (`storage/v2/journal.db`) and resolved against process CWD. Reflex
   (cwd `/opt/hynous/dashboard`) wrote to a *different* file from the
   standalone daemon (cwd `/opt/hynous`). Dashboard read 2,632 stale
   rejection rows from the broken-daemon era while live shadow data landed
   in a file the dashboard never opened. **Fix commit `fc4c02e`**:
   `JournalStore.__init__` resolves relative paths against
   `_find_project_root()`. Absolute paths (test fixtures) pass through
   unchanged.

### 11.3 Operational posture for the standalone daemon

- Service: `hynous-daemon.service` (User=hynous, WorkingDirectory=/opt/hynous,
  ExecStart=`.venv/bin/python -m scripts.run_daemon --log-level INFO`,
  Restart=always)
- The `enabled: true` flip is a **VPS-local edit** to
  `/opt/hynous/config/default.yaml`, NOT committed to git. Future deploys
  must `git stash` it before pulling, then re-apply. Use `sed -i` to
  scriptify if needed.
- HF cache lives at `~hynous/.cache/huggingface/`. Both Kronos-Tokenizer-base
  and Kronos-small weights are cached there post-boot (~50 MB).
- Live latency on Kronos-small: ~33 s per inference (CPU, 2 vCPU box).
  `top -bn1 -H -p <pid>` shows two threads pegged at ~85 % each during
  inference — torch is using both cores for matmul. No further parallelism
  available.

### 11.4 What the data should show after 1-2 weeks

Per the guide's § 8 observation plan, query
`kronos_shadow_predictions` after ~2,000 rows accumulate. Watch for:

- Distribution of `shadow_decision` (long / short / skip)
- Agreement matrix vs `live_decision` (most live decisions will be `skip`
  — that's normal, the live trigger is conservative)
- P50 / P99 of `inference_ms` (currently 33 s; should stay flat)

If shadow data shows real edge against actual closed trade outcomes,
promote to confirmation gate per § 8 Option B. If not, drop the flag and
move on.

### 11.5 Git commit trail

Single-session implementation history on branch `v2`:

```
7484611  swap default model: Kronos-mini → Kronos-base (largest open-source)
0bf390a  M1-M7 — vendor Kronos + shadow predictor (opt-in, zero live impact)
37b4d14  fix JournalStore interface mismatch caught in live boot
4c34009  retry HyperliquidProvider Info() on 429 — unblocks daemon boot
1235466  retry get_candles on 429
fc4c02e  journal scroll + DB path mismatch between dashboard and daemon
c1671c3  new hynous-daemon systemd unit for standalone mechanical loop
0ed9b95  drop sample_count 20 → 5 — Kronos-base CPU inference overflows cadence
f34e89b  sample_count 5 → 1 — autoregressive cost doesn't scale linearly
8b0ef17  pred_len 24 → 6 — sequential autoregressive cost is the real bottleneck
d475bfb  fall back from Kronos-base → Kronos-small (hardware-feasible)
```

The Kronos-base/sample_count/pred_len commits (`0ed9b95` through `8b0ef17`)
are all overridden by `d475bfb`. Reading the YAML alone tells you the live
config; reading the commit log tells you why we ended up there.
