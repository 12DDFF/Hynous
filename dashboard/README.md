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
├── dashboard/               # Main app package
│   ├── dashboard.py         # App entry point
│   ├── state.py             # Application state
│   ├── components/          # Reusable UI components
│   │   ├── card.py          # Card components
│   │   ├── chat.py          # Chat components
│   │   └── nav.py           # Navigation components
│   └── pages/               # Page components
│       ├── home.py          # Home page
│       └── chat.py          # Chat page
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

## Future Integration

The dashboard will connect to:

1. **FastAPI Gateway** - For unified API access
2. **Nous API** - Memory operations (via HTTP proxy)
3. **Hydra** - Market data and execution

See `docs/nous-integration-spec.md` for API details.
