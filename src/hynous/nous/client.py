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
        resp = self._session.get(self._url("/health"))
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
    ) -> dict:
        """Create a new node. Returns the full node dict with generated ID."""
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
        resp = self._session.post(self._url("/nodes"), json=payload)
        resp.raise_for_status()
        return resp.json()

    def get_node(self, node_id: str) -> Optional[dict]:
        """Get a node by ID. Returns None if not found."""
        resp = self._session.get(self._url(f"/nodes/{node_id}"))
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
    ) -> list[dict]:
        """List nodes with optional filters."""
        params: dict = {"limit": limit}
        if type:
            params["type"] = type
        if subtype:
            params["subtype"] = subtype
        if lifecycle:
            params["lifecycle"] = lifecycle
        resp = self._session.get(self._url("/nodes"), params=params)
        resp.raise_for_status()
        return resp.json().get("data", [])

    def update_node(self, node_id: str, **updates) -> dict:
        """Partial update a node. Pass fields as kwargs."""
        resp = self._session.patch(self._url(f"/nodes/{node_id}"), json=updates)
        resp.raise_for_status()
        return resp.json()

    def delete_node(self, node_id: str) -> bool:
        """Delete a node."""
        resp = self._session.delete(self._url(f"/nodes/{node_id}"))
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
        resp = self._session.post(self._url("/edges"), json=payload)
        resp.raise_for_status()
        return resp.json()

    def get_edges(
        self,
        node_id: str,
        direction: str = "both",
    ) -> list[dict]:
        """Get edges for a node. Direction: 'in', 'out', or 'both'."""
        params = {"node_id": node_id, "direction": direction}
        resp = self._session.get(self._url("/edges"), params=params)
        resp.raise_for_status()
        return resp.json().get("data", [])

    def delete_edge(self, edge_id: str) -> bool:
        """Delete an edge."""
        resp = self._session.delete(self._url(f"/edges/{edge_id}"))
        return resp.status_code == 200

    # ---- Graph (bulk fetch for visualization) ----

    def get_graph(self) -> dict:
        """Get full graph data (all nodes + edges) for visualization."""
        resp = self._session.get(self._url("/graph"))
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
        resp = self._session.post(self._url("/contradiction/detect"), json=payload)
        resp.raise_for_status()
        return resp.json()

    def get_conflicts(self, status: str = "pending") -> list[dict]:
        """Get conflict queue items."""
        resp = self._session.get(self._url("/contradiction/queue"), params={"status": status})
        resp.raise_for_status()
        return resp.json().get("data", [])

    def resolve_conflict(self, conflict_id: str, resolution: str) -> dict:
        """Resolve a conflict. Resolution: old_is_current, new_is_current, keep_both, merge."""
        resp = self._session.post(
            self._url("/contradiction/resolve"),
            json={"conflict_id": conflict_id, "resolution": resolution},
        )
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
        resp = self._session.post(self._url("/search"), json=payload)
        resp.raise_for_status()
        return resp.json().get("data", [])

    # ---- Query Classification ----

    def classify_query(self, query: str) -> dict:
        """Classify a query for SSA optimization (QCS pre-classification)."""
        resp = self._session.post(self._url("/classify-query"), json={"query": query})
        resp.raise_for_status()
        return resp.json()
