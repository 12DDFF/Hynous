# Issue 4: Stakes Weighting — Implementation Guide

> **STATUS:** DONE
>
> **Depends on:** Issue 0 (Section Foundation) — provides `SECTION_PROFILES` with per-section `SectionEncodingConfig` (`salience_enabled`, `max_salience_multiplier`, `base_difficulty`), `SUBTYPE_INITIAL_STABILITY` with per-subtype base stability values, and `get_initial_stability_for_subtype()` for lookups. Issue 2 (Per-Section Decay Curves) must also be implemented first — it makes `getNeuralDefaults()` use the section-aware initial stability from Issue 0, which this guide then overrides with salience-modulated values.
>
> **What this changes:** Every memory currently encodes with the same FSRS initial stability for its subtype — a catastrophic 20% loss creates a `trade_close` node with the same 21-day stability as a routine position exit. After this guide, a **salience score** calculated from trade metadata (PnL magnitude, confidence, rarity) modulates the initial stability at creation time. High-stakes events encode 2-3× more strongly; routine observations may encode with reduced stability. This happens at the Python layer before calling `create_node()`, and the Nous server accepts the pre-calculated stability override.

---

## Problem Statement

The agent's memory system treats all events as equally important at encoding time. When `_store_to_nous()` or `_store_memory_impl()` creates a node, the initial stability comes from `getNeuralDefaults()` which looks up the subtype → section → stability chain from Issue 0/2. There is **no mechanism to amplify encoding based on the event's significance**.

Consider the real impact:

**A -20% drawdown trade** creates a `custom:trade_close` node with 21-day initial stability — the same as a routine +0.5% scalp. The circumstances that led to the loss, the thesis that was wrong, the signals that were ignored — all of this decays at the same rate as trivial outcomes. In 3 weeks, both memories have equal retrievability.

**A +50% exceptional trade** where the thesis played out perfectly also gets the same 21-day stability. This trade validates a pattern worth repeating, but the memory decays identically to one where the agent broke even.

**A missed opportunity** (phantom tracker hit TP at +15%) has enormous educational value — the agent should vividly remember the setup it passed on. Currently it gets the same `custom:missed_opportunity` stability as one where the phantom barely moved.

The brain handles this through the amygdala — emotional arousal amplifies hippocampal encoding. Fear, surprise, and reward all produce stronger, more durable memories. This guide implements the computational equivalent: a **salience score** derived from trade metadata that modulates initial stability at creation time.

**What this guide does:**
1. Adds `calculate_salience()` and `modulate_stability()` to the Python sections module
2. Adds a `neural_stability` override parameter to `NousClient.create_node()`
3. Modifies `POST /nodes` in Nous to accept the optional stability override
4. Wires salience calculation into `_store_to_nous()` (trade memories) and `_store_memory_impl()` (agent memories)
5. All daemon-created memories (SL/TP fills, phantom outcomes) also get salience modulation

---

## Required Reading

Read these files **in order** before implementing. The "Focus Areas" column tells you exactly which parts matter.

### Foundation (read first)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 1 | `revisions/memory-sections/executive-summary.md` | Theory document. "Issue 4: No Emotional / Stakes Weighting" (lines 237-268) defines the problem and salience components. | Lines 237-268 (Issue 4 section), lines 406-424 (Proposed Section Model — encoding modulation) |
| 2 | `revisions/memory-sections/issue-0-section-foundation.md` | Foundation guide. Defines `SectionEncodingConfig` (salience_enabled, max_salience_multiplier, base_difficulty), `SUBTYPE_INITIAL_STABILITY`, and `get_initial_stability_for_subtype()`. | `SectionEncodingConfig` (lines 213-220), `SECTION_PROFILES` encoding values (lines 275-279, 302-306, 329-333, 356-360), `SUBTYPE_INITIAL_STABILITY` (lines 426-449), `get_initial_stability_for_subtype()` (lines 455-461), Python `sections.py` mirror (lines 708-724, 865-899) |
| 3 | `revisions/memory-sections/issue-2-decay-curves.md` | Decay curves guide. After Issue 2, `getNeuralDefaults()` uses `getInitialStabilityForSubtype()` instead of the generic `getInitialStability()`. This guide's stability override takes precedence over that default. | Skim Step 2.2 (`getNeuralDefaults` modification) |

### Python Memory Storage Pipeline (the files you will modify)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 4 | `src/hynous/nous/sections.py` | **PRIMARY MODIFICATION TARGET.** The Python sections module. You will add `calculate_salience()` and `modulate_stability()` functions here. | Full file (308 lines) — especially `SectionEncodingConfig` (lines 126-131), `SECTION_PROFILES` encoding values (lines 185-188, 205-208, 225-228, 245-248), `get_initial_stability_for_subtype()` (lines 299-307) |
| 5 | `src/hynous/nous/client.py` | **MODIFICATION TARGET.** The Python HTTP client for Nous. You will add `neural_stability` to `create_node()`. | Lines 61-88 (`create_node()` method — currently no neural_stability parameter) |
| 6 | `src/hynous/intelligence/tools/trading.py` | **PRIMARY MODIFICATION TARGET.** All trade memory creation flows through `_store_to_nous()` (lines 1007-1081). You will add salience calculation there. Also read `_store_trade_memory()` (lines 1112-1206) and `handle_close_position()` (lines 1489-1515, signals dict with PnL data). | `_store_to_nous()` (lines 1007-1081), `_store_trade_memory()` (lines 1112-1206 — entry signals), handle_close_position signals dict (lines 1495-1512 — close signals with PnL data) |
| 7 | `src/hynous/intelligence/tools/memory.py` | **MODIFICATION TARGET.** The general memory storage pipeline. `_store_memory_impl()` (lines 394-639) creates nodes via `client.create_node()`. You will add optional salience calculation for eligible types. | Lines 394-555 (`_store_memory_impl()` — especially the `client.create_node()` call at lines 546-555), Lines 255-275 (`_TYPE_MAP`) |
| 8 | `src/hynous/intelligence/daemon.py` | **MODIFICATION TARGET.** `_record_trigger_close()` (lines 1211-1286) creates trade_close memories for daemon SL/TP fills. Phantom outcome storage at lines 2102-2124. Both need salience. | Lines 1211-1286 (`_record_trigger_close()`), Lines 2090-2124 (phantom result storage) |

