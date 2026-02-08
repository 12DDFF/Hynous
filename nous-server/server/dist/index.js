// src/index.ts
import { Hono as Hono9 } from "hono";
import { serve } from "@hono/node-server";
import { logger } from "hono/logger";
import { cors } from "hono/cors";

// src/db.ts
import { createClient } from "@libsql/client";
import { resolve } from "path";
var db;
function getDb() {
  if (!db) {
    const dbPath = process.env.NOUS_DB_PATH || resolve(process.cwd(), "storage", "nous.db");
    db = createClient({ url: `file:${dbPath}` });
  }
  return db;
}
async function initSchema() {
  const client = getDb();
  await client.execute("PRAGMA journal_mode=WAL");
  await client.execute("PRAGMA foreign_keys=ON");
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
  await safeAddColumn(client, "nodes", "neural_difficulty", "REAL DEFAULT 0.3");
  await safeAddColumn(client, "nodes", "embedding_vector", "BLOB");
  await safeAddColumn(client, "nodes", "embedding_model", "TEXT");
  await safeAddColumn(client, "nodes", "temporal_event_time", "TEXT");
  await safeAddColumn(client, "nodes", "temporal_event_confidence", "REAL");
  await safeAddColumn(client, "nodes", "temporal_event_source", "TEXT");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes (type)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_nodes_subtype ON nodes (subtype)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_nodes_lifecycle ON nodes (state_lifecycle)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_nodes_created_at ON nodes (created_at)");
  await client.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
      content_title, content_summary, content_body,
      content='nodes', content_rowid='rowid'
    )
  `);
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
  await client.execute("INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')");
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
  await safeAddColumn(client, "edges", "subtype", "TEXT");
  await safeAddColumn(client, "edges", "strength", "REAL DEFAULT 0.5");
  await safeAddColumn(client, "edges", "confidence", "REAL DEFAULT 1.0");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_edges_source ON edges (source_id)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_edges_target ON edges (target_id)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_edges_type ON edges (type)");
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
  await client.execute("CREATE INDEX IF NOT EXISTS idx_conflict_status ON conflict_queue (status)");
}
async function safeAddColumn(client, table, column, definition) {
  try {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch {
  }
}
async function getGraphMetrics() {
  const client = getDb();
  const [nodeResult, edgeResult] = await Promise.all([
    client.execute("SELECT COUNT(*) as count FROM nodes"),
    client.execute("SELECT COUNT(*) as count FROM edges")
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
    avg_outbound_edges: avgEdges
  };
}

// src/routes/health.ts
import { Hono } from "hono";
var health = new Hono();
health.get("/health", async (c) => {
  try {
    const db2 = getDb();
    const [nodeResult, edgeResult, lifecycleResult] = await Promise.all([
      db2.execute("SELECT COUNT(*) as count FROM nodes"),
      db2.execute("SELECT COUNT(*) as count FROM edges"),
      db2.execute("SELECT state_lifecycle, COUNT(*) as count FROM nodes GROUP BY state_lifecycle")
    ]);
    const nodeCount = Number(nodeResult.rows[0]?.count ?? 0);
    const edgeCount = Number(edgeResult.rows[0]?.count ?? 0);
    const lifecycle = {};
    for (const row of lifecycleResult.rows) {
      lifecycle[row.state_lifecycle] = Number(row.count);
    }
    return c.json({
      status: "ok",
      node_count: nodeCount,
      edge_count: edgeCount,
      lifecycle
    });
  } catch (e) {
    return c.json({ status: "error", message: String(e) }, 500);
  }
});
var health_default = health;

// src/routes/nodes.ts
import { Hono as Hono2 } from "hono";

// src/utils.ts
import { nanoid } from "nanoid";
function nodeId() {
  return `n_${nanoid(12)}`;
}
function edgeId() {
  return `e_${nanoid(12)}`;
}
function now() {
  return (/* @__PURE__ */ new Date()).toISOString();
}

// src/core-bridge.ts
import {
  calculateRetrievability,
  getDecayLifecycleState,
  updateStabilityOnAccess,
  getInitialStability,
  getInitialDifficulty,
  DECAY_CONFIG,
  SSA_EDGE_WEIGHTS
} from "@nous/core/params";
var SUBTYPE_TO_ALGO_TYPE = {
  "custom:watchpoint": "concept",
  "custom:curiosity": "concept",
  "custom:lesson": "fact",
  "custom:thesis": "concept",
  "custom:market_event": "event",
  "custom:trade": "fact",
  "custom:signal": "fact",
  "custom:preference": "preference",
  "custom:turn_summary": "event",
  // Compressed exchange — stability ~10 days, decays fast
  "custom:session_summary": "note",
  // Session digest — stability ~30 days, more durable
  // Trade lifecycle — concept type for 21-day stability (trade memories should persist)
  "custom:trade_entry": "concept",
  // Thesis + entry — 21 days, durable
  "custom:trade_close": "concept",
  // Outcome + PnL — 21 days, durable (outcomes are lessons)
  "custom:trade_modify": "concept"
  // Position adjustment — 21 days, part of trade lifecycle
};
var TYPE_TO_ALGO_TYPE = {
  concept: "concept",
  episode: "event",
  person: "person",
  document: "document",
  note: "note"
};
function getAlgoType(type, subtype) {
  if (subtype && subtype in SUBTYPE_TO_ALGO_TYPE) {
    return SUBTYPE_TO_ALGO_TYPE[subtype];
  }
  return TYPE_TO_ALGO_TYPE[type] ?? "concept";
}
function computeDecay(row) {
  const lastAccessed = row.neural_last_accessed ? new Date(row.neural_last_accessed) : new Date(row.provenance_created_at);
  const daysSinceAccess = Math.max(0, (Date.now() - lastAccessed.getTime()) / 864e5);
  const retrievability = calculateRetrievability(daysSinceAccess, row.neural_stability);
  const daysDormant = retrievability < DECAY_CONFIG.weak_threshold ? daysSinceAccess : 0;
  const lifecycle_state = getDecayLifecycleState(retrievability, daysDormant);
  return { retrievability, lifecycle_state, days_since_access: daysSinceAccess };
}
function applyDecay(row) {
  const { retrievability, lifecycle_state } = computeDecay(row);
  return {
    ...row,
    neural_retrievability: Math.round(retrievability * 1e4) / 1e4,
    state_lifecycle: lifecycle_state
  };
}
function computeStabilityGrowth(currentStability, difficulty) {
  return updateStabilityOnAccess(currentStability, difficulty);
}
function getNeuralDefaults(type, subtype) {
  const algoType = getAlgoType(type, subtype);
  return {
    neural_stability: getInitialStability(algoType),
    neural_retrievability: 1,
    // just created = perfect recall
    neural_difficulty: getInitialDifficulty(algoType)
  };
}
var EDGE_TYPE_WEIGHTS = {
  relates_to: SSA_EDGE_WEIGHTS.related_to,
  part_of: SSA_EDGE_WEIGHTS.part_of,
  causes: SSA_EDGE_WEIGHTS.caused_by,
  precedes: SSA_EDGE_WEIGHTS.temporal_adjacent,
  similar_to: SSA_EDGE_WEIGHTS.similar_to,
  mentioned_in: SSA_EDGE_WEIGHTS.mentioned_together,
  derived_from: SSA_EDGE_WEIGHTS.related_to,
  contradicts: SSA_EDGE_WEIGHTS.related_to,
  supersedes: SSA_EDGE_WEIGHTS.related_to,
  user_linked: SSA_EDGE_WEIGHTS.user_linked ?? 0.9
};
function getDefaultEdgeWeight(edgeType) {
  return EDGE_TYPE_WEIGHTS[edgeType] ?? 0.5;
}

// src/embed.ts
var OPENAI_URL = "https://api.openai.com/v1/embeddings";
var MODEL = "text-embedding-3-small";
var DIMENSIONS = 1536;
var MAX_CHARS = 3e4;
async function embedTexts(texts) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[embed] OPENAI_API_KEY not set \u2014 skipping embedding");
    return texts.map(() => new Float32Array(0));
  }
  if (texts.length === 0) return [];
  const truncated = texts.map((t) => t.slice(0, MAX_CHARS));
  try {
    const resp = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        input: truncated,
        dimensions: DIMENSIONS
      })
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error("[embed] OpenAI API error:", resp.status, err);
      return texts.map(() => new Float32Array(0));
    }
    const json = await resp.json();
    const sorted = json.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => new Float32Array(d.embedding));
  } catch (e) {
    console.error("[embed] Failed to call OpenAI:", e.message);
    return texts.map(() => new Float32Array(0));
  }
}
async function embedQuery(query) {
  const results = await embedTexts([query]);
  return results[0] ?? new Float32Array(0);
}
function buildNodeText(title, summary, body) {
  const parts = [];
  if (title) parts.push(title);
  if (summary) parts.push(summary);
  if (body) parts.push(body);
  return parts.join(" ").slice(0, MAX_CHARS);
}
function buildContextPrefix(type, subtype) {
  if (!subtype) return `[${type}]`;
  const labels = {
    "custom:watchpoint": "[watchpoint]",
    "custom:curiosity": "[curiosity]",
    "custom:lesson": "[lesson]",
    "custom:thesis": "[thesis]",
    "custom:market_event": "[market event]",
    "custom:trade": "[trade]",
    "custom:signal": "[signal]",
    "custom:turn_summary": "[conversation summary]",
    "custom:session_summary": "[session summary]",
    "custom:trade_entry": "[trade entry]",
    "custom:trade_close": "[trade close]",
    "custom:trade_modify": "[trade modify]"
  };
  return labels[subtype] ?? `[${subtype.replace("custom:", "")}]`;
}

// src/routes/nodes.ts
import { runTier2Pattern } from "@nous/core/contradiction";
import { nanoid as nanoid2 } from "nanoid";
var nodes = new Hono2();
nodes.post("/nodes", async (c) => {
  const body = await c.req.json();
  const {
    type,
    subtype,
    content_title,
    content_summary,
    content_body,
    temporal_event_time,
    temporal_event_confidence,
    temporal_event_source
  } = body;
  if (!type || !content_title) {
    return c.json({ error: "type and content_title are required" }, 400);
  }
  const id = nodeId();
  const ts = now();
  const layer = type === "episode" ? "episode" : "semantic";
  const neural = getNeuralDefaults(type, subtype);
  const db2 = getDb();
  await db2.execute({
    sql: `INSERT INTO nodes
      (id, type, subtype, content_title, content_summary, content_body,
       neural_stability, neural_retrievability, neural_difficulty,
       neural_last_accessed, provenance_created_at, layer, last_modified,
       temporal_event_time, temporal_event_confidence, temporal_event_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      type,
      subtype ?? null,
      content_title,
      content_summary ?? null,
      content_body ?? null,
      neural.neural_stability,
      neural.neural_retrievability,
      neural.neural_difficulty,
      ts,
      ts,
      layer,
      ts,
      temporal_event_time ?? null,
      temporal_event_confidence ?? null,
      temporal_event_source ?? null
    ]
  });
  try {
    const text = buildNodeText(content_title, content_summary ?? null, content_body ?? null);
    const prefix = buildContextPrefix(type, subtype ?? null);
    const [embedding] = await embedTexts([prefix + " " + text]);
    if (embedding && embedding.length > 0) {
      const buffer = Buffer.from(embedding.buffer);
      await db2.execute({
        sql: "UPDATE nodes SET embedding_vector = ?, embedding_model = ? WHERE id = ?",
        args: [buffer, "openai-3-small", id]
      });
    }
  } catch (e) {
    console.warn("[embed] Failed to embed node", id, e.message);
  }
  let contradiction_detected = false;
  try {
    const textToCheck = content_body || content_title;
    const patternResult = runTier2Pattern(textToCheck);
    if (patternResult.triggers_found.length > 0 && patternResult.confidence_score > 0.3) {
      contradiction_detected = true;
      const searchText = content_title.split(" ").slice(0, 3).join("%");
      const likePattern = `%${searchText}%`;
      const conflictSearch = await db2.execute({
        sql: `SELECT id, content_title FROM nodes
              WHERE (content_title LIKE ? OR content_body LIKE ?)
              AND id != ? ORDER BY created_at DESC LIMIT 3`,
        args: [likePattern, likePattern, id]
      });
      for (const cRow of conflictSearch.rows) {
        const cid = `c_${nanoid2(12)}`;
        const expires = new Date(Date.now() + 14 * 864e5).toISOString();
        await db2.execute({
          sql: `INSERT INTO conflict_queue
            (id, old_node_id, new_node_id, new_content, conflict_type,
             detection_tier, detection_confidence, status, created_at, expires_at)
            VALUES (?, ?, ?, ?, 'AMBIGUOUS', 'PATTERN', ?, 'pending', ?, ?)`,
          args: [
            cid,
            cRow.id,
            id,
            textToCheck,
            patternResult.confidence_score,
            ts,
            expires
          ]
        });
      }
    }
  } catch (e) {
    console.warn("[contradiction] Pattern check failed:", e.message);
  }
  const row = await db2.execute({ sql: "SELECT * FROM nodes WHERE id = ?", args: [id] });
  const node = row.rows[0];
  if (contradiction_detected) {
    node._contradiction_detected = true;
  }
  return c.json(node, 201);
});
nodes.get("/nodes/:id", async (c) => {
  const id = c.req.param("id");
  const db2 = getDb();
  const result = await db2.execute({ sql: "SELECT * FROM nodes WHERE id = ?", args: [id] });
  if (result.rows.length === 0) return c.json({ error: "not found" }, 404);
  const row = result.rows[0];
  const decayed = applyDecay(row);
  const newStability = computeStabilityGrowth(
    row.neural_stability,
    row.neural_difficulty
  );
  const ts = now();
  await db2.execute({
    sql: `UPDATE nodes SET
      neural_access_count = neural_access_count + 1,
      neural_last_accessed = ?,
      neural_stability = ?,
      neural_retrievability = ?,
      state_lifecycle = ?
      WHERE id = ?`,
    args: [ts, newStability, decayed.neural_retrievability, decayed.state_lifecycle, id]
  });
  return c.json({
    ...decayed,
    neural_stability: newStability,
    neural_access_count: row.neural_access_count + 1,
    neural_last_accessed: ts
  });
});
nodes.get("/nodes", async (c) => {
  const type = c.req.query("type");
  const subtype = c.req.query("subtype");
  const lifecycle = c.req.query("lifecycle");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  let sql = "SELECT * FROM nodes WHERE 1=1";
  const args = [];
  if (type) {
    sql += " AND type = ?";
    args.push(type);
  }
  if (subtype) {
    sql += " AND subtype = ?";
    args.push(subtype);
  }
  if (lifecycle) {
    sql += " AND state_lifecycle = ?";
    args.push(lifecycle);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  args.push(limit);
  const db2 = getDb();
  const result = await db2.execute({ sql, args });
  const data = result.rows.map((row) => applyDecay(row));
  return c.json({ data, count: data.length });
});
nodes.patch("/nodes/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const db2 = getDb();
  const existing = await db2.execute({ sql: "SELECT * FROM nodes WHERE id = ?", args: [id] });
  if (existing.rows.length === 0) return c.json({ error: "not found" }, 404);
  const allowedFields = [
    "type",
    "subtype",
    "content_title",
    "content_summary",
    "content_body",
    "neural_stability",
    "neural_retrievability",
    "neural_difficulty",
    "state_lifecycle",
    "temporal_event_time",
    "temporal_event_confidence",
    "temporal_event_source"
  ];
  const sets = [];
  const args = [];
  for (const field of allowedFields) {
    if (field in body) {
      sets.push(`${field} = ?`);
      args.push(body[field]);
    }
  }
  if (sets.length === 0) return c.json({ error: "no valid fields to update" }, 400);
  sets.push("version = version + 1");
  sets.push("last_modified = ?");
  args.push(now());
  args.push(id);
  await db2.execute({ sql: `UPDATE nodes SET ${sets.join(", ")} WHERE id = ?`, args });
  const result = await db2.execute({ sql: "SELECT * FROM nodes WHERE id = ?", args: [id] });
  return c.json(result.rows[0]);
});
nodes.delete("/nodes/:id", async (c) => {
  const id = c.req.param("id");
  const db2 = getDb();
  await db2.execute({ sql: "DELETE FROM nodes WHERE id = ?", args: [id] });
  return c.json({ ok: true });
});
nodes.post("/nodes/backfill-embeddings", async (c) => {
  const db2 = getDb();
  const result = await db2.execute(
    "SELECT id, type, subtype, content_title, content_summary, content_body FROM nodes WHERE embedding_vector IS NULL"
  );
  if (result.rows.length === 0) {
    return c.json({ ok: true, embedded: 0, total: 0 });
  }
  const texts = result.rows.map((row) => {
    const text = buildNodeText(row.content_title, row.content_summary, row.content_body);
    const prefix = buildContextPrefix(row.type, row.subtype);
    return prefix + " " + text;
  });
  const embeddings = await embedTexts(texts);
  let embedded = 0;
  for (let i = 0; i < result.rows.length; i++) {
    const emb = embeddings[i];
    if (emb && emb.length > 0) {
      const buffer = Buffer.from(emb.buffer);
      await db2.execute({
        sql: "UPDATE nodes SET embedding_vector = ?, embedding_model = ? WHERE id = ?",
        args: [buffer, "openai-3-small", result.rows[i].id]
      });
      embedded++;
    }
  }
  return c.json({ ok: true, embedded, total: result.rows.length });
});
var nodes_default = nodes;

