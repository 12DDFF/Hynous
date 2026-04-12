"""Hynous v2 analysis module.

Hybrid deterministic + LLM trade analysis pipeline.

Phase 3 M1 ships the deterministic layer only (rules engine + finding catalog +
mistake tag vocabulary). M2 adds the LLM synthesis pipeline, M3 adds evidence
validation, M4 adds daemon wake integration, M5 adds batch rejection analysis.
"""

from .finding_catalog import FINDING_METADATA, FindingType
from .mistake_tags import MISTAKE_TAGS, validate_mistake_tag
from .rules_engine import Finding, run_rules

__all__ = [
    "FINDING_METADATA",
    "MISTAKE_TAGS",
    "Finding",
    "FindingType",
    "run_rules",
    "validate_mistake_tag",
]
