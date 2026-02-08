/**
 * @module @nous/core/db/schema
 * @description SQL schema definitions for Turso/libSQL database
 * @version 1.0.0
 * @spec Brainstorms/Specs/storm-017
 * @storm Brainstorms/Infrastructure/storm-017-infrastructure-architecture
 *
 * Defines all database tables, indexes, and common queries.
 * Uses F32_BLOB for vector storage with DiskANN index.
 */

import { DB_DEFAULTS } from './config';

// ============================================================
// NODES TABLE
// ============================================================

/**
 * Main nodes table storing all node types with embeddings.
 *
 * Maps to NousNode interface from storm-011.
 * Supports vector search via DiskANN index.
 */
export const NODES_TABLE = `
CREATE TABLE IF NOT EXISTS nodes (
  -- Identity
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  subtype TEXT,

  -- Content (JSON encoded)
  content_title TEXT,
  content_summary TEXT,
  content_body TEXT,
  content_blocks TEXT,  -- JSON array of Block[]

  -- Vector embedding for semantic search
  embedding F32_BLOB(${DB_DEFAULTS.vectorDimensions}),

  -- Neural properties
  neural_stability REAL DEFAULT 0.5,
  neural_retrievability REAL DEFAULT 0.5,
  neural_access_count INTEGER DEFAULT 0,
  neural_last_accessed TEXT,

  -- State
  state_lifecycle TEXT DEFAULT 'active',
  state_extraction_depth TEXT DEFAULT 'core',

  -- Provenance
  provenance_source TEXT,
  provenance_created_at TEXT NOT NULL,
  provenance_confidence REAL DEFAULT 1.0,

  -- Storage layer
  layer TEXT NOT NULL DEFAULT 'semantic',

  -- Sync metadata
  version INTEGER DEFAULT 1,
  last_modified TEXT NOT NULL,
  last_modifier TEXT,
  sync_status TEXT DEFAULT 'synced',

  -- E2E encryption (for private tier)
  encrypted_payload TEXT,
  encryption_tier TEXT DEFAULT 'standard',

  -- Indexes on created_at for temporal queries
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/**
 * Indexes for the nodes table.
 */
export const NODES_INDEXES = `
-- Vector similarity search index (DiskANN)
CREATE INDEX IF NOT EXISTS idx_nodes_embedding
ON nodes (libsql_vector_idx(embedding, 'metric=cosine', 'max_neighbors=${DB_DEFAULTS.maxNeighbors}'));

-- Type and subtype for filtering
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes (type);
CREATE INDEX IF NOT EXISTS idx_nodes_subtype ON nodes (subtype);

-- Layer routing
CREATE INDEX IF NOT EXISTS idx_nodes_layer ON nodes (layer);

-- Temporal queries
CREATE INDEX IF NOT EXISTS idx_nodes_created_at ON nodes (created_at);
CREATE INDEX IF NOT EXISTS idx_nodes_last_modified ON nodes (last_modified);

-- Sync status
CREATE INDEX IF NOT EXISTS idx_nodes_sync_status ON nodes (sync_status);

