"""Mechanical entry interface — trigger-source ABC + evaluation dataclasses.

This module is intentionally dependency-free (no hynous.* imports) so tests
can import it without bootstrapping the journal/daemon stack. Concrete
implementations live in sibling modules (ml_signal_driven, etc.).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class EntrySignal:
    """A candidate entry produced by an EntryTriggerSource.

    The trigger source is responsible for all gating. If an EntrySignal is
    returned, the downstream code assumes it has been fully validated and
    computes entry params deterministically.
    """

    symbol: str
    side: str                    # "long" | "short"
    trade_type: str              # "macro" | "micro"
    conviction: float            # 0.0–1.0 derived from ML signals
    trigger_source: str          # "ml_signal" | "hybrid_scanner_ml" | "manual"
    trigger_type: str            # "composite_score" | "direction_model" | etc.
    trigger_detail: dict[str, Any]   # raw context: anomaly dict, ML signal state
    ml_snapshot_ref: dict[str, Any]  # references to the ML state used for gating
    expires_at: str | None = None    # ISO timestamp, or None for no expiry


@dataclass(slots=True)
class EntryEvaluationContext:
    """Context passed to a trigger source for evaluation."""

    daemon: Any                  # the HynousDaemon instance (for state access)
    symbol: str                  # the symbol being considered
    scanner_anomaly: dict[str, Any] | None = None  # if fired from scanner
    now_ts: str = ""             # ISO UTC timestamp


class EntryTriggerSource(ABC):
    """Abstract interface for mechanical entry decision sources.

    Implementations:
        - MLSignalDrivenTrigger (phase 5, Option B): fires based on composite
          entry score + direction model alone, no scanner involvement
        - HybridScannerMLTrigger (future, Option C): scanner nominates, ML gates
    """

    @abstractmethod
    def evaluate(self, ctx: EntryEvaluationContext) -> EntrySignal | None:
        """Decide whether to fire an entry.

        Returns an EntrySignal to fire, or None to pass.
        Must be pure-deterministic: same context always produces same output.
        """
        ...

    @abstractmethod
    def name(self) -> str:
        """Return identifier used in logging and rejection records."""
        ...