// src/routes/edges.ts
import { Hono as Hono3 } from "hono";
var edges = new Hono3();
edges.post("/edges", async (c) => {
  const body = await c.req.json();
  const { source_id, target_id, type, subtype, neural_weight, strength, confidence } = body;
  if (!source_id || !target_id || !type) {
    return c.json({ error: "source_id, target_id, and type are required" }, 400);
  }
  const id = edgeId();
  const edgeStrength = strength ?? getDefaultEdgeWeight(type);
  const edgeConfidence = confidence ?? 1;
  const weight = neural_weight ?? edgeStrength;
  const db2 = getDb();
  await db2.execute({
    sql: `INSERT INTO edges (id, type, subtype, source_id, target_id, neural_weight, strength, confidence)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, type, subtype ?? null, source_id, target_id, weight, edgeStrength, edgeConfidence]
  });
  const result = await db2.execute({ sql: "SELECT * FROM edges WHERE id = ?", args: [id] });
  return c.json(result.rows[0], 201);
});
edges.get("/edges", async (c) => {
  const nodeId2 = c.req.query("node_id");
  const direction = c.req.query("direction") ?? "both";
  if (!nodeId2) {
    return c.json({ error: "node_id query parameter is required" }, 400);
  }
  const db2 = getDb();
  let sql;
  let args;
  if (direction === "out") {
    sql = "SELECT * FROM edges WHERE source_id = ?";
    args = [nodeId2];
  } else if (direction === "in") {
    sql = "SELECT * FROM edges WHERE target_id = ?";
    args = [nodeId2];
  } else {
    sql = "SELECT * FROM edges WHERE source_id = ? OR target_id = ?";
    args = [nodeId2, nodeId2];
  }
  const result = await db2.execute({ sql, args });
  return c.json({ data: result.rows, count: result.rows.length });
});
edges.post("/edges/:id/strengthen", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const amount = body.amount ?? 0.05;
  const db2 = getDb();
  const existing = await db2.execute({ sql: "SELECT * FROM edges WHERE id = ?", args: [id] });
  if (existing.rows.length === 0) return c.json({ error: "not found" }, 404);
  const currentStrength = Number(existing.rows[0]?.strength ?? 0.5);
  const newStrength = Math.min(1, currentStrength + amount);
  await db2.execute({
    sql: "UPDATE edges SET strength = ?, neural_weight = ? WHERE id = ?",
    args: [newStrength, newStrength, id]
  });
  const result = await db2.execute({ sql: "SELECT * FROM edges WHERE id = ?", args: [id] });
  return c.json(result.rows[0]);
});
edges.delete("/edges/:id", async (c) => {
  const id = c.req.param("id");
  const db2 = getDb();
  await db2.execute({ sql: "DELETE FROM edges WHERE id = ?", args: [id] });
  return c.json({ ok: true });
});
var edges_default = edges;

// src/routes/search.ts
import { Hono as Hono4 } from "hono";
import { executeSSA } from "@nous/core/ssa";

// src/ssa-context.ts
import { cosineSimilarity } from "@nous/core/embeddings";
function createSSAContext() {
  return {
    /**
     * Fetch minimal node info for filter evaluation during spreading.
     */
    async getNode(id) {
      const db2 = getDb();
      const r = await db2.execute({
        sql: `SELECT id, type, created_at,
              COALESCE(neural_last_accessed, provenance_created_at) as last_accessed
              FROM nodes WHERE id = ?`,
        args: [id]
      });
      if (r.rows.length === 0) return null;
      const row = r.rows[0];
      return {
        id: row.id,
        type: row.type,
        created_at: row.created_at,
        last_accessed: row.last_accessed
      };
    },
    /**
     * Get all neighbors (bidirectional) for spreading activation.
     * Returns connected nodes with their edge info and weight.
     */
    async getNeighbors(nodeId2) {
      const db2 = getDb();
      const r = await db2.execute({
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
        args: [nodeId2, nodeId2, nodeId2]
      });
      return r.rows.map((row) => ({
        node: {
          id: row.nid,
          type: row.ntype,
          created_at: row.ncreated,
          last_accessed: row.nlast
        },
        edge: {
          id: row.eid,
          source_id: row.source_id,
          target_id: row.target_id,
          edge_type: row.etype
        },
        weight: Number(row.strength ?? 0.5)
      }));
    },
    /**
     * Vector search via cosine similarity scan.
     * Loads all embedded nodes and computes similarity against query vector.
     * For <10K nodes this is <10ms. Replace with ANN index if scale demands it.
     */
    async vectorSearch(queryEmbedding, limit) {
      if (queryEmbedding.length === 0) return [];
      const db2 = getDb();
      const r = await db2.execute(
        "SELECT id, embedding_vector FROM nodes WHERE embedding_vector IS NOT NULL"
      );
      if (r.rows.length === 0) return [];
      const scored = [];
      for (const row of r.rows) {
        const blob = row.embedding_vector;
        if (!blob) continue;
        const nodeVec = new Float32Array(blob);
        if (nodeVec.length !== queryEmbedding.length) continue;
        const sim = cosineSimilarity(queryEmbedding, nodeVec);
        scored.push({ nodeId: row.id, score: sim });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit);
    },
    /**
     * BM25 search using SQLite FTS5.
     * Builds OR query from terms with prefix matching.
     * Scores are normalized to 0-1 range.
     */
    async bm25Search(terms, limit) {
      if (terms.length === 0) return [];
      const db2 = getDb();
      const ftsQuery = terms.map((t) => `"${t.replace(/"/g, "")}"*`).join(" OR ");
      if (!ftsQuery) return [];
      try {
        const r = await db2.execute({
          sql: `SELECT n.id, rank
                FROM nodes_fts fts
                JOIN nodes n ON n.rowid = fts.rowid
                WHERE nodes_fts MATCH ?
                ORDER BY rank
                LIMIT ?`,
          args: [ftsQuery, limit]
        });
        if (r.rows.length === 0) return [];
        const rawScores = r.rows.map(
          (row) => Math.abs(Number(row.rank ?? 0))
        );
        const maxBM25 = Math.max(...rawScores, 1e-3);
        return r.rows.map((row, i) => ({
          nodeId: row.id,
          score: rawScores[i] / maxBM25
        }));
      } catch {
        return [];
      }
    },
    /**
     * Graph-level metrics for reranking context.
     * Reuses the existing getGraphMetrics() from db.ts.
     */
    async getGraphMetrics() {
      return getGraphMetrics();
    },
    /**
     * Fetch reranking-specific fields for a node.
     * Includes access count and inbound edge count for authority/affinity signals.
     */
    async getNodeForReranking(id) {
      const db2 = getDb();
      const [nodeR, edgeR] = await Promise.all([
        db2.execute({
          sql: `SELECT id, neural_last_accessed, provenance_created_at,
                       created_at, neural_access_count
                FROM nodes WHERE id = ?`,
          args: [id]
        }),
        db2.execute({
          sql: "SELECT COUNT(*) as cnt FROM edges WHERE target_id = ?",
          args: [id]
        })
      ]);
      if (nodeR.rows.length === 0) return null;
      const row = nodeR.rows[0];
      return {
        id: row.id,
        last_accessed: new Date(
          row.neural_last_accessed || row.provenance_created_at
        ),
        created_at: new Date(row.created_at),
        access_count: Number(row.neural_access_count ?? 0),
        inbound_edge_count: Number(edgeR.rows[0]?.cnt ?? 0)
      };
    }
  };
}

