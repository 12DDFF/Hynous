"""Runtime config for the Kronos shadow predictor (read-only — never affects live trading)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class V2KronosShadowConfig:
    """Shadow-predictor parameters.

    See ``v2-planning/12-kronos-shadow-integration.md`` § 4 for the full
    rationale. Zero of these fields affect the live entry path — the shadow
    is a side-effect-only writer to ``kronos_shadow_predictions``.
    """

    enabled: bool = False
    symbol: str = "BTC"
    model_name: str = "NeoQuasar/Kronos-mini"
    tokenizer_name: str = "NeoQuasar/Kronos-Tokenizer-2k"
    max_context: int = 512
    lookback_bars: int = 360
    pred_len: int = 24
    sample_count: int = 20
    temperature: float = 1.0
    top_p: float = 0.9
    tick_interval_s: int = 300
    device: str | None = None
    long_threshold: float = 0.60
    short_threshold: float = 0.40
