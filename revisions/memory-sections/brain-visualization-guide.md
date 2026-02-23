# Brain Visualization — Memory Sections Frontend

> **STATUS: IMPLEMENTED (2026-02-22)** — `brain.html` created, `memory_tab` state added to `state.py`, `memory.py` updated with tab bar. Live-tested against 26 nodes / 27 edges: all 4 sections render with correct node counts, pathway lines, stat chips, ghost nodes (dashed ring), force graphs, detail panel, settings persistence, and back navigation. All 21 structural checks passed. Brace/paren balance verified (167/167, 516/516).

## Context

The Hynous memory system has a fully implemented backend with 4 brain-inspired memory sections (EPISODIC, SIGNALS, KNOWLEDGE, PROCEDURAL) — but zero frontend visualization. Every node already carries a `subtype` field that maps deterministically to a section. The goal is a new "Sections" tab within the existing memory page that shows an interactive brain graphic with per-section drill-down into force-directed graphs.

**Constraint: NO backend changes.** Section classification is pure client-side JS using the same static `SUBTYPE_TO_SECTION` mapping that exists in both TypeScript and Python. The `/v1/graph` endpoint returns `subtype` on each node, which is sufficient.

---

## Files to Modify

| File | Change | Lines |
|------|--------|-------|
| `dashboard/dashboard/state.py` | Add `memory_tab` state var + handler | +5 lines near line 2992 |
| `dashboard/dashboard/pages/memory.py` | Add tab bar, swap main area between graph/brain iframes | +35 lines |
| `dashboard/assets/brain.html` | **NEW** — Brain visualization (SVG overview + per-section force graph) | ~950 lines |

---

## Required Reading for Engineer

Read these files **in full** before writing any code. They define every pattern you must follow.

### Critical — Read in Full

| # | File | Why |
|---|------|-----|
| 1 | `dashboard/assets/graph.html` | **PRIMARY PATTERN.** You will replicate ~60% of this file's patterns: URL fallback chain (lines 440-447), COLORS/LABELS maps (449-479), `buildLookups()` (509-538), `renderGraph()` (653-849), node canvas rendering (689-723), batched link rendering (734-809), `isHighlighted()` (578-581), settings panel (83-417, 911-961), detail panel (275-329, 598-633), search handler (964-967). Copy CSS classes and rendering logic verbatim for visual consistency. |
| 2 | `dashboard/dashboard/pages/journal.py` lines 770-857 | **TAB PATTERN.** `_tab_pill()` (770-800), `_tab_bar()` (803-813), `journal_page()` header row (821-850), `rx.cond` tab content switch (853-857). Replicate this exactly for the memory page tab bar. |
| 3 | `dashboard/dashboard/pages/memory.py` | **FILE TO MODIFY.** Current structure: `_sidebar()` (259-282) + `_main_area()` (287-299) in an `rx.hstack`. You will modify `_main_area()` to include a tab bar and conditional iframe. |
| 4 | `dashboard/dashboard/state.py` lines 2992-3005 | **STATE PATTERN.** `journal_tab` var and `set_journal_tab` handler. Replicate exactly for `memory_tab`. |
| 5 | `src/hynous/nous/sections.py` lines 42-65 | **AUTHORITATIVE MAPPING.** The `SUBTYPE_TO_SECTION` dict (16 entries). Port this to JavaScript in brain.html exactly. Also read `SECTION_PROFILES` (lines 172-252) for per-section decay/encoding params that inform the brain overview stats. |

### Context — Skim for Understanding

