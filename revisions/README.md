# Revisions

> Known issues and planned improvements for Hynous. Read before making changes.

---

## Reading Order

### 1. Nous ↔ Python Integration (most issues live here)

Start with the executive summary, then dive into whichever file is relevant:

| File | Contents |
|------|----------|
| `nous-wiring/executive-summary.md` | **Start here.** Issue categories with context and current status |
| `nous-wiring/nous-wiring-revisions.md` | 10 wiring issues (NW-1 to NW-10) — **all 10 FIXED** |
| `nous-wiring/more-functionality.md` | 16 Nous features (MF-0 to MF-15) — 8 DONE, 8 remaining |

### 2. Full Issue List

| File | Contents |
|------|----------|
| `revision-exploration.md` | Master list of all 19 issues across the entire codebase, prioritized P0 through P3. Includes issues beyond Nous wiring (daemon behavior, system prompt, compression) |

---

## For Agents

If you're fixing a specific issue:

1. Read `nous-wiring/executive-summary.md` to understand which category your issue falls into
2. Find the specific issue in `nous-wiring-revisions.md` (NW-#) or `more-functionality.md` (MF-#)
3. Each issue has exact file paths, line numbers, and implementation instructions
4. Check `revision-exploration.md` for any related issues that may compound with yours

If you're doing a general review or planning work:

1. Read `nous-wiring/executive-summary.md` for the full landscape
2. Follow the fix priority table at the bottom — it's ordered by impact-to-effort ratio
