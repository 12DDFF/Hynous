# Nous Module

> Persistent memory that makes Hynous learn over time.

---

## Structure

```
nous/
├── store.py       # SQLite storage + FTS5 search
├── nodes.py       # Node types and schemas
└── relations.py   # Node relationships
```

---

## Node Types

| Type | Purpose | Example |
|------|---------|---------|
| `concept` | Learned patterns | "Funding extremes often precede reversals" |
| `episode` | Time-bound events | "BTC funding hit 0.15% on Feb 5" |
| `trade` | Trade records | "Long BTC @ $67k, stopped out @ $66.4k" |
| `thesis` | Reasoning chains | "Why I went long: support held, funding reset..." |
| `observation` | Raw snapshots | "Market state at 14:00 UTC" |

---

## Key Operations

```python
# Create
node = store.create_node(
    type=NodeType.EPISODE,
    title="...",
    content="...",
    symbols=["BTC"],
    importance=0.7
)

# Search
results = store.search("funding spike BTC", limit=10)

# Get recent
recent = store.get_recent(limit=5, node_types=[NodeType.EPISODE])

# Relations
store.create_relation(node1.id, node2.id, "supports")
related = store.get_related_nodes(node.id)
```

---

## Database Schema

```sql
-- nodes table
CREATE TABLE nodes (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    event_time TIMESTAMP,
    importance REAL DEFAULT 0.5,
    metadata JSON,
    symbols JSON,
    source TEXT
);

-- FTS5 for full-text search
CREATE VIRTUAL TABLE nodes_fts USING fts5(
    title, content,
    content='nodes',
    content_rowid='rowid'
);

-- relations table
CREATE TABLE relations (
    id TEXT PRIMARY KEY,
    from_node_id TEXT REFERENCES nodes(id),
    to_node_id TEXT REFERENCES nodes(id),
    relation_type TEXT NOT NULL,
    strength REAL DEFAULT 1.0,
    created_at TIMESTAMP
);
```

---

## Future: Phase 2 Retrieval

Currently using basic BM25 search. Later:
- Vector embeddings (OpenAI text-embedding-3-small)
- Spreading activation
- LLM-guided traversal

See storm-004 for full retrieval architecture.