| # | File | Why |
|---|------|-----|
| 6 | `revisions/memory-sections/executive-summary.md` | Theory doc: brain analogy, 4 sections, "sections are a bias layer not partitions" design principle, section interconnection diagram. |
| 7 | `nous-server/server/src/routes/graph.ts` | Graph API: returns `{nodes, edges, clusters, memberships}`. Node shape: `{id, type, subtype, title, summary, retrievability, lifecycle, access_count, created_at}`. Edge shape: `{id, source, target, type, strength}`. Note: `memory_section` is NOT in the response — derive it client-side. |
| 8 | `dashboard/dashboard/dashboard.py` | Routing: single `rx.cond` chain for page switching, memory_page is the fallback. `app.add_page(index, route="/")`. Static assets in `dashboard/assets/` auto-served at root URL. |
| 9 | `dashboard/dashboard/components/nav.py` | Nav pattern: `nav_item()` with active/inactive styling. No changes needed but shows the style conventions. |

---

## Step 1: Add `memory_tab` State Variable

**File:** `dashboard/dashboard/state.py`

Find line 2992 (`journal_tab: str = "trades"`). Insert after line 3005 (`self.journal_tab = tab`):

```python
    # Memory page tab
    memory_tab: str = "graph"       # "graph" | "sections"

    def set_memory_tab(self, tab: str):
        self.memory_tab = tab
```

This follows the identical pattern as `journal_tab` / `set_journal_tab` directly above.

---

## Step 2: Add Tab Bar to Memory Page

**File:** `dashboard/dashboard/pages/memory.py`

### 2a. Add tab pill helper

Insert before the `_sidebar()` function (before line 259). Copy the pattern from `journal.py:770-800` exactly, substituting `memory_tab` for `journal_tab`:

```python
def _memory_tab_pill(label: str, tab_value: str) -> rx.Component:
    """Single pill in the memory page tab bar."""
    return rx.box(
        rx.text(
            label,
            font_size="0.8rem",
            font_weight="500",
            color=rx.cond(
                AppState.memory_tab == tab_value,
                "#fafafa",
                "#525252",
            ),
            transition="color 0.15s ease",
        ),
        on_click=AppState.set_memory_tab(tab_value),
        background=rx.cond(
            AppState.memory_tab == tab_value,
            "#262626",
            "transparent",
        ),
        padding_x="14px",
        padding_y="6px",
        border_radius="8px",
        cursor="pointer",
        transition="background 0.15s ease",
        _hover={"background": rx.cond(
            AppState.memory_tab == tab_value,
            "#262626",
            "#1a1a1a",
        )},
    )


def _memory_tab_bar() -> rx.Component:
    """Segmented tab bar — Graph / Sections."""
    return rx.hstack(
        _memory_tab_pill("Graph", "graph"),
        _memory_tab_pill("Sections", "sections"),
        spacing="1",
        background="#111111",
        border="1px solid #1a1a1a",
        border_radius="10px",
        padding="3px",
    )
```

### 2b. Modify `_main_area()`

Replace the existing `_main_area()` function (lines 287-299) with:

```python
def _main_area() -> rx.Component:
    """Right side: tab bar + graph or brain iframe."""
    return rx.vstack(
        # Tab bar row
        rx.hstack(
            rx.spacer(),
            _memory_tab_bar(),
            rx.spacer(),
            width="100%",
            align="center",
            padding_y="8px",
            padding_x="16px",
            border_bottom="1px solid #1a1a1a",
            background="#0a0a0a",
            flex_shrink="0",
        ),
        # Content area — conditional iframe
        rx.box(
            rx.cond(
                AppState.memory_tab == "graph",
                rx.el.iframe(
                    src="/graph.html",
                    width="100%",
                    height="100%",
                    border="none",
                ),
                rx.el.iframe(
                    src="/brain.html",
                    width="100%",
                    height="100%",
                    border="none",
                ),
            ),
            flex="1",
            width="100%",
        ),
        spacing="0",
        flex="1",
        width="100%",
        height="100%",
    )
```

---

## Step 3: Create `brain.html`

**File:** `dashboard/assets/brain.html` (NEW)

This is the main deliverable. It is a self-contained HTML file (like `graph.html`) with no Reflex state interaction. It has two views:

1. **Brain Overview** — SVG sagittal brain with 4 clickable section regions, cross-section pathway lines, per-region stat chips
2. **Section Detail** — Force-directed graph showing that section's nodes (primary) + 1-hop neighbors from other sections (ghost nodes)

