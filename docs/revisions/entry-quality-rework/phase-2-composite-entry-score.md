# Phase 2: Composite Entry Score

> **Status:** Blocked on Phase 1
> **Depends on:** Phase 1 validated (Spearman results documented, models retrained)
> **Scope:** Mechanical composite entry score computed in daemon, injected into briefing and trading tool.

---

## Required Reading

### Condition Engine (source of input signals)
- **`satellite/conditions.py`** — `ConditionEngine.predict()` (lines 240-307): how features are extracted per model (line 272-273), how regimes are classified (line 284), how predictions are returned as `MarketConditions`. Study `to_briefing_text()` (lines 89-187) to see the 10 output sections and their format.
- **`satellite/condition_alerts.py`** — `ConditionWakeEvaluator`: the golden_entry checker (lines 160-190, triggers on entry_quality >= `ml_entry_quality_pctl` AND vol != "low" AND NOT both MAEs extreme), the composite_green checker (lines 305-337, requires entry_quality >= 75th AND vol high/extreme AND acceptable MAE). These are being replaced by the composite score.

### Current ML Integration in Trading Tool
- **`src/hynous/intelligence/tools/trading.py`** — Study these sections that will be modified:
  - `_get_ml_conditions()` (lines 120-137): reads `daemon._latest_predictions[symbol]["conditions"]` with 600s staleness gate.
  - ML unavailable block (lines 533-548): returns error if ml_cond is None.
  - Entry quality gate (lines 550-572): rejects < `ml_entry_reject_pctl`, warns < `ml_entry_warn_pctl`.
  - ML-adaptive leverage cap (lines 595-616): caps leverage in extreme/high vol.
  - ML-adaptive sizing (lines 676-701): `_ml_factor` starts at 1.0, multiplied down by entry quality, vol, MAE.
  - MAE vs SL warning (lines 914-929): compares predicted drawdown to SL distance.
  - SL survival warning (lines 931-942): warns if tight stop hit probability > 50%.

### Daemon Integration Points
- **`src/hynous/intelligence/daemon.py`** — `_run_satellite_inference()` (lines 1600-1779): after condition predictions at line 1740, this is where the composite score will be computed and cached. Study the `_latest_predictions` write pattern at lines 1737-1738 (now wrapped in lock from Phase 0).

### Briefing
- **`src/hynous/intelligence/briefing.py`** — `build_briefing()` signature (lines 295-299), ML section integration (lines 329-333), `_build_ml_section()` (lines 889-966). The composite score line will be injected here.

### Trading Settings
- **`src/hynous/core/trading_settings.py`** — Study the field naming convention and section organization (lines 26-160). New fields go in a new `# --- Composite Entry Score ---` section after the `# --- ML Condition Wakes ---` section.
- **`config/default.yaml`** — Satellite section. New config fields go here.

---

## Step 2.1: Create `satellite/entry_score.py`

**New file.** Follow these conventions from the codebase:
- Module docstring explaining purpose, score interpretation, and usage.
- Dataclasses for structured output (same pattern as `ConditionPrediction` in conditions.py).
- Pure functions — no side effects, no I/O. Takes condition dict, returns score.
- Logging via `log = logging.getLogger(__name__)`.

