# Nous Server

> **Monorepo containing the Nous memory system: `@nous/core` library + Hono HTTP server.**

## Directory Structure

```
nous-server/
├── pnpm-workspace.yaml       # Monorepo configuration
│
├── core/                      # @nous/core — Foundation library (v0.3.0)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts           # Root re-exports
│       ├── constants.ts       # Shared constants
│       ├── constants.test.ts
│       │
│       │  # Foundation
│       ├── nodes/             # Node types, schemas, creation
│       ├── blocks/            # Block parsing and structure
│       ├── edges/             # Edge types, relationships, weight calculation
│       ├── temporal/          # Four-type time handling
│       ├── editing/           # Semantic editing, versioning
│       ├── tps/               # Temporal Parsing System
│       ├── episodes/          # Episode utilities
│       ├── db/                # Database infrastructure (SQLite)
│       ├── sync/              # Sync infrastructure
│       │
│       │  # Data Representation
│       ├── embeddings/        # Contextual Embedding Ecosystem (OpenAI)
│       ├── params/            # Algorithm parameters (SSA weights, decay, thresholds)
│       │
│       │  # Retrieval
│       ├── ssa/               # Seeded Spreading Activation (BM25 + vector + graph)
│       ├── qcs/               # Query Classification System
│       ├── retrieval/         # Retrieval architecture
│       │
│       │  # Memory Lifecycle
│       ├── gate-filter/       # Pre-storage quality gate
│       ├── forgetting/        # FSRS-based decay
│       ├── contradiction/     # Contradiction detection and resolution
│       ├── clusters/          # Cluster management
│       ├── sections/          # Memory sections (4-section bias layer)
│       │
│       │  # Agent & Operations
│       ├── agent/             # Agent-facing utilities
│       ├── agent-tools/       # Agent tool definitions
│       ├── api/               # API type definitions
│       ├── backend/           # Backend utilities
│       ├── operations/        # Batch operations
│       ├── ingestion/         # Node ingestion pipeline
│       ├── context-window/    # Context window management
│       ├── working-memory/    # Working memory utilities
│       │
│       │  # Infrastructure
│       ├── llm/               # LLM integration
│       ├── prompts/           # Prompt templates
│       ├── security/          # Security and privacy tiers
│       └── adaptive-limits/   # Adaptive rate limiting
│
└── server/                    # Hono HTTP server (:3100)
    └── src/
        ├── index.ts           # Server entry point
        ├── db.ts              # Database initialization
        ├── embed.ts           # Embedding utilities
        ├── utils.ts           # Shared helpers
        ├── core-bridge.ts     # Bridge between server and @nous/core
        ├── ssa-context.ts     # SSA context builder
        └── routes/
            ├── nodes.ts       # CRUD: GET/POST/PATCH/DELETE /v1/nodes
            ├── edges.ts       # CRUD: GET/POST/DELETE /v1/edges, POST /v1/edges/:id/strengthen
            ├── search.ts      # POST /v1/search (SSA-powered)
            ├── classify.ts    # POST /v1/classify-query (QCS)
            ├── clusters.ts    # /v1/clusters CRUD + membership
            ├── contradiction.ts # /v1/contradiction (detect, queue, resolve)
            ├── decay.ts       # POST /v1/decay (FSRS batch)
            ├── graph.ts       # GET /v1/graph (full graph for visualization)
            ├── health.ts      # GET /v1/health
```

## Getting Started

```bash
# Navigate to nous-server
cd nous-server

# Install dependencies
pnpm install

# Build core library (required before server can import)
cd core && pnpm build && cd ..

# Run tests
cd core && pnpm test

# Start server
cd server && pnpm dev
```

> **Important:** When you add or change exports in `core/src/` (e.g., `params/index.ts`, `sections/index.ts`), you must rebuild: `cd core && pnpm build`. The server imports from `core/dist/`, not `core/src/`. The DTS build may fail due to a pre-existing `src/db/adapter.ts` type error, but the ESM build succeeds and that is what the server uses.

## Tests

Tests are co-located with source files (`.test.ts` suffix) and run via vitest.

```bash
cd core
pnpm test          # Run all tests
pnpm test:watch    # Watch mode
pnpm test:coverage # With coverage
```

**Current count:** 4272+ passing tests (1 pre-existing `PRIVACY_TIERS` failure).

## Key Modules

| Module | Purpose | Tests |
|--------|---------|-------|
| `nodes/` | Node types, schemas, CRUD | 33 |
| `edges/` | Edge types, weight calculation | 120 |
| `ssa/` | Seeded Spreading Activation | 104 |
| `qcs/` | Query Classification | 121 |
| `retrieval/` | Retrieval architecture | 107 |
| `params/` | Algorithm parameters | 133 |
| `embeddings/` | Vector embeddings (OpenAI) | 112 |
| `db/` | SQLite infrastructure | 108 |
| `gate-filter/` | Pre-storage quality gate | 103 |
| `sections/` | 4-section memory bias layer | - |
| `contradiction/` | Contradiction detection/resolution | - |
| `forgetting/` | FSRS-based memory decay | - |

## Development Workflow

1. Implement in the appropriate module under `core/src/`
2. Write tests alongside implementation (`.test.ts` suffix)
3. Ensure exports are added to the module's `index.ts`
4. Update `core/package.json` exports field if adding a new module
5. Rebuild: `cd core && pnpm build`

## For AI Agents

- Implementation code lives in `core/src/` and `server/src/`
- The server is a thin HTTP layer; all logic lives in `@nous/core`
- `core-bridge.ts` maps core constants (e.g., `EDGE_TYPE_WEIGHTS`) for server use
- Route files in `server/src/routes/` map 1:1 to REST endpoints

---

Last updated: 2026-03-01
