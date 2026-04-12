"""Analysis narrative embedding helper.

Thin wrapper around :class:`hynous.journal.embeddings.EmbeddingClient` for
the post-trade analysis agent. Narrative embeddings are best-effort and
stored on the ``trade_analyses.embedding`` column (bytes, matryoshka-
truncated to 512 dims matching the journal's entry snapshot embeddings
so downstream semantic search can mix scopes cleanly).
"""

from __future__ import annotations

import logging

from hynous.journal.embeddings import EmbeddingClient

logger = logging.getLogger(__name__)


def build_analysis_embedding(narrative: str) -> bytes | None:
    """Embed an analysis narrative; returns ``None`` when the text is empty.

    The caller wraps this in ``try/except`` — any failure (missing
    ``OPENAI_API_KEY``, HTTP error, empty input) is non-fatal and the
    analysis is persisted without an embedding. Semantic search over
    analyses simply excludes rows whose ``embedding`` is NULL.
    """
    if not narrative:
        return None
    client = EmbeddingClient()
    return client.embed(narrative)