```python
"""Composite entry score — mechanical entry quality assessment.

Combines condition model outputs into a single 0-100 score.
Computed every satellite tick (300s) in the daemon. No LLM involved.

Score interpretation:
  0-30:  Poor — skip entries, set watchpoints
  30-50: Below average — reduce size, require higher conviction
  50-70: Neutral — standard sizing
  70-85: Good — favor entries, full conviction sizing
  85-100: Excellent — strong entry window, aggressive sizing allowed

Usage:
    from satellite.entry_score import compute_entry_score, EntryScoreConfig
    score = compute_entry_score(conditions.to_dict(), dir_signal, ...)
"""

import logging
import time
from dataclasses import dataclass, field

log = logging.getLogger(__name__)


@dataclass
class EntryScore:
    """Computed composite entry score for one coin."""

    coin: str
    score: float                      # 0-100
    components: dict[str, float]      # signal name → normalized contribution (0-1)
    timestamp: float
    direction_signal: str | None      # "long", "short", "skip", "conflict", None
    direction_confidence: float       # max(predicted_long_roe, predicted_short_roe)

    @property
    def label(self) -> str:
        if self.score >= 85:
            return "excellent"
        if self.score >= 70:
            return "good"
        if self.score >= 50:
            return "neutral"
        if self.score >= 30:
            return "below_average"
        return "poor"

    def to_briefing_line(self) -> str:
        """Single-line briefing injection. Matches briefing.py formatting conventions."""
        top = sorted(self.components.items(), key=lambda x: abs(x[1] - 0.5), reverse=True)[:3]
        drivers = ", ".join(f"{k}={v:.2f}" for k, v in top)
        return f"Entry score: {self.score:.0f}/100 ({self.label}) [{drivers}]"


@dataclass
class EntryScoreConfig:
    """Weights and thresholds. All configurable via TradingSettings."""

    # Per-signal weights (must sum to ~1.0 for enabled signals)
    # These are initial equal weights — Phase 3 feedback loop adjusts them.
    weights: dict[str, float] = field(default_factory=lambda: {
        "entry_quality": 0.20,
        "vol_favorability": 0.20,
        "funding_safety": 0.15,
        "volume_quality": 0.15,
        "mae_safety": 0.15,
        "direction_edge": 0.15,
    })
    # Trading tool thresholds
    reject_below: float = 25.0
    warn_below: float = 45.0


_REGIME_VOL_MAP = {"low": 0.80, "normal": 0.60, "high": 0.35, "extreme": 0.15}
_REGIME_VOL_1H_MAP = {"low": 0.30, "normal": 0.50, "high": 0.75, "extreme": 0.90}


def compute_entry_score(
    conditions: dict,
    direction_signal: str | None = None,
    direction_long_roe: float = 0.0,
    direction_short_roe: float = 0.0,
    config: EntryScoreConfig | None = None,
    side: str | None = None,
    coin: str = "BTC",
) -> EntryScore:
    """Compute composite entry score from condition predictions.

    Each signal is normalized to [0, 1] where 1 = favorable for entries.
    Signals are weighted and combined into a 0-100 score.

    Args:
        conditions: Dict from MarketConditions.to_dict(). Keys are model names,
            values are dicts with "value", "percentile", "regime".
        direction_signal: From InferenceEngine result. None if direction model unavailable.
        direction_long_roe: Predicted long ROE %.
        direction_short_roe: Predicted short ROE %.
        config: Weights and thresholds. Uses defaults if None.
        side: "long" or "short" — for side-specific MAE. None = use worse side.
        coin: Coin symbol.

    Returns:
        EntryScore with 0-100 composite score.
    """
    cfg = config or EntryScoreConfig()
    components: dict[str, float] = {}

    # --- Signal extraction (each normalized to 0-1, higher = better for entries) ---

    # 1. Entry quality percentile (direct: higher percentile = better timing)
    eq = conditions.get("entry_quality", {})
    if eq and eq.get("percentile") is not None:
        components["entry_quality"] = eq["percentile"] / 100.0

    # 2. Vol favorability (inverted: low vol = better for controlled entries,
    #    extreme vol = worse because noise overwhelms signal)
    vol = conditions.get("vol_1h", {})
    if vol and vol.get("regime"):
        components["vol_favorability"] = _REGIME_VOL_MAP.get(vol["regime"], 0.50)

    # 3. Funding safety (extreme funding = squeeze risk = unfavorable)
    fund = conditions.get("funding_4h", {})
    if fund and fund.get("percentile") is not None:
        pctl = fund["percentile"]
        # Distance from neutral (50th) — closer to 50 = safer
        components["funding_safety"] = 1.0 - abs(pctl - 50) / 50.0

    # 4. Volume quality (higher volume = better liquidity + breakout potential)
    vol_1h = conditions.get("volume_1h", {})
    if vol_1h and vol_1h.get("regime"):
        components["volume_quality"] = _REGIME_VOL_1H_MAP.get(vol_1h["regime"], 0.50)

    # 5. MAE safety (lower drawdown prediction = better entry)
    if side:
        mae = conditions.get(f"mae_{side}", {})
    else:
        # Use worse side (more conservative)
        mae_l = conditions.get("mae_long", {})
        mae_s = conditions.get("mae_short", {})
        mae = mae_l if (mae_l.get("percentile", 50) > mae_s.get("percentile", 50)) else mae_s
    if mae and mae.get("percentile") is not None:
        components["mae_safety"] = 1.0 - mae["percentile"] / 100.0

    # 6. Direction model edge (if available and has a signal)
    if direction_signal in ("long", "short"):
        max_roe = max(direction_long_roe, direction_short_roe)
        # Normalize: 3% (entry threshold) maps to 0.0, 10%+ maps to 1.0
        components["direction_edge"] = min(1.0, max(0.0, (max_roe - 3.0) / 7.0))

    # --- Weighted combination ---
    if not components:
        return EntryScore(
            coin=coin, score=50.0, components={}, timestamp=time.time(),
            direction_signal=direction_signal,
            direction_confidence=max(direction_long_roe, direction_short_roe),
        )

    weights = cfg.weights
    # Only use weights for signals that are present
    active_weight = sum(weights.get(k, 0) for k in components)
    if active_weight < 0.01:
        active_weight = len(components)  # Equal-weight fallback
        weights = {k: 1.0 for k in components}

    raw = sum(components[k] * weights.get(k, 1.0 / len(components))
              for k in components) / active_weight
    score = max(0.0, min(100.0, raw * 100.0))

    return EntryScore(
        coin=coin, score=score, components=components, timestamp=time.time(),
        direction_signal=direction_signal,
        direction_confidence=max(direction_long_roe, direction_short_roe),
    )


def score_to_sizing_factor(score: float, floor: float = 0.5, ceiling: float = 1.2) -> float:
    """Map composite score to position sizing multiplier.

    Linear interpolation: score 0 → floor (0.5x), score 100 → ceiling (1.2x).
    """
    t = max(0.0, min(1.0, score / 100.0))
    return floor + t * (ceiling - floor)
```

