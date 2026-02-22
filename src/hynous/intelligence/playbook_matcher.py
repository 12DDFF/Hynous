"""
Playbook Matcher — Proactive Procedural Memory Retrieval

Loads active playbook nodes from Nous, parses their structured trigger
conditions, and matches against scanner anomaly events. This is the
"cerebellum" — pattern-matching that fires automatically when market
conditions match a known playbook, rather than waiting for a semantic query.

Architecture:
  PlaybookMatcher.find_matching(anomalies)
    → loads/caches playbook nodes from Nous
    → for each playbook with structured trigger, evaluate against anomalies
    → returns matching playbooks sorted by relevance (success_rate × severity)

Called from: daemon._wake_for_scanner() between anomaly filtering and
message formatting.

See: revisions/memory-sections/issue-5-procedural-memory.md
"""

import json
import logging
import time
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class PlaybookMatch:
    """A playbook that matched the current anomaly events."""
    playbook_id: str
    title: str
    action: str
    direction: str  # "long", "short", "either"
    success_count: int
    sample_size: int
    matched_anomaly_type: str
    matched_symbol: str
    severity: float

    @property
    def success_rate(self) -> float:
        if self.sample_size == 0:
            return 0.0
        return self.success_count / self.sample_size

    @property
    def relevance_score(self) -> float:
        """Combined score: success_rate × severity × sample_weight.

        Sample weight ramps from 0 to 1 over the first 10 trades,
        so new playbooks with 1/1 (100%) don't outrank seasoned ones.
        """
        sample_weight = min(1.0, self.sample_size / 10)
        return self.success_rate * self.severity * sample_weight


class PlaybookMatcher:
    """Matches scanner anomalies against stored playbook trigger conditions.

    Usage:
        matcher = PlaybookMatcher(cache_ttl=1800)
        matches = matcher.find_matching(anomalies)
        if matches:
            context = PlaybookMatcher.format_matches(matches)
    """

    def __init__(self, cache_ttl: int = 1800):
        """Initialize the matcher.

        Args:
            cache_ttl: Seconds between playbook cache refreshes from Nous.
                Default 1800 (30 minutes). Set to 0 to disable caching.
        """
        self._cache_ttl = cache_ttl
        self._cache: list[dict] = []
        self._cache_time: float = 0
        self._load_errors: int = 0

    def find_matching(self, anomalies: list) -> list[PlaybookMatch]:
        """Find playbooks whose triggers match the given anomalies.

        Args:
            anomalies: list[AnomalyEvent] from scanner.detect(), already
                filtered by wake threshold and capped.

        Returns:
            Matching playbooks sorted by relevance_score descending.
            Empty list if no matches or no playbooks loaded.
        """
        playbooks = self._get_cached_playbooks()
        if not playbooks:
            return []

        matches: list[PlaybookMatch] = []
        for pb in playbooks:
            trigger = pb.get("_parsed_trigger")
            if not trigger:
                continue  # Manual playbook — no structured trigger

            for anomaly in anomalies:
                if self._matches(trigger, anomaly):
                    match = PlaybookMatch(
                        playbook_id=pb["id"],
                        title=pb.get("content_title", "Untitled"),
                        action=pb.get("_action", ""),
                        direction=pb.get("_direction", "either"),
                        success_count=pb.get("_success_count", 0),
                        sample_size=pb.get("_sample_size", 0),
                        matched_anomaly_type=anomaly.type,
                        matched_symbol=anomaly.symbol,
                        severity=anomaly.severity,
                    )
                    matches.append(match)
                    break  # One match per playbook is enough

        matches.sort(key=lambda m: m.relevance_score, reverse=True)
        return matches

    @staticmethod
    def _matches(trigger: dict, anomaly) -> bool:
        """Check if a playbook's trigger matches an anomaly event.

        Trigger format (from playbook content_body JSON):
            {
                "anomaly_types": ["funding_extreme", "oi_surge"],
                "symbols": ["BTC", "ETH"],     # null = any symbol
                "min_severity": 0.5             # optional, default 0.0
            }
        """
        # 1. anomaly_types check (required — no types = can't match)
        anomaly_types = trigger.get("anomaly_types", [])
        if not anomaly_types:
            return False
        if anomaly.type not in anomaly_types:
            return False

        # 2. Symbol filter (optional — null/empty means any symbol)
        symbols = trigger.get("symbols")
        if symbols:
            # Normalize to uppercase for comparison
            symbols_upper = [s.upper() for s in symbols]
            if anomaly.symbol.upper() not in symbols_upper:
                return False

        # 3. Severity floor (optional — default 0.0 means any severity)
        min_severity = trigger.get("min_severity", 0.0)
        if anomaly.severity < min_severity:
            return False

        return True

    def _get_cached_playbooks(self) -> list[dict]:
        """Load playbook nodes from Nous with caching.

        Returns cached list if within TTL. On Nous error, returns stale
        cache (better stale than empty). Parses content_body JSON to
        extract trigger conditions for matching.
        """
        now = time.time()
        if self._cache and (now - self._cache_time) < self._cache_ttl:
            return self._cache

        try:
            from ..nous.client import get_client
            client = get_client()
            nodes = client.list_nodes(
                subtype="custom:playbook",
                lifecycle="ACTIVE",
                limit=50,
            )

            parsed: list[dict] = []
            for node in nodes:
                body = node.get("content_body", "")
                try:
                    data = json.loads(body) if body and body.startswith("{") else {}
                except (json.JSONDecodeError, TypeError):
                    data = {}

                # Extract fields for matching (prefixed with _ to avoid collisions)
                node["_parsed_trigger"] = data.get("trigger")
                node["_action"] = data.get("action", "")
                node["_direction"] = data.get("direction", "either")
                node["_success_count"] = data.get("success_count", 0)
                node["_sample_size"] = data.get("sample_size", 0)
                parsed.append(node)

            self._cache = parsed
            self._cache_time = now
            self._load_errors = 0
            logger.debug("Playbook cache refreshed: %d playbooks loaded", len(parsed))
            return parsed

        except Exception as e:
            self._load_errors += 1
            logger.debug("Playbook cache load failed (%d): %s", self._load_errors, e)
            return self._cache  # Return stale cache on error

    def invalidate_cache(self):
        """Force cache refresh on next access.

        Call this after a new playbook is created or an existing one
        is updated, so the matcher picks up changes immediately.
        """
        self._cache_time = 0

    @staticmethod
    def format_matches(matches: list[PlaybookMatch]) -> str:
        """Format matching playbooks for inclusion in wake message.

        Returns a [Matching Playbooks] section ready to append to
        the scanner wake message.
        """
        if not matches:
            return ""

        lines = ["[Matching Playbooks]", ""]
        for i, m in enumerate(matches, 1):
            rate_str = f"{m.success_rate:.0%}" if m.sample_size > 0 else "new"
            sample_str = f" ({m.success_count}/{m.sample_size})" if m.sample_size > 0 else ""
            lines.append(
                f"{i}. **{m.title}** — {rate_str} win rate{sample_str}"
            )
            if m.action:
                lines.append(f"   Action: {m.action}")
            if m.direction != "either":
                lines.append(f"   Direction: {m.direction.upper()}")
            lines.append(f"   Triggered by: {m.matched_anomaly_type} on {m.matched_symbol}")
            lines.append(f"   Playbook ID: {m.playbook_id}")
            lines.append("")

        lines.append(
            "If following a playbook, mention its ID in your thesis. "
            "The system auto-tracks success after trade close."
        )
        return "\n".join(lines)