### TypeScript Server (minimal changes)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 9 | `nous-server/server/src/routes/nodes.ts` | **MODIFICATION TARGET.** The `POST /nodes` handler (lines 24-127). Currently always uses `getNeuralDefaults()`. You will add an optional `neural_stability` override from the request body. | Lines 24-56 (POST handler — destructuring, getNeuralDefaults call, INSERT) |
| 10 | `nous-server/server/src/core-bridge.ts` | Reference only. `getNeuralDefaults()` (lines 166-177) returns the section-aware defaults (after Issue 2). The override in POST /nodes replaces `neural.neural_stability` when the Python side passes a salience-modulated value. | Lines 166-177 (getNeuralDefaults) |

### Existing Tests (understand patterns)

| # | File | Why | Focus Areas |
|---|------|-----|-------------|
| 11 | `tests/unit/test_sections.py` | Existing section tests from Issue 0. You will add salience calculation tests here. | Full file — test class patterns, especially `TestInitialStability` |

---

## Architecture Decisions

### Decision 1: Salience is calculated Python-side, passed as a stability override to Nous (FINAL)

The Python layer has access to trade metadata (PnL, confidence, position size) that the TypeScript server does not. Rather than sending all trade metadata to Nous and having it calculate salience, we calculate salience in Python and send the final `neural_stability` value as an override.

**Rationale:**
- The Nous server is memory-agnostic — it doesn't know about trading concepts. Keeping salience logic in Python maintains this separation.
- The Python side already has all the data: `_store_to_nous()` receives a `signals` dict with PnL, confidence, size, etc.
- The override is a single float — minimal API surface change.

### Decision 2: Salience only applies when `salience_enabled=True` for the section (FINAL)

The `SectionEncodingConfig` from Issue 0 has a `salience_enabled` flag per section:
- **EPISODIC:** `salience_enabled=True` — trade outcomes should encode differently by stakes
- **SIGNALS:** `salience_enabled=False` — market signals are transient; PnL isn't relevant
- **KNOWLEDGE:** `salience_enabled=True` — lessons from high-stakes events should be more durable
- **PROCEDURAL:** `salience_enabled=True` — playbooks validated by large wins/losses should be more durable

When `salience_enabled=False`, the function returns 0.5 (neutral salience = no modulation = base stability unchanged).

### Decision 3: The salience formula uses PnL magnitude as the primary signal (FINAL)

| Subtype | Primary Signal | Secondary Signal | Formula |
|---------|---------------|-----------------|---------|
| `trade_close` | `abs(pnl_pct)` | `loss_boost` (losses encode 15% stronger) | `0.3 + min(1.0, abs(pnl_pct)/10) * 0.55 + (0.15 if loss)` |
| `trade_entry` | `confidence` | `rr_ratio` | `0.3 + confidence * 0.5 + min(1.0, rr_ratio/3) * 0.2` |
| `trade_modify` | `abs(pnl_pct)` if present | — | Same as trade_close or 0.5 if no PnL |
| `missed_opportunity` | `abs(pnl_pct)` | — | `0.3 + min(1.0, abs(pnl_pct)/10) * 0.7` |
| `good_pass` | `abs(pnl_pct)` | — | `0.3 + min(1.0, abs(pnl_pct)/10) * 0.7` |
| Other (salience_enabled) | 0.5 | — | Neutral — base stability unchanged |

10% price move = maximum PnL magnitude score. This is calibrated for crypto where 5-10% moves are significant. The `loss_boost` of +0.15 encodes losses more strongly than equivalent wins — matching the brain's negativity bias (losses hurt 2× more than equivalent gains feel good).

### Decision 4: Stability modulation is a linear interpolation (FINAL)

```
Given:
  base_stability = get_initial_stability_for_subtype(subtype)
  salience = calculate_salience(subtype, signals)
  max_mult = section.encoding.max_salience_multiplier

When salience >= 0.5 (amplify):
  t = (salience - 0.5) / 0.5
  multiplier = 1.0 + t * (max_mult - 1.0)

When salience < 0.5 (reduce):
  t = salience / 0.5
  multiplier = 0.2 + t * 0.8

modulated_stability = base_stability * multiplier
```

Examples for `trade_close` (EPISODIC section, base=21 days, max_mult=2.0):

| PnL | Salience | Multiplier | Final Stability |
|-----|----------|------------|-----------------|
| +0.5% (routine) | 0.33 | 0.73× | 15.3 days |
| +2% (normal win) | 0.41 | 0.86× | 18.0 days |
| +5% (good win) | 0.58 | 1.16× | 24.4 days |
| -5% (notable loss) | 0.73 | 1.46× | 30.6 days |
| +10% (exceptional) | 0.85 | 1.70× | 35.7 days |
| -10% (catastrophic) | 1.00 | 2.00× | 42.0 days |