### Tests for entry_score.py

**New file:** `satellite/tests/test_entry_score.py`

Write tests covering:
1. Score with all 6 components present — verify 0-100 range.
2. Score with only 2 components — verify graceful degradation.
3. Score with empty conditions dict — returns 50.0.
4. Entry quality at 90th pctl + low vol + neutral funding → score > 70.
5. Entry quality at 10th pctl + extreme vol + extreme funding → score < 30.
6. `score_to_sizing_factor(0)` → 0.5, `score_to_sizing_factor(100)` → 1.2, `score_to_sizing_factor(50)` → 0.85.
7. `to_briefing_line()` returns non-empty string with score and label.
8. Direction model edge: signal="long", roe=10% → direction_edge close to 1.0.
9. Direction model edge: signal=None → "direction_edge" not in components.

Follow the test naming pattern in `satellite/tests/test_features.py`.

---

## Step 2.2: Integrate into Daemon

**File:** `src/hynous/intelligence/daemon.py`

### Compute entry score after condition predictions

**Location:** After line 1744 (where `save_condition_predictions()` is called), inside the condition prediction success block. The entry score is computed using the same condition data just predicted.

**Insert after the `save_condition_predictions()` call** (around line 1744):

```python
                    # --- Compute composite entry score ---
                    try:
                        from satellite.entry_score import compute_entry_score

                        # Get direction model results for this coin (may be None)
                        _dir_pred = self._latest_predictions.get(coin, {})
                        _entry_score = compute_entry_score(
                            conditions=conditions.to_dict(),
                            direction_signal=_dir_pred.get("signal"),
                            direction_long_roe=_dir_pred.get("long_roe", 0),
                            direction_short_roe=_dir_pred.get("short_roe", 0),
                            coin=coin,
                        )
                        with self._latest_predictions_lock:
                            if coin in self._latest_predictions:
                                self._latest_predictions[coin]["entry_score"] = _entry_score.score
                                self._latest_predictions[coin]["entry_score_label"] = _entry_score.label
                                self._latest_predictions[coin]["entry_score_components"] = _entry_score.components
                                self._latest_predictions[coin]["entry_score_line"] = _entry_score.to_briefing_line()
                    except Exception:
                        logger.debug("Failed to compute entry score for %s", coin, exc_info=True)
```

