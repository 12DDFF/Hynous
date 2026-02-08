/**
 * SSA Graph Context — Adapter between @nous/core's SSA algorithm and the libSQL database.
 *
 * Implements the SSAGraphContext interface so that executeSSA() can query
 * the Nous graph for neighbors, BM25 search, and reranking data.
 *
 * The vectorSearch method returns empty results since we don't have embeddings yet.
 * When embeddings are added, only this file needs to change.
 */

import type {
  SSAGraphContext,
  FilterNodeInput,
  NeighborResult,
  SSAVectorSearchResult,
  BM25SearchResult,
  RerankingNodeData,
} from '@nous/core/ssa';
import type { GraphMetrics } from '@nous/core/params';
import { cosineSimilarity } from '@nous/core/embeddings';
import { getDb, getGraphMetrics } from './db.js';

/**
 * Create an SSAGraphContext backed by the libSQL database.
 * Each method maps to SQL queries against the nodes/edges tables.
 */
export function createSSAContext(): SSAGraphContext {
  return {
    /**
     * Fetch minimal node info for filter evaluation during spreading.
     */
    async getNode(id: string): Promise<FilterNodeInput | null> {
      const db = getDb();
      const r = await db.execute({
        sql: `SELECT id, type, created_at,
              COALESCE(neural_last_accessed, provenance_created_at) as last_accessed
              FROM nodes WHERE id = ?`,
        args: [id],
      });
      if (r.rows.length === 0) return null;
      const row = r.rows[0]!;
      return {
        id: row.id as string,
        type: row.type as string,
        created_at: row.created_at as string,
        last_accessed: row.last_accessed as string,
      };
    },

    /**
     * Get all neighbors (bidirectional) for spreading activation.
     * Returns connected nodes with their edge info and weight.
     */
    async getNeighbors(nodeId: string): Promise<NeighborResult[]> {
      const db = getDb();
      const r = await db.execute({
        sql: `SELECT
                e.id as eid, e.type as etype, e.source_id, e.target_id, e.strength,
                n.id as nid, n.type as ntype, n.created_at as ncreated,
                COALESCE(n.neural_last_accessed, n.provenance_created_at) as nlast
              FROM edges e
              JOIN nodes n ON n.id = CASE
                WHEN e.source_id = ? THEN e.target_id
                ELSE e.source_id
              END
              WHERE e.source_id = ? OR e.target_id = ?`,
        args: [nodeId, nodeId, nodeId],
      });
      return r.rows.map((row: any) => ({
        node: {
          id: row.nid,
          type: row.ntype,
          created_at: row.ncreated,
          last_accessed: row.nlast,
        },
        edge: {
          id: row.eid,
          source_id: row.source_id,
          target_id: row.target_id,
          edge_type: row.etype,
        },
        weight: Number(row.strength ?? 0.5),
      }));
    },

    /**
     * Vector search via cosine similarity scan.
     * Loads all embedded nodes and computes similarity against query vector.
     * For <10K nodes this is <10ms. Replace with ANN index if scale demands it.
     */
    async vectorSearch(
      queryEmbedding: Float32Array,
      limit: number,
    ): Promise<SSAVectorSearchResult[]> {
      if (queryEmbedding.length === 0) return []; // No embedding provider

      const db = getDb();
      const r = await db.execute(
        'SELECT id, embedding_vector FROM nodes WHERE embedding_vector IS NOT NULL',
      );

      if (r.rows.length === 0) return [];

      const scored: SSAVectorSearchResult[] = [];
      for (const row of r.rows) {
        const blob = row.embedding_vector;
        if (!blob) continue;
        // libSQL returns ArrayBuffer for BLOB columns
        const nodeVec = new Float32Array(blob as ArrayBuffer);
        if (nodeVec.length !== queryEmbedding.length) continue;
        const sim = cosineSimilarity(queryEmbedding, nodeVec);
        scored.push({ nodeId: row.id as string, score: sim });
      }

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit);
    },

    /**
     * BM25 search using SQLite FTS5.
     * Builds OR query from terms with prefix matching.
     * Scores are normalized to 0-1 range.
     */
    async bm25Search(
      terms: string[],
      limit: number,
    ): Promise<BM25SearchResult[]> {
      if (terms.length === 0) return [];

      const db = getDb();
      // Build FTS5 match query — each term gets quoted + prefix wildcard
      const ftsQuery = terms
        .map((t) => `"${t.replace(/"/g, '')}"*`)
        .join(' OR ');
      if (!ftsQuery) return [];

      try {
        const r = await db.execute({
          sql: `SELECT n.id, rank
                FROM nodes_fts fts
                JOIN nodes n ON n.rowid = fts.rowid
                WHERE nodes_fts MATCH ?
                ORDER BY rank
                LIMIT ?`,
          args: [ftsQuery, limit],
        });

        if (r.rows.length === 0) return [];

        // FTS5 rank is negative (more negative = better match)
        const rawScores = r.rows.map((row) =>
          Math.abs(Number(row.rank ?? 0)),
        );
        const maxBM25 = Math.max(...rawScores, 0.001);

        return r.rows.map((row, i) => ({
          nodeId: row.id as string,
          score: rawScores[i]! / maxBM25,
        }));
      } catch {
        // FTS5 can throw on malformed queries
        return [];
      }
    },

    /**
     * Graph-level metrics for reranking context.
     * Reuses the existing getGraphMetrics() from db.ts.
     */
    async getGraphMetrics(): Promise<GraphMetrics> {
      return getGraphMetrics();
    },

    /**
     * Fetch reranking-specific fields for a node.
     * Includes access count and inbound edge count for authority/affinity signals.
     */
    async getNodeForReranking(
      id: string,
    ): Promise<RerankingNodeData | null> {
      const db = getDb();
      const [nodeR, edgeR] = await Promise.all([
        db.execute({
          sql: `SELECT id, neural_last_accessed, provenance_created_at,
                       created_at, neural_access_count
                FROM nodes WHERE id = ?`,
          args: [id],
        }),
        db.execute({
          sql: 'SELECT COUNT(*) as cnt FROM edges WHERE target_id = ?',
          args: [id],
        }),
      ]);

      if (nodeR.rows.length === 0) return null;
      const row = nodeR.rows[0]!;

      return {
        id: row.id as string,
        last_accessed: new Date(
          (row.neural_last_accessed || row.provenance_created_at) as string,
        ),
        created_at: new Date(row.created_at as string),
        access_count: Number(row.neural_access_count ?? 0),
        inbound_edge_count: Number(edgeR.rows[0]?.cnt ?? 0),
      };
    },
  };
}
