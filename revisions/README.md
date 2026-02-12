# Revisions

> Known issues and planned improvements for Hynous. Read before making changes.

---

## Reading Order

### 1. Nous ↔ Python Integration — ALL RESOLVED

| File | Contents |
|------|----------|
| `nous-wiring/executive-summary.md` | **Start here.** Issue categories with context and current status |
| `nous-wiring/nous-wiring-revisions.md` | 10 wiring issues (NW-1 to NW-10) — **all 10 FIXED** |
| `nous-wiring/more-functionality.md` | 16 Nous features (MF-0 to MF-15) — **14 DONE, 2 SKIPPED, 0 remaining** |

Detailed implementation + audit notes for major items:

| Directory | Item | Status |
|-----------|------|--------|
| `MF0/` | Search-before-store dedup | DONE, auditor verified |
| `MF12/` | Contradiction resolution execution | DONE, auditor verified |
| `MF13/` | Cluster management | DONE, auditor verified |
| `MF15/` | Gate filter for memory quality | DONE, auditor verified |

### 2. Token Optimization — TO-1 through TO-4 DONE

| File | Contents |
|------|----------|
| `token-optimization/executive-summary.md` | Overview of 8 TOs (4 implemented, 4 deferred) |
| `token-optimization/TO-1-dynamic-max-tokens.md` | Dynamic max_tokens per wake type (512-2048) |
| `token-optimization/TO-2-schema-trimming.md` | Trim store_memory/recall_memory schemas (~70% smaller) |
| `token-optimization/TO-3-stale-tool-truncation.md` | Tiered stale tool-result truncation (150/300/400/600/800) |
| `token-optimization/TO-4-window-size.md` | Window size 6→4 with Haiku compression |

Deferred for later: TO-5 (streaming cost abort), TO-6 (cron schedule tuning), TO-7 (prompt compression), TO-8 (model routing).

### 3. Full Issue List

| File | Contents |
|------|----------|
| `revision-exploration.md` | Master list of all 19 issues across the entire codebase, prioritized P0 through P3 |

---

## For Agents

If you're fixing a specific issue:

1. Check if it's already resolved in `nous-wiring/` or `token-optimization/`
2. Each issue has exact file paths, line numbers, and implementation instructions
3. Check `revision-exploration.md` for related issues that may compound with yours

If you're doing a general review or planning work:

1. Read `nous-wiring/executive-summary.md` for Nous integration status
2. Read `token-optimization/executive-summary.md` for cost optimization status
3. Check `revision-exploration.md` for the full issue landscape