A catastrophic loss encodes with 2× the base stability — it takes twice as long to decay to the same retrievability as a routine trade. This is the "amygdala amplification" effect.

### Decision 5: The `neural_stability` override is optional and additive (FINAL)

When `client.create_node()` receives `neural_stability`, it's included in the POST body. The Nous server uses it instead of the default from `getNeuralDefaults()`. When not provided, behavior is unchanged. This makes the feature backward-compatible — existing code that doesn't pass `neural_stability` works exactly as before.

---

## Implementation Steps

### Step 4.1: Add salience calculation functions to Python sections module

**File:** `src/hynous/nous/sections.py`

**Find this** (at the end of the file, after `get_initial_stability_for_subtype()`):
```python
def get_initial_stability_for_subtype(subtype: str | None) -> float:
    """Get initial stability for a specific subtype (in days).

    Falls back to section default, then to 21 days (global fallback).
    """
    if subtype and subtype in SUBTYPE_INITIAL_STABILITY:
        return SUBTYPE_INITIAL_STABILITY[subtype]
    section = get_section_for_subtype(subtype)
    return SECTION_PROFILES[section].decay.initial_stability_days
```

**Insert after** (at the end of the file):
```python


# ============================================================
# SALIENCE CALCULATION (Issue 4: Stakes Weighting)
# ============================================================

def calculate_salience(subtype: str | None, signals: dict | None) -> float:
    """Calculate emotional/stakes salience for a memory.

    Returns a float from 0.1 (routine) to 1.0 (catastrophic/exceptional).
    Default is 0.5 (neutral — no stability modulation).

    Salience is derived from trade metadata in the signals dict:
    - For trade_close: PnL magnitude + loss amplification
    - For trade_entry: confidence + risk/reward ratio
    - For phantoms: phantom PnL magnitude
    - For other types or missing data: 0.5 (neutral)

    Only applies when the section's SectionEncodingConfig.salience_enabled is True.
    SIGNALS section (salience_enabled=False) always returns 0.5.
    """
    if not subtype or not signals:
        return 0.5

    section = get_section_for_subtype(subtype)
    profile = SECTION_PROFILES[section]
    if not profile.encoding.salience_enabled:
        return 0.5

    # ----- Trade close: PnL is the primary salience signal -----
    if subtype == "custom:trade_close":
        pnl_pct = signals.get("pnl_pct", 0)
        magnitude = min(1.0, abs(pnl_pct) / 10.0)  # 10% price move = max
        loss_boost = 0.15 if pnl_pct < 0 else 0.0   # Negativity bias
        return _clamp(0.3 + magnitude * 0.55 + loss_boost)

    # ----- Trade entry: confidence and R:R ratio -----
    if subtype == "custom:trade_entry":
        confidence = signals.get("confidence", 0.5)
        if confidence is None:
            confidence = 0.5
        rr_ratio = signals.get("rr_ratio", 0)
        if rr_ratio is None:
            rr_ratio = 0
        rr_score = min(1.0, rr_ratio / 3.0)  # 3:1 R:R = max
        return _clamp(0.3 + confidence * 0.5 + rr_score * 0.2)

    # ----- Trade modify: use PnL if available (position is at some unrealized PnL) -----
    if subtype == "custom:trade_modify":
        pnl_pct = signals.get("pnl_pct", 0)
        if pnl_pct:
            magnitude = min(1.0, abs(pnl_pct) / 10.0)
            return _clamp(0.3 + magnitude * 0.55)
        return 0.5

    # ----- Phantom outcomes: phantom PnL magnitude -----
    if subtype in ("custom:missed_opportunity", "custom:good_pass"):
        pnl_pct = signals.get("pnl_pct", 0)
        magnitude = min(1.0, abs(pnl_pct) / 10.0)
        return _clamp(0.3 + magnitude * 0.7)

    return 0.5


def modulate_stability(subtype: str | None, salience: float) -> float | None:
    """Apply salience to base stability, returning modulated stability in days.

    Returns None if salience is neutral (0.5) or section doesn't support salience,
    meaning the caller should use default stability (no override needed).

    The modulation formula:
    - salience >= 0.5: amplify. multiplier = 1.0 to max_salience_multiplier
    - salience < 0.5: reduce. multiplier = 0.2 to 1.0
    """
    if not subtype:
        return None

    section = get_section_for_subtype(subtype)
    profile = SECTION_PROFILES[section]

    if not profile.encoding.salience_enabled:
        return None

    # Neutral salience = no modulation needed
    if abs(salience - 0.5) < 0.01:
        return None

    base = get_initial_stability_for_subtype(subtype)
    max_mult = profile.encoding.max_salience_multiplier

    if salience >= 0.5:
        t = (salience - 0.5) / 0.5
        multiplier = 1.0 + t * (max_mult - 1.0)
    else:
        t = salience / 0.5
        multiplier = 0.2 + t * 0.8

    return round(base * multiplier, 2)


def _clamp(value: float, low: float = 0.1, high: float = 1.0) -> float:
    """Clamp a value to [low, high] range."""
    return max(low, min(high, value))
```

**Why:** These two functions are the core of stakes weighting. `calculate_salience()` derives a score from trade metadata. `modulate_stability()` converts that score into a concrete stability value in days. The caller chains them: `salience = calculate_salience(subtype, signals)` → `stability = modulate_stability(subtype, salience)` → pass to `create_node()`. Returning `None` from `modulate_stability()` means "use default" — the caller only passes the override when salience actually differs from neutral.

---

### Step 4.2: Add `neural_stability` parameter to `NousClient.create_node()`

**File:** `src/hynous/nous/client.py`