This follows the same pattern as the condition prediction caching at lines 1737-1738: write to `_latest_predictions` under lock, swallow exceptions with debug logging.

---

## Step 2.3: Inject into Briefing

**File:** `src/hynous/intelligence/briefing.py`

**Location:** In `_build_ml_section()` (lines 889-966), after the condition text is assembled. Find where `conditions_text` is added to the output (around line 946 area) and add the entry score line immediately after.

Look for where the ML section for a coin is being built. After the conditions text block, add:

```python
            # Composite entry score
            _score_line = pred.get("entry_score_line", "")
            if _score_line:
                lines.append(f"  {_score_line}")
```

This follows the same indentation and formatting pattern as other per-coin lines in the ML section.

---

## Step 2.4: Replace ml_factor with Composite Score in Trading Tool

**File:** `src/hynous/intelligence/tools/trading.py`

### 2.4a: Add entry score to _get_ml_conditions() output

**Location:** `_get_ml_conditions()` at lines 120-137. The function returns the `conditions` sub-dict from `_latest_predictions`. The entry score is stored at the same level as conditions (in `_latest_predictions[symbol]`), so we need to include it.

**After line 131** (`conditions = pred.get("conditions", {})`), add:

```python
        # Include composite entry score in the returned dict
        if conditions:
            conditions["_entry_score"] = pred.get("entry_score")
            conditions["_entry_score_label"] = pred.get("entry_score_label")
            conditions["_entry_score_components"] = pred.get("entry_score_components")
```

The underscore prefix signals these are derived fields, not raw condition model outputs.

### 2.4b: Add composite score gate before existing ML gates

**Location:** After the ML unavailable check (line 548) and before the existing entry quality gate (line 550).

**Insert between lines 548 and 550:**

```python
    # --- Composite entry score gate (replaces per-signal synthesis) ---
    _comp_score = ml_cond.get("_entry_score") if ml_cond else None
    _comp_label = ml_cond.get("_entry_score_label", "unknown") if ml_cond else "unknown"
    if _comp_score is not None:
        if _comp_score < ts.composite_reject_score:
            _record_trade_span(
                "execute_trade", "composite_gate", False,
                f"Entry score {_comp_score:.0f}/100 ({_comp_label})",
                symbol=symbol,
            )
            return (
                f"BLOCKED: Entry score {_comp_score:.0f}/100 ({_comp_label}). "
                f"Market conditions unfavorable for entries. "
                f"Components: {ml_cond.get('_entry_score_components', {})}. "
                f"Wait for conditions to improve or set a watchpoint."
            )
        if _comp_score < ts.composite_warn_score:
            _warnings.append(
                f"Entry score {_comp_score:.0f}/100 ({_comp_label}) — "
                f"below average conditions. Consider reducing size."
            )
```

### 2.4c: Replace ml_factor with score-based sizing

**Location:** The ml_factor computation at lines 676-701.

The existing `_ml_factor` logic (entry quality penalty × vol penalty × MAE penalty) is now redundant — the composite score already incorporates all these signals. Replace the ml_factor computation with:

