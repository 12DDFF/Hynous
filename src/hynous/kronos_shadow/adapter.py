"""Thin wrapper around the vendored Kronos model.

All torch / huggingface_hub imports are deferred behind
:func:`is_kronos_available` so importing this module does NOT require the
optional ``kronos-shadow`` extras. Callers must check availability before
invoking :meth:`KronosAdapter.load`.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from math import erf, sqrt
from typing import Any

logger = logging.getLogger(__name__)

_KRONOS_AVAILABLE: bool | None = None


def is_kronos_available() -> bool:
    """Return True iff torch + the vendored Kronos model can be imported.

    Cached after the first call. Logs one warning on the first miss; silent
    on subsequent misses.
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


def _reset_availability_cache_for_tests() -> None:
    """Test-only hook — unit tests monkeypatch this via the global directly."""
    global _KRONOS_AVAILABLE
    _KRONOS_AVAILABLE = None


@dataclass(slots=True, frozen=True)
class KronosForecast:
    """Summary of a single Kronos inference call."""

    symbol: str
    model_variant: str
    tokenizer_name: str
    lookback_len: int
    pred_len: int
    sample_count: int
    current_close: float
    mean_forecast_close_end: float
    upside_prob: float
    predicted_return_bps: float
    sample_std_bps: float
    inference_ms: float
    predicted_at: float


class KronosAdapter:
    """Owns the loaded KronosPredictor. One per daemon.

    Instantiation is cheap (no imports); :meth:`load` is blocking and must
    be called before :meth:`predict_upside_prob`. Load failures raise
    ``RuntimeError`` — callers are expected to catch and disable the shadow
    for the session.
    """

    def __init__(
        self,
        *,
        model_name: str = "NeoQuasar/Kronos-base",
        tokenizer_name: str = "NeoQuasar/Kronos-Tokenizer-base",
        max_context: int = 512,
        device: str | None = None,
    ) -> None:
        self._model_name = model_name
        self._tokenizer_name = tokenizer_name
        self._max_context = max_context
        self._device = device
        self._predictor: Any = None

    @property
    def model_variant(self) -> str:
        return self._model_name.split("/", 1)[-1]

    def load(self) -> None:
        if not is_kronos_available():
            raise RuntimeError("Kronos shadow extras not installed")
        from .vendor import Kronos, KronosPredictor, KronosTokenizer

        tokenizer = KronosTokenizer.from_pretrained(self._tokenizer_name)
        model = Kronos.from_pretrained(self._model_name)
        self._predictor = KronosPredictor(
            model,
            tokenizer,
            device=self._device,
            max_context=self._max_context,
        )
        logger.info(
            "Kronos adapter loaded: model=%s tokenizer=%s max_ctx=%d device=%s",
            self._model_name,
            self._tokenizer_name,
            self._max_context,
            self._predictor.device,
        )

    def predict_upside_prob(
        self,
        *,
        symbol: str,
        candles_1h: list[dict[str, Any]],
        pred_len: int = 24,
        sample_count: int = 20,
        T: float = 1.0,  # noqa: N803 — mirrors upstream KronosPredictor.predict param name
        top_p: float = 0.9,
    ) -> KronosForecast:
        """Run one inference pass and summarize the MC distribution.

        Args:
            symbol: display-only; used to tag the :class:`KronosForecast`.
            candles_1h: list of dicts with keys ``t`` (ms since epoch),
                ``o``, ``h``, ``l``, ``c``, ``v``. Sorted ascending by ``t``.
                Must contain ≥ 64 bars. Only the last ``max_context`` are used.
            pred_len: forecast horizon in bars.
            sample_count: Monte Carlo sample count. 20 is the CPU sweet spot
                for the CPU path; tune down if Kronos-base inference exceeds the cadence.

        Raises:
            RuntimeError: if :meth:`load` has not completed.
            ValueError: if the candle list is malformed or too short.
        """
        if self._predictor is None:
            raise RuntimeError("KronosAdapter.load() must be called first")
        if not isinstance(candles_1h, list) or len(candles_1h) < 64:
            raise ValueError(
                f"need ≥64 candles, got {len(candles_1h) if isinstance(candles_1h, list) else 'non-list'}",
            )

        import pandas as pd

        trimmed = candles_1h[-self._max_context:]
        df = pd.DataFrame(
            [
                {
                    "open": float(c["o"]),
                    "high": float(c["h"]),
                    "low": float(c["l"]),
                    "close": float(c["c"]),
                    "volume": float(c["v"]),
                }
                for c in trimmed
            ],
        )
        x_timestamp = pd.to_datetime([c["t"] for c in trimmed], unit="ms")
        last_ts = x_timestamp[-1]
        y_timestamp = pd.date_range(
            start=last_ts + pd.Timedelta(hours=1),
            periods=pred_len,
            freq="1h",
        )
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
        mean_end = float(pred_df["close"].iloc[-1])
        predicted_return_bps = (mean_end / current_close - 1.0) * 10_000.0
        # Proxy sample std: mean per-bar (high - low) / close over the forecast.
        # KronosPredictor.predict already averages samples internally (see
        # vendor/kronos.py::auto_regressive_inference line 467), so we cannot
        # recover per-sample terminal variance here. The high/low envelope
        # captured in the mean forecast bars is the best cheap proxy.
        envelope = (pred_df["high"].values - pred_df["low"].values) / pred_df["close"].values
        sample_std_bps = float(envelope.mean() * 10_000.0)
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
