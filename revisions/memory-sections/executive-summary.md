# Memory Sections — Executive Summary

> **STATUS: FULLY IMPLEMENTED (2026-02-21)** — All 6 issues (0–5 foundation + 6 retrieval bias) are complete. New modules: `consolidation.py`, `playbook_matcher.py` (Python); `sections/` (TypeScript). All 443 Python + 4272/4273 TypeScript tests passing.

---

> The Hynous memory system (Nous) is functionally complete but architecturally flat. Every memory — whether a fleeting market signal, a hard-won trading lesson, or a procedural playbook — lives in the same table, competes for retrieval with the same weights, decays at the same rate, and gets pruned by the same rules. The brain does not work this way. This revision proposes **sectioned memory**: a reranking and lifecycle bias layer on top of the existing search infrastructure, where each memory's section membership influences how it's scored, how fast it decays, and how strongly it encodes — without replacing the underlying SSA retrieval system or partitioning nodes into separate stores.

---

## The Theory: Why Flat Memory Fails an Autonomous Agent

### The Brain Analogy

The human brain does not store all information in one undifferentiated pool. It has evolved specialized regions because **different kinds of knowledge require different treatment**:

- **The hippocampus** encodes new episodic memories rapidly but lets them fade quickly. It replays experiences during sleep, extracting patterns and transferring durable knowledge to the neocortex. It is a fast-write, fast-decay staging area.
- **The neocortex** stores consolidated long-term knowledge — principles, schemas, generalized rules. It encodes slowly (requiring repeated exposure or deliberate consolidation) but retains durably. Once something reaches the neocortex, it persists.
- **The amygdala** tags experiences with emotional salience. A near-death experience encodes with far greater strength than a routine walk. The amygdala doesn't store the memory itself — it modulates *how strongly* other regions encode it. High-stakes events get preferential encoding and retrieval.
- **The cerebellum** stores procedural knowledge — pattern-action pairs that become automatic through repetition. "When I see X, I do Y" is not the same kind of knowledge as "X happened on Tuesday." Procedural memory is retrieved by pattern-matching triggers, not by semantic similarity.
- **The prefrontal cortex** maintains working memory — the active scratchpad of what's relevant *right now*. It doesn't store long-term knowledge; it orchestrates retrieval from other regions and holds intermediate reasoning state.

Each region has its own:
- **Encoding rules** — how quickly and strongly new information is stored
- **Decay curves** — how fast information fades without reinforcement
- **Retrieval biases** — what signals matter most when searching (recency? semantic match? emotional weight?)
- **Consolidation pathways** — how information migrates between regions over time

### What Nous Has Today

Nous is a sophisticated system. It has SSA retrieval with 6-signal reranking, FSRS spaced-repetition decay, Hebbian edge learning, contradiction detection, deduplication, and a quality gate. These are powerful primitives.

But they are applied **uniformly**. The current architecture is:

```
┌─────────────────────────────────────────────────────────┐
│                    ONE BIG POOL                         │
│                                                         │
│  trade_entry, trade_close, lesson, thesis, signal,      │
│  watchpoint, curiosity, turn_summary, session_summary,  │
│  market_event, playbook, missed_opportunity, good_pass  │
│                                                         │
│  Same SSA weights:     semantic 0.30 / keyword 0.15 /   │
│                        graph 0.20 / recency 0.15 /      │
│                        authority 0.10 / affinity 0.10   │
│                                                         │
│  Same decay:           R = e^(-t/S), growth_rate 2.5    │
│                        for ALL subtypes                 │
│                                                         │
│  Same retrieval path:  Every query searches everything  │
│                                                         │
│  No stakes weighting:  A -20% loss encodes identically  │
│                        to a routine scan                │
│                                                         │
│  No consolidation:     Individual episodes compressed   │
│                        but never generalized across     │
│                        episodes                         │
└─────────────────────────────────────────────────────────┘
```

The subtype tags (`custom:lesson`, `custom:signal`, etc.) exist but they are **labels, not architectural boundaries**. They affect nothing algorithmically — no different weights, no different decay, no different retrieval priority.

This means:
- A 3-hour-old funding rate spike competes on equal footing with a trading principle learned over 20 trades
- A lesson that saved the agent from a catastrophic loss decays at the same rate as a curiosity item about an obscure altcoin
- The agent cannot say "check my playbooks first, then consult general knowledge" — every query hits the entire pool
- There is no mechanism to notice "I've seen this pattern 8 times and it predicted correctly 7 times" and promote that into a durable rule