// src/routes/search.ts
import { checkDisqualifiers, classifyQueryType } from "@nous/core/qcs";
var search = new Hono4();
var ssaEmbed = async (queries) => {
  if (queries.length === 0) return new Float32Array(0);
  try {
    return await embedQuery(queries[0]);
  } catch {
    return new Float32Array(0);
  }
};
search.post("/search", async (c) => {
  const body = await c.req.json();
  const { query, type, subtype, lifecycle, limit: rawLimit, time_range } = body;
  if (!query || typeof query !== "string") {
    return c.json({ error: "query string is required" }, 400);
  }
  const limit = Math.min(Number(rawLimit ?? 10), 100);
  const db2 = getDb();
  const ts = now();
  const qcsDisqualifier = checkDisqualifiers(query);
  const qcsQueryType = classifyQueryType(query);
  const isSimpleLookup = !qcsDisqualifier.disqualified && qcsQueryType.type === "LOOKUP" && qcsQueryType.confidence >= 0.7;
  const ssaMultiplier = isSimpleLookup ? 2 : 3;
  try {
    const context = createSSAContext();
    const ssaResult = await executeSSA({
      request: {
        query,
        // Over-fetch for post-filtering — QCS adjusts multiplier
        limit: limit * ssaMultiplier,
        // SSA supports type filtering natively
        filters: type ? { types: [type] } : void 0
      },
      context,
      embed: ssaEmbed,
      // Lower seed threshold when no embeddings are available.
      // With embeddings: combined = 0.7*vector + 0.3*bm25 can reach 0.60+
      // Without embeddings: combined = 0.3*bm25 maxes at 0.30, so use 0.05
      config: process.env.OPENAI_API_KEY ? void 0 : { seed_threshold: 0.05 }
      // BM25-only fallback
    });
    if (ssaResult.relevant_nodes.length === 0) {
      return c.json({ data: [], count: 0, metrics: ssaResult.metrics });
    }
    const rankedIds = ssaResult.relevant_nodes.map((n) => n.node_id);
    const placeholders = rankedIds.map(() => "?").join(",");
    const nodeResult = await db2.execute({
      sql: `SELECT * FROM nodes WHERE id IN (${placeholders})`,
      args: rankedIds
    });
    const nodeMap = new Map(
      nodeResult.rows.map((r) => [r.id, r])
    );
    let results = ssaResult.relevant_nodes.filter((ranked) => {
      const row = nodeMap.get(ranked.node_id);
      if (!row) return false;
      if (subtype && row.subtype !== subtype) return false;
      if (lifecycle && row.state_lifecycle !== lifecycle) return false;
      return true;
    });
    if (time_range && time_range.start && time_range.end) {
      const start = new Date(time_range.start).getTime();
      const end = new Date(time_range.end).getTime();
      const timeType = time_range.type || "any";
      results = results.filter((ranked) => {
        const row = nodeMap.get(ranked.node_id);
        if (!row) return false;
        if ((timeType === "event" || timeType === "any") && row.temporal_event_time) {
          const t = new Date(row.temporal_event_time).getTime();
          if (t >= start && t <= end) return true;
        }
        if ((timeType === "ingestion" || timeType === "any") && row.provenance_created_at) {
          const t = new Date(row.provenance_created_at).getTime();
          if (t >= start && t <= end) return true;
        }
        return timeType === "any" ? false : false;
      });
    }
    results = results.slice(0, limit);
    const data = results.map((ranked) => {
      const row = nodeMap.get(ranked.node_id);
      const decayed = applyDecay(row);
      return {
        ...decayed,
        score: Math.round(ranked.score * 1e4) / 1e4,
        breakdown: ranked.ranking_reason.score_breakdown,
        primary_signal: ranked.ranking_reason.primary_signal
      };
    });
    for (const item of data) {
      await db2.execute({
        sql: "UPDATE nodes SET neural_access_count = neural_access_count + 1, neural_last_accessed = ? WHERE id = ?",
        args: [ts, item.id]
      });
    }
    return c.json({
      data,
      count: data.length,
      metrics: ssaResult.metrics,
      qcs: {
        query_type: qcsQueryType.type,
        confidence: qcsQueryType.confidence,
        disqualified: qcsDisqualifier.disqualified,
        disqualifier_category: qcsDisqualifier.category ?? null,
        ssa_multiplier: ssaMultiplier
      }
    });
  } catch (e) {
    console.error("[search] SSA failed, falling back to LIKE:", e.message);
    const likeSql = `
      SELECT * FROM nodes
      WHERE (content_title LIKE ? OR content_body LIKE ? OR content_summary LIKE ?)
      ${type ? "AND type = ?" : ""}
      ${subtype ? "AND subtype = ?" : ""}
      ${lifecycle ? "AND state_lifecycle = ?" : ""}
      ORDER BY created_at DESC
      LIMIT ?
    `;
    const likePattern = `%${query}%`;
    const likeArgs = [
      likePattern,
      likePattern,
      likePattern
    ];
    if (type) likeArgs.push(type);
    if (subtype) likeArgs.push(subtype);
    if (lifecycle) likeArgs.push(lifecycle);
    likeArgs.push(limit);
    const fallback = await db2.execute({ sql: likeSql, args: likeArgs });
    const data = fallback.rows.map(
      (row) => applyDecay(row)
    );
    return c.json({ data, count: data.length });
  }
});
var search_default = search;

