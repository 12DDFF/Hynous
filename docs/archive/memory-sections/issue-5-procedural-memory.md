# Issue 5: Procedural Memory — Implementation Guide

> **STATUS:** DONE
>
> **Depends on:** Issue 0 (Section Foundation) — provides `MemorySection.PROCEDURAL`, `SUBTYPE_TO_SECTION`, `SECTION_PROFILES` with `consolidation_role="target"`, and `SUBTYPE_INITIAL_STABILITY["custom:playbook"] = 180` days. Issue 3 (Cross-Episode Generalization) — the consolidation engine creates knowledge from episode clusters; Issue 5 extends it to optionally create playbook nodes when patterns have strong statistical backing.
>
> **What this creates:** A proactive procedural memory system — the "cerebellum" — that adds a genuinely new retrieval mechanism **alongside** SSA search. When the daemon's scanner detects market anomalies, a `PlaybookMatcher` cross-references those anomalies against stored playbook trigger conditions and injects matching playbooks into the agent's context. After trade outcomes, a feedback loop updates playbook success metrics. This is **additive** — SSA semantic search continues to work normally for all queries; the playbook matcher supplements it with structured pattern-matching for the proactive case where market conditions trigger a known playbook without anyone asking.

---

## Problem Statement

The agent has `custom:playbook` as a subtype, but it's treated identically to any other concept node. There is no distinct retrieval mechanism for procedural knowledge — pattern→action pairs that should activate when a matching pattern is detected, not when a semantically similar query is issued.

**Pattern blindness at wake time.** The scanner detects anomalies (funding extreme, OI surge, liquidation cascade, etc.) and wakes the agent. But it doesn't check whether any stored playbook matches the current conditions. The agent has to manually recall relevant playbooks — assuming it remembers they exist and formulates the right query.

**No structured condition matching.** Playbook nodes store plain text. When the scanner fires a `funding_extreme` anomaly with severity 0.8, there's no way to automatically match this against a playbook that says "when funding exceeds 0.10%, short with tight stop." The existing SSA search matches by semantic similarity, not structured conditions.

**No success feedback.** When the agent follows a playbook and the trade closes profitably, the playbook's durability doesn't increase. The system has no record of which trades followed which playbooks, so it can't strengthen successful patterns or weaken failing ones.

