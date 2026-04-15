"""Kronos shadow predictor (v2 post-launch).

Runs the Kronos foundation model alongside the live ``MLSignalDrivenTrigger``
and writes a would-fire verdict per tick to ``kronos_shadow_predictions``.
Never mutates live trading state. See
``v2-planning/12-kronos-shadow-integration.md``.

All heavy imports (torch, Kronos vendor) are deferred to ``adapter`` so this
package stays cheap to import without the optional extras.
"""

from __future__ import annotations

from .config import V2KronosShadowConfig
from .shadow_predictor import KronosShadowPredictor

__all__ = ["KronosShadowPredictor", "V2KronosShadowConfig"]