```python
        # --- ML: Composite score-based sizing ---
        if ml_cond and ts.ml_adaptive_sizing:
            _comp_score = ml_cond.get("_entry_score")
            if _comp_score is not None:
                from satellite.entry_score import score_to_sizing_factor
                _sizing_factor = score_to_sizing_factor(_comp_score)
                _effective_conf = confidence * _sizing_factor

                if _effective_conf < ts.tier_pass_threshold:
                    return (
                        f"ML BLOCKED: Entry score {_comp_score:.0f}/100 reduces effective "
                        f"conviction to {_effective_conf:.0%} (below {ts.tier_pass_threshold:.0%}).\n"
                        f"  Your conviction: {confidence:.0%} × sizing factor: {_sizing_factor:.2f} "
                        f"= {_effective_conf:.0%}\n"
                        f"Wait for better conditions or increase conviction."
                    )

                if _sizing_factor < 0.95:
                    _old_tier = tier
                    if _effective_conf >= 0.8:
                        recommended_margin = portfolio * (ts.tier_high_margin_pct / 100)
                        tier = "High"
                    elif _effective_conf >= 0.6:
                        recommended_margin = portfolio * (ts.tier_medium_margin_pct / 100)
                        tier = "Medium"
                    else:
                        recommended_margin = portfolio * (ts.tier_speculative_margin_pct / 100)
                        tier = "Speculative"

                    if tier != _old_tier:
                        _warnings.append(
                            f"ML: Sizing {_old_tier} → {tier} "
                            f"(entry score {_comp_score:.0f}/100 × conviction {confidence:.0%} "
                            f"= {_effective_conf:.0%})."
                        )
```

**Remove** the old ml_factor code (the `_ml_factor = 1.0` through `_ml_factor = max(0.4, ...)` block). Keep the existing leverage cap (lines 595-616) and MAE/SL warning (lines 914-942) — those provide independent safety checks.

---

## Step 2.5: Add TradingSettings Fields

**File:** `src/hynous/core/trading_settings.py`

**Location:** After the `# --- ML Condition Wakes ---` section (around line 155), add:

```python
    # --- Composite Entry Score ---
    composite_reject_score: float = 25.0    # Hard block entries below this score (0-100)
    composite_warn_score: float = 45.0      # Warn below this score
```

**File:** `config/default.yaml`

**Location:** In the daemon section, after the condition wake settings:

```yaml
  # Composite entry score thresholds
  composite_reject_score: 25
  composite_warn_score: 45
```

---

## Step 2.6: Update System Prompt

**File:** `src/hynous/intelligence/prompts/builder.py`

**Location:** The ML Market Conditions section (lines 268-290). Replace the per-condition descriptions with a reference to the composite score.

Find the line that describes entry quality gating and replace with:

```
**Composite entry score:** Every 5 minutes, the system computes a 0-100 entry score
from my condition models (volatility, entry timing, funding, volume, drawdown risk,
direction edge). The execute_trade tool uses this score to gate and size entries:
- Score < 25: BLOCKED (poor conditions)
- Score 25-45: Warning (below average)
- Score 45-70: Standard sizing
- Score 70+: Favorable, full conviction sizing
The score is shown in my briefing as "Entry score: XX/100 (label)".
```

Keep the existing leverage cap, MAE/SL, and SL survival descriptions — those are independent safety checks.

---

## Verification

### Unit tests
```bash
PYTHONPATH=. pytest satellite/tests/test_entry_score.py -x -v
PYTHONPATH=. pytest satellite/tests/ -x -v
PYTHONPATH=src pytest tests/ -x -v
```

### Integration test

Start daemon, wait for one satellite tick (~300s):

```bash
# 1. Check entry score in cache
# Look for daemon log: "Entry score: XX/100 (label)" or similar

# 2. Check briefing includes score
# On next agent wake, the briefing should contain "Entry score: XX/100"

# 3. Attempt a paper trade — verify:
#    - Score is checked before execution
#    - Sizing factor applied from score
#    - Low score blocks entry (set composite_reject_score high temporarily to test)
```

### Report required

Before proceeding to Phase 3:
1. Entry score computed and cached correctly (value in `_latest_predictions`).
2. Score appears in briefing text.
3. Trading tool gates entries based on score.
4. Sizing factor applied correctly.
5. All tests pass.

---

Last updated: 2026-03-22
