"""Shared utilities for hynous-data."""

import math


def safe_float(val) -> float:
    """Convert to float safely, returning 0 for invalid values (NaN, inf, etc.)."""
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return 0.0
        return f
    except (TypeError, ValueError):
        return 0.0
