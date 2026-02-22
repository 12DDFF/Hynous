"""
Nous Client — HTTP wrapper for the Nous memory server.

Talks to the TypeScript Nous server running on localhost:3100.
Provides node CRUD, edge CRUD, and text search.

Singleton pattern — use get_client() to get the shared instance.
Sync (requests.Session) — matches the rest of the Hynous stack.
"""

import json
import logging
from typing import Optional

import requests

from ..core.config import load_config

logger = logging.getLogger(__name__)


_client: Optional["NousClient"] = None


def get_client() -> "NousClient":
    """Get or create the singleton NousClient."""
    global _client
    if _client is None:
        cfg = load_config()
        _client = NousClient(base_url=cfg.nous.url)
    return _client


class NousClient:
    """HTTP client for the Nous memory server."""

    # Default timeout for all Nous HTTP calls (seconds).
    # Decay overrides this with _DECAY_TIMEOUT since it processes all nodes.
    _DEFAULT_TIMEOUT = 30
    _DECAY_TIMEOUT = 180  # 3 min ceiling — if decay takes longer, something is wrong

    def __init__(self, base_url: str = "http://localhost:3100"):
        self.base_url = base_url.rstrip("/")
        self._session = requests.Session()
        self._session.headers.update({"Content-Type": "application/json"})
        logger.info("NousClient initialized → %s", self.base_url)

    def _url(self, path: str) -> str:
        return f"{self.base_url}/v1{path}"

    # ---- Health ----

    def health(self) -> dict:
        """Check server health."""
        resp = self._session.get(self._url("/health"), timeout=self._DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    # ---- Node CRUD ----

    def create_node(
        self,
        type: str,
        subtype: str,
        title: str,
        body: Optional[str] = None,
        summary: Optional[str] = None,
        event_time: Optional[str] = None,
        event_confidence: Optional[float] = None,
        event_source: Optional[str] = None,
        neural_stability: Optional[float] = None,
    ) -> dict:
        """Create a new node. Returns the full node dict with generated ID.

        Args:
            neural_stability: Optional FSRS stability override in days.
                When provided, overrides the default from getNeuralDefaults().
                Used by stakes weighting (Issue 4) to encode high-salience
                events with stronger initial stability.
        """
        payload = {
            "type": type,
            "subtype": subtype,
            "content_title": title,
            "content_body": body,
            "content_summary": summary,
        }
        if event_time:
            payload["temporal_event_time"] = event_time
        if event_confidence is not None:
            payload["temporal_event_confidence"] = event_confidence
        if event_source:
            payload["temporal_event_source"] = event_source
        if neural_stability is not None:
            payload["neural_stability"] = neural_stability
        resp = self._session.post(self._url("/nodes"), json=payload, timeout=self._DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    def get_node(self, node_id: str) -> Optional[dict]:
        """Get a node by ID. Returns None if not found."""
        resp = self._session.get(self._url(f"/nodes/{node_id}"), timeout=self._DEFAULT_TIMEOUT)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()

    def list_nodes(
        self,
        type: Optional[str] = None,
        subtype: Optional[str] = None,
        lifecycle: Optional[str] = None,
        limit: int = 50,
        created_after: Optional[str] = None,
        created_before: Optional[str] = None,
    ) -> list[dict]:
        """List nodes with optional filters."""
        params: dict = {"limit": limit}
        if type:
            params["type"] = type
        if subtype:
            params["subtype"] = subtype
        if lifecycle:
            params["lifecycle"] = lifecycle
        if created_after:
            params["created_after"] = created_after
        if created_before:
            params["created_before"] = created_before
        resp = self._session.get(self._url("/nodes"), params=params, timeout=self._DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json().get("data", [])

    def update_node(self, node_id: str, **updates) -> dict:
        """Partial update a node. Pass fields as kwargs."""
        resp = self._session.patch(self._url(f"/nodes/{node_id}"), json=updates, timeout=self._DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    def delete_node(self, node_id: str) -> bool:
        """Delete a node. Raises on HTTP errors."""
        resp = self._session.delete(self._url(f"/nodes/{node_id}"), timeout=self._DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.status_code == 200

    # ---- Edge CRUD ----

    def create_edge(
        self,
        source_id: str,
        target_id: str,
        type: str,
        strength: float | None = None,
    ) -> dict:
        """Create an edge between two nodes.

        If strength is not provided, the server assigns an SSA default
        based on edge type (e.g. causes=0.8, relates_to=0.5).
        """
        payload: dict = {
            "source_id": source_id,
            "target_id": target_id,
            "type": type,
        }
        if strength is not None:
            payload["strength"] = strength
        resp = self._session.post(self._url("/edges"), json=payload, timeout=self._DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    def get_edges(
        self,
        node_id: str,
        direction: str = "both",
    ) -> list[dict]:
        """Get edges for a node. Direction: 'in', 'out', or 'both'."""
        params = {"node_id": node_id, "direction": direction}
        resp = self._session.get(self._url("/edges"), params=params, timeout=self._DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json().get("data", [])

    def strengthen_edge(self, edge_id: str, amount: float = 0.05) -> dict:
        """Hebbian co-activation: strengthen an edge.

        Increments the edge's strength by amount, capped at 1.0.
        Stronger edges make SSA spreading activation flow more energy
        between connected nodes.
        """
        resp = self._session.post(
            self._url(f"/edges/{edge_id}/strengthen"),
            json={"amount": amount},
            timeout=self._DEFAULT_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()

    def delete_edge(self, edge_id: str) -> bool:
        """Delete an edge. Raises on HTTP errors."""
        resp = self._session.delete(self._url(f"/edges/{edge_id}"), timeout=self._DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.status_code == 200

    # ---- Graph (bulk fetch for visualization) ----

    def get_graph(self) -> dict:
        """Get full graph data (all nodes + edges) for visualization."""
        resp = self._session.get(self._url("/graph"), timeout=self._DECAY_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    # ---- Contradiction Detection ----

    def detect_contradiction(self, content: str, title: Optional[str] = None, node_id: Optional[str] = None) -> dict:
        """Run tier 1-2 pattern detection on content."""
        payload: dict = {"content": content}
        if title:
            payload["title"] = title
        if node_id:
            payload["node_id"] = node_id
        resp = self._session.post(self._url("/contradiction/detect"), json=payload, timeout=self._DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    def get_conflicts(self, status: str = "pending") -> list[dict]:
        """Get conflict queue items."""
        resp = self._session.get(self._url("/contradiction/queue"), params={"status": status}, timeout=self._DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json().get("data", [])

    def resolve_conflict(self, conflict_id: str, resolution: str) -> dict:
        """Resolve a conflict. Resolution: old_is_current, new_is_current, keep_both, merge."""
        resp = self._session.post(
            self._url("/contradiction/resolve"),
            json={"conflict_id": conflict_id, "resolution": resolution},
            timeout=self._DEFAULT_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()

    # TypeScript enforces max 50 items per batch-resolve call.
    _MAX_BATCH_RESOLVE = 50

    def batch_resolve_conflicts(self, items: list[dict]) -> dict:
        """Batch resolve conflicts. items: [{conflict_id, resolution}, ...]

        Splits into chunks of 50 to respect the TypeScript server limit.
        Returns merged: {ok, resolved, failed, total, results}
        """
        if not items:
            return {"ok": True, "resolved": 0, "failed": 0, "total": 0, "results": []}

        # Split into chunks if needed — TypeScript enforces max 50 per call
        chunks = [items[i:i + self._MAX_BATCH_RESOLVE] for i in range(0, len(items), self._MAX_BATCH_RESOLVE)]
        merged: dict = {"ok": True, "resolved": 0, "failed": 0, "total": 0, "results": []}

        for chunk in chunks:
            resp = self._session.post(
                self._url("/contradiction/batch-resolve"),
                json={"items": chunk},
                timeout=self._DEFAULT_TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
            merged["resolved"] += data.get("resolved", 0)
            merged["failed"] += data.get("failed", 0)
            merged["total"] += data.get("total", 0)
            merged["results"].extend(data.get("results", []))
            if not data.get("ok", True):
                merged["ok"] = False

        return merged

    # ---- Decay ----

    def run_decay(self) -> dict:
        """Run FSRS decay cycle across all nodes.

        Recomputes retrievability and transitions lifecycle states
        (ACTIVE → WEAK → DORMANT). Returns stats with transition details.

        Uses _DECAY_TIMEOUT (3 min) — longer than default because it processes
        every node in the database. If it exceeds this, something is wrong with
        the server-side implementation (see decay.ts N+1 query issue).
        """
        resp = self._session.post(self._url("/decay"), timeout=self._DECAY_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    # ---- Embedding Backfill ----

    def backfill_embeddings(self) -> dict:
        """Generate embeddings for nodes that are missing them.

        Finds all nodes with no vector embedding and generates one.
        Returns {ok, embedded, total}.
        """
        resp = self._session.post(self._url("/nodes/backfill-embeddings"), timeout=self._DECAY_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    # ---- Search ----

    def search(
        self,
        query: str,
        type: Optional[str] = None,
        subtype: Optional[str] = None,
        lifecycle: Optional[str] = None,
        limit: int = 10,
        time_range: Optional[dict] = None,
        cluster_ids: list[str] | None = None,
    ) -> list[dict]:
        """Full-text search across nodes."""
        payload: dict = {"query": query, "limit": limit}
        if type:
            payload["type"] = type
        if subtype:
            payload["subtype"] = subtype
        if lifecycle:
            payload["lifecycle"] = lifecycle
        if time_range:
            payload["time_range"] = time_range
        if cluster_ids:
            payload["cluster_ids"] = cluster_ids
        resp = self._session.post(self._url("/search"), json=payload, timeout=self._DEFAULT_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()

        # Log QCS metadata for debugging retrieval path (MF-10)
        qcs = data.get("qcs", {})
        if qcs:
            query_type = qcs.get("query_type", "?")
            used_embeddings = qcs.get("used_embeddings", False)
            disqualified = qcs.get("disqualified", False)
            if disqualified:
                logger.debug(
                    "QCS: query=%r → %s (disqualified: %s), embeddings=%s",
                    query[:50], query_type, qcs.get("disqualifier_category"), used_embeddings,
                )
            else:
                logger.debug(
                    "QCS: query=%r → %s, embeddings=%s",
                    query[:50], query_type, used_embeddings,
                )

        return data.get("data", [])

    def search_full(
        self,
        query: str,
        type: Optional[str] = None,
        subtype: Optional[str] = None,
        lifecycle: Optional[str] = None,
        limit: int = 10,
        time_range: Optional[dict] = None,
        cluster_ids: list[str] | None = None,
    ) -> dict:
        """Full-text search returning results with QCS metadata and metrics.

        Same as search() but returns the complete response dict instead of
        just the data array. Used by the retrieval orchestrator for quality
        gating and score-based selection.

        Returns:
            {
                "data": [...],       # Node dicts with score, breakdown, primary_signal
                "count": int,
                "metrics": {...},
                "qcs": {
                    "query_type": "LOOKUP"|"AMBIGUOUS",
                    "confidence": float,
                    "disqualified": bool,
                    "disqualifier_category": str|None,
                    "used_embeddings": bool,
                    "ssa_multiplier": int,
                },
            }
        """
        payload: dict = {"query": query, "limit": limit}
        if type:
            payload["type"] = type
        if subtype:
            payload["subtype"] = subtype
        if lifecycle:
            payload["lifecycle"] = lifecycle
        if time_range:
            payload["time_range"] = time_range
        if cluster_ids:
            payload["cluster_ids"] = cluster_ids
        resp = self._session.post(self._url("/search"), json=payload, timeout=self._DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    # ---- Dedup Check ----

    def check_similar(
        self,
        content: str,
        title: str,
        subtype: str,
        limit: int = 5,
    ) -> dict:
        """Check if similar nodes exist before storing.

        Compares content embedding against existing nodes of the same subtype.
        Returns similarity matches with recommended actions based on thresholds:
          - duplicate (>= 0.95 cosine): near-identical content exists
          - connect (0.90-0.95 cosine): similar content, should link

        Used by _store_memory_impl() for lesson and curiosity dedup.
        """
        resp = self._session.post(
            self._url("/nodes/check-similar"),
            json={
                "content": content,
                "title": title,
                "subtype": subtype,
                "limit": limit,
            },
            timeout=self._DEFAULT_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()

    # ---- Query Classification ----

    def classify_query(self, query: str) -> dict:
        """Classify a query for SSA optimization (QCS pre-classification)."""
        resp = self._session.post(self._url("/classify-query"), json={"query": query}, timeout=self._DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    # ================================================================
    # Clusters (MF-13)
    # ================================================================

    def create_cluster(
        self,
        name: str,
        description: str | None = None,
        icon: str | None = None,
        pinned: bool = False,
        auto_subtypes: list[str] | None = None,
    ) -> dict:
        """Create a new cluster."""
        payload: dict = {"name": name}
        if description is not None:
            payload["description"] = description
        if icon is not None:
            payload["icon"] = icon
        if pinned:
            payload["pinned"] = True
        if auto_subtypes:
            payload["auto_subtypes"] = auto_subtypes
        resp = self._session.post(self._url("/clusters"), json=payload, timeout=self._DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    def list_clusters(self) -> list[dict]:
        """List all clusters with node counts."""
        resp = self._session.get(self._url("/clusters"), timeout=self._DEFAULT_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", data) if isinstance(data, dict) else data

    def get_cluster(self, cluster_id: str) -> dict:
        """Get cluster details."""
        resp = self._session.get(self._url(f"/clusters/{cluster_id}"), timeout=self._DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    def update_cluster(self, cluster_id: str, **kwargs) -> dict:
        """Update cluster fields (name, description, icon, pinned, auto_subtypes)."""
        resp = self._session.patch(
            self._url(f"/clusters/{cluster_id}"), json=kwargs, timeout=self._DEFAULT_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()

    def delete_cluster(self, cluster_id: str) -> dict:
        """Delete a cluster. Memberships are removed automatically."""
        resp = self._session.delete(self._url(f"/clusters/{cluster_id}"), timeout=self._DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    def add_to_cluster(
        self,
        cluster_id: str,
        node_id: str | None = None,
        node_ids: list[str] | None = None,
    ) -> dict:
        """Add node(s) to a cluster."""
        payload: dict = {}
        if node_id:
            payload["node_id"] = node_id
        if node_ids:
            payload["node_ids"] = node_ids
        resp = self._session.post(
            self._url(f"/clusters/{cluster_id}/members"), json=payload, timeout=self._DEFAULT_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()

    def remove_from_cluster(self, cluster_id: str, node_id: str) -> dict:
        """Remove a node from a cluster."""
        resp = self._session.delete(
            self._url(f"/clusters/{cluster_id}/members/{node_id}"),
            timeout=self._DEFAULT_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()

    def get_cluster_members(self, cluster_id: str, limit: int = 50) -> list[dict]:
        """List members of a cluster."""
        resp = self._session.get(
            self._url(f"/clusters/{cluster_id}/members"),
            params={"limit": limit},
            timeout=self._DEFAULT_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", data) if isinstance(data, dict) else data

    def get_cluster_health(self, cluster_id: str) -> dict:
        """Get health stats for a cluster."""
        resp = self._session.get(
            self._url(f"/clusters/{cluster_id}/health"),
            timeout=self._DEFAULT_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()