**Find this** (lines 61-88, the `create_node` method):
```python
    def create_node(
        self,
        type: str,
        subtype: str,
        title: str,
        body: Optional[str] = None,
        summary: Optional[str] = None,
        event_time: Optional[str] = None,
        event_confidence: Optional[float] = None,
        event_source: Optional[str] = None,
    ) -> dict:
        """Create a new node. Returns the full node dict with generated ID."""
        payload = {
            "type": type,
            "subtype": subtype,
            "content_title": title,
            "content_body": body,
            "content_summary": summary,
        }
        if event_time:
            payload["temporal_event_time"] = event_time
        if event_confidence is not None:
            payload["temporal_event_confidence"] = event_confidence
        if event_source:
            payload["temporal_event_source"] = event_source
        resp = self._session.post(self._url("/nodes"), json=payload, timeout=self._DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
```

**Replace with:**
```python
    def create_node(
        self,
        type: str,
        subtype: str,
        title: str,
        body: Optional[str] = None,
        summary: Optional[str] = None,
        event_time: Optional[str] = None,
        event_confidence: Optional[float] = None,
        event_source: Optional[str] = None,
        neural_stability: Optional[float] = None,
    ) -> dict:
        """Create a new node. Returns the full node dict with generated ID.

        Args:
            neural_stability: Optional FSRS stability override in days.
                When provided, overrides the default from getNeuralDefaults().
                Used by stakes weighting (Issue 4) to encode high-salience
                events with stronger initial stability.
        """
        payload = {
            "type": type,
            "subtype": subtype,
            "content_title": title,
            "content_body": body,
            "content_summary": summary,
        }
        if event_time:
            payload["temporal_event_time"] = event_time
        if event_confidence is not None:
            payload["temporal_event_confidence"] = event_confidence
        if event_source:
            payload["temporal_event_source"] = event_source
        if neural_stability is not None:
            payload["neural_stability"] = neural_stability
        resp = self._session.post(self._url("/nodes"), json=payload, timeout=self._DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
```

**Why:** Adds a single optional parameter. When not provided (the common case for non-trade memories), the POST body is unchanged. When provided, the Nous server will use it instead of the default from `getNeuralDefaults()`.

---

### Step 4.3: Modify `POST /nodes` in Nous to accept optional `neural_stability` override

**File:** `nous-server/server/src/routes/nodes.ts`

**Find this** (lines 24-56, the POST handler):
```typescript
nodes.post('/nodes', async (c) => {
  const body = await c.req.json();
  const {
    type, subtype, content_title, content_summary, content_body,
    temporal_event_time, temporal_event_confidence, temporal_event_source,
  } = body;

  if (!type || !content_title) {
    return c.json({ error: 'type and content_title are required' }, 400);
  }

  const id = nodeId();
  const ts = now();
  const layer = type === 'episode' ? 'episode' : 'semantic';

  // Get FSRS-appropriate neural defaults from @nous/core
  const neural = getNeuralDefaults(type, subtype);

  const db = getDb();
  await db.execute({
    sql: `INSERT INTO nodes
      (id, type, subtype, content_title, content_summary, content_body,
       neural_stability, neural_retrievability, neural_difficulty,
       neural_last_accessed, provenance_created_at, layer, last_modified,
       temporal_event_time, temporal_event_confidence, temporal_event_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, type, subtype ?? null, content_title, content_summary ?? null, content_body ?? null,
      neural.neural_stability, neural.neural_retrievability, neural.neural_difficulty,
      ts, ts, layer, ts,
      temporal_event_time ?? null, temporal_event_confidence ?? null, temporal_event_source ?? null,
    ],
  });
