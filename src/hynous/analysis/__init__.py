"""Hynous v2 analysis module.

Hybrid deterministic + LLM trade analysis pipeline.

Phase 3 M1 ships the deterministic layer only (rules engine + finding catalog +
mistake tag vocabulary). M2 adds the LLM synthesis pipeline, M3 adds evidence
validation, M4 adds daemon wake integration, M5 adds batch rejection analysis.
"""

from .finding_catalog import FINDING_METADATA, FindingType
from .llm_pipeline import run_analysis
from .mistake_tags import MISTAKE_TAGS, validate_mistake_tag
from .prompts import ANALYSIS_SYSTEM_PROMPT, build_user_prompt
from .rules_engine import Finding, run_rules
from .validation import validate_analysis_output
from .wake_integration import trigger_analysis_async, trigger_analysis_for_trade

__all__ = [
    "ANALYSIS_SYSTEM_PROMPT",
    "FINDING_METADATA",
    "MISTAKE_TAGS",
    "Finding",
    "FindingType",
    "build_user_prompt",
    "run_analysis",
    "run_rules",
    "trigger_analysis_async",
    "trigger_analysis_for_trade",
    "validate_analysis_output",
    "validate_mistake_tag",
]
