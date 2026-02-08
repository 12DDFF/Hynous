"""
Nous - Persistent Memory System

HTTP client for the TypeScript Nous server.
The knowledge graph that makes Hynous remember.

Usage:
    from hynous.nous.client import get_client

    client = get_client()
    node = client.create_node(
        type="concept",
        subtype="custom:lesson",
        title="BTC funding spike",
        body="Funding hit 0.15% on Feb 5..."
    )
    results = client.search("funding spike")
"""

from .client import NousClient, get_client
from .server import ensure_running

__all__ = ["NousClient", "get_client", "ensure_running"]
