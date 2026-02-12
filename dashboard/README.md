# Hynous Dashboard

> Reflex-powered dashboard for the Hynous crypto intelligence system.

## Quick Start

```bash
# From the dashboard directory
cd dashboard

# Initialize Reflex (first time only)
reflex init

# Run the dashboard
reflex run
```

The dashboard will be available at `http://localhost:3000`

## Structure

```
dashboard/
├── rxconfig.py              # Reflex configuration
├── assets/
│   └── graph.html           # Force-graph visualization (standalone HTML)
├── dashboard/               # Main app package
│   ├── dashboard.py         # App entry point, routing, Nous API proxy
│   ├── state.py             # Application state
│   ├── components/          # Reusable UI components
│   │   ├── card.py          # Card components
│   │   ├── chat.py          # Chat components
│   │   └── nav.py           # Navigation components
│   └── pages/               # Page components
│       ├── home.py          # Home page
│       ├── chat.py          # Chat page
│       ├── memory.py        # Memory browser + cluster sidebar
│       ├── graph.py         # Graph visualization (iframe → graph.html)
│       └── debug.py         # Agent trace inspector
└── README.md
```

## Pages

### Home (`/`)
- Portfolio overview (value, change)
- Agent status indicator
- Open positions
- Quick chat widget
- Recent activity feed

### Chat (`/chat`)
- Full conversation interface
- Message history
- Quick suggestions
- Real-time responses (when agent connected)

### Memory (`/memory`)
- Cluster sidebar with member counts and health
- Memory node browser with search and type filtering
- Cluster-scoped recall

### Graph (`/graph`)
- Force-directed graph of all memory nodes and edges (force-graph v1.47.4)
- Node colors by subtype, size by connection count, opacity by retrievability
- Search highlighting, node detail panel on click
- **Cluster visualization toggle**: deterministic layout that separates nodes by cluster — each cluster gets its own region with Fibonacci spiral arrangement, convex hull boundaries, and cluster legend. Cross-cluster links still drawn. Toggle off restores normal physics layout.

### Debug (`/debug`)
- Agent trace inspector — every `agent.chat()` / `chat_stream()` call produces a trace
- Trace list sidebar with source badges, status dots, duration, auto-refresh (15s polling)
- Span timeline with expandable detail for each step (multiple spans can be open simultaneously)
- 7 span types: Context, Retrieval, LLM Call, Tool Execution, Memory Op, Compression, Queue Flush
- **Content visibility**: expanded spans show full resolved content, not just hashes:
  - LLM Call spans: full message array (`messages_content`) and response text (`response_content`)
  - Context spans: raw user message + full injected context (briefing/snapshot)
  - Retrieval spans: result bodies (title, content preview, score, node_type, lifecycle)
- Error panel for failed traces, duration tracking per span, output summary
- Source tagging: traces show origin (`user_chat`, `daemon:review`, `daemon:scanner`, etc.)

## Tech Stack

- **Framework:** Reflex (Python → React)
- **Styling:** Tailwind via Reflex
- **State:** Reflex state management
- **Theme:** Dark mode, Indigo accent (#6366f1)

## Design System

### Colors

| Name | Hex | Usage |
|------|-----|-------|
| Background | `#0a0a0a` | Page background |
| Surface | `#141414` | Cards, containers |
| Border | `#262626` | Borders, dividers |
| Muted | `#737373` | Secondary text |
| Accent | `#6366f1` | Primary actions, highlights |
| Positive | `#22c55e` | Success, profits |
| Negative | `#ef4444` | Error, losses |

### Typography

- **Headings:** Inter (600-700 weight)
- **Body:** Inter (400-500 weight)
- **Code:** JetBrains Mono

## Development

### Adding a new page

1. Create page component in `dashboard/pages/`
2. Add to `pages/__init__.py`
3. Add navigation in `state.py` and `components/nav.py`
4. Add route in `dashboard.py`

### Adding a new component

1. Create component in `dashboard/components/`
2. Export in `components/__init__.py`
3. Import where needed

## Nous API Proxy

The dashboard proxies Nous API requests through the Reflex backend (`dashboard.py:250`):

```
Browser → localhost:3000/api/nous/{path} → localhost:3100/v1/{path}
```

This is used by the graph page (`graph.html`) to fetch nodes, edges, clusters, and memberships without CORS issues. The proxy wildcards all `/api/nous/*` paths.
