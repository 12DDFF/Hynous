import { createClient, type Client } from '@libsql/client';
import { resolve } from 'path';

let db: Client;

export function getDb(): Client {
  if (!db) {
    const dbPath = process.env.NOUS_DB_PATH || resolve(process.cwd(), 'storage', 'nous.db');
    db = createClient({ url: `file:${dbPath}` });
  }
  return db;
}

/**
 * Initialize the database schema.
 * V1-compatible subset of @nous/core — same column names, no vector/sync/encryption.
 * Includes FSRS neural columns and rich edge properties.
 */
export async function initSchema(): Promise<void> {
  const client = getDb();

  // Enable WAL mode for better concurrent reads
  await client.execute('PRAGMA journal_mode=WAL');
  await client.execute('PRAGMA foreign_keys=ON');

  // --- NODES ---
  await client.execute(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      subtype TEXT,

      content_title TEXT,
      content_summary TEXT,
      content_body TEXT,

      neural_stability REAL DEFAULT 0.5,
      neural_retrievability REAL DEFAULT 1.0,
      neural_difficulty REAL DEFAULT 0.3,
      neural_access_count INTEGER DEFAULT 0,
      neural_last_accessed TEXT,

      state_lifecycle TEXT DEFAULT 'ACTIVE',

      provenance_source TEXT DEFAULT 'agent',
      provenance_created_at TEXT NOT NULL,

      layer TEXT NOT NULL DEFAULT 'semantic',
      version INTEGER DEFAULT 1,
      last_modified TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Migration: add neural_difficulty if table already exists without it
  await safeAddColumn(client, 'nodes', 'neural_difficulty', 'REAL DEFAULT 0.3');

  // Embedding columns for vector search (Phase 1)
  await safeAddColumn(client, 'nodes', 'embedding_vector', 'BLOB');
  await safeAddColumn(client, 'nodes', 'embedding_model', 'TEXT');

  // Temporal columns (Phase 2) — distinguish "when it happened" vs "when stored"
  await safeAddColumn(client, 'nodes', 'temporal_event_time', 'TEXT');
  await safeAddColumn(client, 'nodes', 'temporal_event_confidence', 'REAL');
  await safeAddColumn(client, 'nodes', 'temporal_event_source', 'TEXT');

  await client.execute('CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes (type)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_nodes_subtype ON nodes (subtype)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_nodes_lifecycle ON nodes (state_lifecycle)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_nodes_created_at ON nodes (created_at)');

  // --- FTS5 for text search ---
  await client.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
      content_title, content_summary, content_body,
      content='nodes', content_rowid='rowid'
    )
  `);

  // Triggers to keep FTS in sync with nodes table
  await client.execute(`
    CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
      INSERT INTO nodes_fts(rowid, content_title, content_summary, content_body)
      VALUES (new.rowid, new.content_title, new.content_summary, new.content_body);
    END
  `);

  await client.execute(`
    CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
      INSERT INTO nodes_fts(nodes_fts, rowid, content_title, content_summary, content_body)
      VALUES ('delete', old.rowid, old.content_title, old.content_summary, old.content_body);
    END
  `);

  await client.execute(`
    CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
      INSERT INTO nodes_fts(nodes_fts, rowid, content_title, content_summary, content_body)
      VALUES ('delete', old.rowid, old.content_title, old.content_summary, old.content_body);
      INSERT INTO nodes_fts(rowid, content_title, content_summary, content_body)
      VALUES (new.rowid, new.content_title, new.content_summary, new.content_body);
    END
  `);

  // Rebuild FTS5 index to catch any nodes inserted before triggers existed
  await client.execute("INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')");

  // --- EDGES ---
  await client.execute(`
    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      subtype TEXT,

      source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,

      neural_weight REAL DEFAULT 1.0,
      strength REAL DEFAULT 0.5,
      confidence REAL DEFAULT 1.0,

      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Migration: add new edge columns if table already exists without them
  await safeAddColumn(client, 'edges', 'subtype', 'TEXT');
  await safeAddColumn(client, 'edges', 'strength', 'REAL DEFAULT 0.5');
  await safeAddColumn(client, 'edges', 'confidence', 'REAL DEFAULT 1.0');

  await client.execute('CREATE INDEX IF NOT EXISTS idx_edges_source ON edges (source_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_edges_target ON edges (target_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_edges_type ON edges (type)');

  // --- CONFLICT QUEUE (Phase 3 — contradiction detection) ---
  await client.execute(`
    CREATE TABLE IF NOT EXISTS conflict_queue (
      id TEXT PRIMARY KEY NOT NULL,
      old_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      new_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
      new_content TEXT NOT NULL,
      conflict_type TEXT NOT NULL,
      detection_tier TEXT NOT NULL,
      detection_confidence REAL NOT NULL,
      context TEXT,
      entity_name TEXT,
      topic TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )
  `);
  await client.execute('CREATE INDEX IF NOT EXISTS idx_conflict_status ON conflict_queue (status)');
}

/**
 * Safely add a column to an existing table (no-op if column exists).
 */
async function safeAddColumn(
  client: Client,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  try {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch {
    // Column already exists — ignore
  }
}

// ---- Graph Metrics (for reranking) ----

export interface GraphMetrics {
  total_nodes: number;
  total_edges: number;
  density: number;
  avg_inbound_edges: number;
  avg_outbound_edges: number;
}

/**
 * Compute graph-level metrics for reranking.
 * Cached per-request — cheap enough to compute on each search.
 */
export async function getGraphMetrics(): Promise<GraphMetrics> {
  const client = getDb();

  const [nodeResult, edgeResult] = await Promise.all([
    client.execute('SELECT COUNT(*) as count FROM nodes'),
    client.execute('SELECT COUNT(*) as count FROM edges'),
  ]);

  const totalNodes = Number(nodeResult.rows[0]?.count ?? 0);
  const totalEdges = Number(edgeResult.rows[0]?.count ?? 0);

  const avgEdges = totalNodes > 0 ? totalEdges / totalNodes : 0;
  const maxPossibleEdges = totalNodes * (totalNodes - 1);
  const density = maxPossibleEdges > 0 ? totalEdges / maxPossibleEdges : 0;

  return {
    total_nodes: totalNodes,
    total_edges: totalEdges,
    density,
    avg_inbound_edges: avgEdges,
    avg_outbound_edges: avgEdges,
  };
}

/**
 * Count inbound edges for a set of node IDs (batch query for reranking).
 */
export async function getInboundEdgeCounts(
  nodeIds: string[],
): Promise<Record<string, number>> {
  if (nodeIds.length === 0) return {};

  const client = getDb();
  const placeholders = nodeIds.map(() => '?').join(',');
  const result = await client.execute({
    sql: `SELECT target_id, COUNT(*) as cnt FROM edges WHERE target_id IN (${placeholders}) GROUP BY target_id`,
    args: nodeIds,
  });

  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    counts[row.target_id as string] = Number(row.cnt);
  }
  return counts;
}
