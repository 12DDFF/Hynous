import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { initSchema } from './db.js';
import health from './routes/health.js';
import nodes from './routes/nodes.js';
import edges from './routes/edges.js';
import search from './routes/search.js';
import decay from './routes/decay.js';
import graph from './routes/graph.js';
import contradiction from './routes/contradiction.js';
import classify from './routes/classify.js';
import { mkdirSync } from 'fs';
import { resolve } from 'path';

const app = new Hono().basePath('/v1');

// Middleware
app.use('*', cors());
app.use('*', logger());

// Mount routes
app.route('/', health);
app.route('/', nodes);
app.route('/', edges);
app.route('/', search);
app.route('/', decay);
app.route('/', graph);
app.route('/', contradiction);
app.route('/', classify);

// Root redirect
app.get('/', (c) => c.json({ name: 'nous-server', version: '0.1.0' }));

async function main() {
  // Ensure storage directory exists
  const storagePath = process.env.NOUS_DB_PATH
    ? resolve(process.env.NOUS_DB_PATH, '..')
    : resolve(process.cwd(), 'storage');
  mkdirSync(storagePath, { recursive: true });

  // Init DB schema
  await initSchema();
  console.log('[nous] Database initialized');

  const port = Number(process.env.PORT ?? 3100);
  serve({ fetch: app.fetch, port }, () => {
    console.log(`[nous] Server running on http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error('[nous] Failed to start:', err);
  process.exit(1);
});
