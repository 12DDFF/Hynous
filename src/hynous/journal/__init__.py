"""Hynous v2 journal module.

SQLite-backed trade journal replacing the Nous TypeScript memory server.

Phase 1: schema, staging_store, capture, counterfactuals (data capture pipeline).
Phase 2: JournalStore + embeddings + API routes + migration (production store).
Phase 3: LLM analysis agent writes into trade_analyses.

Note: staging_store.py remains in the tree because
``tests/unit/test_v2_capture.py`` and
``tests/integration/test_v2_journal_integration.py`` import StagingStore for
round-trip fixtures, and migrate_staging.py references it conceptually (it
actually opens staging.db via raw sqlite3). The daemon no longer writes to
StagingStore — JournalStore is the sole production write target since
phase 2 M7. See docs/revisions/v2-debug/README.md § M2.

See ``README.md`` in this directory for the public API surface and
``v2-planning/05-phase-2-journal-module.md`` for the authoritative plan.
"""
