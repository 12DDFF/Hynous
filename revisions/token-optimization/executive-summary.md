# Token Optimization — Executive Summary

> Audit of all token-consuming paths in Hynous. Prioritized fixes to reduce API costs while maintaining agent quality.

---

## Status

| ID | Issue | Status | Priority | Est. Savings |
|----|-------|--------|----------|-------------|
| TO-1 | Dynamic max_tokens per wake type | **READY** | P0 | Output tokens capped per function |
| TO-2 | Trim store_memory + recall_memory schemas | **READY** | P1 | ~1,200 tokens/call (cached) |
| TO-3 | Tiered stale tool result truncation | **READY** | P1 | ~400-600 tokens/call |
| TO-4 | Reduce conversation window from 6 to 4 | **READY** | P1 | ~2,000 tokens/call |
| TO-5 | System prompt bloat (40% waste) | DEFERRED | P2 | ~1,025 tokens/call (cached) |
| TO-6 | Wake message instructional bloat | DEFERRED | P3 | 150-1,250 tokens/wake |
| TO-7 | store_memory verbosity feedback loop | DEFERRED | P2 | Compounds over time |
| TO-8 | Verbose tool result formatting | DEFERRED | P3 | ~100-500 tokens/call |

---

## Implementation Order

1. **TO-1** (dynamic max_tokens) — Biggest immediate impact on output token spend ($15/M)
2. **TO-2** (schema trimming) — Reduces cached input cost, faster processing
3. **TO-3** (stale tool truncation) — Reduces uncached history payload
4. **TO-4** (window size) — Reduces uncached history payload

Each issue has a dedicated implementation guide: `TO-{n}-*.md`

---

## Architecture Context

### How tokens flow through the system

```
User/Daemon message
    |
    v
agent.chat() or agent.chat_stream()
    |
    +-- _build_snapshot() or briefing injection  (0-800 tokens injected into message)
    +-- memory_manager.retrieve_context()        (0-1000 tokens injected into message)
    +-- stamp()                                  (~10 tokens per message)
    |
    v
_api_kwargs() builds the API call:
    |
    +-- system prompt      (~2,544 tokens, CACHED after 1st call)
    +-- tool schemas       (~13,600 tokens, CACHED after 1st call)
    +-- messages array     (~2,000-8,000 tokens, NOT cached, re-sent every call)
    |   |
    |   +-- _compact_messages() truncates stale tool results to 800 chars
    |   +-- _compact_messages() strips old [Live State]/[Briefing]/[Update] blocks
    |   +-- _build_messages() injects recalled memory context into last user message
    |
    v
Anthropic API call (Sonnet 4.5)
    |
    +-- If stop_reason == "tool_use": execute tools, append results, call API AGAIN
    +-- If stop_reason == "end_turn": return response
    |
    v
Post-response:
    +-- memory_manager.maybe_compress() evicts oldest exchanges, compresses via Haiku
    +-- flush_memory_queue() sends queued store_memory calls to Nous
    +-- persistence.save() writes history to disk
```

### Pricing reference (Sonnet 4.5)

| Token type | Price per 1M tokens |
|-----------|-------------------|
| Input (uncached) | $3.00 |
| Input (cache write, 1st call) | $3.75 |
| Input (cache read, subsequent) | $0.30 |
| **Output** | **$15.00** |

Output tokens are **5x more expensive** than uncached input and **50x more expensive** than cached input. This is why TO-1 (capping output) is the highest priority.

---

## Key Files

| File | Role |
|------|------|
| `src/hynous/intelligence/agent.py` | API call construction, history management, tool execution |
| `src/hynous/intelligence/daemon.py` | Wake orchestration, _wake_agent() |
| `src/hynous/intelligence/tools/registry.py` | Tool registration |
| `src/hynous/intelligence/tools/memory.py` | store_memory, recall_memory, update_memory |
| `src/hynous/intelligence/memory_manager.py` | Context retrieval, compression, window management |
| `src/hynous/intelligence/prompts/builder.py` | System prompt assembly |
| `src/hynous/intelligence/briefing.py` | Briefing injection system |
| `src/hynous/intelligence/context_snapshot.py` | Live state snapshot |
| `src/hynous/core/costs.py` | Cost tracking and pricing |
| `config/default.yaml` | Runtime configuration |

---

## Deferred Items (Context for Future Work)

### TO-5: System Prompt Bloat
The system prompt is ~2,544 tokens. ~40% is waste: duplicated Briefing/Update/Live State explanations (appears 3 times), "How My Memory Works" section (300 tokens of Nous technical docs), tool descriptions that repeat schemas. Deferred for discussion with the team. Possible solutions: surgical trim, full rewrite, or static/dynamic split.

### TO-6: Wake Message Instructional Bloat
Wake messages include step-by-step checklists the agent already knows from the system prompt. Not critical — the waste is 150-300 tokens per wake on routine wakes. Can revisit if costs need further reduction.

### TO-7: store_memory Verbosity Loop
The store_memory tool description says "be detailed, no need to be brief" which creates a feedback loop: verbose stores → verbose recalled context → inflated input tokens. Deferred — needs testing to confirm shorter memories don't reduce agent reasoning quality.

### TO-8: Verbose Tool Result Formatting
Trading tools return 8-12 lines (memory confirmations, auto-link details, SL/TP distance calculations). Watchpoint lists include 1500-char context blocks. Deferred — maintaining result quality is prioritized over token savings here.