### The Goal: Sectioned Memory

The target architecture gives different memory types **fundamentally different behaviors** — not just different labels. Each "section" should have:

1. **Its own retrieval profile** — different SSA reranking weights tuned to what matters for that kind of memory
2. **Its own decay curve** — fast decay for ephemeral data, slow decay for hard-won knowledge
3. **Its own consolidation rules** — background processes that extract patterns and promote durable knowledge
4. **Its own encoding strength modulation** — high-stakes events encode more strongly
5. **Its own retrieval triggers** — some sections activate on pattern-match, not semantic similarity
6. **Section-aware scoring** — the existing search still hits all nodes, but each result is reranked using the weights of the section it belongs to, and results from query-relevant sections get a priority boost

### Critical Design Principle: Sections Are a Bias Layer, Not Partitions

**Sections do not replace the existing search. They layer on top of it.**

The current SSA retrieval pipeline — vector seeding, BM25 keyword match, spreading activation, 6-signal reranking — remains the foundation. All nodes still live in one table. All queries still search all nodes. The graph still connects across sections (a lesson can have edges to the trade entries it emerged from, and spreading activation will follow those edges regardless of section boundaries).

What sections add is a **post-retrieval reranking bias**:

```
BEFORE (current):
  Query → SSA searches all nodes → rerank with GLOBAL weights → return

AFTER (sectioned):
  Query → SSA searches all nodes → tag each result with its section →
    rerank each result using ITS SECTION'S weights →
    apply priority boost for query-relevant sections → return
```

This matters for three reasons:

1. **No information loss.** Hard-filtering by section would hide relevant results. A query about "ETH funding rates" classified as knowledge-intent would miss the `trade_entry` where the agent actually traded that setup. With bias-based sections, that trade entry still appears — it just gets ranked by the episodic section's weights (recency-dominant) while a related lesson gets ranked by the knowledge section's weights (authority-dominant). Both are visible; the ranking reflects their nature.

2. **The graph already connects across sections.** SSA spreading activation follows edges. A lesson node linked to 5 trade entries will naturally pull those trades into results. Hard section walls would break this. The bias model preserves it.

3. **Graceful degradation.** If section classification is wrong or a memory is miscategorized, the result still appears — just potentially ranked differently. With hard walls, a misclassification means the result is invisible.

The one narrow exception where hard filtering is appropriate: **real-time signal queries** ("what signals are firing?") can safely exclude lessons, playbooks, and trade history because they are categorically irrelevant to "what's happening right now." This is an opt-in optimization for specific query patterns, not the general model.

---

## The Six Issues

### Issue 1: Uniform SSA Retrieval Weights

**Current state:** Every search uses identical reranking weights regardless of what's being searched for or what kind of memory is being retrieved.

```
All queries, all memory types:
  semantic:  0.30    (vector similarity)
  keyword:   0.15    (BM25 match)
  graph:     0.20    (spreading activation)
  recency:   0.15    (time decay)
  authority: 0.10    (inbound edge count)
  affinity:  0.10    (access history)
```

**Why this is wrong:** Different retrieval contexts demand radically different weight distributions.

Consider these scenarios:

**"What was my thesis for the ETH short last week?"** — This is a specific episodic recall. Recency matters enormously. Keyword match on "ETH short" matters. Semantic similarity matters less (the query is already specific). The ideal weights would heavily favor `recency` and `keyword`.

**"What lessons have I learned about trading funding rate divergences?"** — This is a knowledge recall. Recency is almost irrelevant — a lesson from 3 months ago is just as valid as one from yesterday. Authority matters (a lesson with many edges to trade outcomes is well-validated). Semantic match matters (the concept "funding rate divergence" needs to match). The ideal weights would heavily favor `semantic` and `authority`, with `recency` near zero.

