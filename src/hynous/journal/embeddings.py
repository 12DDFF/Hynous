"""OpenAI text-embedding-3-small client + cosine similarity + snapshot→text helper.

Embeddings are truncated to ``COMPARISON_DIM`` using the matryoshka property of
text-embedding-3-small — the first N dimensions of the 1536-d vector retain
most of the semantic content and cosine distance is well-behaved at smaller
sizes. 512 dims × 4 bytes (float32) = 2048 bytes per row — storage-cheap
and ~3× faster cosine than full 1536.
"""

from __future__ import annotations

import logging
import os
import struct
import time
from typing import Any

import requests  # type: ignore[import-untyped]  # types-requests not in deps; matches existing pattern in data/providers/*

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "text-embedding-3-small"
DEFAULT_DIM = 1536
COMPARISON_DIM = 512  # matryoshka truncation for fast cosine


class EmbeddingClient:
    """Wraps OpenAI ``/v1/embeddings`` with retries, batching, and matryoshka truncation.

    Model names are accepted with or without a provider prefix (e.g. both
    ``"openai/text-embedding-3-small"`` and ``"text-embedding-3-small"`` work).
    The prefix is stripped at init time because the OpenAI direct API rejects
    provider-prefixed names; v2's config stores names with prefixes for
    consistency with OpenRouter-style entries elsewhere.
    """

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str = DEFAULT_MODEL,
        dim: int = DEFAULT_DIM,
        comparison_dim: int = COMPARISON_DIM,
        timeout_s: float = 30.0,
    ) -> None:
        self._api_key = api_key or os.environ.get("OPENAI_API_KEY")
        if not self._api_key:
            raise RuntimeError("OPENAI_API_KEY not set")
        # Accept both "openai/text-embedding-3-small" and bare "text-embedding-3-small".
        # OpenAI rejects provider-prefixed names; v2 config stores them prefixed for
        # consistency so we normalize here.
        self._model = model.split("/", 1)[-1]
        self._dim = dim
        self._comparison_dim = comparison_dim
        self._timeout_s = timeout_s
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        })

    def embed(self, text: str) -> bytes:
        """Embed a single text; returns float32 bytes truncated to ``comparison_dim``."""
        return self.embed_batch([text])[0]

    def embed_batch(self, texts: list[str]) -> list[bytes]:
        """Batch embed. Returns one bytes blob per input text, preserving order.

        Retries up to 3 times on 429 (rate limit, exponential backoff) or on
        transient request exceptions. Raises after exhausting retries.
        """
        if not texts:
            return []

        # Cap text length as a cheap pre-flight against the 8191-token model limit
        # (~30K chars at 4 chars/token for English).
        capped = [t[:30000] for t in texts]

        retries = 3
        last_error: BaseException | None = None
        for attempt in range(retries):
            try:
                response = self._session.post(
                    "https://api.openai.com/v1/embeddings",
                    json={
                        "model": self._model,
                        "input": capped,
                        "encoding_format": "float",
                    },
                    timeout=self._timeout_s,
                )
                response.raise_for_status()
                data = response.json()

                result: list[bytes] = []
                for item in data["data"]:
                    vec = item["embedding"]
                    truncated = vec[:self._comparison_dim]
                    packed = struct.pack(f"{len(truncated)}f", *truncated)
                    result.append(packed)
                return result

            except requests.exceptions.HTTPError as e:
                last_error = e
                status = getattr(e.response, "status_code", None)
                if status == 429 and attempt < retries - 1:
                    backoff = 2 ** attempt
                    logger.warning(
                        "OpenAI embedding rate limited, backoff %ds", backoff,
                    )
                    time.sleep(backoff)
                    continue
                raise
            except requests.exceptions.RequestException as e:
                last_error = e
                if attempt < retries - 1:
                    time.sleep(1)
                    continue
                raise

        raise RuntimeError(f"Embedding failed after {retries} retries: {last_error}")


def cosine_similarity(a_bytes: bytes, b_bytes: bytes) -> float:
    """Cosine similarity between two float32 byte blobs of equal length.

    Returns 0.0 when either blob is empty, lengths differ, or a vector has
    zero magnitude. These are defensive defaults — a well-formed query will
    never hit them.
    """
    if not a_bytes or not b_bytes or len(a_bytes) != len(b_bytes):
        return 0.0

    n = len(a_bytes) // 4
    a = struct.unpack(f"{n}f", a_bytes)
    b = struct.unpack(f"{n}f", b_bytes)

    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5

    if norm_a == 0 or norm_b == 0:
        return 0.0

    return float(dot / (norm_a * norm_b))


def build_entry_embedding_text(snapshot_dict: dict[str, Any]) -> str:
    """Build a concise text description of an entry snapshot for embedding.

    Captures what signals were firing and what the market looked like — the
    "essence" of the trade setup that semantic search should match on.
    """
    basics = snapshot_dict.get("trade_basics", {})
    ml = snapshot_dict.get("ml_snapshot", {})
    market = snapshot_dict.get("market_state", {})
    derivs = snapshot_dict.get("derivatives_state", {})
    trigger = snapshot_dict.get("trigger_context", {})

    parts: list[str] = [
        f"{basics.get('symbol')} {basics.get('side')} {basics.get('leverage')}x "
        f"at {basics.get('entry_px')}",
        f"trigger: {trigger.get('trigger_source')} {trigger.get('trigger_type')}",
        f"composite entry score: {ml.get('composite_entry_score')} "
        f"{ml.get('composite_label')}",
        f"vol regime: {ml.get('vol_1h_regime')} value {ml.get('vol_1h_value')}",
        f"entry quality pctl: {ml.get('entry_quality_percentile')}",
        f"direction signal: {ml.get('direction_signal')}",
        f"funding: {derivs.get('funding_rate')} oi: {derivs.get('open_interest')}",
        f"1h change: {market.get('pct_change_1h')}%",
    ]
    return " | ".join(p for p in parts if p)
