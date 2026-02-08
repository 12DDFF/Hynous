# Nous Packages

> **Monorepo containing all Nous implementation code.**
> This directory is excluded from Obsidian indexing but accessible to AI agents.

## Directory Structure

```
packages/
├── package.json          # Workspace root
├── pnpm-workspace.yaml   # Monorepo configuration
├── tsconfig.base.json    # Shared TypeScript config
│
└── core/                 # @nous/core - Foundation library
    ├── src/
    │   ├── constants.ts  # Shared constants
    │   │
    │   │  # Phase 1: Foundation
    │   ├── nodes/        # Node types, schemas, creation (storm-011)
    │   ├── blocks/       # Block parsing and structure (storm-011)
    │   ├── edges/        # Edge types and relationships (storm-011)
    │   ├── temporal/     # Four-type time handling (storm-011)
    │   ├── editing/      # Semantic editing, versioning (storm-011)
    │   ├── storage/      # Three-layer storage (storm-004)
    │   ├── tps/          # Temporal Parsing System (storm-004)
    │   ├── episodes/     # Episode utilities (storm-004)
    │   ├── db/           # Database infrastructure (storm-017)
    │   ├── sync/         # Sync infrastructure (storm-017)
    │   │
    │   │  # Phase 2: Data Representation
    │   ├── embeddings/   # Contextual Embedding Ecosystem (storm-016)
    │   ├── edges/weight/ # Edge Weight Calculation (storm-031)
    │   ├── params/       # Algorithm Parameters (storm-028)
    │   │
    │   │  # Phase 3: Retrieval Core
    │   ├── ssa/          # Seeded Spreading Activation (storm-005)
    │   ├── qcs/          # Query Classification System (storm-008)
    │   ├── retrieval/    # Retrieval Architecture (storm-003)
    │   │
    │   │  # Phase 4: Memory Lifecycle
    │   └── gate-filter/  # Gate Filter System (storm-036)
    │
    ├── package.json
    └── tsconfig.json
```

## Relationship to Specs

Each package implements specs from `Specs/`:

| Package | Implements | Spec Location | Status | Tests |
|---------|------------|---------------|--------|-------|
| `@nous/core` | storm-011 (Nodes) | `Specs/Phase-1-Foundation/storm-011/` | Finalized | 33 |
| `@nous/core` | storm-004 (Storage) | `Specs/Phase-1-Foundation/storm-004/` | Finalized | 104 |
| `@nous/core` | storm-017 (Infrastructure) | `Specs/Phase-1-Foundation/storm-017/` | Finalized | 108 |
| `@nous/core` | storm-016 (Embeddings) | `Specs/Phase-2-Data-Representation/storm-016/` | Finalized | 112 |
| `@nous/core` | storm-031 (Edge Weight) | `Specs/Phase-2-Data-Representation/storm-031/` | Finalized | 120 |
| `@nous/core` | storm-028 (Params) | `Specs/Phase-2-Data-Representation/storm-028/` | Finalized | 133 |
| `@nous/core` | storm-005 (SSA) | `Specs/Phase-3-Retrieval-Core/storm-005/` | Finalized | 98 |
| `@nous/core` | storm-008 (QCS) | `Specs/Phase-3-Retrieval-Core/storm-008/` | Finalized | 121 |
| `@nous/core` | storm-003 (Retrieval) | `Specs/Phase-3-Retrieval-Core/storm-003/` | Finalized | 107 |
| `@nous/core` | storm-036 (Gate Filter) | `Specs/Phase-4-Memory-Lifecycle/storm-036/` | Finalized | 103 |
| `@nous/api` | storm-023 | (future) | - | - |
| `@nous/sdk` | storm-030 | (future) | - | - |

**Total Tests:** 1236 passing

## Getting Started

```bash
# Navigate to packages directory
cd packages

# Install dependencies
pnpm install

# Run all tests
pnpm test

# Build all packages
pnpm build
```

## Development Workflow

1. **Read the spec** - Check `Specs/Phase-X-Name/storm-XXX/` for interfaces
2. **Follow the Engineering Guide** - `Specs/Engineering-Guide.md` (7 phases)
3. **Implement** - Write code in the appropriate package
4. **Test** - Write tests alongside implementation
5. **Validate** - Ensure implementation matches spec
6. **Finalize** - Update spec status and unblock dependents

See [[Hub#Workflow: Iterative Storm Development]] and [[Specs/Engineering-Guide]] for the full lifecycle.

## Adding a New Package

1. Create directory: `packages/[name]/`
2. Copy structure from `core/`
3. Update `pnpm-workspace.yaml`
4. Run `pnpm install`

## For AI Agents

This directory contains the actual implementation code. When implementing a spec:

1. Read the spec files in `Specs/Phase-X-Name/storm-XXX/spec/`
2. Read the Engineering Guide: `Specs/Engineering-Guide.md`
3. Implement in the corresponding package under `packages/`
4. Write tests in the same directory as the code (`.test.ts` suffix)
5. Ensure exports are added to the module's `index.ts`
6. Update `packages/core/package.json` exports field