**"What signals are firing right now?"** — This is a real-time situational query. Recency is everything. A signal from 4 hours ago is stale. Authority is irrelevant (signals don't accumulate edges). The ideal weights would be dominated by `recency`.

**"Show me my playbook for momentum breakouts"** — This is procedural recall. Graph connectivity matters (playbooks should be well-connected to the trades they emerged from). Keyword match on "momentum breakout" matters. Recency is irrelevant. The ideal weights would favor `keyword`, `graph`, and `authority`.

The current system cannot distinguish between these cases. A query about real-time signals gives the same weight to `recency` (0.15) as a query about timeless lessons. A query about well-validated playbooks gives the same weight to `authority` (0.10) as a query about fleeting curiosity items.

**What sectioned memory enables:** Each memory section defines its own reranking weight profile. After SSA retrieves candidates from the full node pool, each result is reranked using the weights of the section it belongs to. This means a `custom:signal` node in the results is scored with recency-dominant weights, while a `custom:lesson` node in the same result set is scored with authority-dominant weights — even though they were retrieved by the same query.

The `rerankCandidates()` function in `params/index.ts` already accepts an optional `weights` parameter. Today it always receives the global default. The change is to pass section-specific weights per result, not one global set for the entire batch.

Additionally, results from sections that are relevant to the query intent receive a priority boost multiplier. If the query is classified as knowledge-intent, lesson and thesis nodes get a boost on top of their section-specific reranking. This doesn't exclude other results — it biases the ranking toward the most relevant section while keeping everything visible.

**Where this lives in the codebase today:**
- Reranking weights: `nous-server/core/src/params/index.ts` → `RERANKING_WEIGHTS` (single global constant)
- Reranking function: `nous-server/core/src/params/index.ts` → `rerankCandidates()` (takes optional weights param but always receives the global default)
- SSA execution: `nous-server/core/src/ssa/index.ts` → `executeSSA()` (no section awareness)
- Search route: `nous-server/server/src/routes/search.ts` (no per-section weight dispatch)

---

### Issue 2: Uniform FSRS Decay Curves

**Current state:** All memories decay using the same FSRS model with the same parameters. The only differentiation is `AlgorithmNodeType` — a generic 7-category system (`person`, `fact`, `concept`, `event`, `note`, `document`, `preference`) that maps poorly to the agent's actual memory subtypes.

```
Current decay parameters (same for all):
  growth_rate:        2.5     (stability multiplier on recall)
  max_stability_days: 365     (cap)
  active_threshold:   0.5     (R > 0.5 = ACTIVE)
  weak_threshold:     0.1     (R > 0.1 = WEAK, else DORMANT)

Current initial stability (only varies by generic type):
  person:     14 days
  fact:        7 days
  concept:    21 days
  event:      10 days
  note:       30 days
  document:    7 days
  preference: 45 days
```

**Why this is wrong:** The agent's actual memory types have wildly different useful lifespans, and the current generic categories don't capture this.

Consider the actual subtypes and their ideal decay behavior:

**`custom:signal`** — A market signal (funding spike, OI surge, liquidation cascade) is useful for *hours to days*. After 48 hours, a funding rate signal is stale information. These should have aggressive decay — initial stability of 1-3 days, fast fade to DORMANT. Currently they inherit `concept` (21 days initial stability), meaning stale signals compete with fresh ones for weeks.

**`custom:lesson`** — A trading lesson ("don't chase pumps after 3 consecutive green candles") is potentially useful *forever*. It should have very high initial stability, slow decay, and strong reinforcement on recall. Currently it also inherits `concept` (21 days), meaning hard-won lessons start fading after 3 weeks without access — the same rate as a fleeting market signal.

**`custom:trade_entry` / `custom:trade_close`** — Trade records are historical facts. Their relevance for active decision-making fades over weeks, but they should never be fully deleted (they're the agent's track record). They need a medium decay to WEAK but should resist going DORMANT.

**`custom:thesis`** — A trading thesis ("ETH will outperform BTC in Q1 due to ETF flows") has a time-bound validity window. It should decay relatively quickly once its time horizon passes. Currently there's no mechanism to model this.

**`custom:playbook`** — A validated trading playbook should be among the most durable memories. If the agent has extracted "momentum breakout → enter on pullback to VWAP → 2:1 R:R" from 15 successful trades, that should decay extremely slowly. Currently it decays at the same rate as everything else.

**`custom:turn_summary` / `custom:session_summary`** — Compressed conversation records. These are the raw material for consolidation (see Issue 3). They should have medium decay — useful for cross-referencing recent sessions but not meant to persist indefinitely in their raw form.

**What sectioned memory enables:** Each section defines its own decay profile — initial stability, growth rate, decay thresholds, and lifecycle transition rules. Signals decay in hours. Lessons persist for months. Playbooks are nearly permanent. The FSRS parameters become per-section, not global.

**Where this lives in the codebase today:**
- Decay config: `nous-server/core/src/params/index.ts` → `DECAY_CONFIG` (single global)
- Initial stability: `nous-server/core/src/params/index.ts` → `INITIAL_STABILITY` (maps generic types only)
- Decay execution: `nous-server/core/src/forgetting/` (applies uniform model)
- Lifecycle transitions: `nous-server/core/src/params/index.ts` → `getDecayLifecycleState()` (same thresholds for all)
- Daemon trigger: `config/default.yaml` → `daemon.decay_interval: 21600` (6h, one cycle for everything)

---

### Issue 3: No Cross-Episode Generalization Pipeline

**Current state:** The system has single-episode compression (Haiku summarizes individual conversations into `turn_summary` nodes when the working window overflows). It also has agent-initiated lesson extraction (the LLM can decide to `store_memory` a lesson during a conversation). But there is no systematic background process that reviews accumulated episodes and extracts cross-episode patterns.

**What exists (and works):**
- Turn summaries compress individual conversations → `custom:turn_summary` nodes
- The agent can manually create `custom:lesson` and `custom:playbook` nodes during live conversations
- FSRS decay provides lifecycle transitions (ACTIVE → WEAK → DORMANT)
- Pruning tools can archive or delete stale nodes

**What's missing:** The biological analogy is hippocampal replay — the brain replays recent experiences during sleep, finds patterns across episodes, and consolidates those patterns into schema-level knowledge in the neocortex. The key difference from episode compression is:

- **Episode compression** (what exists): "In this conversation, the agent discussed ETH funding rates and opened a short" → one summary of one episode
- **Cross-episode generalization** (what's missing): "Across the last 12 trades where funding exceeded 0.08%, 9 resulted in reversals within 4 hours. The agent's thesis was correct in 75% of these cases. This pattern should be promoted to a playbook." → extracting durable knowledge from the *intersection* of many episodes

This matters because:
1. **The agent's context window is finite.** It cannot simultaneously review 12 trade entries to notice a pattern. Each conversation sees at most 4-5 recalled memories.
2. **Lesson creation is opportunistic.** The agent only creates lessons when it happens to notice something during a live conversation. Many patterns span more episodes than the agent can hold in context at once.
3. **Playbook validation requires statistical evidence.** "This setup has worked 9/12 times" requires reviewing all 12 trades — something the agent can't do in a single context window but a background consolidation process could.
4. **Ephemeral memories have value in aggregate.** Individual `turn_summary` nodes are mildly useful. But patterns across 50 turn summaries (e.g., "the agent consistently underestimates volatility on Sundays") are highly valuable and currently invisible.

**What sectioned memory enables:** A consolidation pipeline that periodically:
1. Retrieves clusters of related episodic memories (trades, signals, summaries)
2. Identifies recurring patterns across them (using LLM analysis with a larger review window)
3. Creates or strengthens knowledge-tier memories (lessons, playbooks) with statistical backing
4. Links the newly consolidated knowledge to its source episodes
5. Allows the source episodes to decay naturally, while the extracted knowledge persists

This is the "hippocampus → neocortex" transfer. Episodes are fast-write, fast-decay staging areas. Consolidated knowledge is slow-write, slow-decay permanent storage. The consolidation pipeline is the bridge between them.

**Where this would connect in the codebase:**
- Source data: `custom:trade_entry`, `custom:trade_close`, `custom:turn_summary`, `custom:signal` nodes
- Target data: `custom:lesson`, `custom:playbook` nodes (already exist as types)
- Trigger: daemon periodic task (similar to `_run_decay_cycle()`)
- Analysis: LLM call to review episode clusters and extract patterns
- Storage: `NousClient.create_node()` + edge linking to source episodes

---

### Issue 4: No Emotional / Stakes Weighting

**Current state:** All memories encode with the same strength regardless of their consequences. A trade that lost 20% of the portfolio creates a node with the same initial stability, the same FSRS parameters, and the same retrieval priority as a routine market scan that led to no action.

**What the brain does:** The amygdala modulates encoding strength based on emotional salience. Fear, pain, large rewards, and surprise all cause the amygdala to signal the hippocampus: "encode this more strongly." This is why people vividly remember traumatic events decades later but forget routine days immediately. The amygdala doesn't store the memory — it amplifies the encoding process in other regions.

**Why this matters for a trading agent:** Trading has natural emotional analogs:

- **Large losses** — A -20% drawdown on a position should encode with extreme strength. The circumstances leading to it, the thesis that was wrong, the signals that were ignored — all of this should be practically unforgettable. Currently, a catastrophic loss creates a `trade_close` node with the same 21-day initial stability as any other concept.

- **Exceptional wins** — A +50% trade where the thesis played out perfectly should also encode strongly, because it validates a pattern worth repeating. Currently, same encoding as any other trade.

- **Near-misses** — The `custom:missed_opportunity` type exists but gets no special encoding treatment. A missed opportunity where the agent would have captured a 30% move is extremely educational — it should encode as strongly as an actual win.

- **Surprise events** — A black swan (sudden 15% drop in 5 minutes) should encode strongly even if the agent had no position, because the context around it (what signals preceded it, what the market looked like before) is valuable for future pattern recognition.

- **Routine observations** — A regular funding rate check with normal values has near-zero educational value. Currently it gets the same encoding strength as everything else.

**What stakes weighting enables:** When a memory is created, its initial stability and encoding strength are modulated by a "salience score" derived from:
- **PnL magnitude** — Absolute gain/loss relative to portfolio size
- **Thesis accuracy** — How closely the outcome matched the prediction (surprise factor)
- **Rarity** — How anomalous the event was relative to historical baselines
- **Consequence** — Did this lead to action? Did the action have significant outcomes?

A salience score of 0.9 (catastrophic loss) might give 5x the initial stability of a salience score of 0.1 (routine observation). This means high-stakes memories resist decay much longer, surface more readily in retrieval (via the `affinity`/`authority` signals), and remain available when the agent faces similar situations.

**Where this connects in the codebase today:**
- Node creation: `NousClient.create_node()` → currently sets no salience metadata
- Initial stability: `INITIAL_STABILITY` in `params/index.ts` → per-type only, no per-instance modulation
- Trade execution: `tools/trading.py` → has full PnL data, confidence, and thesis but doesn't use it to modulate encoding
- Daemon fills: `daemon.py` → wakes agent on SL/TP fills, has outcome data
- FSRS on access: `updateStabilityOnAccess()` → could factor in salience but currently doesn't

---

### Issue 5: No Procedural Memory

**Current state:** The agent has `custom:playbook` as a subtype, but it's treated identically to any other concept node. There is no distinct retrieval mechanism for procedural knowledge — pattern→action pairs that should activate when a matching pattern is detected, not when a semantically similar query is issued.

**What procedural memory is:** In the brain, the cerebellum and basal ganglia store "when I see X, do Y" knowledge. This is fundamentally different from declarative memory ("I know that X is true"). Key differences:

- **Retrieval trigger:** Declarative memory is retrieved by query ("what do I know about X?"). Procedural memory is triggered by pattern recognition ("the current situation matches pattern X, so execute action Y").
- **Encoding mechanism:** Declarative memory forms from single exposure. Procedural memory forms from repetition and reinforcement — doing something successfully multiple times until it becomes automatic.
- **Representation:** Declarative memory is text/semantic. Procedural memory is structured: a trigger pattern, a set of conditions, and an action sequence.
- **Decay behavior:** Procedural memory is extremely durable once formed ("riding a bicycle") but requires many repetitions to establish. Declarative memory forms quickly but decays without rehearsal.

**Why this matters for a trading agent:** The agent's most valuable knowledge is arguably its playbooks — validated trading patterns extracted from experience:

> "When funding rate exceeds 0.10% AND open interest is rising AND price has been in a tight range for 4+ hours → likely squeeze incoming → short with tight stop above range high, target 2:1 R:R"

This is procedural knowledge. It should:
1. **Activate on pattern match, not semantic query.** When the daemon detects funding > 0.10% + rising OI + range-bound price, the relevant playbook should surface automatically — not because the agent happened to search for "funding rate" but because the market conditions triggered it.
2. **Strengthen through successful application.** Every time the agent executes this playbook and profits, the playbook's stability should increase. Every time it fails, the conditions should be refined or the playbook weakened.
3. **Have structured representation.** Not a blob of text, but parseable fields: trigger conditions (quantitative where possible), entry rules, exit rules, historical success rate, sample size.
4. **Resist decay.** A playbook validated across 15 trades should be nearly permanent. Current FSRS treats it like any other 21-day concept.

**What sectioned memory enables for procedural knowledge:**
- A distinct "procedural" section with structured nodes (trigger → condition → action)
- Pattern-matching retrieval that compares current market state against stored trigger conditions
- Reinforcement-based stability (success count determines durability, not time-based access)
- Automatic activation during daemon wakes when conditions match (proactive recall, not reactive query)
- A formation pathway: after N successful trades following the same pattern, the system proposes formalizing a playbook (this connects to Issue 3 — consolidation extracts the pattern, procedural section stores it)

**How procedural memory interacts with the bias model:** Procedural memory is the one section that adds a genuinely new retrieval mechanism *alongside* the existing SSA search, rather than just reranking SSA results differently. When the daemon wakes on a scanner anomaly, two things happen in parallel: (1) standard SSA search for relevant memories (the existing path, with section-aware reranking), and (2) a structured condition-match against stored playbook triggers (the new path). Results from both paths merge into the agent's context. This is additive — the playbook matcher doesn't replace SSA, it supplements it. If the agent explicitly searches "what playbooks do I have for funding squeezes?", standard SSA handles it (playbook nodes have text content that matches semantically). The structured matcher is specifically for the proactive case where market conditions trigger a playbook without anyone asking.

**Where this connects in the codebase today:**
- Playbook type: `custom:playbook` exists as a subtype but has no special behavior
- Pattern detection: `scanner.py` detects market anomalies but doesn't cross-reference against stored playbooks
- Daemon wakes: `daemon.py` wakes the agent on scanner anomalies but doesn't check if an existing playbook matches
- Trade outcomes: `tools/trading.py` records trade results but doesn't feed back into playbook validation

---

### Issue 6: Section-Aware Retrieval Bias

**Current state:** Every query searches the entire node pool with a single pass and applies one global set of reranking weights. The Intelligent Retrieval Orchestrator decomposes compound queries into sub-queries and runs them in parallel, but all sub-queries search the same undifferentiated pool with the same scoring.

**What's changing — and what's NOT changing:**

The existing retrieval pipeline stays intact. SSA vector seeding, BM25 keyword match, spreading activation through graph edges, the 6-signal reranking framework — all of this remains. The query still hits all nodes. Results from any section can appear for any query. The graph still connects across sections, and spreading activation still follows edges regardless of which section a node belongs to.

What changes is what happens *after* SSA returns its candidates:

```
BEFORE (current):
  Query → SSA retrieves candidates from ALL nodes →
    rerank ALL candidates with GLOBAL weights →
    return top N

AFTER (sectioned):
  Query → SSA retrieves candidates from ALL nodes →
    classify query intent (which section is most relevant?) →
    for each candidate:
      look up its section membership (based on subtype) →
      rerank using THAT SECTION'S weights →
    apply priority boost to candidates from query-relevant section(s) →
    return top N
```

**Why this is the right model:**

**No information loss.** The most dangerous failure mode for sectioned retrieval is hiding relevant results behind a wall the intent classifier didn't open. Consider: the agent asks "what do I know about ETH funding rates?" and the classifier tags it as knowledge-intent. With hard filtering, a highly relevant `trade_entry` where the agent actually traded ETH based on funding rates would be invisible — it lives in the episodic section, and the classifier didn't select that section. With the bias model, that trade entry still appears in results. It gets reranked using the episodic section's weights (recency-favoring), while a related lesson gets reranked using the knowledge section's weights (authority-favoring). The lesson ranks higher because the query-relevant section (knowledge) gets a priority boost — but the trade entry is still visible if its SSA score is strong enough.

**The graph already connects across sections.** This is critical. A `custom:lesson` node often has `causes` or `relates_to` edges pointing to the `custom:trade_entry` nodes it was derived from. SSA spreading activation follows these edges naturally, pulling trade entries into the result set when a lesson is a seed node. Hard section walls would sever these cross-section connections. The bias model preserves them entirely — spreading activation operates on the full graph, and section-specific reranking happens only at the final scoring stage.

**Graceful degradation.** If the intent classifier miscategorizes a query, or if a memory's section assignment is wrong, the result still appears — just potentially ranked slightly differently than optimal. With hard walls, misclassification means total invisibility. The bias model turns classification errors from catastrophic (missing results) to minor (slightly suboptimal ranking).

**Intent classification determines boost, not filter.** When the system classifies a query as knowledge-intent, it doesn't restrict results to the knowledge section. It applies a boost multiplier (e.g., 1.3x) to candidates from the knowledge section. A signal node with a raw SSA score of 0.85 can still outrank a lesson node with a raw SSA score of 0.40 — the boost helps relevant-section results but doesn't guarantee they win. This ensures that genuinely strong cross-section results always surface.

**The narrow exception for hard filtering.** There is exactly one case where hard filtering makes sense: real-time signal queries ("what signals are firing right now?"). When the agent or daemon explicitly asks for current signals, there is genuinely no reason to include lessons, playbooks, or trade history in the results. This is an opt-in optimization for a specific, unambiguous query pattern — not the general retrieval model. It can be triggered by explicit subtype filtering (which the search API already supports) rather than by section routing logic.

**How this interacts with the existing orchestrator:** The Intelligent Retrieval Orchestrator (`retrieval_orchestrator.py`) already has a 5-step pipeline: Classify → Decompose → Parallel Search → Quality Gate → Merge & Select. Section-aware retrieval fits naturally into this pipeline. The Classify step expands to include intent-to-section mapping. The Parallel Search step remains unchanged (each sub-query still calls `search_full()` on the full node pool). The Merge & Select step applies section-specific reranking and priority boosts before returning results. No fundamental restructuring of the orchestrator is needed — sections add a reranking layer within the existing merge step.

**Where this lives in the codebase today:**
- Retrieval orchestrator: `src/hynous/intelligence/retrieval_orchestrator.py` → dispatches all sub-queries to `NousClient.search_full()` with no section awareness; the merge step applies uniform scoring
- QCS: `nous-server/core/src/qcs/` → classifies query structure (D1-D6 disqualifiers) but not query intent relative to memory sections
- Search route: `nous-server/server/src/routes/search.ts` → takes optional `subtype` filter but caller must specify it manually; returns results with score breakdowns that could be re-weighted per-section
- Reranking: `nous-server/core/src/params/index.ts` → `rerankCandidates()` already accepts custom weights but always receives the global default
- Memory manager auto-retrieval: `memory_manager.py` → calls orchestrator with raw query, no section awareness

---

## How the Six Issues Interconnect

These six issues are not independent. They form a coherent system where each reinforces the others:

```
                    ┌──────────────────────────┐
                    │  Issue 6: Section-Aware  │
                    │   Retrieval Bias         │
                    │  (reranks results using  │
                    │   section weights +      │
                    │   intent-based boost)    │
                    └──────┬───────────────────┘
                           │ needs sections to exist
                           ▼
    ┌──────────────────────────────────────────┐
    │         Memory Sections (the core)       │
    │                                          │
    │  Each section defined by:                │
    │   • Issue 1: Its reranking weights       │
    │   • Issue 2: Its decay curve             │
    │   • Issue 5: Its retrieval trigger type  │
    │     (semantic vs pattern-match)          │
    └──────┬──────────────────────┬────────────┘
           │                      │
           ▼                      ▼
┌─────────────────────┐  ┌────────────────────────┐
│  Issue 4: Stakes    │  │  Issue 3: Cross-Episode │
│  Weighting          │  │  Generalization         │
│  (modulates HOW     │  │  (moves knowledge       │
│  strongly memories  │  │  BETWEEN sections:      │
│  encode into their  │  │  episodes → knowledge   │
│  section)           │  │  → procedural)          │
└─────────────────────┘  └────────────────────────┘
```

**Issues 1 + 2** define what makes each section unique (different retrieval behavior, different temporal behavior).

**Issue 5** defines a new *kind* of section (procedural) that adds a structured pattern-matching retrieval path alongside the existing SSA search.

**Issue 4** modulates encoding strength *within* sections — it's orthogonal to which section a memory belongs to.

**Issue 3** provides the migration pathway *between* sections — ephemeral episodes consolidate into durable knowledge, which can further crystallize into procedural playbooks.

**Issue 6** is the bias layer that makes sections useful at retrieval time — reranking results using per-section weights and boosting results from query-relevant sections, without filtering or partitioning the search space.

---

## Proposed Section Model

Based on the brain analogy and the agent's actual memory types, the natural sections are:

| Section | Brain Analog | Memory Subtypes | Character |
|---------|-------------|-----------------|-----------|
| **Episodic** | Hippocampus | `trade_entry`, `trade_close`, `trade_modify`, `turn_summary`, `session_summary`, `market_event` | Fast-write, medium-decay. Records of what happened. High recency bias in retrieval. Source material for consolidation. |
| **Signals** | Sensory cortex | `signal`, `watchpoint` | Fastest decay. Extremely recency-dominant retrieval. Stale signals are noise. High write volume, high churn. |
| **Knowledge** | Neocortex | `lesson`, `thesis`, `curiosity` | Slow-decay, authority-dominant retrieval. Formed through consolidation or deliberate agent reflection. The agent's accumulated wisdom. |
| **Procedural** | Cerebellum / Basal ganglia | `playbook`, `good_pass`, `missed_opportunity` | Pattern-match retrieval alongside standard SSA. Reinforcement-based stability (success count, not time). Extremely durable once validated. |
| **Working** | Prefrontal cortex | (in-memory, not persisted in Nous) | Already exists as the conversation working window in `memory_manager.py`. Not a Nous section — it's the active scratchpad. |

**All sections share one node table, one graph, one SSA pipeline.** Section membership is determined by subtype → section mapping (a static lookup). What differs per section:

- **Reranking weights** — per-section `RerankingWeights` used during the post-SSA reranking step instead of the global default
- **Decay profile** — per-section `DecayConfig` with appropriate initial stability, growth rate, and thresholds
- **Encoding modulation** — how stakes/salience affects initial stability within that section (Issue 4)
- **Consolidation role** — whether this section is a *source* for consolidation (episodic, signals), a *target* (knowledge, procedural), or neither (working)
- **Priority boost eligibility** — the intent classifier determines which section(s) get a boost for a given query; boost is a multiplier on final score, not a filter

---

## Companion Implementation Guides

This executive summary defines the **theory and problem statement**. The following companion guides provide full implementation details — exact code blocks (find → replace), file paths with line numbers, test specifications, and verification checklists:

| Guide | File | Scope |
|-------|------|-------|
| Issue 0 | `issue-0-section-foundation.md` | Shared types, subtype→section mapping, config, Python+TS sync |
| Issue 1 | `issue-1-retrieval-weights.md` | Per-section SSA reranking weights (`rerankWithSections()` in TS) |
| Issue 2 | `issue-2-decay-curves.md` | Per-section FSRS decay (initial stability, growth rate, thresholds) |
| Issue 3 | `issue-3-generalization.md` | Cross-episode consolidation pipeline (`ConsolidationEngine` in Python) |
| Issue 4 | `issue-4-stakes-weighting.md` | Salience-modulated encoding (`calculate_salience()` in Python) |
| Issue 5 | `issue-5-procedural-memory.md` | Procedural memory + playbook matcher (`PlaybookMatcher` in Python) |
| Issue 6 | `issue-6-retrieval-bias.md` | Intent classification + section-aware boost in retrieval orchestrator |

**Implementation order:** 0 → 1 & 2 (parallel) → 6 → 4 → 3 → 5

Each guide follows the established revision format with Required Reading tables, Architecture Decisions, step-by-step Implementation Steps with exact find/replace code, Testing (unit + integration + live local + live VPS), Verification Checklists, and File Summaries.

---

## Summary

The Hynous memory system has powerful primitives (SSA, FSRS, Hebbian learning, contradiction detection) applied uniformly to an undifferentiated pool. The brain's architecture demonstrates that **specialized regions with different behaviors** dramatically outperform a flat store for an agent that must simultaneously handle fast-decaying signals, durable lessons, episodic trade records, and procedural playbooks.

The six issues identified here — uniform retrieval weights, uniform decay, no cross-episode generalization, no stakes weighting, no procedural memory, and flat retrieval — collectively define what's needed to evolve Nous from a flat memory system into a sectioned cognitive architecture.

**The critical design constraint: sections are a bias layer, not partitions.** All nodes remain in one table. All queries still search all nodes. The graph still connects across sections. What sections add is per-section reranking weights, per-section decay curves, per-section encoding modulation, and an intent-based priority boost at retrieval time. This preserves the existing system's strengths (open-ended search, cross-section graph traversal, graceful degradation) while giving each memory type the specialized treatment it needs.

Each issue reinforces the others, and together they transform the agent's ability to learn from experience, retain what matters, forget what doesn't, and apply validated knowledge when it counts.