### 3a. Architecture Overview

```
Internal state:
  appMode = 'overview' | 'section'
  activeSection = null | 'EPISODIC' | 'SIGNALS' | 'KNOWLEDGE' | 'PROCEDURAL'
  rawData = null              // cached API response
  sectionData = {}            // per-section: { nodes, ghosts, healthStats, crossEdgeCount }
  nodeSection = new Map()     // nodeId → section key
  adjMap = new Map()          // nodeId → Set<neighbor nodeIds>
  nodeById = new Map()        // nodeId → node object
  sectionGraph = null         // ForceGraph instance (only while in section view)

DOM:
  #brain-view     — shown in overview mode (SVG + stat chip overlay)
  #section-view   — shown in section mode (header + force graph + legend + detail panel)
  .loading        — centered loading/error message
```

### 3b. Libraries

Same as `graph.html`:
```html
<script src="https://unpkg.com/d3-force@3/dist/d3-force.min.js"></script>
<script src="https://unpkg.com/force-graph@1.47.4/dist/force-graph.min.js"></script>
```

### 3c. Client-Side Section Mapping

Port the 16-entry mapping from `sections.py:42-65` to JavaScript:

```javascript
const SUBTYPE_TO_SECTION = {
  'custom:trade_entry': 'EPISODIC',
  'custom:trade_close': 'EPISODIC',
  'custom:trade_modify': 'EPISODIC',
  'custom:trade': 'EPISODIC',
  'custom:turn_summary': 'EPISODIC',
  'custom:session_summary': 'EPISODIC',
  'custom:market_event': 'EPISODIC',
  'custom:signal': 'SIGNALS',
  'custom:watchpoint': 'SIGNALS',
  'custom:lesson': 'KNOWLEDGE',
  'custom:thesis': 'KNOWLEDGE',
  'custom:curiosity': 'KNOWLEDGE',
  'custom:playbook': 'PROCEDURAL',
  'custom:missed_opportunity': 'PROCEDURAL',
  'custom:good_pass': 'PROCEDURAL',
};
const DEFAULT_SECTION = 'KNOWLEDGE';
function getSection(subtype) {
  return SUBTYPE_TO_SECTION[subtype] || DEFAULT_SECTION;
}
```

**Verify this mapping matches `sections.py:42-65` exactly.** If there's a mismatch, the Python file is the source of truth.

### 3d. Section Configuration

```javascript
const SECTION_CONFIG = {
  EPISODIC: {
    name: 'Episodic Memory',
    brainRegion: 'Hippocampus',
    description: 'What happened — trades, summaries, events',
    color: '#22c55e',        // green-500
    colorDim: '#15803d',     // green-700
    colorGhost: '#14532d',   // green-900
    glowColor: '#4ade80',    // green-400
  },
  SIGNALS: {
    name: 'Signal Monitor',
    brainRegion: 'Sensory Cortex',
    description: 'What to watch — signals, watchpoints',
    color: '#06b6d4',        // cyan-500
    colorDim: '#0e7490',     // cyan-700
    colorGhost: '#164e63',   // cyan-900
    glowColor: '#67e8f9',    // cyan-300
  },
  KNOWLEDGE: {
    name: 'Knowledge Base',
    brainRegion: 'Neocortex',
    description: 'What I\'ve learned — lessons, theses, curiosity',
    color: '#6366f1',        // indigo-500 (matches dashboard accent)
    colorDim: '#4338ca',     // indigo-700
    colorGhost: '#312e81',   // indigo-900
    glowColor: '#a5b4fc',    // indigo-300
  },
  PROCEDURAL: {
    name: 'Procedural Store',
    brainRegion: 'Cerebellum',
    description: 'How to act — playbooks, outcome analysis',
    color: '#f59e0b',        // amber-500
    colorDim: '#b45309',     // amber-700
    colorGhost: '#78350f',   // amber-900
    glowColor: '#fcd34d',    // amber-300
  },
};
```