**No formation pathway.** The agent creates playbooks manually after winning trades (prompted by the daemon's TP fill wake message). But there's no systematic background process that extracts recurring winning patterns into formal playbooks. Issue 3's consolidation engine creates lessons — Issue 5 extends it to create playbooks when patterns have sufficient statistical backing.

**What this guide implements:**
1. A `PlaybookMatcher` class that loads active playbook nodes, parses structured trigger conditions, and matches against scanner anomaly events
2. Daemon integration that runs the matcher inline during scanner wake processing and injects matching playbook context into the wake message
3. Auto-linking between matched playbooks and trade entries via `applied_to` edges
4. A feedback loop that updates playbook success metrics (success_count, sample_size) after trade close
5. Extension of the consolidation engine to promote high-confidence patterns to playbook nodes
6. Store validation for playbook-type memories to ensure structured trigger format
7. System prompt updates for procedural memory awareness
8. Configuration for playbook cache TTL

---

## Required Reading

Read these files **in order** before implementing. The "Focus Areas" column tells you exactly which parts matter.

### Foundation & Theory (read first)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 1 | `revisions/memory-sections/executive-summary.md` | **START HERE.** "Issue 5: No Procedural Memory" (lines 272-307) defines the problem, brain analogy, and what the pipeline should do. Key insight at line 300: "Procedural memory is the one section that adds a genuinely new retrieval mechanism alongside the existing SSA search." Also "How the Six Issues Interconnect" (lines 359-402). | Lines 272-307 (Issue 5 definition), lines 359-402 (interconnections) |
| 2 | `revisions/memory-sections/issue-0-section-foundation.md` | Foundation guide — **FORMAT REFERENCE** for this document. Also defines `SECTION_PROFILES[PROCEDURAL]` (consolidation_role="target", reranking weights, decay params) and `SUBTYPE_INITIAL_STABILITY["custom:playbook"] = 180`. | Lines 338-364 (PROCEDURAL profile), lines 426-449 (SUBTYPE_INITIAL_STABILITY) |
| 3 | `revisions/memory-sections/issue-3-generalization.md` | **DEPENDENCY.** Defines the `ConsolidationEngine` class that Issue 5 extends. "What Comes Next" (lines 1385-1388): "Issue 5 extends the consolidation pipeline. When the consolidation engine identifies a pattern with enough statistical backing (e.g., '9/12 trades following this setup were profitable'), it can create a `custom:playbook` node instead of a `custom:lesson`." | Lines 1383-1388 ("What Comes Next"), full guide for `ConsolidationEngine` pattern: `_analyze_group()`, `_create_knowledge_node()`, `_CONSOLIDATION_SYSTEM` prompt |

### Scanner & Daemon (critical — this is where playbook matching hooks in)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 4 | `src/hynous/intelligence/scanner.py` | **INTEGRATION TARGET.** `AnomalyEvent` dataclass (lines 60-71) — the data structure playbook triggers match against. `detect()` (lines 330-443) — produces anomaly events. `format_scanner_wake()` (lines 1470-1559) — formats wake messages; playbook context is injected AFTER this function returns. `infer_phantom_direction()` (lines 1562-1629) — maps anomaly type to direction. | Lines 60-71 (`AnomalyEvent` fields: type, symbol, severity, headline, detail, fingerprint, detected_at, category), lines 330-443 (`detect()` — dedup + confluence + sorting), lines 1470-1559 (`format_scanner_wake()`) |
| 5 | `src/hynous/intelligence/daemon.py` | **PRIMARY INTEGRATION TARGET.** `__init__()` (lines 184-300) — where to add `_playbook_matcher` and `_last_matched_playbooks`. `_loop()` step 3b (lines 567-580) — scanner detection flow; playbook matching runs inside `_wake_for_scanner()`, not here. `_wake_for_scanner()` (lines 1729-1787) — where to inject playbook context after message formatting and auto-link after agent trades. Study the existing injection pattern: regime context (lines 1751-1754), historical context (lines 1757-1759). | Lines 184-300 (`__init__` — timer trackers, thread refs, scanner init at 284-289), lines 567-580 (step 3b — scanner flow), lines 1729-1787 (`_wake_for_scanner` — threshold filter, format, regime inject, track record, wake, phantom) |

### Memory Tools & Trading Tools (store, feedback loop)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 6 | `src/hynous/intelligence/tools/memory.py` | **MODIFICATION TARGET.** `_TYPE_MAP` (line 272): `"playbook"` already exists. `STORE_TOOL_DEF` (lines 282-357): description and trigger schema — add playbook guidance. `_store_memory_impl()` (lines 394-658): add playbook body initialization (success_count, sample_size). | Lines 256-275 (`_TYPE_MAP`), lines 282-357 (`STORE_TOOL_DEF` — description and trigger schema), lines 394-466 (`_store_memory_impl()` — body building logic at lines 457-466) |
| 7 | `src/hynous/intelligence/tools/trading.py` | **MODIFICATION TARGET.** `_find_trade_entry()` (lines 1102-1128) — pattern for finding entry nodes by symbol. `_store_trade_memory()` (lines 1130-1224) — entry node creation. `handle_close_position()` (lines 1277-1577) — where to add playbook feedback after line 1537. `_strengthen_trade_edge()` (lines 1901-1925) — **exact pattern to follow** for background Hebbian operations. | Lines 1102-1128 (`_find_trade_entry` — list_nodes pattern), lines 1130-1188 (entry node creation + signals), lines 1508-1537 (trade_close storage + Hebbian strengthening), lines 1901-1925 (`_strengthen_trade_edge` — background thread pattern) |

### Nous Client & Section Config (API reference)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 8 | `src/hynous/nous/client.py` | **API REFERENCE.** `list_nodes()` (lines 108-131) — load playbooks with `subtype="custom:playbook"`, `lifecycle="ACTIVE"`. `get_node()` (lines 100-106) — fetch playbook for metric update. `update_node()` (lines 133-137) — update playbook `content_body` with new metrics. `create_edge()` (lines 147-168) — create `applied_to` edge. `get_edges()` (lines 170-179) — find `applied_to` edges on trade entry nodes. | Lines 108-131 (`list_nodes` — filters: subtype, lifecycle, limit), lines 133-137 (`update_node`), lines 147-168 (`create_edge`), lines 170-179 (`get_edges` — direction="in" for incoming edges) |
| 9 | `src/hynous/nous/sections.py` | **REFERENCE.** `SECTION_PROFILES[PROCEDURAL]` (lines 233-251): consolidation_role="target", intent_boost=1.3, initial_stability_days=120, max_salience_multiplier=3.0. `SUBTYPE_INITIAL_STABILITY["custom:playbook"] = 180` (line 292). `calculate_salience()` (lines 314-369): for `missed_opportunity` and `good_pass` subtypes (lines 364-367). | Lines 233-251 (PROCEDURAL profile), lines 292 (playbook stability 180d), lines 364-367 (phantom salience) |

### TypeScript (SSA edge weight for applied_to)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 10 | `nous-server/core/src/params/index.ts` | **MODIFICATION TARGET.** `SSAEdgeWeights` interface (lines 307-316), `SSAEdgeWeightsSchema` (lines 318-327), `SSA_EDGE_WEIGHTS` (lines 329-338) — add `applied_to: 0.75`. Also `getSSAEdgeWeight()` in `ssa/index.ts` (line 772-775) has `?? 0.50` fallback for unknown types, so `applied_to` works even before adding it — but explicit registration gives correct weight. | Lines 307-338 (SSAEdgeWeights interface + schema + constant) |

### System Prompt (agent awareness)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 11 | `src/hynous/intelligence/prompts/builder.py` | **MODIFICATION TARGET.** `TOOL_STRATEGY` (lines 146-177): "How My Memory Works" section (lines 173-177) — add procedural memory awareness. Also lines 165 mention playbook fading alerts — extend with playbook matching context. | Lines 146-177 (`TOOL_STRATEGY`), lines 173-177 ("How My Memory Works") |

### Config (daemon settings)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 12 | `src/hynous/core/config.py` | **MODIFICATION TARGET.** `DaemonConfig` (lines 94-119) — add `playbook_cache_ttl`. | Lines 94-119 (DaemonConfig dataclass) |
| 13 | `config/default.yaml` | **MODIFICATION TARGET.** `daemon:` section (lines 34-49) — add `playbook_cache_ttl`. | Lines 34-49 (daemon YAML block) |

---

## Architecture Decisions

### Decision 1: PlaybookMatcher is a standalone module, not embedded in scanner or daemon (FINAL)

The `PlaybookMatcher` class lives in its own file (`intelligence/playbook_matcher.py`), separate from `scanner.py` and `daemon.py`. It receives anomaly events and returns matching playbooks — pure input/output with no side effects except Nous HTTP calls for cache loading.

**Rationale:** Testability. The matcher can be unit-tested with mock anomalies and mock Nous responses without instantiating a scanner or daemon. The scanner stays "zero LLM cost, pure Python" — it has no knowledge of playbooks or Nous.

**Where:** `src/hynous/intelligence/playbook_matcher.py` (new file, ~200 lines).

### Decision 2: Matching runs inline during _wake_for_scanner(), not as a separate daemon timer (FINAL)

Playbook matching does NOT get its own daemon periodic task. It runs inside `_wake_for_scanner()` — specifically between anomaly filtering and agent wake. This means matching only happens when there are wake-worthy anomalies.

**Rationale:**
- **No wasted work.** Matching without anomalies is pointless — playbook triggers match against anomaly events.
- **No new timer complexity.** The daemon already has 9+ periodic tasks. Playbook matching piggybacks on the existing scanner flow.
- **Tight timing.** The matched playbook context is available at the same time as the anomaly context — both go into the same wake message.

**Where:** Inside `daemon._wake_for_scanner()`, after filtering anomalies but before formatting the wake message.

### Decision 3: Trigger matching is anomaly-type-based, not raw-data-based (FINAL)

Playbook triggers match against `AnomalyEvent` objects (type, symbol, severity) — NOT against raw market data (prices, funding rates, OI). The scanner already encodes all quantitative detection logic into anomaly type + severity.

**Trigger format (stored in playbook content_body JSON):**
```json
{
  "anomaly_types": ["funding_extreme", "oi_surge"],
  "symbols": ["BTC", "ETH"],
  "min_severity": 0.5
}
```

- `anomaly_types` (required): list of anomaly type strings to match (ANY match triggers)
- `symbols` (optional): list of symbols to match (`null` = any symbol)
- `min_severity` (optional): severity floor, default 0.0

**Rationale:**
- The scanner does all the hard work of quantitative detection. Re-evaluating raw data in the matcher would duplicate logic.
- Anomaly types are stable, well-defined strings (15 types). Matching against them is deterministic and testable.
- The scanner's confluence scoring already handles multi-signal conditions — if funding_extreme + oi_surge fire on the same symbol, they get merged with boosted severity.

### Decision 4: Playbook cache with TTL avoids per-anomaly Nous calls (FINAL)

The `PlaybookMatcher` caches all active playbook nodes from Nous and refreshes on a configurable TTL (default 30 minutes). Matching runs against the in-memory cache — no HTTP calls during the matching hot path.

**Rationale:**
- Scanner can produce anomalies every 60s. Calling Nous `list_nodes()` on every detection would be 60 HTTP calls/hour.
- Playbooks change rarely (new ones created after winning trades, maybe 1-2/day). A 30-minute cache is more than fresh enough.
- On cache miss or Nous error, the matcher returns stale results rather than blocking the wake.

**Where:** `PlaybookMatcher._get_cached_playbooks()` with `self._cache_ttl` from `DaemonConfig.playbook_cache_ttl`.

### Decision 5: Playbook context is appended to the wake message, not passed to format_scanner_wake() (FINAL)

Matching playbook context is appended to the formatted wake message as a separate `[Matching Playbooks]` section — similar to how `[Track Record]` is prepended. The `format_scanner_wake()` function signature is unchanged.

**Rationale:**
- `format_scanner_wake()` is a scanner-module function. It shouldn't need to know about playbooks.
- The daemon already orchestrates context injection (regime, track record). Playbook context follows the same pattern.
- Keeps the scanner module "zero knowledge of Nous" — pure Python anomaly detection.

### Decision 6: Feedback loop uses applied_to edges + background metric updates (FINAL)

When a playbook matches during a scanner wake and the agent subsequently executes a trade:
1. The daemon creates an `applied_to` edge from the playbook node to the trade entry node (background thread)
2. When the trade closes (`handle_close_position`), a background task checks if the entry node has incoming `applied_to` edges from playbook nodes
3. If found, it updates the playbook's `success_count`/`sample_size` in its `content_body` JSON

The edge type `applied_to` gets weight 0.75 in SSA (strong — shows the playbook produced this trade).

**Rationale:**
- Automatic, no agent involvement needed for metric tracking.
- Edge-based association is discoverable by SSA — when the agent searches for a playbook, its linked trades surface naturally.
- Background threading follows the established pattern (`_strengthen_trade_edge()` at lines 1901-1925 in trading.py).

### Decision 7: Consolidation engine extension creates playbooks from high-confidence patterns (FINAL)

Issue 3's `ConsolidationEngine._analyze_group()` calls Haiku to analyze episode clusters. Issue 5 extends the LLM prompt to detect patterns with:
- Win rate ≥ 70% across ≥ 8 trades
- Clear, extractable trigger conditions (anomaly type + direction)

When detected, the engine creates a `custom:playbook` node instead of a `custom:lesson`, with structured trigger conditions in the content body.

**Rationale:**
- Playbook formation should be systematic, not just manual. The consolidation engine already reviews trade episodes — extending it for playbook creation is natural.
- The LLM can extract structured conditions from unstructured trade descriptions (e.g., "I shorted BTC when funding was extreme" × 9 episodes → `anomaly_types: ["funding_extreme"]`).
- Manual playbook creation (via `store_memory`) remains the primary path. Consolidation-promoted playbooks are a supplementary automatic path.

### Decision 8: Playbooks without structured triggers are still valid — they just don't pattern-match (FINAL)

A playbook stored without a `trigger` field in its content body is a "manual-only" playbook. It's still:
- Retrievable via SSA semantic search ("what playbooks do I have for funding squeezes?")
- Subject to FSRS decay with 180-day initial stability
- Shown in the agent's context when semantically relevant

It just won't be matched by the `PlaybookMatcher` during scanner wakes. This is intentional — not all procedural knowledge can be reduced to anomaly-type triggers. Some playbooks are qualitative ("when the market feels overextended and news is quiet, reduce exposure").

---

## Implementation Steps

### Step 5.1: Add `applied_to` edge type to SSA_EDGE_WEIGHTS

**File:** `nous-server/core/src/params/index.ts`

The `applied_to` edge connects a playbook to a trade entry it was used for. Weight 0.75 — strong, because applying a playbook is a deliberate, high-confidence action (stronger than `mentioned_together: 0.60`, weaker than `caused_by: 0.80`).

> **Note:** Issue 3 also adds `generalizes: 0.70`. If implementing in order, `generalizes` should already be present. If not, add both.

**Find this (lines 307-316):**
```typescript
export interface SSAEdgeWeights {
  same_entity: number;
  part_of: number;
  caused_by: number;
  mentioned_together: number;
  related_to: number;
  similar_to: number;
  user_linked: number;
  temporal_adjacent: number;
}
```

**Replace with:**
```typescript
export interface SSAEdgeWeights {
  same_entity: number;
  part_of: number;
  caused_by: number;
  mentioned_together: number;
  related_to: number;
  similar_to: number;
  user_linked: number;
  temporal_adjacent: number;
  generalizes: number;    // Issue 3: knowledge generalizes episodes
  applied_to: number;     // Issue 5: playbook applied to trade entry
}
```

**Find this (lines 318-327):**
```typescript
export const SSAEdgeWeightsSchema = z.object({
  same_entity: z.number().min(0).max(1),
  part_of: z.number().min(0).max(1),
  caused_by: z.number().min(0).max(1),
  mentioned_together: z.number().min(0).max(1),
  related_to: z.number().min(0).max(1),
  similar_to: z.number().min(0).max(1),
  user_linked: z.number().min(0).max(1),
  temporal_adjacent: z.number().min(0).max(1),
});
```

**Replace with:**
```typescript
export const SSAEdgeWeightsSchema = z.object({
  same_entity: z.number().min(0).max(1),
  part_of: z.number().min(0).max(1),
  caused_by: z.number().min(0).max(1),
  mentioned_together: z.number().min(0).max(1),
  related_to: z.number().min(0).max(1),
  similar_to: z.number().min(0).max(1),
  user_linked: z.number().min(0).max(1),
  temporal_adjacent: z.number().min(0).max(1),
  generalizes: z.number().min(0).max(1),
  applied_to: z.number().min(0).max(1),
});
```

**Find this (lines 329-338):**
```typescript
export const SSA_EDGE_WEIGHTS: SSAEdgeWeights = {
  same_entity: 0.95,
  part_of: 0.85,
  caused_by: 0.80,
  mentioned_together: 0.60,
  related_to: 0.50,
  similar_to: 0.45,
  user_linked: 0.90,
  temporal_adjacent: 0.40,
};
```

**Replace with:**
```typescript
export const SSA_EDGE_WEIGHTS: SSAEdgeWeights = {
  same_entity: 0.95,
  part_of: 0.85,
  caused_by: 0.80,
  generalizes: 0.70,    // Issue 3: consolidation creates this
  mentioned_together: 0.60,
  related_to: 0.50,
  similar_to: 0.45,
  user_linked: 0.90,
  temporal_adjacent: 0.40,
  applied_to: 0.75,     // Issue 5: playbook applied to trade
};
```

**Build after change:**
```bash
cd nous-server/core && npx tsup
```

---

### Step 5.2: Add `playbook_cache_ttl` to DaemonConfig

**File:** `src/hynous/core/config.py`

**Find this (lines 116-118):**
```python
    # Phantom tracker (inaction cost)
    phantom_check_interval: int = 1800          # Seconds between phantom evaluations (30 min)
    phantom_max_age_seconds: int = 14400        # Max phantom lifetime (4h, macro default)
```

**Replace with:**
```python
    # Phantom tracker (inaction cost)
    phantom_check_interval: int = 1800          # Seconds between phantom evaluations (30 min)
    phantom_max_age_seconds: int = 14400        # Max phantom lifetime (4h, macro default)
    # Playbook matcher (Issue 5: procedural memory)
    playbook_cache_ttl: int = 1800              # Seconds between playbook cache refreshes (30 min)
```

---

### Step 5.3: Add `playbook_cache_ttl` to default.yaml

**File:** `config/default.yaml`

**Find this (lines 48-49):**
```yaml
  max_wakes_per_hour: 6              # Rate limit on agent wakes per hour
  wake_cooldown_seconds: 120         # Min seconds between non-priority wakes
```

**Replace with:**
```yaml
  max_wakes_per_hour: 6              # Rate limit on agent wakes per hour
  wake_cooldown_seconds: 120         # Min seconds between non-priority wakes
  playbook_cache_ttl: 1800           # Playbook matcher cache refresh interval (seconds, 30 min)
```

---

### Step 5.4: Create PlaybookMatcher class

**File:** `src/hynous/intelligence/playbook_matcher.py` **(NEW FILE)**

This is the core of Issue 5 — the pattern-matching engine that matches scanner anomalies against stored playbook triggers.

```python
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
```

---

### Step 5.5: Wire PlaybookMatcher into daemon __init__

**File:** `src/hynous/intelligence/daemon.py`

Initialize the `PlaybookMatcher` alongside the scanner. Add state tracking for matched playbooks (used by auto-linking in Step 5.7).

**Find this (lines 283-289):**
```python
        # Market scanner (anomaly detection across all pairs)
        self._scanner = None
        if config.scanner.enabled:
            from .scanner import MarketScanner
            self._scanner = MarketScanner(config.scanner)
            self._scanner.execution_symbols = set(config.execution.symbols)
            self._scanner._data_layer_enabled = config.data_layer.enabled
```

**Replace with:**
```python
        # Market scanner (anomaly detection across all pairs)
        self._scanner = None
        self._playbook_matcher = None
        self._last_matched_playbooks: list = []  # For auto-linking after trade
        if config.scanner.enabled:
            from .scanner import MarketScanner
            self._scanner = MarketScanner(config.scanner)
            self._scanner.execution_symbols = set(config.execution.symbols)
            self._scanner._data_layer_enabled = config.data_layer.enabled
            # Playbook matcher (Issue 5: proactive procedural memory)
            from .playbook_matcher import PlaybookMatcher
            self._playbook_matcher = PlaybookMatcher(
                cache_ttl=config.daemon.playbook_cache_ttl,
            )
```

---

### Step 5.6: Inject playbook context + auto-link in _wake_for_scanner

**File:** `src/hynous/intelligence/daemon.py`

This is the main integration point. After formatting the scanner wake message but before injecting regime and track record context, run the playbook matcher and append matching playbook context. After the agent responds with a trade, auto-link the matched playbooks to the trade entry in a background thread.

**Find this (lines 1746-1787 — the body of `_wake_for_scanner` after the filter/cap):**
```python
        # Format the wake message (pass position types + regime for directional context)
        regime_label = self._regime.label if self._regime else "NEUTRAL"
        message = format_scanner_wake(top, position_types=self._position_types, regime_label=regime_label)

        # Inject regime context above the scanner message
        if self._regime and self._regime.label != "NEUTRAL":
            from .regime import format_regime_line
            regime_line = format_regime_line(self._regime, compact=True)
            message = f"[{regime_line}]\n\n" + message

        # Inject historical context above the scanner message
        track_record = self._build_historical_context(top)
        if track_record:
            message = track_record + "\n\n" + message

        response = self._wake_agent(
            message, max_coach_cycles=0, max_tokens=768,
            source="daemon:scanner",
        )
        if response:
            self.scanner_wakes += 1
            self._scanner.wakes_triggered += 1
            top_event = top[0]
            title = top_event.headline

            # Track pass streak + phantom creation
            if self.agent.last_chat_had_trade_tool():
                self._scanner_pass_streak = 0
            else:
                self._scanner_pass_streak += 1
                # Phantom tracking: record what would have happened on this pass
                self._maybe_create_phantom(top_event, agent_response=response)

            log_event(DaemonEvent(
                "scanner", title,
                f"{len(top)} anomalies (top: {top_event.type} {top_event.symbol} sev={top_event.severity:.2f})",
            ))
            _queue_and_persist("Scanner", title, response, event_type="scanner")
            _notify_discord("Scanner", title, response)
            logger.info("Scanner wake: %d anomalies, agent responded (%d chars)",
                        len(top), len(response))
```

**Replace with:**
```python
        # Format the wake message (pass position types + regime for directional context)
        regime_label = self._regime.label if self._regime else "NEUTRAL"
        message = format_scanner_wake(top, position_types=self._position_types, regime_label=regime_label)

        # Issue 5: Playbook matching — inject matching playbook context
        matched_playbooks: list = []
        if self._playbook_matcher:
            try:
                from .playbook_matcher import PlaybookMatcher
                matched_playbooks = self._playbook_matcher.find_matching(top)
                if matched_playbooks:
                    playbook_section = PlaybookMatcher.format_matches(matched_playbooks)
                    message += "\n\n" + playbook_section
                    logger.debug(
                        "Playbook matcher: %d matches for %d anomalies",
                        len(matched_playbooks), len(top),
                    )
            except Exception as e:
                logger.debug("Playbook matching failed: %s", e)

        # Inject regime context above the scanner message
        if self._regime and self._regime.label != "NEUTRAL":
            from .regime import format_regime_line
            regime_line = format_regime_line(self._regime, compact=True)
            message = f"[{regime_line}]\n\n" + message

        # Inject historical context above the scanner message
        track_record = self._build_historical_context(top)
        if track_record:
            message = track_record + "\n\n" + message

        response = self._wake_agent(
            message, max_coach_cycles=0, max_tokens=768,
            source="daemon:scanner",
        )
        if response:
            self.scanner_wakes += 1
            self._scanner.wakes_triggered += 1
            top_event = top[0]
            title = top_event.headline

            # Track pass streak + phantom creation
            if self.agent.last_chat_had_trade_tool():
                self._scanner_pass_streak = 0
                # Issue 5: auto-link matched playbooks to the trade entry
                if matched_playbooks:
                    self._link_playbooks_to_trade(matched_playbooks, top)
            else:
                self._scanner_pass_streak += 1
                # Phantom tracking: record what would have happened on this pass
                self._maybe_create_phantom(top_event, agent_response=response)

            log_event(DaemonEvent(
                "scanner", title,
                f"{len(top)} anomalies (top: {top_event.type} {top_event.symbol} sev={top_event.severity:.2f})",
            ))
            _queue_and_persist("Scanner", title, response, event_type="scanner")
            _notify_discord("Scanner", title, response)
            logger.info("Scanner wake: %d anomalies, agent responded (%d chars)",
                        len(top), len(response))
```

---

### Step 5.7: Add _link_playbooks_to_trade method to daemon

**File:** `src/hynous/intelligence/daemon.py`

Add this method anywhere in the `Daemon` class — recommended location: after `_wake_for_scanner()` (after line 1787).

**Insert after `_wake_for_scanner()` (after line 1787):**
```python
    def _link_playbooks_to_trade(self, matches: list, anomalies: list):
        """Background: link matched playbooks to the most recent trade entry.

        After the agent trades following a playbook match, create an
        `applied_to` edge from each matched playbook to the trade entry.
        This enables the feedback loop: on trade close, the system finds
        these edges and updates playbook success metrics.

        Runs in a background thread — cannot block the main daemon loop.
        """
        def _do_link():
            try:
                from ..nous.client import get_client
                client = get_client()
                # Collect symbols from anomalies (for matching entries)
                symbols = set(
                    a.symbol.upper() for a in anomalies if a.symbol != "MARKET"
                )
                # Fetch recent trade entries (newest first)
                entries = client.list_nodes(
                    subtype="custom:trade_entry", limit=5,
                )
                for match in matches:
                    sym = match.matched_symbol.upper()
                    for entry in entries:
                        title = entry.get("content_title", "").upper()
                        if sym in title:
                            try:
                                client.create_edge(
                                    source_id=match.playbook_id,
                                    target_id=entry["id"],
                                    type="applied_to",
                                )
                                logger.info(
                                    "Linked playbook %s → trade entry %s (%s)",
                                    match.playbook_id, entry["id"], sym,
                                )
                            except Exception as e:
                                logger.debug(
                                    "Playbook-trade edge failed: %s", e,
                                )
                            break  # Found the entry for this symbol
            except Exception as e:
                logger.debug("Playbook-trade linking failed: %s", e)

        threading.Thread(target=_do_link, daemon=True, name="hynous-pb-link").start()
```

---

### Step 5.8: Enhance STORE_TOOL_DEF for playbook type guidance

**File:** `src/hynous/intelligence/tools/memory.py`

Update the tool description to include playbook guidance, and extend the trigger parameter description to cover playbook triggers.

**Find this (lines 284-298):**
```python
    "description": (
        "Store something in your persistent memory. Include key context, reasoning, "
        "and numbers — be complete but not padded.\n\n"
        "Memory types:\n"
        "  episode — A specific event. \"BTC pumped 5% on a short squeeze.\"\n"
        "  lesson — A takeaway from experience or research.\n"
        "  thesis — Forward-looking conviction. What you believe will happen and why.\n"
        "  signal — Raw data snapshot. Numbers, not narrative.\n"
        "  watchpoint — An alert with trigger conditions. Include trigger object.\n"
        "  curiosity — A question to research later.\n"
        "  trade — Manual trade record.\n\n"
        "Use [[wikilinks]] in content to link to related memories: "
        "\"This confirms my [[funding rate thesis]].\" "
        "The system searches for matches and creates edges automatically.\n\n"
        "Lessons and curiosity items are checked for duplicates automatically."
    ),
```

**Replace with:**
```python
    "description": (
        "Store something in your persistent memory. Include key context, reasoning, "
        "and numbers — be complete but not padded.\n\n"
        "Memory types:\n"
        "  episode — A specific event. \"BTC pumped 5% on a short squeeze.\"\n"
        "  lesson — A takeaway from experience or research.\n"
        "  thesis — Forward-looking conviction. What you believe will happen and why.\n"
        "  signal — Raw data snapshot. Numbers, not narrative.\n"
        "  watchpoint — An alert with trigger conditions. Include trigger object.\n"
        "  curiosity — A question to research later.\n"
        "  trade — Manual trade record.\n"
        "  playbook — A validated trading pattern. Include trigger object for "
        "automatic matching when scanner detects similar conditions. Format: "
        "trigger={anomaly_types: [...], symbols: [...], min_severity: N, "
        "direction: 'long'|'short'|'either'}. Put conditions and action in content. "
        "Include success_count and sample_size in signals if known.\n\n"
        "Use [[wikilinks]] in content to link to related memories: "
        "\"This confirms my [[funding rate thesis]].\" "
        "The system searches for matches and creates edges automatically.\n\n"
        "Lessons and curiosity items are checked for duplicates automatically."
    ),
```

**Find this (lines 319-325):**
```python
            "trigger": {
                "type": "object",
                "description": (
                    "Watchpoints only. Conditions: price_below, price_above, funding_above, "
                    "funding_below, fear_greed_extreme. Requires symbol and value. "
                    "Optional expiry (ISO date, default 7 days)."
                ),
```

**Replace with:**
```python
            "trigger": {
                "type": "object",
                "description": (
                    "Watchpoints: price_below, price_above, funding_above, "
                    "funding_below, fear_greed_extreme. Requires symbol and value. "
                    "Optional expiry (ISO date, default 7 days).\n"
                    "Playbooks: {anomaly_types: [...], symbols: [...], "
                    "min_severity: float, direction: 'long'|'short'|'either'}. "
                    "Enables automatic matching when scanner detects matching conditions."
                ),
```

---

### Step 5.9: Add playbook body initialization in _store_memory_impl

**File:** `src/hynous/intelligence/tools/memory.py`

When storing a playbook, initialize `success_count`, `sample_size`, and `direction` in the JSON body. Also move playbook-specific fields from `signals` into the body structure if present.

**Find this (lines 457-466):**
```python
    # Build content_body — plain text for simple memories, JSON for watchpoints
    if trigger or signals:
        body_data: dict = {"text": content}
        if trigger:
            body_data["trigger"] = trigger
        if signals:
            body_data["signals_at_creation"] = signals
        body = json.dumps(body_data)
    else:
        body = content
```

**Replace with:**
```python
    # Build content_body — plain text for simple memories, JSON for structured types
    if trigger or signals or memory_type == "playbook":
        body_data: dict = {"text": content}
        if trigger:
            body_data["trigger"] = trigger
        if signals:
            body_data["signals_at_creation"] = signals
        # Playbook: initialize tracking fields for the matcher feedback loop
        if memory_type == "playbook":
            body_data.setdefault("success_count", 0)
            body_data.setdefault("sample_size", 0)
            body_data.setdefault("direction", "either")
            # Extract action and conditions from content if provided in signals
            if signals:
                if "action" in signals:
                    body_data["action"] = signals.pop("action")
                if "conditions" in signals:
                    body_data["conditions"] = signals.pop("conditions")
                if "direction" in signals:
                    body_data["direction"] = signals.pop("direction")
                if "success_count" in signals:
                    body_data["success_count"] = signals.pop("success_count")
                if "sample_size" in signals:
                    body_data["sample_size"] = signals.pop("sample_size")
        body = json.dumps(body_data)
    else:
        body = content
```

---

### Step 5.10: Add playbook feedback in handle_close_position

**File:** `src/hynous/intelligence/tools/trading.py`

After the Hebbian edge strengthening (line 1537), add a background task that checks if the entry node is linked to any playbook via `applied_to` edges and updates their success metrics.

**Find this (lines 1535-1537):**
```python
    # Hebbian: strengthen the trade lifecycle edge (MF-1)
    if close_node_id and entry_node_id:
        _strengthen_trade_edge(entry_node_id, close_node_id)
```

**Replace with:**
```python
    # Hebbian: strengthen the trade lifecycle edge (MF-1)
    if close_node_id and entry_node_id:
        _strengthen_trade_edge(entry_node_id, close_node_id)
        # Issue 5: update playbook metrics if this trade followed a playbook
        _update_playbook_metrics(entry_node_id, pnl_pct > 0)
```

**Insert after `_strengthen_trade_edge()` function (after line 1925):**
```python

def _update_playbook_metrics(entry_node_id: str, was_profitable: bool) -> None:
    """Update playbook success metrics after a trade close.

    Checks if the trade entry has incoming `applied_to` edges from
    playbook nodes (created by daemon._link_playbooks_to_trade when
    the agent trades following a playbook match). For each linked
    playbook, increments sample_size and optionally success_count.

    Runs in background thread to avoid blocking the tool response.
    """
    def _do_update():
        try:
            from ...nous.client import get_client
            client = get_client()
            edges = client.get_edges(entry_node_id, direction="in")
            for edge in edges:
                if edge.get("edge_type") != "applied_to":
                    continue
                pb_id = edge.get("source_id")
                if not pb_id:
                    continue
                pb_node = client.get_node(pb_id)
                if not pb_node or pb_node.get("content_subtype") != "custom:playbook":
                    continue

                # Parse body and update metrics
                body = pb_node.get("content_body", "")
                try:
                    data = json.loads(body)
                except (json.JSONDecodeError, TypeError):
                    continue

                data["sample_size"] = data.get("sample_size", 0) + 1
                if was_profitable:
                    data["success_count"] = data.get("success_count", 0) + 1

                from datetime import datetime, timezone
                data["last_applied"] = datetime.now(timezone.utc).isoformat()

                client.update_node(pb_id, content_body=json.dumps(data))

                # Hebbian: strengthen the applied_to edge (playbook validated)
                edge_id = edge.get("id")
                if edge_id and was_profitable:
                    client.strengthen_edge(edge_id, amount=0.10)

                logger.info(
                    "Playbook %s metrics updated: %d/%d (profitable: %s)",
                    pb_id, data.get("success_count", 0),
                    data["sample_size"], was_profitable,
                )
        except Exception as e:
            logger.debug("Playbook metrics update failed: %s", e)

    threading.Thread(target=_do_update, daemon=True, name="hynous-pb-metrics").start()
```

---

### Step 5.11: Extend consolidation engine for playbook promotion

**File:** `src/hynous/intelligence/consolidation.py` *(created by Issue 3)*

> **Prerequisite:** Issue 3 must be implemented first. This step modifies the `ConsolidationEngine` class defined in Issue 3's guide.

This extension modifies two parts of the consolidation engine:

1. **The LLM system prompt** — instructs Haiku to detect playbook-worthy patterns
2. **The knowledge creation logic** — creates `custom:playbook` nodes when patterns qualify

**Modify the `_CONSOLIDATION_SYSTEM` prompt constant** (defined in Issue 3 guide, near the top of consolidation.py).

**Find the last paragraph of `_CONSOLIDATION_SYSTEM` (exact text from Issue 3 guide):**
```python
If no cross-episode pattern exists, respond with: {"type": "none"}
"""
```

**Replace with:**
```python
If the pattern has clear trigger conditions (specific anomaly types like funding_extreme, \
oi_surge, price_spike, etc.) AND a success rate >= 70% across >= 8 trades, respond with \
type "playbook" instead of "lesson". Include structured trigger conditions:
{
  "type": "playbook",
  "title": "...",
  "summary": "...",
  "trigger": {
    "anomaly_types": ["funding_extreme"],
    "symbols": null,
    "min_severity": 0.5,
    "direction": "short"
  },
  "action": "Short with tight stop above range high, target 2:1 R:R",
  "conditions": ["Confirm with orderbook imbalance"],
  "success_count": N,
  "sample_size": M
}

If no cross-episode pattern exists, respond with: {"type": "none"}
"""
```

**Modify `_create_knowledge_node()` method** (defined in Issue 3 guide).

**Find the node creation section in `_create_knowledge_node()` (the `client.create_node()` call):**
```python
        node = client.create_node(
            type="concept",
            subtype="custom:lesson",
            title=analysis["title"],
            body=analysis["summary"],
        )
```

**Replace with:**
```python
        # Determine subtype: playbook for high-confidence patterns, lesson otherwise
        analysis_type = analysis.get("type", "lesson")
        if analysis_type == "playbook":
            subtype = "custom:playbook"
            # Build structured JSON body for playbook matcher
            body_data = {
                "text": analysis["summary"],
                "trigger": analysis.get("trigger"),
                "action": analysis.get("action", ""),
                "conditions": analysis.get("conditions", []),
                "direction": analysis.get("trigger", {}).get("direction", "either"),
                "success_count": analysis.get("success_count", 0),
                "sample_size": analysis.get("sample_size", 0),
            }
            body = json.dumps(body_data)
        else:
            subtype = "custom:lesson"
            body = analysis["summary"]

        node = client.create_node(
            type="concept",
            subtype=subtype,
            title=analysis["title"],
            body=body,
        )
```

**Add playbook cache invalidation after creation (in the same method, after the create_node call):**
```python
        # Invalidate playbook cache so the matcher picks up the new playbook
        if subtype == "custom:playbook":
            try:
                from ..intelligence.daemon import get_active_daemon
                daemon = get_active_daemon()
                if daemon and daemon._playbook_matcher:
                    daemon._playbook_matcher.invalidate_cache()
            except Exception:
                pass
```

---

### Step 5.12: Update system prompt for procedural memory awareness

**File:** `src/hynous/intelligence/prompts/builder.py`

Update "How My Memory Works" to mention playbook matching and the feedback loop.

**Find this (lines 173-177):**
```python
## How My Memory Works

My memory has semantic search, quality gates, dedup, and decay. Memories decay (ACTIVE → WEAK → DORMANT) — recalling strengthens them. When I need to revise a memory — correct information, append new data, change lifecycle — I use update_memory to edit it in place. I never store a duplicate to "update" something that already exists. Contradictions are queued for my review. Search by meaning, not keywords. Link related memories with [[wikilinks]]. Resolve conflicts promptly. My most valuable knowledge naturally rises through use.

Decay is two-way: the daemon runs FSRS every 6 hours and tells me when important memories (lessons, theses, playbooks) are fading. I review them, reinforce what still holds, and archive what doesn't. The spaced repetition only works if I close the loop."""
```

**Replace with:**
```python
## How My Memory Works

My memory has semantic search, quality gates, dedup, and decay. Memories decay (ACTIVE → WEAK → DORMANT) — recalling strengthens them. When I need to revise a memory — correct information, append new data, change lifecycle — I use update_memory to edit it in place. I never store a duplicate to "update" something that already exists. Contradictions are queued for my review. Search by meaning, not keywords. Link related memories with [[wikilinks]]. Resolve conflicts promptly. My most valuable knowledge naturally rises through use.

**Procedural memory (playbooks):** When the scanner fires, the system automatically matches anomalies against my stored playbook triggers and injects matching playbooks into my context. When I trade following a playbook, the system auto-links the playbook to my trade entry. After the trade closes, it updates the playbook's success metrics (success_count/sample_size). I store playbooks with structured triggers — `trigger={anomaly_types: [...], direction: 'long'|'short'}` — so the matcher can fire proactively. Playbooks without triggers still work via semantic search. My consolidation engine can also promote recurring winning patterns into formal playbooks in the background.

Decay is two-way: the daemon runs FSRS every 6 hours and tells me when important memories (lessons, theses, playbooks) are fading. I review them, reinforce what still holds, and archive what doesn't. The spaced repetition only works if I close the loop."""
```

---

## Testing

### Unit Tests

**File:** `tests/unit/test_playbook_matcher.py` **(NEW FILE)**

```python
"""Unit tests for PlaybookMatcher — Issue 5: Procedural Memory."""
import json
import pytest
from unittest.mock import patch, MagicMock
from dataclasses import dataclass


@dataclass
class MockAnomaly:
    """Minimal AnomalyEvent mock for testing."""
    type: str
    symbol: str
    severity: float
    headline: str = ""
    detail: str = ""
    fingerprint: str = ""
    detected_at: float = 0
    category: str = "macro"


class TestPlaybookMatch:
    """Test PlaybookMatch dataclass properties."""

    def test_success_rate_with_trades(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatch
        m = PlaybookMatch(
            playbook_id="pb1", title="Test", action="Short",
            direction="short", success_count=7, sample_size=10,
            matched_anomaly_type="funding_extreme",
            matched_symbol="BTC", severity=0.8,
        )
        assert m.success_rate == 0.7

    def test_success_rate_zero_sample(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatch
        m = PlaybookMatch(
            playbook_id="pb1", title="Test", action="Short",
            direction="short", success_count=0, sample_size=0,
            matched_anomaly_type="funding_extreme",
            matched_symbol="BTC", severity=0.8,
        )
        assert m.success_rate == 0.0

    def test_relevance_score_seasoned(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatch
        m = PlaybookMatch(
            playbook_id="pb1", title="Test", action="Short",
            direction="short", success_count=9, sample_size=12,
            matched_anomaly_type="funding_extreme",
            matched_symbol="BTC", severity=0.8,
        )
        # success_rate=0.75, severity=0.8, sample_weight=1.0
        assert abs(m.relevance_score - 0.6) < 0.01

    def test_relevance_score_new_playbook(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatch
        m = PlaybookMatch(
            playbook_id="pb1", title="Test", action="Short",
            direction="short", success_count=1, sample_size=1,
            matched_anomaly_type="funding_extreme",
            matched_symbol="BTC", severity=0.8,
        )
        # success_rate=1.0, severity=0.8, sample_weight=0.1
        assert abs(m.relevance_score - 0.08) < 0.01


class TestMatchLogic:
    """Test trigger matching without Nous dependency."""

    def test_anomaly_type_match(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        trigger = {"anomaly_types": ["funding_extreme", "oi_surge"]}
        anomaly = MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8)
        assert PlaybookMatcher._matches(trigger, anomaly) is True

    def test_anomaly_type_no_match(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        trigger = {"anomaly_types": ["funding_extreme"]}
        anomaly = MockAnomaly(type="price_spike", symbol="BTC", severity=0.8)
        assert PlaybookMatcher._matches(trigger, anomaly) is False

    def test_empty_anomaly_types(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        trigger = {"anomaly_types": []}
        anomaly = MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8)
        assert PlaybookMatcher._matches(trigger, anomaly) is False

    def test_symbol_filter_match(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        trigger = {"anomaly_types": ["funding_extreme"], "symbols": ["BTC", "ETH"]}
        anomaly = MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8)
        assert PlaybookMatcher._matches(trigger, anomaly) is True

    def test_symbol_filter_no_match(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        trigger = {"anomaly_types": ["funding_extreme"], "symbols": ["BTC", "ETH"]}
        anomaly = MockAnomaly(type="funding_extreme", symbol="SOL", severity=0.8)
        assert PlaybookMatcher._matches(trigger, anomaly) is False

    def test_symbol_filter_null_matches_any(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        trigger = {"anomaly_types": ["funding_extreme"], "symbols": None}
        anomaly = MockAnomaly(type="funding_extreme", symbol="DOGE", severity=0.8)
        assert PlaybookMatcher._matches(trigger, anomaly) is True

    def test_symbol_case_insensitive(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        trigger = {"anomaly_types": ["funding_extreme"], "symbols": ["btc"]}
        anomaly = MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8)
        assert PlaybookMatcher._matches(trigger, anomaly) is True

    def test_severity_floor_pass(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        trigger = {"anomaly_types": ["funding_extreme"], "min_severity": 0.5}
        anomaly = MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8)
        assert PlaybookMatcher._matches(trigger, anomaly) is True

    def test_severity_floor_fail(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        trigger = {"anomaly_types": ["funding_extreme"], "min_severity": 0.9}
        anomaly = MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.7)
        assert PlaybookMatcher._matches(trigger, anomaly) is False

    def test_severity_floor_default_zero(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        trigger = {"anomaly_types": ["funding_extreme"]}
        anomaly = MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.1)
        assert PlaybookMatcher._matches(trigger, anomaly) is True


class TestFindMatching:
    """Test the full find_matching pipeline with mocked Nous."""

    def _make_playbook_node(self, node_id, title, trigger, action="", direction="either",
                            success_count=0, sample_size=0):
        body = json.dumps({
            "text": title,
            "trigger": trigger,
            "action": action,
            "direction": direction,
            "success_count": success_count,
            "sample_size": sample_size,
        })
        return {
            "id": node_id,
            "content_title": title,
            "content_body": body,
            "content_subtype": "custom:playbook",
        }

    @patch("hynous.intelligence.playbook_matcher.PlaybookMatcher._get_cached_playbooks")
    def test_single_match(self, mock_cache):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        pb = self._make_playbook_node(
            "pb1", "Funding Fade",
            {"anomaly_types": ["funding_extreme"]},
            action="Short with tight stop",
            direction="short", success_count=9, sample_size=12,
        )
        # Simulate cached playbooks (already parsed)
        pb["_parsed_trigger"] = {"anomaly_types": ["funding_extreme"]}
        pb["_action"] = "Short with tight stop"
        pb["_direction"] = "short"
        pb["_success_count"] = 9
        pb["_sample_size"] = 12
        mock_cache.return_value = [pb]

        matcher = PlaybookMatcher()
        anomalies = [MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8)]
        matches = matcher.find_matching(anomalies)

        assert len(matches) == 1
        assert matches[0].playbook_id == "pb1"
        assert matches[0].success_count == 9
        assert matches[0].matched_symbol == "BTC"

    @patch("hynous.intelligence.playbook_matcher.PlaybookMatcher._get_cached_playbooks")
    def test_no_match(self, mock_cache):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        pb = self._make_playbook_node(
            "pb1", "Funding Fade",
            {"anomaly_types": ["funding_extreme"]},
        )
        pb["_parsed_trigger"] = {"anomaly_types": ["funding_extreme"]}
        pb["_action"] = ""
        pb["_direction"] = "either"
        pb["_success_count"] = 0
        pb["_sample_size"] = 0
        mock_cache.return_value = [pb]

        matcher = PlaybookMatcher()
        anomalies = [MockAnomaly(type="price_spike", symbol="BTC", severity=0.8)]
        matches = matcher.find_matching(anomalies)

        assert len(matches) == 0

    @patch("hynous.intelligence.playbook_matcher.PlaybookMatcher._get_cached_playbooks")
    def test_manual_playbook_skipped(self, mock_cache):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        pb = {"id": "pb1", "content_title": "Manual", "content_body": "plain text",
              "_parsed_trigger": None, "_action": "", "_direction": "either",
              "_success_count": 0, "_sample_size": 0}
        mock_cache.return_value = [pb]

        matcher = PlaybookMatcher()
        anomalies = [MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8)]
        matches = matcher.find_matching(anomalies)

        assert len(matches) == 0

    @patch("hynous.intelligence.playbook_matcher.PlaybookMatcher._get_cached_playbooks")
    def test_sorted_by_relevance(self, mock_cache):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        # Seasoned playbook (9/12, 75%)
        pb1 = {"id": "pb1", "content_title": "Seasoned",
               "_parsed_trigger": {"anomaly_types": ["funding_extreme"]},
               "_action": "Short", "_direction": "short",
               "_success_count": 9, "_sample_size": 12}
        # New playbook (1/1, 100% but low sample weight)
        pb2 = {"id": "pb2", "content_title": "New",
               "_parsed_trigger": {"anomaly_types": ["funding_extreme"]},
               "_action": "Short", "_direction": "short",
               "_success_count": 1, "_sample_size": 1}
        mock_cache.return_value = [pb2, pb1]  # Deliberately reversed

        matcher = PlaybookMatcher()
        anomalies = [MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8)]
        matches = matcher.find_matching(anomalies)

        assert len(matches) == 2
        assert matches[0].playbook_id == "pb1"  # Seasoned ranks higher


class TestFormatMatches:
    """Test wake message formatting."""

    def test_format_single_match(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher, PlaybookMatch
        match = PlaybookMatch(
            playbook_id="pb1", title="Funding Fade",
            action="Short with tight stop", direction="short",
            success_count=9, sample_size=12,
            matched_anomaly_type="funding_extreme",
            matched_symbol="BTC", severity=0.8,
        )
        result = PlaybookMatcher.format_matches([match])
        assert "[Matching Playbooks]" in result
        assert "Funding Fade" in result
        assert "75%" in result
        assert "9/12" in result
        assert "SHORT" in result
        assert "pb1" in result

    def test_format_empty(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        result = PlaybookMatcher.format_matches([])
        assert result == ""


class TestCacheLoading:
    """Test Nous integration for cache loading."""

    @patch("hynous.nous.client.get_client")
    def test_cache_loads_and_parses(self, mock_get_client):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        mock_client = MagicMock()
        mock_client.list_nodes.return_value = [{
            "id": "pb1",
            "content_title": "Test",
            "content_body": json.dumps({
                "text": "desc",
                "trigger": {"anomaly_types": ["funding_extreme"]},
                "action": "Short",
                "direction": "short",
                "success_count": 5,
                "sample_size": 8,
            }),
        }]
        mock_get_client.return_value = mock_client

        matcher = PlaybookMatcher(cache_ttl=0)  # Disable caching for test
        playbooks = matcher._get_cached_playbooks()

        assert len(playbooks) == 1
        assert playbooks[0]["_parsed_trigger"] == {"anomaly_types": ["funding_extreme"]}
        assert playbooks[0]["_success_count"] == 5

    @patch("hynous.nous.client.get_client")
    def test_cache_returns_stale_on_error(self, mock_get_client):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        matcher = PlaybookMatcher(cache_ttl=0)
        matcher._cache = [{"id": "stale", "_parsed_trigger": None, "_action": "",
                           "_direction": "either", "_success_count": 0, "_sample_size": 0}]

        mock_get_client.side_effect = Exception("Nous down")
        playbooks = matcher._get_cached_playbooks()

        assert len(playbooks) == 1
        assert playbooks[0]["id"] == "stale"

    def test_invalidate_cache(self):
        from hynous.intelligence.playbook_matcher import PlaybookMatcher
        matcher = PlaybookMatcher(cache_ttl=3600)
        matcher._cache_time = 9999999999  # Far future
        matcher.invalidate_cache()
        assert matcher._cache_time == 0
```

**Test count:** 18 unit tests covering:
- `PlaybookMatch` properties (success_rate, relevance_score): 4 tests
- Trigger matching logic (type match, symbol filter, severity floor, edge cases): 8 tests
- `find_matching()` pipeline (single match, no match, manual skip, sorting): 4 tests
- Message formatting: 2 tests
- Cache loading (Nous integration, error handling, invalidation): 3 tests → wait that's 21. Let me recount... 4 + 8 + 4 + 2 + 3 = 21.

### Integration Tests

**File:** `tests/integration/test_playbook_integration.py`

These tests verify the full pipeline: scanner anomaly → playbook match → message formatting → (mock) agent wake.

```python
"""Integration tests for playbook matching in the daemon wake pipeline."""
import json
import pytest
from unittest.mock import patch, MagicMock
from dataclasses import dataclass


@dataclass
class MockAnomaly:
    type: str
    symbol: str
    severity: float
    headline: str = ""
    detail: str = ""
    fingerprint: str = ""
    detected_at: float = 0
    category: str = "macro"


class TestPlaybookWakePipeline:
    """Test the full pipeline from anomaly detection to playbook-enriched wake message."""

    @patch("hynous.nous.client.get_client")
    def test_playbook_injected_into_wake_message(self, mock_get_client):
        """Playbook context should appear in the wake message when a match is found."""
        from hynous.intelligence.playbook_matcher import PlaybookMatcher

        mock_client = MagicMock()
        mock_client.list_nodes.return_value = [{
            "id": "pb-funding-fade",
            "content_title": "Funding Fade Short",
            "content_body": json.dumps({
                "text": "Short when funding is extreme",
                "trigger": {"anomaly_types": ["funding_extreme"]},
                "action": "Short with tight stop above range high",
                "direction": "short",
                "success_count": 9,
                "sample_size": 12,
            }),
        }]
        mock_get_client.return_value = mock_client

        matcher = PlaybookMatcher(cache_ttl=0)
        anomalies = [
            MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8,
                        headline="BTC funding extreme (0.15%/8h)"),
        ]
        matches = matcher.find_matching(anomalies)
        assert len(matches) == 1

        # Format and verify injection
        from hynous.intelligence.scanner import format_scanner_wake
        base_message = format_scanner_wake(anomalies)
        playbook_section = PlaybookMatcher.format_matches(matches)
        full_message = base_message + "\n\n" + playbook_section

        assert "[Matching Playbooks]" in full_message
        assert "Funding Fade Short" in full_message
        assert "75%" in full_message
        assert "9/12" in full_message

    @patch("hynous.nous.client.get_client")
    def test_no_playbook_when_no_match(self, mock_get_client):
        """Wake message should be unchanged when no playbook matches."""
        from hynous.intelligence.playbook_matcher import PlaybookMatcher

        mock_client = MagicMock()
        mock_client.list_nodes.return_value = [{
            "id": "pb1",
            "content_title": "OI Surge Long",
            "content_body": json.dumps({
                "text": "Long when OI surges",
                "trigger": {"anomaly_types": ["oi_surge"]},
            }),
        }]
        mock_get_client.return_value = mock_client

        matcher = PlaybookMatcher(cache_ttl=0)
        # Anomaly is funding_extreme, playbook is for oi_surge — no match
        anomalies = [MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8)]
        matches = matcher.find_matching(anomalies)
        assert len(matches) == 0

    @patch("hynous.nous.client.get_client")
    def test_multiple_playbooks_sorted(self, mock_get_client):
        """Multiple matching playbooks should be sorted by relevance."""
        from hynous.intelligence.playbook_matcher import PlaybookMatcher

        mock_client = MagicMock()
        mock_client.list_nodes.return_value = [
            {
                "id": "pb-new",
                "content_title": "New Pattern",
                "content_body": json.dumps({
                    "text": "Fresh pattern",
                    "trigger": {"anomaly_types": ["funding_extreme"]},
                    "success_count": 1, "sample_size": 1,
                }),
            },
            {
                "id": "pb-seasoned",
                "content_title": "Seasoned Pattern",
                "content_body": json.dumps({
                    "text": "Proven pattern",
                    "trigger": {"anomaly_types": ["funding_extreme"]},
                    "success_count": 15, "sample_size": 20,
                }),
            },
        ]
        mock_get_client.return_value = mock_client

        matcher = PlaybookMatcher(cache_ttl=0)
        anomalies = [MockAnomaly(type="funding_extreme", symbol="BTC", severity=0.8)]
        matches = matcher.find_matching(anomalies)

        assert len(matches) == 2
        assert matches[0].playbook_id == "pb-seasoned"  # Higher relevance
        assert matches[1].playbook_id == "pb-new"
```

### Live Dynamic Tests (Local)

Run a local Nous server and verify end-to-end:

```bash
# 1. Start local Nous server
cd nous-server && pnpm run dev

# 2. Create a playbook node with structured trigger
curl -X POST http://localhost:3100/v1/nodes -H 'Content-Type: application/json' -d '{
  "type": "concept",
  "subtype": "custom:playbook",
  "content_title": "Funding Fade Short",
  "content_body": "{\"text\":\"When funding is extreme, the market is crowded. Short with tight stop.\",\"trigger\":{\"anomaly_types\":[\"funding_extreme\"],\"symbols\":null,\"min_severity\":0.5},\"action\":\"Short with tight stop above range high, target 2:1 R:R\",\"direction\":\"short\",\"success_count\":9,\"sample_size\":12}"
}'
# Expected: 201 with node ID

# 3. Verify the node is loadable
curl 'http://localhost:3100/v1/nodes?subtype=custom:playbook&lifecycle=ACTIVE&limit=10'
# Expected: list including the playbook with parsed content_body

# 4. Run the PlaybookMatcher in a Python REPL
python3 -c "
import os; os.environ['NOUS_URL'] = 'http://localhost:3100'
from hynous.intelligence.playbook_matcher import PlaybookMatcher
from dataclasses import dataclass

@dataclass
class MockAnomaly:
    type: str; symbol: str; severity: float
    headline: str = ''; detail: str = ''; fingerprint: str = ''
    detected_at: float = 0; category: str = 'macro'

matcher = PlaybookMatcher(cache_ttl=0)
anomalies = [MockAnomaly(type='funding_extreme', symbol='BTC', severity=0.8)]
matches = matcher.find_matching(anomalies)
print(f'Matches: {len(matches)}')
for m in matches:
    print(f'  {m.title} — {m.success_rate:.0%} ({m.success_count}/{m.sample_size})')
    print(f'  Triggered by: {m.matched_anomaly_type} on {m.matched_symbol}')
print()
print(PlaybookMatcher.format_matches(matches))
"
# Expected: 1 match — "Funding Fade Short" with 75% (9/12)

# 5. Test with non-matching anomaly
python3 -c "
import os; os.environ['NOUS_URL'] = 'http://localhost:3100'
from hynous.intelligence.playbook_matcher import PlaybookMatcher
from dataclasses import dataclass
@dataclass
class MockAnomaly:
    type: str; symbol: str; severity: float
    headline: str = ''; detail: str = ''; fingerprint: str = ''
    detected_at: float = 0; category: str = 'macro'

matcher = PlaybookMatcher(cache_ttl=0)
anomalies = [MockAnomaly(type='price_spike', symbol='SOL', severity=0.9)]
matches = matcher.find_matching(anomalies)
print(f'Matches: {len(matches)}')
"
# Expected: 0 matches (price_spike not in trigger anomaly_types)

# 6. Create applied_to edge and verify feedback loop
# First create a trade entry node
ENTRY_ID=$(curl -s -X POST http://localhost:3100/v1/nodes -H 'Content-Type: application/json' -d '{
  "type": "concept",
  "subtype": "custom:trade_entry",
  "content_title": "SHORT BTC @ 95000"
}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Entry ID: $ENTRY_ID"

# Get playbook ID
PB_ID=$(curl -s 'http://localhost:3100/v1/nodes?subtype=custom:playbook&limit=1' | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['id'])")
echo "Playbook ID: $PB_ID"

# Create applied_to edge
curl -X POST http://localhost:3100/v1/edges -H 'Content-Type: application/json' -d "{
  \"source_id\": \"$PB_ID\",
  \"target_id\": \"$ENTRY_ID\",
  \"type\": \"applied_to\"
}"
# Expected: 201 with edge ID

# Verify edge exists
curl "http://localhost:3100/v1/edges?node_id=$ENTRY_ID&direction=in"
# Expected: edge with source_id = PB_ID, edge_type = "applied_to"
```

### Live Dynamic Tests (VPS)

```bash
# 1. Check if any existing playbook nodes exist
curl 'https://nous.yourdomain.com/v1/nodes?subtype=custom:playbook&lifecycle=ACTIVE&limit=10'
# Note: replace with actual Nous URL

# 2. If playbooks exist, verify their content_body has parseable JSON
# Look for "trigger" field in content_body

# 3. Check if applied_to edge type works with SSA
# (Requires Nous rebuild with Step 5.1 changes)
cd nous-server/core && npx tsup
# Restart Nous server
sudo systemctl restart nous

# 4. Verify the new edge weight is loaded
curl 'https://nous.yourdomain.com/health'
# Check that response includes SSA params (or just verify no startup errors)

# 5. Run unit tests
cd /path/to/hynous && PYTHONPATH=src python -m pytest tests/unit/test_playbook_matcher.py -v
```

---

## Verification Checklist

| # | Check | How to Verify |
|---|-------|---------------|
| 1 | `PlaybookMatcher` class exists and is importable | `python -c "from hynous.intelligence.playbook_matcher import PlaybookMatcher"` |
| 2 | Trigger matching: anomaly_type match | Unit test `test_anomaly_type_match` passes |
| 3 | Trigger matching: symbol filter (match, no match, null) | Unit tests `test_symbol_filter_*` pass |
| 4 | Trigger matching: severity floor (pass, fail, default) | Unit tests `test_severity_floor_*` pass |
| 5 | Cache loading parses JSON content_body correctly | Unit test `test_cache_loads_and_parses` passes |
| 6 | Cache returns stale data on Nous error | Unit test `test_cache_returns_stale_on_error` passes |
| 7 | `invalidate_cache()` resets cache timer | Unit test `test_invalidate_cache` passes |
| 8 | Matches sorted by `relevance_score` descending | Unit test `test_sorted_by_relevance` passes |
| 9 | Manual playbooks (no trigger) are skipped | Unit test `test_manual_playbook_skipped` passes |
| 10 | `format_matches()` produces `[Matching Playbooks]` section | Unit test `test_format_single_match` passes |
| 11 | Daemon `__init__` creates `_playbook_matcher` when scanner enabled | Read daemon.py, verify initialization code |
| 12 | `_wake_for_scanner()` calls `find_matching()` and appends context | Read daemon.py, verify injection block |
| 13 | `_wake_for_scanner()` auto-links playbooks to trade entry after trade | Read daemon.py, verify `_link_playbooks_to_trade` call |
| 14 | `_link_playbooks_to_trade()` runs in background thread | Verify `threading.Thread` with `daemon=True` |
| 15 | `STORE_TOOL_DEF` description includes playbook guidance | Read memory.py, verify description text |
| 16 | `_store_memory_impl()` initializes playbook body with success_count/sample_size | Read memory.py, verify body initialization |
| 17 | `handle_close_position()` calls `_update_playbook_metrics()` | Read trading.py, verify call after Hebbian strengthening |
| 18 | `_update_playbook_metrics()` increments success_count on profitable close | Read trading.py, verify logic |
| 19 | `_update_playbook_metrics()` strengthens applied_to edge on profitable close | Read trading.py, verify Hebbian call |
| 20 | `applied_to` edge in `SSA_EDGE_WEIGHTS` with weight 0.75 | Read params/index.ts, verify constant |
| 21 | `SSAEdgeWeights` interface includes `applied_to: number` | Read params/index.ts, verify interface |
| 22 | `SSAEdgeWeightsSchema` includes `applied_to` validation | Read params/index.ts, verify schema |
| 23 | `DaemonConfig.playbook_cache_ttl` exists with default 1800 | Read config.py, verify field |
| 24 | `default.yaml` has `playbook_cache_ttl: 1800` | Read default.yaml, verify value |
| 25 | System prompt mentions procedural memory and playbook matching | Read builder.py, verify "How My Memory Works" section |
| 26 | Nous TypeScript builds successfully after edge weight change | `cd nous-server/core && npx tsup` succeeds |
| 27 | All 21 unit tests pass | `PYTHONPATH=src python -m pytest tests/unit/test_playbook_matcher.py -v` |
| 28 | Integration tests pass | `PYTHONPATH=src python -m pytest tests/integration/test_playbook_integration.py -v` |
| 29 | Live local: playbook node created and matcher finds it | Manual curl + Python REPL test |
| 30 | Live local: applied_to edge created and readable | Manual curl test |

---

## File Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/hynous/intelligence/playbook_matcher.py` | **NEW** | `PlaybookMatcher` class: cache loading, trigger matching, format output (~210 lines) |
| `nous-server/core/src/params/index.ts` | Modified | Add `applied_to: 0.75` (and `generalizes: 0.70` if not present) to `SSAEdgeWeights` interface + schema + constant (~6 lines) |
| `src/hynous/core/config.py` | Modified | Add `playbook_cache_ttl: int = 1800` to `DaemonConfig` (+2 lines) |
| `config/default.yaml` | Modified | Add `playbook_cache_ttl: 1800` to daemon section (+1 line) |
| `src/hynous/intelligence/daemon.py` | Modified | Add `_playbook_matcher` init, playbook matching in `_wake_for_scanner()`, auto-linking `_link_playbooks_to_trade()` method (~55 lines) |
| `src/hynous/intelligence/tools/memory.py` | Modified | Enhance `STORE_TOOL_DEF` description for playbooks, add body initialization in `_store_memory_impl()` (~20 lines) |
| `src/hynous/intelligence/tools/trading.py` | Modified | Add `_update_playbook_metrics()` function + call in `handle_close_position()` (~50 lines) |
| `src/hynous/intelligence/consolidation.py` | Modified | Extend `_CONSOLIDATION_SYSTEM` prompt and `_create_knowledge_node()` for playbook promotion (~25 lines) |
| `src/hynous/intelligence/prompts/builder.py` | Modified | Add procedural memory paragraph to "How My Memory Works" (+3 lines) |
| `tests/unit/test_playbook_matcher.py` | **NEW** | 21 unit tests for PlaybookMatcher (~280 lines) |
| `tests/integration/test_playbook_integration.py` | **NEW** | 3 integration tests for wake pipeline (~90 lines) |

**Total new code:** ~210 lines (`playbook_matcher.py`) + ~370 lines (tests) = ~580 lines
**Total modified:** ~160 lines across 7 existing files
**Schema changes:** None (no database migration)
**API changes:** None (uses existing Nous endpoints)
**New edge type:** `applied_to` (SSA weight 0.75)
**New config:** `daemon.playbook_cache_ttl` (default 1800s)

---

## What Comes Next

After this guide, the system has a complete procedural memory subsystem:
- **Creation:** Agent manually stores playbooks (with structured triggers) after winning trades. Consolidation engine automatically promotes high-confidence patterns.
- **Retrieval:** PlaybookMatcher fires proactively on scanner wakes. SSA semantic search works for explicit queries.
- **Feedback:** Success metrics auto-update on trade close. Hebbian strengthening on `applied_to` edges. FSRS with 180-day base stability (most durable subtype).
- **Decay resistance:** Procedural section has growth_rate=3.5, active_threshold=0.3, max_stability_days=365. Validated playbooks become nearly permanent.

With all 7 guides complete (Issues 0-6), the memory sections system is fully specified. Implementation should follow the dependency order:

```
Issue 0: Section Foundation
  ↓
Issue 1: Per-Section Retrieval Weights  }  (independent of each other)
Issue 2: Per-Section Decay Curves       }
  ↓
Issue 4: Stakes Weighting (depends on Issue 0)
Issue 6: Section-Aware Retrieval Bias (depends on Issues 0 + 1)
  ↓
Issue 3: Cross-Episode Generalization (depends on Issues 0 + 2)
  ↓
Issue 5: Procedural Memory (depends on Issues 0 + 3)
```