```

**Replace with:**
```typescript
nodes.post('/nodes', async (c) => {
  const body = await c.req.json();
  const {
    type, subtype, content_title, content_summary, content_body,
    temporal_event_time, temporal_event_confidence, temporal_event_source,
    neural_stability: stability_override,
  } = body;

  if (!type || !content_title) {
    return c.json({ error: 'type and content_title are required' }, 400);
  }

  const id = nodeId();
  const ts = now();
  const layer = type === 'episode' ? 'episode' : 'semantic';

  // Get FSRS-appropriate neural defaults from @nous/core
  const neural = getNeuralDefaults(type, subtype);

  // Stakes weighting (Issue 4): Python-side salience calculation may override
  // the default stability with a salience-modulated value. When provided,
  // it takes precedence over the section-aware default from getNeuralDefaults().
  const finalStability = (typeof stability_override === 'number' && stability_override > 0)
    ? stability_override
    : neural.neural_stability;

  const db = getDb();
  await db.execute({
    sql: `INSERT INTO nodes
      (id, type, subtype, content_title, content_summary, content_body,
       neural_stability, neural_retrievability, neural_difficulty,
       neural_last_accessed, provenance_created_at, layer, last_modified,
       temporal_event_time, temporal_event_confidence, temporal_event_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, type, subtype ?? null, content_title, content_summary ?? null, content_body ?? null,
      finalStability, neural.neural_retrievability, neural.neural_difficulty,
      ts, ts, layer, ts,
      temporal_event_time ?? null, temporal_event_confidence ?? null, temporal_event_source ?? null,
    ],
  });
```

**Why:** Destructures `neural_stability` from the request body (renamed to `stability_override` for clarity). If it's a positive number, it overrides the default. Otherwise, falls back to the section-aware default. The validation `typeof stability_override === 'number' && stability_override > 0` prevents zero/negative/null/undefined/NaN from being used.

---

### Step 4.4: Wire salience into `_store_to_nous()` in trading tools

**File:** `src/hynous/intelligence/tools/trading.py`

This is the single funnel for ALL trade memory creation — entries, closes, modifications, and phantom results all flow through here.

**Find this** (lines 1007-1052, the `_store_to_nous` function up to the `create_node` call):
```python
def _store_to_nous(
    subtype: str,
    title: str,
    content: str,
    summary: str,
    signals: dict | None = None,
    link_to: str | None = None,
    edge_type: str = "part_of",
    event_time: str | None = None,
) -> str | None:
    """Store a trade memory node in Nous with proper structure and linking.

    Creates a node with structured JSON body and optional edge to a related
    node. Uses specific subtypes (trade_entry, trade_close, trade_modify)
    and 'part_of' edges (SSA weight 0.85) to build the trade lifecycle graph.

    Returns node_id or None.
    """
    from ...nous.client import get_client
    from ...core.memory_tracker import get_tracker

    tracker = get_tracker()

    # Build structured body — always JSON for trade memories
    body_data: dict = {"text": content}
    if signals:
        body_data["signals"] = signals
    body = json.dumps(body_data)

    # Auto-set event_time if not provided (trade events happen NOW)
    if not event_time:
        from datetime import datetime, timezone
        event_time = datetime.now(timezone.utc).isoformat()

    try:
        client = get_client()
        node = client.create_node(
            type="concept",
            subtype=subtype,
            title=title,
            body=body,
            summary=summary,
            event_time=event_time,
            event_confidence=1.0,
            event_source="inferred",
        )
```

**Replace with:**
```python
def _store_to_nous(
    subtype: str,
    title: str,
    content: str,
    summary: str,
    signals: dict | None = None,
    link_to: str | None = None,
    edge_type: str = "part_of",
    event_time: str | None = None,
) -> str | None:
    """Store a trade memory node in Nous with proper structure and linking.

    Creates a node with structured JSON body and optional edge to a related
    node. Uses specific subtypes (trade_entry, trade_close, trade_modify)
    and 'part_of' edges (SSA weight 0.85) to build the trade lifecycle graph.

    Stakes weighting (Issue 4): calculates salience from the signals dict
    and passes a stability override to Nous when the event is non-routine.

    Returns node_id or None.
    """
    from ...nous.client import get_client
    from ...core.memory_tracker import get_tracker

    tracker = get_tracker()

    # Build structured body — always JSON for trade memories
    body_data: dict = {"text": content}
    if signals:
        body_data["signals"] = signals
    body = json.dumps(body_data)

    # Auto-set event_time if not provided (trade events happen NOW)
    if not event_time:
        from datetime import datetime, timezone
        event_time = datetime.now(timezone.utc).isoformat()

    # Stakes weighting: calculate salience-modulated stability
    _neural_stability = None
    try:
        from ...nous.sections import calculate_salience, modulate_stability
        salience = calculate_salience(subtype, signals)
        _neural_stability = modulate_stability(subtype, salience)
        if _neural_stability is not None:
            logger.debug(
                "Stakes weighting: %s salience=%.2f → stability=%.1f days",
                subtype, salience, _neural_stability,
            )
    except Exception as e:
        logger.debug("Stakes weighting skipped: %s", e)

    try:
        client = get_client()
        node = client.create_node(
            type="concept",
            subtype=subtype,
            title=title,
            body=body,
            summary=summary,
            event_time=event_time,
            event_confidence=1.0,
            event_source="inferred",
            neural_stability=_neural_stability,
        )
```

**Why:** Calculates salience from the `signals` dict that's already passed to every trade memory call. The try/except ensures salience calculation never blocks memory creation — if it fails, the node is still created with default stability. The debug log lets you verify salience values during testing. `_neural_stability` is `None` for neutral salience (no override) and a positive float for non-neutral (override the default).

---

### Step 4.5: Wire salience into `_store_memory_impl()` for agent-created memories

**File:** `src/hynous/intelligence/tools/memory.py`

Most agent-created memories (lesson, thesis, signal) don't have PnL metadata, so salience will be 0.5 (neutral) and no override is passed. But the `playbook`, `missed_opportunity`, and `good_pass` types CAN have salience-relevant metadata in their `signals` dict. This step adds the salience path for those cases.

**Find this** (lines 541-555, the `create_node` call in `_store_memory_impl()`):
```python
    try:
        from ...core.memory_tracker import get_tracker
        tracker = get_tracker()

        client = get_client()
        node = client.create_node(
            type=node_type,
            subtype=subtype,
            title=title,
            body=body,
            summary=summary,
            event_time=_event_time,
            event_confidence=_event_confidence,
            event_source=_event_source,
        )
```

**Replace with:**
```python
    try:
        from ...core.memory_tracker import get_tracker
        tracker = get_tracker()

        # Stakes weighting (Issue 4): calculate salience from signals if available
        _neural_stability = None
        try:
            from ...nous.sections import calculate_salience, modulate_stability
            salience = calculate_salience(subtype, signals)
            _neural_stability = modulate_stability(subtype, salience)
        except Exception:
            pass

        client = get_client()
        node = client.create_node(
            type=node_type,
            subtype=subtype,
            title=title,
            body=body,
            summary=summary,
            event_time=_event_time,
            event_confidence=_event_confidence,
            event_source=_event_source,
            neural_stability=_neural_stability,
        )
```

**Why:** For most agent-created memories, `signals` is None or doesn't contain PnL data, so `calculate_salience()` returns 0.5 → `modulate_stability()` returns None → no override passed. The only case where this has effect is when the agent creates a memory with a signals dict that happens to contain PnL-related fields. This is intentionally lightweight — the primary salience path is through `_store_to_nous()` for trade memories.

---

### Step 4.6: Build and verify TypeScript changes

After modifying `nodes.ts`, rebuild the Nous server to ensure the TypeScript change compiles.

**Commands to run (from project root):**
```bash
cd nous-server/core
npx tsup
```

**Expected output:** Build succeeds with no errors.

**Verify the override works:**
```bash
cd nous-server/server
# Start the dev server, then:
curl -s -X POST http://localhost:3100/v1/nodes \
  -H "Content-Type: application/json" \
  -d '{
    "type": "concept",
    "subtype": "custom:trade_close",
    "content_title": "Stakes test: -10% loss",
    "content_body": "Test node with stability override",
    "neural_stability": 42.0
  }' | jq '{id, neural_stability}'
```

**Expected output:**
```json
{
  "id": "...",
  "neural_stability": 42
}
```

The `neural_stability` should be 42.0, not the default 21 (or whatever `getNeuralDefaults` returns for `custom:trade_close`).

**Verify default still works (no override):**
```bash
curl -s -X POST http://localhost:3100/v1/nodes \
  -H "Content-Type: application/json" \
  -d '{
    "type": "concept",
    "subtype": "custom:trade_close",
    "content_title": "Default stability test",
    "content_body": "Test node without override"
  }' | jq '{id, neural_stability}'
```

**Expected output:** `neural_stability` should be the section-aware default from `getNeuralDefaults()` (21 for `custom:trade_close` after Issue 2, or the pre-Issue-2 value if Issue 2 isn't implemented yet).

---

## Testing

### Unit Tests (Python — Salience Calculation)

**Add to existing file:** `tests/unit/test_sections.py`

Append these test classes to the existing test file:

```python
from hynous.nous.sections import (
    calculate_salience,
    modulate_stability,
)


class TestCalculateSalience:
    """Test salience calculation from trade metadata."""

    # ---- Trade close ----

    def test_trade_close_routine_win(self):
        """Small win → low salience."""
        s = calculate_salience("custom:trade_close", {"pnl_pct": 0.5})
        assert 0.3 <= s <= 0.45, f"Expected low salience for +0.5%, got {s}"

    def test_trade_close_notable_loss(self):
        """5% loss → high salience (with loss boost)."""
        s = calculate_salience("custom:trade_close", {"pnl_pct": -5.0})
        assert s > 0.7, f"Expected high salience for -5%, got {s}"

    def test_trade_close_catastrophic_loss(self):
        """10% loss → max salience."""
        s = calculate_salience("custom:trade_close", {"pnl_pct": -10.0})
        assert s >= 0.95, f"Expected max salience for -10%, got {s}"

    def test_trade_close_exceptional_win(self):
        """10% win → high salience (but lower than equivalent loss)."""
        win = calculate_salience("custom:trade_close", {"pnl_pct": 10.0})
        loss = calculate_salience("custom:trade_close", {"pnl_pct": -10.0})
        assert win > 0.8, f"Expected high salience for +10%, got {win}"
        assert loss > win, f"Loss ({loss}) should encode stronger than equivalent win ({win})"

    def test_trade_close_loss_bias(self):
        """Same magnitude: loss encodes stronger than win."""
        win_5 = calculate_salience("custom:trade_close", {"pnl_pct": 5.0})
        loss_5 = calculate_salience("custom:trade_close", {"pnl_pct": -5.0})
        assert loss_5 > win_5, f"Loss salience ({loss_5}) should exceed win ({win_5})"

    def test_trade_close_no_signals(self):
        """No signals → neutral salience."""
        assert calculate_salience("custom:trade_close", None) == 0.5
        assert calculate_salience("custom:trade_close", {}) == 0.5

    # ---- Trade entry ----

    def test_trade_entry_high_confidence(self):
        """High confidence entry → high salience."""
        s = calculate_salience("custom:trade_entry", {"confidence": 0.9, "rr_ratio": 2.5})
        assert s > 0.7, f"Expected high salience for 90% confidence, got {s}"

    def test_trade_entry_low_confidence(self):
        """Low confidence entry → low salience."""
        s = calculate_salience("custom:trade_entry", {"confidence": 0.3, "rr_ratio": 1.0})
        assert s < 0.6, f"Expected low salience for 30% confidence, got {s}"

    def test_trade_entry_no_confidence(self):
        """Missing confidence → neutral."""
        s = calculate_salience("custom:trade_entry", {})
        assert 0.4 <= s <= 0.6, f"Expected neutral-ish salience, got {s}"

    # ---- Phantom outcomes ----

    def test_missed_opportunity_large(self):
        """Large phantom gain → high salience."""
        s = calculate_salience("custom:missed_opportunity", {"pnl_pct": 15.0})
        assert s > 0.8, f"Expected high salience for 15% phantom, got {s}"

    def test_good_pass_small(self):
        """Small phantom loss → low salience."""
        s = calculate_salience("custom:good_pass", {"pnl_pct": -1.0})
        assert s < 0.5, f"Expected low salience for 1% phantom, got {s}"

    # ---- Section enforcement ----

    def test_signals_section_disabled(self):
        """SIGNALS section has salience_enabled=False → always neutral."""
        s = calculate_salience("custom:signal", {"pnl_pct": -20.0})
        assert s == 0.5, f"SIGNALS should ignore salience, got {s}"

    def test_unknown_subtype_neutral(self):
        """Unknown subtype → neutral salience."""
        assert calculate_salience("custom:unknown", {"pnl_pct": -20.0}) == 0.5

    # ---- Bounds ----

    def test_salience_bounds(self):
        """Salience is always in [0.1, 1.0]."""
        # Extreme values
        for pnl in [-100, -50, -10, -5, 0, 5, 10, 50, 100]:
            s = calculate_salience("custom:trade_close", {"pnl_pct": pnl})
            assert 0.1 <= s <= 1.0, f"Salience {s} out of bounds for pnl_pct={pnl}"

    def test_salience_monotonic_with_magnitude(self):
        """Higher PnL magnitude → higher salience (for wins)."""
        s1 = calculate_salience("custom:trade_close", {"pnl_pct": 1.0})
        s5 = calculate_salience("custom:trade_close", {"pnl_pct": 5.0})
        s10 = calculate_salience("custom:trade_close", {"pnl_pct": 10.0})
        assert s1 < s5 < s10, f"Expected monotonic: {s1} < {s5} < {s10}"


class TestModulateStability:
    """Test stability modulation from salience scores."""

    def test_neutral_returns_none(self):
        """Neutral salience (0.5) → no override needed."""
        assert modulate_stability("custom:trade_close", 0.5) is None

    def test_high_salience_amplifies(self):
        """High salience → stability above base."""
        base = 21.0  # trade_close base
        result = modulate_stability("custom:trade_close", 0.9)
        assert result is not None
        assert result > base, f"Expected amplification: {result} > {base}"

    def test_low_salience_reduces(self):
        """Low salience → stability below base."""
        base = 21.0
        result = modulate_stability("custom:trade_close", 0.2)
        assert result is not None
        assert result < base, f"Expected reduction: {result} < {base}"

    def test_max_salience_at_max_multiplier(self):
        """Salience 1.0 → base × max_salience_multiplier."""
        base = 21.0  # trade_close base
        max_mult = 2.0  # EPISODIC max_salience_multiplier
        result = modulate_stability("custom:trade_close", 1.0)
        assert result is not None
        expected = base * max_mult
        assert abs(result - expected) < 0.5, f"Expected ~{expected}, got {result}"

    def test_disabled_section_returns_none(self):
        """SIGNALS section (salience_enabled=False) → None."""
        assert modulate_stability("custom:signal", 0.9) is None

    def test_procedural_higher_multiplier(self):
        """PROCEDURAL section has max_salience_multiplier=3.0."""
        base = 180.0  # playbook base
        result = modulate_stability("custom:playbook", 1.0)
        assert result is not None
        expected = base * 3.0
        assert abs(result - expected) < 1.0, f"Expected ~{expected}, got {result}"

    def test_result_is_rounded(self):
        """Modulated stability is rounded to 2 decimal places."""
        result = modulate_stability("custom:trade_close", 0.7)
        assert result is not None
        assert result == round(result, 2)

    def test_catastrophic_loss_example(self):
        """Verify the -10% loss example from Architecture Decisions table."""
        # trade_close: base=21, salience=1.0, max_mult=2.0 → 42.0
        salience = calculate_salience("custom:trade_close", {"pnl_pct": -10.0})
        result = modulate_stability("custom:trade_close", salience)
        assert result is not None
        assert result >= 38.0, f"Catastrophic loss should have stability ~42d, got {result}"
```

**Run with:**
```bash
cd /path/to/project
PYTHONPATH=src python -m pytest tests/unit/test_sections.py -v -k "Salience or Modulate"
```

**Expected:** All tests pass. ~25 test cases covering salience calculation bounds, monotonicity, section enforcement, and modulation formula.

### Integration Tests (Live Local)

These tests require the Nous server running locally with the Step 4.3 changes deployed.

**Prerequisites:**
```bash
# Terminal 1: Build and start Nous server
cd nous-server/core && npx tsup
cd ../server && pnpm dev
# Should show: "Nous server running on port 3100"
```

**Test 1: Verify stability override in POST /nodes**
```bash
# Create node with override
curl -s -X POST http://localhost:3100/v1/nodes \
  -H "Content-Type: application/json" \
  -d '{
    "type": "concept",
    "subtype": "custom:trade_close",
    "content_title": "Stakes test: high-salience close",
    "content_body": "{\"text\": \"Catastrophic loss test\", \"signals\": {\"pnl_pct\": -10.0}}",
    "neural_stability": 42.0
  }' | jq '{id, neural_stability, subtype}'

# Create node without override (should use default)
curl -s -X POST http://localhost:3100/v1/nodes \
  -H "Content-Type: application/json" \
  -d '{
    "type": "concept",
    "subtype": "custom:trade_close",
    "content_title": "Stakes test: default stability",
    "content_body": "No override test"
  }' | jq '{id, neural_stability, subtype}'
```

**Expected:**
- First node: `neural_stability: 42` (the override value)
- Second node: `neural_stability: 21` (the default for `custom:trade_close` after Issue 2)

**Test 2: Verify invalid override is rejected**
```bash
curl -s -X POST http://localhost:3100/v1/nodes \
  -H "Content-Type: application/json" \
  -d '{
    "type": "concept",
    "subtype": "custom:trade_close",
    "content_title": "Invalid override test",
    "neural_stability": -5
  }' | jq '{id, neural_stability}'
```

**Expected:** `neural_stability` should be the default (not -5), because the validation `stability_override > 0` rejects negative values.

**Test 3: Verify Python salience calculation end-to-end**
```bash
PYTHONPATH=src python -c "
from hynous.nous.sections import calculate_salience, modulate_stability

# Catastrophic loss
s = calculate_salience('custom:trade_close', {'pnl_pct': -10.0})
stab = modulate_stability('custom:trade_close', s)
print(f'Catastrophic loss: salience={s:.2f}, stability={stab:.1f} days')

# Routine win
s = calculate_salience('custom:trade_close', {'pnl_pct': 0.5})
stab = modulate_stability('custom:trade_close', s)
print(f'Routine win: salience={s:.2f}, stability={stab} days')

# High-confidence entry
s = calculate_salience('custom:trade_entry', {'confidence': 0.85, 'rr_ratio': 2.5})
stab = modulate_stability('custom:trade_entry', s)
print(f'High-confidence entry: salience={s:.2f}, stability={stab:.1f} days')

# Signal (disabled)
s = calculate_salience('custom:signal', {'pnl_pct': -20.0})
stab = modulate_stability('custom:signal', s)
print(f'Signal (disabled): salience={s:.2f}, stability={stab}')
"
```

**Expected:**
```
Catastrophic loss: salience=1.00, stability=42.0 days
Routine win: salience=0.33, stability=None days
High-confidence entry: salience=0.89, stability=37.4 days
Signal (disabled): salience=0.50, stability=None
```

### Live Dynamic Tests (VPS)

After deploying updated Nous server + Python code to VPS:

**Test 4: Verify existing trade flow creates salience-modulated nodes**

Execute a paper trade via the chat interface or API, then check the node:
```bash
# After a trade close, find the most recent trade_close node:
curl -s 'http://localhost:3100/v1/nodes?subtype=custom:trade_close&limit=1' | \
  jq '.data[0] | {id, content_title, neural_stability, subtype}'
```

**Expected:** The `neural_stability` value should differ from the subtype default (21 days) if the trade had non-trivial PnL. A +0.1% routine close might show ~15 days (reduced), while a -5% loss would show ~30 days (amplified).

**Test 5: Compare stability values across recent trades**
```bash
curl -s 'http://localhost:3100/v1/nodes?subtype=custom:trade_close&limit=10' | \
  jq '.data[] | {title: .content_title, stability: .neural_stability}'
```

**Expected:** Different trades should have different stability values, correlated with their PnL magnitude. Pre-stakes-weighting nodes will all show the same default stability.

---

## Verification Checklist

| # | Check | How to Verify |
|---|-------|---------------|
| 1 | Python salience tests pass | `PYTHONPATH=src python -m pytest tests/unit/test_sections.py -v -k "Salience or Modulate"` — all green |
| 2 | Existing Python tests still pass | `PYTHONPATH=src python -m pytest tests/ -v` — no regressions |
| 3 | TypeScript server compiles | `cd nous-server/core && npx tsup` — no errors |
| 4 | Existing TS tests still pass | `cd nous-server/core && npx vitest run` — no regressions |
| 5 | POST /nodes accepts stability override | Create node with `neural_stability: 42`, verify returned value is 42 |
| 6 | POST /nodes ignores invalid override | Create node with `neural_stability: -5`, verify default is used |
| 7 | POST /nodes without override unchanged | Create node without `neural_stability`, verify default from `getNeuralDefaults()` |
| 8 | `calculate_salience()` returns 0.5 for disabled sections | `calculate_salience("custom:signal", {"pnl_pct": -20})` returns 0.5 |
| 9 | `modulate_stability()` returns None for neutral | `modulate_stability("custom:trade_close", 0.5)` returns None |
| 10 | Catastrophic loss gets max multiplier | `salience(-10% loss)` ≈ 1.0, `modulate(1.0)` ≈ 42 days for trade_close |
| 11 | Trade close stores with salience | Execute paper trade, close, verify `neural_stability` differs from default |
| 12 | Trade entry stores with confidence salience | Execute high-confidence trade, verify entry node stability > default |
| 13 | `_store_to_nous()` logs salience | Run trade with DEBUG logging, verify "Stakes weighting" log line |
| 14 | `_store_memory_impl()` doesn't break | Store a lesson via agent, verify default stability (salience neutral) |

---

## File Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/hynous/nous/sections.py` | Modified | Add `calculate_salience()`, `modulate_stability()`, `_clamp()` (~85 lines) |
| `src/hynous/nous/client.py` | Modified | Add `neural_stability` parameter to `create_node()` (+5 lines) |
| `src/hynous/intelligence/tools/trading.py` | Modified | Wire salience calculation into `_store_to_nous()` (+12 lines) |
| `src/hynous/intelligence/tools/memory.py` | Modified | Wire salience into `_store_memory_impl()` create_node call (+7 lines) |
| `nous-server/server/src/routes/nodes.ts` | Modified | Accept optional `neural_stability` override in POST body (+5 lines) |
| `tests/unit/test_sections.py` | Modified | Add `TestCalculateSalience` + `TestModulateStability` test classes (~120 lines) |

**Total new code:** ~85 lines (salience functions + helper)
**Total modified:** ~30 lines across 4 existing files
**Total tests:** ~25 new test cases in 2 test classes
**Schema changes:** None
**API changes:** `POST /nodes` accepts optional `neural_stability` field (additive, non-breaking)

---

## What Comes Next

After this guide, high-stakes events encode with amplified stability. The next guides build on this foundation:

- **Issue 3 (Cross-Episode Generalization)** benefits from stakes weighting: the consolidation pipeline can look at stability values as a signal of which episodes are worth generalizing from. A cluster of high-salience trade closes is more likely to contain a valuable pattern than a cluster of routine ones.
- **Issue 5 (Procedural Memory)** uses the PROCEDURAL section's `max_salience_multiplier=3.0` — a playbook validated by a spectacular trade can encode with up to 3× base stability (540 days for a playbook with base 180).