### 3e. Per-Subtype Colors and Labels

Copy the COLORS and LABELS maps from `graph.html:449-479` exactly, AND add the 3 missing subtypes:

```javascript
// ADD to COLORS (missing from graph.html):
'custom:playbook':           '#c084fc',   // purple-400
'custom:missed_opportunity': '#fb923c',   // orange-400
'custom:good_pass':          '#34d399',   // emerald-400

// ADD to LABELS:
'custom:playbook':           'Playbook',
'custom:missed_opportunity': 'Missed Opportunity',
'custom:good_pass':          'Good Pass',
```

### 3f. Data Fetching

Same URL fallback chain as `graph.html:440-447, 855-908`. Copy `tryFetch()` and `loadGraph()` logic. Cache the response in `rawData`.

### 3g. Data Classification Pipeline

After fetching:

```javascript
function classifyAndCompute() {
  // 1. Classify every node into a section
  for (const node of rawData.nodes) {
    nodeSection.set(node.id, getSection(node.subtype));
  }

  // 2. Build global lookup tables (same pattern as graph.html buildLookups)
  // adjMap, nodeById, pre-cache _conns, _color, _opacity, _baseRadius, etc.

  // 3. Compute per-section data
  for (const sectionKey of ['EPISODIC', 'SIGNALS', 'KNOWLEDGE', 'PROCEDURAL']) {
    const primaryNodes = rawData.nodes.filter(n => nodeSection.get(n.id) === sectionKey);
    const primaryIds = new Set(primaryNodes.map(n => n.id));
    const ghosts = computeGhosts(sectionKey, primaryIds, rawData.edges);
    const healthStats = computeHealth(primaryNodes);
    const crossEdgeCount = countCrossEdges(primaryIds, ghosts, rawData.edges);
    sectionData[sectionKey] = { nodes: primaryNodes, ghosts, healthStats, crossEdgeCount };
  }

  // 4. Compute cross-section pathway counts for brain overview
  pathways = computePathways(rawData.edges);
}
```

### 3h. Ghost Node Algorithm

```javascript
function computeGhosts(sectionKey, primaryIds, edges) {
  const ghostCounts = new Map(); // foreignNodeId → count of edges to this section

  for (const edge of edges) {
    const srcIn = primaryIds.has(edge.source);
    const tgtIn = primaryIds.has(edge.target);
    if (srcIn && !tgtIn) {
      ghostCounts.set(edge.target, (ghostCounts.get(edge.target) || 0) + 1);
    }
    if (tgtIn && !srcIn) {
      ghostCounts.set(edge.source, (ghostCounts.get(edge.source) || 0) + 1);
    }
  }

  // Sort by connection count, cap at 50
  return [...ghostCounts.entries()]
    .filter(([id]) => !primaryIds.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([id]) => nodeById.get(id))
    .filter(Boolean);
}
```

### 3i. Pathway Computation (for brain overview lines)

```javascript
function computePathways(edges) {
  const counts = {};
  for (const edge of edges) {
    const s1 = nodeSection.get(edge.source);
    const s2 = nodeSection.get(edge.target);
    if (!s1 || !s2 || s1 === s2) continue;
    const key = [s1, s2].sort().join('↔');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts; // e.g. { "EPISODIC↔KNOWLEDGE": 47, ... }
}
```

### 3j. Brain SVG Overview

Use `viewBox="0 0 520 420"` with `preserveAspectRatio="xMidYMid meet"`. Create a sagittal (side-view) brain with:

- **Outer brain silhouette** — single `<path>` with `stroke="#333" fill="none"` for the overall brain outline
- **KNOWLEDGE (Neocortex)** — large outer cortex dome (top 2/3), largest region
- **EPISODIC (Hippocampus)** — curved inner structure, center of brain
- **SIGNALS (Sensory Cortex)** — posterior upper wedge (back-top)
- **PROCEDURAL (Cerebellum)** — distinct bump at bottom-back
- **Brainstem** — thin decorative connector, non-interactive

