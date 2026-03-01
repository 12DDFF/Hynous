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
│   ├── brain.html           # Brain-section visualization (standalone HTML)
│   ├── data.html            # Data intelligence dashboard (standalone HTML)
│   ├── graph.html           # Force-graph visualization (standalone HTML)
│   ├── hynous-avatar.png    # Hynous agent avatar image
│   └── ml.html              # ML / Satellite dashboard (standalone HTML)
├── dashboard/               # Main app package
│   ├── dashboard.py         # App entry point, routing, API proxies
│   ├── state.py             # Application state (reactive vars, polling, model prefs)
│   ├── components/          # Reusable UI components
│   │   ├── card.py          # Card + stat_card components
│   │   ├── chat.py          # Chat message rendering components
│   │   ├── nav.py           # Navigation bar
│   │   └── ticker.py        # Ticker symbol badge with auto-detected brand color
│   └── pages/               # Page components
│       ├── home.py          # Home — portfolio overview + agent status
│       ├── chat.py          # Chat — full conversation interface
│       ├── memory.py        # Memory — cluster browser + graph/sections tabs
│       ├── graph.py         # Graph — force-directed knowledge graph (iframe)
│       ├── journal.py       # Journal — trade history + phantom/playbook tracker
│       ├── data.py          # Data — data intelligence dashboard (iframe)
│       ├── ml.py            # ML — satellite engine dashboard + toggle (iframe)
│       ├── settings.py      # Settings — runtime trading parameters
│       ├── debug.py         # Debug — agent trace inspector
│       └── login.py         # Login — password gate
└── README.md
```

## Pages

### Home (`home.py`)
- Portfolio overview (value, change, sparkline)
- Agent status indicator (online/offline, model label)
- Open positions with live PnL
- Quick chat widget with recent messages
- Recent daemon activity feed

### Chat (`chat.py`)
- Full conversation interface with message history
- Model selector (Anthropic, OpenAI, xAI, DeepSeek, Google, Mistral, Qwen)
- Quick suggestion chips
- Real-time streaming responses (when agent connected)
- Financial value highlighting (green/red glow on +/- amounts)

### Memory (`memory.py`)
- **Graph tab**: Cluster sidebar with member counts and health, memory node browser with search and type filtering, cluster-scoped recall
- **Sections tab**: Brain-section visualization via `brain.html` iframe — interactive sagittal brain SVG with 4 clickable regions (KNOWLEDGE, EPISODIC, SIGNALS, PROCEDURAL), per-section force-directed graphs, pathway lines, and stat chips

### Graph (`graph.py`)
- Force-directed graph of all memory nodes and edges (force-graph v1.47.4)
- Node colors by subtype, size by connection count, opacity by retrievability
- Search highlighting, node detail panel on click
- **Cluster visualization toggle**: deterministic layout that separates nodes by cluster — each cluster gets its own region with Fibonacci spiral arrangement, convex hull boundaries, and cluster legend. Cross-cluster links still drawn. Toggle off restores normal physics layout.

### Journal (`journal.py`)
- **Trades tab**: Trade history table, equity curve chart, 9-stat grid (win rate, PnL, profit factor, total trades, fee losses, total fees, current streak, best trade, worst trade), regime detection scoring
- **Regret tab**: Phantom tracker table (missed opportunities with PnL, anomaly type, category, expandable details) and playbook library (stored after profitable trade closes)

### Data (`data.py`)
- Full-screen data intelligence dashboard via `data.html` iframe
- Proxied through the Reflex backend to the hynous-data service (port 8100)
- **Price chart**: Candlestick (OHLC) with green/red coloring, crosshair tooltip showing O/H/L/C grid
- **Heatmap price lines**: Top 5 liquidation buckets above + below current price drawn as dashed price lines on the candlestick chart, colored by dominance (green = long, red = short, yellow = mixed), refreshed every 30s

### ML (`ml.py`)
- Full-screen ML/Satellite dashboard via `ml.html` iframe
- Satellite on/off toggle overlay (Reflex switch wired to daemon runtime state)
- 5 panels: status, feature snapshots, data quality, predictions, and prediction history (newest-first table with signal badges, ROE, top SHAP driver, model version)
- Model metadata and SHAP explanations

### Settings (`settings.py`)
- Runtime-adjustable trading parameters in a two-column card grid
- **Left column**: Macro card (leverage range, SL range), Micro/Scalp card (fixed leverage, SL), Position sizing card, Small wins card
- **Right column**: Risk card, Limits card, Scanner card, Smart money card
- Live fee/ROE preview calculations

### Debug (`debug.py`)
- Agent trace inspector — every `agent.chat()` / `chat_stream()` call produces a trace
- Trace list sidebar with source badges, status dots, duration, auto-refresh (15s polling)
- Span timeline with expandable detail for each step (multiple spans can be open simultaneously)
- 8 span types: Context, Retrieval, LLM Call, Tool Execution, Trade Step, Memory Op, Compression, Queue Flush
- **Content visibility**: expanded spans show full resolved content, not just hashes:
  - LLM Call spans: full message array (`messages_content`) and response text (`response_content`)
  - Context spans: raw user message + full injected context (briefing/snapshot)
  - Retrieval spans: result bodies (title, content preview, score, node_type, lifecycle)
- Error panel for failed traces, duration tracking per span, output summary
- Source tagging: traces show origin (`user_chat`, `daemon:review`, `daemon:scanner`, etc.)

### Login (`login.py`)
- Password gate — all dashboard content is behind authentication
- Centered login form with Hynous branding
- Session persisted via Reflex state (`is_authenticated`)

## API Proxies

The dashboard proxies several backend APIs through the Reflex backend (`dashboard.py`) so the browser doesn't need direct access to internal ports (blocked by UFW on VPS):

| Route | Target | Methods | Purpose |
|-------|--------|---------|---------|
| `/api/nous/{path}` | `localhost:3100/v1/{path}` | GET | Nous memory API (nodes, edges, clusters, graph) |
| `/api/data/{path}` | `localhost:8100/v1/{path}` | GET, POST, DELETE, PATCH | Data layer API (stats, signals, candles) |
| `/api/data-health` | `localhost:8100/health` | GET | Data layer health check |
| `/api/ml/status` | local query | GET | Satellite engine status |
| `/api/ml/features` | local query | GET | Latest feature snapshot per coin |
| `/api/ml/snapshots/stats` | local query | GET | Per-coin snapshot counts and availability |
| `/api/ml/predictions` | local query | GET | Latest ML prediction per coin |
| `/api/ml/predictions/history` | local query | GET | Prediction history newest-first (limit capped at 200) |
| `/api/ml/model` | local query | GET | Model metadata (artifacts directory) |
| `/api/ml/satellite/toggle` | config write | POST | Enable/disable satellite at runtime |
| `/api/candles` | Hyperliquid API | GET | OHLCV candle data |
| `/api/agent-message` | daemon wake | POST | Queue a user message for the agent |
| `/api/reset-paper-stats` | provider reset | POST | Reset paper trading session stats |

## Tech Stack

- **Framework:** Reflex (Python -> React)
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

---

Last updated: 2026-03-01