// src/routes/decay.ts
import { Hono as Hono5 } from "hono";
var decay = new Hono5();
decay.post("/decay", async (c) => {
  const db2 = getDb();
  const result = await db2.execute(
    "SELECT * FROM nodes WHERE state_lifecycle NOT IN ('ARCHIVE', 'DELETED')"
  );
  let processed = 0;
  const transitions = [];
  for (const row of result.rows) {
    const nodeRow = row;
    const { retrievability, lifecycle_state } = computeDecay(nodeRow);
    const currentLifecycle = nodeRow.state_lifecycle;
    if (Math.abs(retrievability - nodeRow.neural_retrievability) > 1e-3 || lifecycle_state !== currentLifecycle) {
      await db2.execute({
        sql: "UPDATE nodes SET neural_retrievability = ?, state_lifecycle = ? WHERE id = ?",
        args: [Math.round(retrievability * 1e4) / 1e4, lifecycle_state, nodeRow.id]
      });
      if (lifecycle_state !== currentLifecycle) {
        transitions.push({
          id: nodeRow.id,
          from: currentLifecycle,
          to: lifecycle_state
        });
      }
    }
    processed++;
  }
  return c.json({
    ok: true,
    processed,
    transitions_count: transitions.length,
    transitions
  });
});
var decay_default = decay;