Each region is a `<path>` with:
- `data-section="EPISODIC"` (etc.) for click handling
- `class="brain-region"`
- `fill` = section's `colorDim` at `fill-opacity: 0.35`
- `stroke` = section's `color` at `stroke-opacity: 0.7`
- Hover: `fill-opacity: 0.6` + `filter: brightness(1.4)`
- Click: calls `enterSection(sectionKey)`

**Pathway lines** between region centroids:
- SVG `<line>` elements in a `<g id="pathways">` group
- Stroke: section color gradient, `stroke-width` scaled by `Math.log2(count + 1)`
- `stroke-opacity: 0.25`, `stroke-dasharray: 4 3`
- Count label at midpoint if count > 5

**Stat chip overlays** — absolutely positioned `<div>` elements over the SVG container:
- Section name (colored)
- Brain region name (muted)
- Node count + lifecycle breakdown: "N nodes — X active / Y weak / Z dormant"
- Chips positioned via percentage-based CSS (`left`, `top`)

### 3k. Section Detail View — Force Graph

When user clicks a brain region:

1. **Transition**: Brain SVG scales toward clicked region's centroid + fades out (200ms CSS transition), then section view fades in (180ms)
2. **Section header bar**: Back button + section color dot + name + brain region + stats
3. **Force graph**: `ForceGraph()` instance mounted on `#graph-container`

**Node rendering** (canvas callback — same pattern as `graph.html:689-723`):

- **Primary nodes**: Full opacity (retrievability-based, same formula as graph.html), full radius, full color, glow on hover/select
- **Ghost nodes**: Fixed `alpha 0.18`, radius `* 0.65`, colored with their own section's `colorGhost`. Draw a dashed ring (`ctx.setLineDash([3, 3])`) in the ghost's section color at `alpha 0.3` around the node to visually indicate "foreign section"

**Edge rendering** (batched — same first-link pattern as `graph.html:734-809`):

Three batches:
1. Primary↔Primary: `alpha 0.35`, `lineWidth 0.4 * lineThick`
2. Primary↔Ghost (cross): `alpha 0.18`, `lineWidth 0.3 * lineThick`
3. Ghost↔Ghost: `alpha 0.06`, `lineWidth 0.2 * lineThick`

Tag each edge with `_category: 'primary' | 'cross' | 'ghost'` before passing to `graphData()`:

```javascript
function buildSectionGraphData(sectionKey) {
  const primary = sectionData[sectionKey].nodes;
  const ghosts = sectionData[sectionKey].ghosts;
  const primarySet = new Set(primary.map(n => n.id));
  const ghostSet = new Set(ghosts.map(n => n.id));
  const allIds = new Set([...primarySet, ...ghostSet]);

  const nodes = [
    ...primary.map(n => ({ ...n, _role: 'primary' })),
    ...ghosts.map(n => ({ ...n, _role: 'ghost', _ghostSection: nodeSection.get(n.id) })),
  ];

  const links = rawData.edges
    .filter(e => allIds.has(e.source) && allIds.has(e.target))
    .map(e => ({
      ...e,
      _category: primarySet.has(e.source) && primarySet.has(e.target) ? 'primary'
        : primarySet.has(e.source) || primarySet.has(e.target) ? 'cross'
        : 'ghost',
    }));

  return { nodes, links };
}
```

**Force parameters** (tuned for smaller section-scoped graphs):
```javascript
const SECTION_DEFAULTS = {
  nodeSize: 1.2, lineThick: 1.0,
  centerForce: 0.08, repelForce: 45, linkStrength: 0.4, linkDistance: 70,
};
```