-- Neural properties for retrieval scoring
CREATE INDEX IF NOT EXISTS idx_nodes_stability ON nodes (neural_stability);
CREATE INDEX IF NOT EXISTS idx_nodes_retrievability ON nodes (neural_retrievability);
`;

// ============================================================
// EDGES TABLE
// ============================================================

/**
 * Edges table for relationships between nodes.
 *
 * Maps to NousEdge interface from storm-011.
 */
export const EDGES_TABLE = `
CREATE TABLE IF NOT EXISTS edges (
  -- Identity
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,

  -- Relationship
  source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,

  -- Neural properties
  neural_weight REAL DEFAULT 1.0,
  neural_stability REAL DEFAULT 0.5,
  neural_last_activated TEXT,

  -- Metadata
  bidirectional INTEGER DEFAULT 0,

  -- Sync
  version INTEGER DEFAULT 1,
  last_modified TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/**
 * Indexes for the edges table.
 */
export const EDGES_INDEXES = `
-- Efficient traversal
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges (source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges (target_id);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges (type);

-- Bidirectional lookup
CREATE INDEX IF NOT EXISTS idx_edges_bidirectional ON edges (source_id, target_id);

-- Weight for relevance
CREATE INDEX IF NOT EXISTS idx_edges_weight ON edges (neural_weight);
`;

// ============================================================
// EPISODES TABLE
// ============================================================

/**
 * Episodes table for time-indexed events.
 *
 * Maps to Episode interface from storm-004.
 * Includes TPS (Temporal Parsing System) metadata.
 */
export const EPISODES_TABLE = `
CREATE TABLE IF NOT EXISTS episodes (
  -- Identity
  id TEXT PRIMARY KEY NOT NULL,

  -- Content
  content TEXT NOT NULL,
  summary TEXT,

  -- Temporal bounds
  start_time TEXT NOT NULL,
  end_time TEXT,

  -- TPS Confidence Factors
  tps_temporal_confidence REAL DEFAULT 0.5,
  tps_parsing_method TEXT,
  tps_source_reliability REAL DEFAULT 0.5,

  -- References to nodes created from this episode
  node_refs TEXT,  -- JSON array of node IDs

  -- Source context
  source_type TEXT,
  source_id TEXT,

  -- Sync
  version INTEGER DEFAULT 1,
  last_modified TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/**
 * Indexes for the episodes table.
 */
export const EPISODES_INDEXES = `
-- Temporal range queries
CREATE INDEX IF NOT EXISTS idx_episodes_start_time ON episodes (start_time);
CREATE INDEX IF NOT EXISTS idx_episodes_end_time ON episodes (end_time);

-- Source lookup
CREATE INDEX IF NOT EXISTS idx_episodes_source ON episodes (source_type, source_id);
`;

// ============================================================
// SYNC METADATA TABLE
// ============================================================

/**
 * Sync metadata table for tracking sync state.
 */
export const SYNC_METADATA_TABLE = `
CREATE TABLE IF NOT EXISTS sync_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// ============================================================
// USER SETTINGS TABLE
// ============================================================

/**
 * User settings table for preferences.
 */
export const USER_SETTINGS_TABLE = `
CREATE TABLE IF NOT EXISTS user_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// ============================================================
// EDIT HISTORY TABLE
// ============================================================

/**
 * Edit history table for undo capability.
 *
 * Maps to EditRecord interface from storm-011.
 */
export const EDIT_HISTORY_TABLE = `
CREATE TABLE IF NOT EXISTS edit_history (
  id TEXT PRIMARY KEY NOT NULL,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,  -- 'create' | 'update' | 'delete'
  before_state TEXT,  -- JSON snapshot before edit
  after_state TEXT,   -- JSON snapshot after edit
  editor_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/**
 * Indexes for edit history.
 */
export const EDIT_HISTORY_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_edit_history_node ON edit_history (node_id);
CREATE INDEX IF NOT EXISTS idx_edit_history_created ON edit_history (created_at);
`;

// ============================================================
// LOCAL CACHE TABLE
// ============================================================

/**
 * Local cache table for LRU cache on limited storage.
 */
export const LOCAL_CACHE_TABLE = `
CREATE TABLE IF NOT EXISTS local_cache (
  node_id TEXT PRIMARY KEY NOT NULL,
  cached_at TEXT NOT NULL,
  last_accessed TEXT NOT NULL,
  access_count INTEGER DEFAULT 1,
  size_bytes INTEGER NOT NULL
);
`;

/**
 * Indexes for local cache.
 */
export const LOCAL_CACHE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_local_cache_last_accessed ON local_cache (last_accessed);
CREATE INDEX IF NOT EXISTS idx_local_cache_access_count ON local_cache (access_count);
`;

// ============================================================
// SCHEMA VERSION TABLE
// ============================================================

/**
 * Schema version table for migration tracking.
 */
export const SCHEMA_VERSION_TABLE = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  description TEXT
);
`;

// ============================================================
// FULL SCHEMA
// ============================================================

/**
 * Complete schema creation statements in order.
 *
 * Execute in order to create full database schema.
 */
export const FULL_SCHEMA: string[] = [
  NODES_TABLE,
  NODES_INDEXES,
  EDGES_TABLE,
  EDGES_INDEXES,
  EPISODES_TABLE,
  EPISODES_INDEXES,
  SYNC_METADATA_TABLE,
  USER_SETTINGS_TABLE,
  EDIT_HISTORY_TABLE,
  EDIT_HISTORY_INDEXES,
  LOCAL_CACHE_TABLE,
  LOCAL_CACHE_INDEXES,
  SCHEMA_VERSION_TABLE,
];

// ============================================================
// COMMON QUERIES
// ============================================================

/**
 * Common query templates.
 */
export const QUERIES = {
  /**
   * Vector similarity search query.
   * Uses cosine distance via DiskANN index.
   */
  vectorSearch: `
    SELECT
      id,
      type,
      content_title,
      content_summary,
      vector_distance_cos(embedding, ?) as distance
    FROM nodes
    WHERE embedding IS NOT NULL
      AND layer = ?
    ORDER BY distance ASC
    LIMIT ?
  `,

  /**
   * Get node by ID.
   */
  getNodeById: `
    SELECT * FROM nodes WHERE id = ?
  `,

  /**
   * Get edges for a node (both directions).
   */
  getEdgesForNode: `
    SELECT * FROM edges
    WHERE source_id = ? OR target_id = ?
  `,

  /**
   * Get outgoing edges from a node.
   */
  getOutgoingEdges: `
    SELECT * FROM edges WHERE source_id = ?
  `,

  /**
   * Get incoming edges to a node.
   */
  getIncomingEdges: `
    SELECT * FROM edges WHERE target_id = ?
  `,

  /**
   * Get episodes in time range.
   */
  getEpisodesInRange: `
    SELECT * FROM episodes
    WHERE start_time >= ? AND (end_time IS NULL OR end_time <= ?)
    ORDER BY start_time ASC
  `,

  /**
   * Get nodes with sync conflicts.
   */
  getSyncConflicts: `
    SELECT * FROM nodes WHERE sync_status = 'conflict'
  `,

  /**
   * Get unsynced changes.
   */
  getUnsyncedChanges: `
    SELECT * FROM nodes WHERE sync_status = 'pending'
  `,

  /**
   * Insert new node.
   */
  insertNode: `
    INSERT INTO nodes (
      id, type, subtype,
      content_title, content_summary, content_body, content_blocks,
      embedding,
      neural_stability, neural_retrievability, neural_access_count,
      state_lifecycle, state_extraction_depth,
      provenance_source, provenance_created_at, provenance_confidence,
      layer, version, last_modified, last_modifier
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,

  /**
   * Insert new episode.
   */
  insertEpisode: `
    INSERT INTO episodes (
      id, content, summary,
      start_time, end_time,
      tps_temporal_confidence, tps_parsing_method, tps_source_reliability,
      node_refs, source_type, source_id,
      version, last_modified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,

  /**
   * Update node sync status.
   */
  updateSyncStatus: `
    UPDATE nodes SET sync_status = ?, last_modified = ? WHERE id = ?
  `,

  /**
   * Get schema version.
   */
  getSchemaVersion: `
    SELECT MAX(version) as version FROM schema_version
  `,

  /**
   * Insert schema version.
   */
  insertSchemaVersion: `
    INSERT INTO schema_version (version, description) VALUES (?, ?)
  `,
} as const;

// ============================================================
// SCHEMA HELPERS
// ============================================================

/**
 * Gets all CREATE TABLE statements.
 */
export function getTableStatements(): string[] {
  return [
    NODES_TABLE,
    EDGES_TABLE,
    EPISODES_TABLE,
    SYNC_METADATA_TABLE,
    USER_SETTINGS_TABLE,
    EDIT_HISTORY_TABLE,
    LOCAL_CACHE_TABLE,
    SCHEMA_VERSION_TABLE,
  ];
}

/**
 * Gets all CREATE INDEX statements.
 */
export function getIndexStatements(): string[] {
  return [
    NODES_INDEXES,
    EDGES_INDEXES,
    EPISODES_INDEXES,
    EDIT_HISTORY_INDEXES,
    LOCAL_CACHE_INDEXES,
  ];
}

/**
 * Gets drop statements for all tables (for testing/reset).
 */
export function getDropStatements(): string[] {
  return [
    'DROP TABLE IF EXISTS edit_history',
    'DROP TABLE IF EXISTS local_cache',
    'DROP TABLE IF EXISTS edges',
    'DROP TABLE IF EXISTS episodes',
    'DROP TABLE IF EXISTS nodes',
    'DROP TABLE IF EXISTS sync_metadata',
    'DROP TABLE IF EXISTS user_settings',
    'DROP TABLE IF EXISTS schema_version',
  ];
}