// src/routes/graph.ts
import { Hono as Hono6 } from "hono";
var graph = new Hono6();
graph.get("/graph", async (c) => {
  const db2 = getDb();
  const nodeResult = await db2.execute({
    sql: `SELECT * FROM nodes ORDER BY provenance_created_at DESC LIMIT 500`,
    args: []
  });
  const nodes2 = nodeResult.rows.map((row) => {
    const decayed = applyDecay(row);
    return {
      id: decayed.id,
      type: decayed.type,
      subtype: decayed.subtype,
      title: decayed.content_title,
      summary: decayed.content_summary,
      retrievability: decayed.neural_retrievability,
      lifecycle: decayed.state_lifecycle,
      access_count: decayed.neural_access_count,
      created_at: decayed.provenance_created_at
    };
  });
  const edgeResult = await db2.execute({
    sql: `SELECT * FROM edges`,
    args: []
  });
  const edges2 = edgeResult.rows.map((row) => ({
    id: row.id,
    source: row.source_id,
    target: row.target_id,
    type: row.type,
    strength: row.strength
  }));
  return c.json({ nodes: nodes2, edges: edges2, count: { nodes: nodes2.length, edges: edges2.length } });
});
var graph_default = graph;

// src/routes/contradiction.ts
import { Hono as Hono7 } from "hono";
import { nanoid as nanoid3 } from "nanoid";
import { runTier2Pattern as runTier2Pattern2 } from "@nous/core/contradiction";
var contradiction = new Hono7();
contradiction.post("/contradiction/detect", async (c) => {
  const body = await c.req.json();
  const { content, title, node_id } = body;
  if (!content || typeof content !== "string") {
    return c.json({ error: "content string is required" }, 400);
  }
  const patternResult = runTier2Pattern2(content);
  const detected = patternResult.triggers_found.length > 0 && patternResult.confidence_score > 0.3;
  let conflicting_nodes = [];
  if (detected) {
    const db2 = getDb();
    const searchText = title || content.substring(0, 80);
    const likePattern = `%${searchText.split(" ").slice(0, 3).join("%")}%`;
    try {
      const result = await db2.execute({
        sql: `SELECT id, content_title, subtype FROM nodes
              WHERE (content_title LIKE ? OR content_body LIKE ?)
              ${node_id ? "AND id != ?" : ""}
              ORDER BY created_at DESC LIMIT 5`,
        args: node_id ? [likePattern, likePattern, node_id] : [likePattern, likePattern]
      });
      conflicting_nodes = result.rows.map((r) => ({
        id: r.id,
        title: r.content_title,
        subtype: r.subtype
      }));
    } catch {
    }
  }
  return c.json({
    conflict_detected: detected,
    tier: "PATTERN",
    confidence: patternResult.confidence_score,
    triggers: patternResult.triggers_found,
    disqualifiers: patternResult.disqualifiers_found,
    temporal_signal: patternResult.temporal_signal,
    conflicting_nodes
  });
});
contradiction.get("/contradiction/queue", async (c) => {
  const status = c.req.query("status") || "pending";
  const db2 = getDb();
  const result = await db2.execute({
    sql: "SELECT * FROM conflict_queue WHERE status = ? ORDER BY created_at ASC",
    args: [status]
  });
  return c.json({ data: result.rows, count: result.rows.length });
});
contradiction.post("/contradiction/queue", async (c) => {
  const body = await c.req.json();
  const {
    old_node_id,
    new_node_id,
    new_content,
    conflict_type,
    detection_tier,
    detection_confidence,
    context,
    entity_name,
    topic
  } = body;
  if (!old_node_id || !new_content) {
    return c.json({ error: "old_node_id and new_content are required" }, 400);
  }
  const id = `c_${nanoid3(12)}`;
  const ts = now();
  const expires = new Date(Date.now() + 14 * 864e5).toISOString();
  const db2 = getDb();
  await db2.execute({
    sql: `INSERT INTO conflict_queue
      (id, old_node_id, new_node_id, new_content, conflict_type,
       detection_tier, detection_confidence, context, entity_name, topic,
       status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    args: [
      id,
      old_node_id,
      new_node_id ?? null,
      new_content,
      conflict_type ?? "AMBIGUOUS",
      detection_tier ?? "PATTERN",
      detection_confidence ?? 0,
      context ?? null,
      entity_name ?? null,
      topic ?? null,
      ts,
      expires
    ]
  });
  return c.json({ id, status: "pending", expires_at: expires }, 201);
});
contradiction.post("/contradiction/resolve", async (c) => {
  const { conflict_id, resolution } = await c.req.json();
  if (!conflict_id || !resolution) {
    return c.json({ error: "conflict_id and resolution are required" }, 400);
  }
  const db2 = getDb();
  await db2.execute({
    sql: "UPDATE conflict_queue SET status = ? WHERE id = ?",
    args: ["resolved", conflict_id]
  });
  return c.json({ ok: true, conflict_id, resolution });
});
var contradiction_default = contradiction;

// src/routes/classify.ts
import { Hono as Hono8 } from "hono";
import { checkDisqualifiers as checkDisqualifiers2, classifyQueryType as classifyQueryType2 } from "@nous/core/qcs";
var classify = new Hono8();
classify.post("/classify-query", async (c) => {
  const body = await c.req.json();
  const { query } = body;
  if (!query || typeof query !== "string") {
    return c.json({ error: "query string is required" }, 400);
  }
  const disqualifier = checkDisqualifiers2(query);
  const queryType = classifyQueryType2(query);
  return c.json({
    query,
    disqualified: disqualifier.disqualified,
    disqualifier_category: disqualifier.category ?? null,
    disqualifier_reason: disqualifier.reason ?? null,
    query_type: queryType.type,
    confidence: queryType.confidence,
    entity: queryType.entity ?? null,
    attribute: queryType.attribute ?? null
  });
});
var classify_default = classify;

// src/index.ts
import { mkdirSync } from "fs";
import { resolve as resolve2 } from "path";
var app = new Hono9().basePath("/v1");
app.use("*", cors());
app.use("*", logger());
app.route("/", health_default);
app.route("/", nodes_default);
app.route("/", edges_default);
app.route("/", search_default);
app.route("/", decay_default);
app.route("/", graph_default);
app.route("/", contradiction_default);
app.route("/", classify_default);
app.get("/", (c) => c.json({ name: "nous-server", version: "0.1.0" }));
async function main() {
  const storagePath = process.env.NOUS_DB_PATH ? resolve2(process.env.NOUS_DB_PATH, "..") : resolve2(process.cwd(), "storage");
  mkdirSync(storagePath, { recursive: true });
  await initSchema();
  console.log("[nous] Database initialized");
  const port = Number(process.env.PORT ?? 3100);
  serve({ fetch: app.fetch, port }, () => {
    console.log(`[nous] Server running on http://localhost:${port}`);
  });
}
main().catch((err) => {
  console.error("[nous] Failed to start:", err);
  process.exit(1);
});
