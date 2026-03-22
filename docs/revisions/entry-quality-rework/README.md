# Entry Quality Rework

> **Status:** Phase 0 ready for implementation
> **Priority:** Critical
> **Depends on:** Phantom removal (done), ML briefing rewrite (done), trailing stop v3 (done), dynamic protective SL (done)

---

## Problem

The entry pipeline has three structural weaknesses:

1. **The XGBoost direction model is broken.** Feature hash mismatch causes `ModelArtifact.load()` to fail at daemon startup. `_inference_engine` is `None`. Zero direction predictions have been generated since the feature set expanded from 12 to 28.

2. **The LLM is the entry bottleneck.** 5-30s reasoning latency means entry opportunities pass before execution. Exits are mechanical (1s loop) but entries require full LLM reasoning.

3. **No closed-loop learning.** The system doesn't track which market conditions predicted winning entries. Trade outcomes don't feed back into entry signal quality.

## Solution (4 Phases)

| Phase | Guide | What | Depends On |
|-------|-------|------|------------|
| 0 | [phase-0-ml-foundation.md](./phase-0-ml-foundation.md) | Fix 14 ML pipeline bugs (TRANSFORM_MAP, avail flags, std, alignment) | Nothing |
| 1 | [phase-1-retrain-models.md](./phase-1-retrain-models.md) | Retrain direction + condition models with all 28 features | Phase 0 verified |
| 2 | [phase-2-composite-entry-score.md](./phase-2-composite-entry-score.md) | Mechanical composite entry score replacing LLM signal synthesis | Phase 1 validated |
| 3 | [phase-3-feedback-loop.md](./phase-3-feedback-loop.md) | Entry-outcome logging, rolling IC, adaptive weights, drift detection | Phase 2 deployed |
| 4 | [phase-4-staged-entries.md](./phase-4-staged-entries.md) | LLM lookahead: agent stages entries, daemon executes mechanically | Phase 2 deployed |

**Phases 3 and 4 can run in parallel** after Phase 2 is stable.

## Execution Rules

- Complete each phase fully before starting the next.
- Run all unit tests + integration tests after each phase.
- If any test fails or unexpected behavior is observed, **STOP and report** — do not proceed to the next phase.
- Each guide lists required reading, exact code changes, and verification steps.

---

## Confirmed Bugs (Phase 0)

| # | Bug | File | Severity |
|---|-----|------|----------|
| 1 | 14 features missing from TRANSFORM_MAP | normalize.py:27-51 | Critical (blocks retraining) |
| 2 | Direction model artifact hash mismatch → inference disabled | daemon.py:530, artifact.py:138 | Critical (zero predictions) |
| 3 | 5 features have no availability flag | features.py | High (model can't detect missing data) |
| 4 | 2 features set avail=1 unconditionally on neutral | features.py | High (model misinterprets neutral as signal) |
| 5 | Population std instead of sample std in 5 functions | features.py | Medium (systematic vol underestimate) |
| 6 | Training/inference avail column count mismatch | pipeline.py:145 vs inference.py:150 | High (dimension mismatch on retrain) |
| 7 | Stale comment "12 + 9 = 21" in inference.py | inference.py:151 | Low |
| 8 | No lock on `_latest_predictions` cache | daemon.py:434 | Medium (race condition) |
| 9 | Fragile candle search in price_trend_1h/4h | features.py:797-801 | Medium |
| 10 | Stale candle fallback in microstructure features | features.py:1319 | Medium |

---

Last updated: 2026-03-22