Store settings to `localStorage` key `hynous-brain-settings` (separate from graph.html's `hynous-graph-settings`).

**Section legend**: Two parts:
1. Primary subtypes present in this section (dot + label, same format as graph.html legend)
2. Ghost sections with count: "Episodic ghosts (12)" with dashed ring indicator

**Search**: Same `searchTerm` + `isHighlighted()` pattern from graph.html. Placeholder: "Search {SectionName}...". Ghost nodes that match search render at `alpha 0.6` (not full — still visually secondary).

**Detail panel**: Same pattern as graph.html (bottom-right, 300px, click node → show metadata). Add a "Section" row showing the node's memory section.

### 3l. Transition Mechanism

**Overview → Section:**
```javascript
function enterSection(sectionKey) {
  appMode = 'section';
  activeSection = sectionKey;
  // Phase 1: scale brain SVG toward clicked region, fade out
  const svg = document.getElementById('brain-svg');
  svg.style.transformOrigin = /* centroid of clicked region as % */;
  svg.style.transition = 'transform 0.22s ease-in, opacity 0.22s ease-in';
  svg.style.transform = 'scale(1.8)';
  svg.style.opacity = '0';

  setTimeout(() => {
    document.getElementById('brain-view').classList.add('hidden');
    document.getElementById('section-view').classList.remove('hidden');
    document.getElementById('section-view').style.opacity = '0';
    requestAnimationFrame(() => {
      mountSectionGraph(sectionKey);
      document.getElementById('section-view').style.opacity = '1';
    });
    // Reset SVG for next visit
    svg.style.transition = 'none';
    svg.style.transform = 'scale(1)';
    svg.style.opacity = '1';
  }, 230);
}
```

**Section → Overview (back button):**
```javascript
function exitSection() {
  const sectionView = document.getElementById('section-view');
  sectionView.style.transition = 'opacity 0.18s ease-in';
  sectionView.style.opacity = '0';
  setTimeout(() => {
    if (sectionGraph) { sectionGraph._destructor?.(); sectionGraph = null; }
    sectionView.classList.add('hidden');
    const brainView = document.getElementById('brain-view');
    brainView.classList.remove('hidden');
    brainView.style.opacity = '0';
    brainView.style.transition = 'opacity 0.18s ease-out';
    requestAnimationFrame(() => { brainView.style.opacity = '1'; });
    activeSection = null;
    appMode = 'overview';
  }, 200);
}
```

### 3m. CSS Requirements

Copy these CSS blocks from `graph.html` verbatim for visual consistency:
- `body` base styles (`#0a0a0a`, Inter font, `overflow: hidden`)
- `.btn` button styles
- `.controls` top-left overlay
- `.settings-panel` and all setting row styles
- `input[type="range"]` custom slider styles
- `.detail-panel` and detail content styles
- `.legend` and legend item styles
- `.stats` top-right stats chip
- `.loading` / `.error` center indicators

New CSS for brain.html only:
- `#brain-view` — flex center, `position: relative`
- `#brain-svg` — `max-height: 85vh, max-width: 90vw`
- `.brain-region` — `fill-opacity: 0.35`, hover to `0.6`, `cursor: pointer`, `transition: 0.2s`
- `#section-view` — flex column, `display: none` initially
- `.section-header` — flex row, `border-bottom: 1px solid #1a1a1a`, `padding: 10px 16px`
- `#graph-container` — `flex: 1`, `position: relative`
- `.region-chip` — absolutely positioned, semi-transparent backdrop
- `.hidden` — `display: none !important`

### 3n. Edge Cases to Handle

1. **Empty sections** (e.g., PROCEDURAL with 0 playbooks): Show region at `fill-opacity: 0.15`, "0 nodes" chip. Click still works — empty section view with "No memories in this section" message.
2. **Ghost cap**: Max 50 ghosts per section, sorted by cross-connection count descending. Most-connected ghosts always included regardless of which foreign section they belong to.
3. **Unknown subtypes**: Default to KNOWLEDGE section (matches Python/TypeScript source of truth).
4. **Force-graph link mutation**: force-graph mutates `link.source`/`link.target` from IDs to objects. Set `_category` before passing to `graphData()`. In link rendering, use `link.source.id ?? link.source` defensively.
5. **Window resize**: Brain SVG handles it via `preserveAspectRatio`. Force graph needs explicit resize: `sectionGraph.width(el.clientWidth).height(el.clientHeight)`.
6. **Tab switch resets**: Reflex `rx.cond` unmounts iframe on tab switch, so brain view resets to overview each time. This is acceptable.

---

## Testing

### Static Verification

1. **Mapping sync check**: Compare `SUBTYPE_TO_SECTION` in brain.html against `src/hynous/nous/sections.py:42-65` — all 16 entries must match exactly.
2. **Color coverage**: Verify COLORS map has entries for all 16 subtypes (original 13 from graph.html + 3 new PROCEDURAL ones).
3. **CSS consistency**: Verify `.btn`, `.settings-panel`, `.detail-panel`, `.legend` classes in brain.html match graph.html pixel-for-pixel.
4. **Tab state**: Verify `AppState.memory_tab` is referenced correctly in memory.py tab pills and `rx.cond`.

### Dynamic Testing (Live)

**Prerequisites:** Run the Reflex dashboard (`reflex run` in `dashboard/`) and ensure the Nous server is running on port 3100 with existing memory data.

1. **Tab switching**: Navigate to Memory page → verify "Graph" tab is active by default → verify graph.html loads in iframe → click "Sections" tab → verify brain.html loads → click "Graph" → verify graph.html reloads. No console errors.

2. **Brain overview renders**: In Sections tab → verify brain SVG is visible with 4 colored regions → verify stat chips show correct node counts → verify pathway lines appear between connected sections.

3. **Section drill-down**: Click each of the 4 brain regions in turn:
   - Verify zoom transition animation plays
   - Verify section header shows correct name/brain region
   - Verify force graph loads with primary nodes in section color
   - Verify ghost nodes appear dimmed with dashed ring border
   - Verify legend shows primary subtypes + ghost section indicators
   - Verify stats show correct primary/ghost/cross-edge counts
   - Click back → verify smooth return to brain overview

4. **Node interaction in section view**: Click a primary node → detail panel shows → verify "Section" row in detail panel. Click a ghost node → detail panel shows its foreign section. Click background → panel hides.

5. **Search in section view**: Type a query → verify primary matches brighten, non-matches dim, ghost matches go to medium opacity.

6. **Settings in section view**: Open settings panel → adjust sliders → verify force graph responds → close and reopen brain.html → verify settings persist.

7. **Empty section**: If any section has 0 nodes, verify it renders correctly in both brain overview (low opacity region) and drill-down (empty state message).

8. **Edge case — sidebar interaction**: While in Sections tab, verify the left sidebar (health, clusters, actions) still functions — run decay, view conflicts, etc. The sidebar is independent of the iframe content.

---

## Verification Checklist

| # | Check | How |
|---|-------|-----|
| 1 | Tab bar renders in memory page | Navigate to Memory, see "Graph" / "Sections" pills |
| 2 | Graph tab still works | Click "Graph", verify graph.html iframe loads |
| 3 | Brain overview renders | Click "Sections", see brain SVG with 4 regions |
| 4 | Node counts accurate | Compare brain overview chip counts with graph.html stats (total nodes = sum of all sections) |
| 5 | All 4 sections clickable | Click each region, verify transition + force graph |
| 6 | Ghost nodes visible | In section view, see dimmed nodes from other sections |
| 7 | Ghost dashed ring | Ghost nodes have dashed circle border |
| 8 | Cross-section edges faded | Edges between primary and ghost nodes render at lower opacity |
| 9 | Detail panel works | Click any node, see metadata panel |
| 10 | Back navigation works | Click back button, return to brain overview |
| 11 | Search works | Type in search, see matching nodes highlighted |
| 12 | Settings persist | Adjust sliders, refresh page, verify settings restored |
| 13 | Pathway lines visible | Brain overview shows dashed lines between connected sections |
| 14 | No console errors | Open browser devtools, verify no JS errors throughout |
| 15 | SUBTYPE_TO_SECTION matches Python | Compare brain.html mapping with sections.py |
