"""Hynous v2 journal module.

SQLite-backed trade journal replacing the Nous TypeScript memory server.

Phase 1: schema, staging_store, capture, counterfactuals (data capture pipeline).
Phase 2: JournalStore + embeddings + API routes + migration (production store).
Phase 3 (next): LLM analysis agent writes into trade_analyses.
Phase 4: staging_store.py is deleted alongside the rest of the v1 memory stack.

See ``README.md`` in this directory for the public API surface and
``v2-planning/05-phase-2-journal-module.md`` for the authoritative plan.
"""
