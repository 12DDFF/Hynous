"""
Application State

Central state management for the Hynous dashboard.
All reactive state lives here.
"""

import json
import re
import asyncio
import time
import threading
import reflex as rx
import logging
from collections import deque
from pathlib import Path
from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional

logger = logging.getLogger(__name__)

# Poll interval for live portfolio updates (seconds)
_POLL_INTERVAL = 15

# Background task decorator — rx.background not exposed in Reflex 0.8.x
# but the machinery exists. Setting the marker attribute is all that's needed.
from reflex.state import BACKGROUND_TASK_MARKER

def _background(fn):
    """Mark an async method as a Reflex background task."""
    setattr(fn, BACKGROUND_TASK_MARKER, True)
    return fn

# --- Financial value highlighting ---
# Matches: +1.5%, +$500, +0.0034%, +$1.2M, etc.
_POS_RE = re.compile(r'(\+\$?[\d,]+\.?\d*[KMBkmb]?%?)')
# Matches: -1.5%, -$500, etc. Requires preceding space/paren/pipe to avoid markdown list markers
_NEG_RE = re.compile(r'(?<=[ (|:])(-\$?[\d,]+\.?\d*[KMBkmb]?%?)')

_GREEN = '<span style="color:#4ade80;text-shadow:0 0 6px rgba(74,222,128,0.2)">'
_RED = '<span style="color:#f87171;text-shadow:0 0 6px rgba(248,113,113,0.2)">'
_END = '</span>'


def _highlight(text: str) -> str:
    """Add subtle color glow to financial values in text.

    Positive values (+X%, +$X) get green glow.
    Negative values (-X%, -$X) get red glow.
    Uses raw HTML spans — requires use_raw=True in rx.markdown (default).
    """
    text = _POS_RE.sub(f'{_GREEN}\\1{_END}', text)
    text = _NEG_RE.sub(f'{_RED}\\1{_END}', text)
    return text

# Portfolio value history for sparkline (capped automatically)
_portfolio_history: deque[float] = deque(maxlen=20)


def _build_sparkline_svg(values: list[float], width: int = 80, height: int = 24, color: str = "#22c55e") -> str:
    """Build a tiny SVG sparkline from a list of values."""
    if len(values) < 2:
        return ""
    mn, mx = min(values), max(values)
    rng = mx - mn if mx != mn else 1
    points = []
    for i, v in enumerate(values):
        x = round(i / (len(values) - 1) * width, 1)
        y = round(height - ((v - mn) / rng) * height, 1)
        points.append(f"{x},{y}")
    pts = " ".join(points)
    return (
        f'<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
        f'xmlns="http://www.w3.org/2000/svg" style="display:block">'
        f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="1.5" '
        f'stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/></svg>'
    )


# Human-readable names for tool indicators
_TOOL_DISPLAY = {
    "get_market_data": "Fetching market data",
    "get_orderbook": "Reading orderbook",
    "get_funding_history": "Analyzing funding rates",
    "get_multi_timeframe": "Multi-timeframe analysis",
    "get_liquidations": "Checking liquidations",
    "get_global_sentiment": "Reading global sentiment",
    "get_options_flow": "Analyzing options flow",
    "get_institutional_flow": "Tracking institutional flow",
    "search_web": "Searching the web",
    "get_my_costs": "Checking costs",
    "store_memory": "Storing memory",
    "recall_memory": "Searching memories",
    "get_account": "Checking account",
    "execute_trade": "Executing trade",
    "close_position": "Closing position",
    "modify_position": "Modifying position",
    "delete_memory": "Deleting memory",
    "manage_watchpoints": "Managing watchpoints",
    "get_trade_stats": "Checking trade stats",
    "explore_memory": "Exploring memory graph",
    "manage_conflicts": "Managing conflicts",
    "manage_clusters": "Managing clusters",
    "data_layer": "Querying data layer",
}
# --- Model preference persistence ---
_MODEL_PREFS_FILE = Path(__file__).resolve().parents[2] / "storage" / "model_prefs.json"

def _save_model_prefs(main: str, sub: str) -> None:
    """Persist model selection to disk so it survives restarts."""
    try:
        _MODEL_PREFS_FILE.parent.mkdir(parents=True, exist_ok=True)
        _MODEL_PREFS_FILE.write_text(json.dumps({"model": main, "sub_model": sub}))
    except Exception:
        pass

def _load_model_prefs() -> tuple[str, str] | None:
    """Load saved model preferences, or None if not saved."""
    try:
        if _MODEL_PREFS_FILE.exists():
            d = json.loads(_MODEL_PREFS_FILE.read_text())
            return d.get("model", ""), d.get("sub_model", "")
    except Exception:
        pass
    return None


# --- Model selection options (label, litellm model ID) ---
_MODEL_OPTIONS: list[tuple[str, str]] = [
    # Anthropic
    ("Claude Opus 4.6", "openrouter/anthropic/claude-opus-4.6"),
    ("Claude Opus 4.5", "openrouter/anthropic/claude-opus-4.5"),
    ("Claude Sonnet 4.5", "openrouter/anthropic/claude-sonnet-4-5-20250929"),
    ("Claude Haiku 4.5", "openrouter/anthropic/claude-haiku-4-5-20251001"),
    # OpenAI — GPT-5.2
    ("GPT-5.2 Pro", "openrouter/openai/gpt-5.2-pro"),
    ("GPT-5.2", "openrouter/openai/gpt-5.2"),
    ("GPT-5.2 Codex", "openrouter/openai/gpt-5.2-codex"),
    ("GPT-5.2 Chat", "openrouter/openai/gpt-5.2-chat"),
    # OpenAI — GPT-5.1
    ("GPT-5.1", "openrouter/openai/gpt-5.1"),
    ("GPT-5.1 Codex Max", "openrouter/openai/gpt-5.1-codex-max"),
    ("GPT-5.1 Codex", "openrouter/openai/gpt-5.1-codex"),
    ("GPT-5.1 Codex Mini", "openrouter/openai/gpt-5.1-codex-mini"),
    ("GPT-5.1 Chat", "openrouter/openai/gpt-5.1-chat"),
    # OpenAI — GPT-5
    ("GPT-5", "openrouter/openai/gpt-5-2025-08-07"),
    ("GPT-5 Mini", "openrouter/openai/gpt-5-mini-2025-08-07"),
    ("GPT-5 Nano", "openrouter/openai/gpt-5-nano-2025-08-07"),
    # OpenAI — GPT-4.1
    ("GPT-4.1", "openrouter/openai/gpt-4.1-2025-04-14"),
    ("GPT-4.1 Mini", "openrouter/openai/gpt-4.1-mini-2025-04-14"),
    ("GPT-4.1 Nano", "openrouter/openai/gpt-4.1-nano-2025-04-14"),
    # xAI — Grok
    ("Grok 4.1 Fast", "openrouter/x-ai/grok-4.1-fast"),
    ("Grok 4 Fast", "openrouter/x-ai/grok-4-fast"),
    ("Grok 4", "openrouter/x-ai/grok-4-07-09"),
    ("Grok 3", "openrouter/x-ai/grok-3"),
    ("Grok 3 Mini", "openrouter/x-ai/grok-3-mini"),
    ("Grok Code Fast", "openrouter/x-ai/grok-code-fast-1"),
    # DeepSeek
    ("DeepSeek V3.2", "openrouter/deepseek/deepseek-v3.2"),
    ("DeepSeek V3.2 Speciale", "openrouter/deepseek/deepseek-v3.2-speciale"),
    # Google
    ("Gemini 3 Pro", "openrouter/google/gemini-3-pro-preview"),
    ("Gemini 3 Flash", "openrouter/google/gemini-3-flash-preview"),
    # Mistral
    ("Mistral Large 3", "openrouter/mistralai/mistral-large-2512"),
    ("Devstral 2", "openrouter/mistralai/devstral-2512"),
    # Qwen
    ("Qwen3 Max", "openrouter/qwen/qwen3-max-thinking"),
    ("Qwen3 Coder", "openrouter/qwen/qwen3-coder-next"),
]
_LABEL_TO_MODEL = {label: model_id for label, model_id in _MODEL_OPTIONS}
_MODEL_TO_LABEL = {model_id: label for label, model_id in _MODEL_OPTIONS}
MODEL_LABELS = [label for label, _ in _MODEL_OPTIONS]

_TOOL_TAG = {
    "get_market_data": "market data",
    "get_orderbook": "orderbook",
    "get_funding_history": "funding",
    "get_multi_timeframe": "multi-TF",
    "get_liquidations": "liquidations",
    "get_global_sentiment": "sentiment",
    "get_options_flow": "options",
    "get_institutional_flow": "institutional",
    "search_web": "web search",
    "get_my_costs": "costs",
    "store_memory": "memory",
    "recall_memory": "memory",
    "update_memory": "memory",
    "batch_prune": "memory",
    "analyze_memory": "memory",
    "get_account": "account",
    "execute_trade": "trade",
    "close_position": "close",
    "modify_position": "modify",
    "delete_memory": "delete",
    "manage_watchpoints": "watchpoints",
    "get_trade_stats": "stats",
    "explore_memory": "explore",
    "manage_conflicts": "conflicts",
    "manage_clusters": "clusters",
    "get_book_history": "book history",
    "monitor_signal": "monitor",
    "data_layer": "data layer",
}


class Message(BaseModel):
    """Chat message model."""
    sender: str  # "user" or "hynous"
    content: str
    timestamp: str
    tools_used: list[str] = []
    show_avatar: bool = True  # False when grouped with previous same-sender message


class WakeItem(BaseModel):
    """Unified wake item for the activity sidebar."""
    category: str = ""  # scanner, fill, review, watchpoint, wake, learning, error
    content: str = ""  # first line (truncated for sidebar display)
    full_content: str = ""  # complete response text
    timestamp: str = ""
    tool_trace_text: str = ""   # formatted tool call trace (scanner/monitor wakes)
    signal_header: str = ""     # e.g. "book_flip · ETH · 0.74"
    decision: str = ""          # "trade"|"pass"|"monitor"|"manage"|""


class Activity(BaseModel):
    """Activity log entry."""
    type: str  # "chat", "trade", "alert", "system"
    title: str
    level: str  # "info", "success", "warning", "error"
    timestamp: str


class DaemonActivity(BaseModel):
    """Daemon activity log entry (from daemon_log.py)."""
    type: str       # "wake", "watchpoint", "fill", "learning", "review", "error", "skip"
    title: str
    detail: str
    timestamp: str


class Position(BaseModel):
    """Trading position."""
    symbol: str
    side: str  # "long" or "short"
    size: float  # USD notional
    entry: float  # entry price
    mark: float = 0.0  # current mark price
    pnl: float = 0.0  # return % on equity
    pnl_usd: float = 0.0  # unrealized PnL in USD
    leverage: int = 1
    realized_pnl: float = 0.0  # Locked-in PnL from partial exits


class ClosedTrade(BaseModel):
    """Closed trade for journal display."""
    symbol: str
    side: str
    entry_px: float
    exit_px: float
    pnl_pct: float
    pnl_usd: float
    closed_at: str
    close_type: str = "full"
    duration_hours: float = 0.0
    duration_str: str = ""  # Pre-formatted: "4.2h" or "1.3d"
    date: str = ""  # Pre-formatted date string (YYYY-MM-DD)
    trade_id: str = ""  # close node ID (for expand tracking)
    thesis: str = ""  # from linked trade_entry
    stop_loss: float = 0.0
    take_profit: float = 0.0
    confidence: float = 0.0  # 0-1
    rr_ratio: float = 0.0
    trade_type: str = ""  # "micro" or "macro"
    mfe_pct: float = 0.0         # max favorable excursion ROE % (peak, gross)
    mfe_usd: float = 0.0         # peak dollar value (mfe_pct / 100 * margin)
    mae_pct: float = 0.0         # max adverse excursion ROE % (trough, negative = drawdown)
    mae_usd: float = 0.0         # trough dollar value
    lev_return_pct: float = 0.0  # net leveraged ROE % (same basis as mfe_pct)
    leverage: int = 0            # position leverage; 0 = unknown (pre-signal)
    fee_loss: bool = False  # directionally correct but fees ate profit
    fee_heavy:    bool  = False   # fees took >50% of gross profit
    fee_estimate: float = 0.0    # estimated round-trip fees in USD
    pnl_gross:    float = 0.0    # raw PnL before fees
    detail_html: str = ""  # pre-rendered HTML for expanded view


class PhantomRecord(BaseModel):
    """Resolved phantom for regret tab display."""
    symbol: str
    side: str           # "long" / "short"
    result: str         # "missed_opportunity" / "good_pass"
    pnl_pct: float      # leveraged ROE %
    anomaly_type: str   # e.g. "price_spike", "book_flip"
    category: str       # "micro" / "macro"
    date: str           # pre-formatted date string
    headline: str       # anomaly headline from title
    phantom_id: str = ""  # node ID (for expand tracking)
    entry_px: float = 0.0
    exit_px: float = 0.0
    detail_html: str = ""  # pre-rendered HTML for expanded view


class PlaybookRecord(BaseModel):
    """Playbook entry for regret tab display."""
    title: str
    content: str
    date: str           # pre-formatted date string


def _build_trade_detail_html(d: dict) -> str:
    """Build pre-rendered HTML for an expanded trade detail panel."""
    parts = []
    thesis = d.get("thesis", "")
    if thesis:
        esc = thesis.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        parts.append(
            f'<div style="color:#a3a3a3;font-size:0.82rem;line-height:1.5;'
            f'margin-bottom:8px;padding:8px 10px;background:#111;border-radius:4px;'
            f'border-left:2px solid #525252">{esc}</div>'
        )

    metrics = []
    tt = d.get("trade_type", "")
    if tt:
        color = "#a855f7" if tt == "micro" else "#3b82f6"
        metrics.append(("Type", f'<span style="color:{color};font-weight:500">{tt.upper()}</span>'))
    conf = d.get("confidence", 0)
    if conf > 0:
        metrics.append(("Conviction", f"{conf*100:.0f}%"))
    sl = d.get("stop_loss", 0)
    if sl > 0:
        metrics.append(("Stop Loss", f"${sl:,.2f}" if sl >= 1 else f"${sl:.4f}"))
    tp = d.get("take_profit", 0)
    if tp > 0:
        metrics.append(("Take Profit", f"${tp:,.2f}" if tp >= 1 else f"${tp:.4f}"))
    rr = d.get("rr_ratio", 0)
    if rr > 0:
        metrics.append(("R:R", f"{rr:.1f}:1"))
    mfe = d.get("mfe_pct", 0)
    if mfe > 0:
        metrics.append(("Peak Profit", f"+{mfe:.1f}% ROE"))
    if d.get("fee_estimate", 0) > 0:
        gross = d.get("pnl_gross", 0)
        fee   = d.get("fee_estimate", 0)
        metrics.append(("Gross PnL", f"${gross:+.2f}"))
        metrics.append(("Est. Fees", f'-${fee:.2f}'))

    if metrics:
        cells = "".join(
            f'<div style="padding:4px 0"><span style="color:#525252;font-size:0.7rem;'
            f'text-transform:uppercase;letter-spacing:0.05em;display:block">{label}</span>'
            f'<span style="color:#e5e5e5;font-size:0.82rem">{val}</span></div>'
            for label, val in metrics
        )
        parts.append(
            f'<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px 16px">{cells}</div>'
        )

    if not parts:
        return '<div style="color:#525252;font-size:0.82rem">No details available</div>'
    return "".join(parts)


def _build_phantom_detail_html(sig: dict, headline: str = "") -> str:
    """Build pre-rendered HTML for an expanded phantom detail panel."""
    parts = []
    ep = sig.get("entry_price", 0) or sig.get("entry_px", 0)
    xp = sig.get("exit_price", 0) or sig.get("exit_px", 0)
    if ep > 0:
        parts.append(f'<span style="color:#525252">Entry:</span> ${ep:,.2f}')
    if xp > 0:
        parts.append(f'<span style="color:#525252">Exit:</span> ${xp:,.2f}')
    cat = sig.get("category", "")
    if cat:
        color = "#a855f7" if cat == "micro" else "#3b82f6"
        parts.append(f'<span style="color:{color};font-weight:500">{cat.upper()}</span>')
    at = sig.get("anomaly_type", "")
    if at and headline:
        esc = headline.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        parts.append(f'<span style="color:#525252">Signal:</span> {esc}')
    desc = sig.get("description", "")
    if desc:
        esc = desc.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        parts.append(f'<div style="color:#a3a3a3;font-size:0.8rem;margin-top:4px">{esc}</div>')

    if not parts:
        return '<div style="color:#525252;font-size:0.82rem">No details available</div>'
    return '<div style="font-size:0.82rem;color:#e5e5e5;line-height:1.7">' + "<br>".join(parts) + "</div>"


def _enrich_trade(close_node: dict, nous_client) -> dict:
    """Follow edges from a trade_close node to its entry node, extract enrichment data."""
    result = {
        "trade_id": close_node.get("id", ""),
        "thesis": "",
        "stop_loss": 0.0,
        "take_profit": 0.0,
        "confidence": 0.0,
        "rr_ratio": 0.0,
        "trade_type": "",
        "mfe_pct": 0.0,
        "mfe_usd": 0.0,
        "mae_pct": 0.0,
        "mae_usd": 0.0,
        "lev_return_pct": 0.0,
        "fee_loss": False,
        "fee_heavy": False,
        "fee_estimate": 0.0,
        "pnl_gross": 0.0,
    }

    # Get MFE + lev_return_pct + trade_type + fee fields from close node's signals
    try:
        close_body = json.loads(close_node.get("content_body", "{}"))
        close_signals = close_body.get("signals", {})
        mfe_pct_raw              = float(close_signals.get("mfe_pct", 0))
        result["mfe_pct"]  = mfe_pct_raw
        result["mfe_usd"]  = float(close_signals.get("mfe_usd", 0.0))
        lev_stored         = int(close_signals.get("leverage", 0))
        sz_usd             = float(close_signals.get("size_usd", 0.0))
        pnl_usd_sig        = float(close_signals.get("pnl_usd", 0.0))
        lev_return_pct     = float(close_signals.get("lev_return_pct", 0.0))
        # Derive lev_return_pct when missing
        if lev_return_pct == 0.0:
            margin_used = float(close_signals.get("margin_used", 0.0))
            if margin_used > 0 and pnl_usd_sig != 0.0:
                lev_return_pct = round(pnl_usd_sig / margin_used * 100, 2)
        if lev_return_pct == 0.0 and lev_stored > 0 and sz_usd > 0 and pnl_usd_sig != 0.0:
            lev_return_pct = round(pnl_usd_sig / (sz_usd / lev_stored) * 100, 2)
        result["lev_return_pct"] = lev_return_pct
        # Derive leverage when not stored
        if lev_stored == 0 and lev_return_pct != 0.0 and sz_usd > 0 and pnl_usd_sig != 0.0:
            lev_stored = max(1, round(abs(lev_return_pct * sz_usd / (pnl_usd_sig * 100))))
        result["leverage"] = lev_stored
        # Derive mfe_usd — try each available data path in order
        if result["mfe_usd"] == 0.0 and mfe_pct_raw > 0:
            # Path 1: from lev_return_pct + pnl (pre-existing)
            if lev_return_pct != 0.0 and pnl_usd_sig != 0.0:
                result["mfe_usd"] = round(mfe_pct_raw * pnl_usd_sig / lev_return_pct, 2)
            # Path 2: from margin_used directly (new nodes from trigger close fix)
            if result["mfe_usd"] == 0.0:
                margin_sig = float(close_signals.get("margin_used", 0.0))
                if margin_sig > 0:
                    result["mfe_usd"] = round(mfe_pct_raw / 100 * margin_sig, 2)
            # Path 3: derive margin from size_usd / leverage
            if result["mfe_usd"] == 0.0 and sz_usd > 0 and lev_stored > 0:
                result["mfe_usd"] = round(mfe_pct_raw / 100 * sz_usd / lev_stored, 2)
        result["mae_pct"]        = float(close_signals.get("mae_pct", 0.0))
        result["mae_usd"]        = float(close_signals.get("mae_usd", 0.0))
        result["fee_loss"]       = bool(close_signals.get("fee_loss", False))
        result["fee_heavy"]      = bool(close_signals.get("fee_heavy", False))
        result["fee_estimate"]   = float(close_signals.get("fee_estimate", 0.0))
        result["pnl_gross"]      = float(close_signals.get("pnl_gross", 0.0))
        if close_signals.get("trade_type"):
            result["trade_type"] = close_signals["trade_type"]
    except Exception:
        pass

    # Follow part_of edge (in) to find the linked trade_entry node
    node_id = close_node.get("id")
    if not node_id or not nous_client:
        return result

    try:
        edges = nous_client.get_edges(node_id, direction="in")
        entry_node = None
        for edge in edges:
            if edge.get("type") == "part_of":
                source_id = edge.get("source_id")
                if source_id:
                    entry_node = nous_client.get_node(source_id)
                    if entry_node:
                        break

        # Fallback: list by subtype if no edge found (search fails without embeddings)
        if not entry_node:
            try:
                close_body_fb = json.loads(close_node.get("content_body", "{}"))
                symbol = close_body_fb.get("signals", {}).get("symbol", "")
                closed_at = close_node.get("created_at", "")
                if symbol:
                    candidates = nous_client.list_nodes(
                        subtype="custom:trade_entry",
                        created_before=closed_at if closed_at else None,
                        limit=10,
                    )
                    # list_nodes returns newest first — first symbol match is best
                    for candidate in candidates:
                        title = candidate.get("content_title", "")
                        if symbol.upper() in title.upper():
                            entry_node = candidate
                            break
            except Exception:
                pass

        if not entry_node:
            return result

        # Parse entry node
        entry_body_raw = entry_node.get("content_body", "")
        try:
            entry_body = json.loads(entry_body_raw)
        except (json.JSONDecodeError, TypeError):
            return result

        # Thesis text
        result["thesis"] = entry_body.get("text", "")
        # Extract thesis from text field — it starts with "Thesis: "
        if result["thesis"].startswith("Thesis: "):
            # Get just the thesis part (before "Entry:")
            lines = result["thesis"].split("\n")
            thesis_parts = []
            for line in lines:
                if line.startswith("Entry:") or line.startswith("Stop Loss:") or line.startswith("Confidence:"):
                    break
                thesis_parts.append(line.replace("Thesis: ", "", 1) if line.startswith("Thesis: ") else line)
            result["thesis"] = "\n".join(thesis_parts).strip()

        # Signals
        entry_signals = entry_body.get("signals", {})
        result["stop_loss"] = float(entry_signals.get("stop", 0))
        result["take_profit"] = float(entry_signals.get("target", 0))
        result["confidence"] = float(entry_signals.get("confidence", 0))
        result["rr_ratio"] = float(entry_signals.get("rr_ratio", 0))
        # Only set from entry if close signals didn't already have it
        if not result["trade_type"]:
            result["trade_type"] = entry_signals.get("trade_type", "macro")

    except Exception:
        pass

    return result


class DaemonActivityFormatted(BaseModel):
    """Daemon activity with pre-formatted relative time."""
    type: str = ""
    title: str = ""
    detail: str = ""
    time_display: str = ""  # "3m ago"


class WatchpointGroup(BaseModel):
    """Watchpoint group for a single symbol (used in accordion)."""
    symbol: str = ""
    count: str = "0"
    detail_html: str = ""


class ClusterDisplay(BaseModel):
    """Cluster card data with pre-rendered health bar HTML."""
    name: str = ""
    node_count: str = "0"
    health_html: str = ""
    accent: str = "#525252"


class ConflictItem(BaseModel):
    """Structured conflict for per-item resolution UI."""
    conflict_id: str = ""
    conflict_type: str = ""
    confidence: str = ""
    old_title: str = ""
    old_body: str = ""
    new_title: str = ""
    new_body: str = ""


# --- Agent + Daemon singletons (shared across all sessions) ---

_agent = None
_agent_error: Optional[str] = None
_daemon = None
_agent_lock = threading.Lock()


def _get_agent():
    """Lazily initialize the Hynous agent and daemon.

    Thread-safe: uses double-checked locking so only one Agent is created
    even when called concurrently from stream_response and init_and_start_daemon.
    """
    global _agent, _agent_error, _daemon

    if _agent is not None:
        return _agent

    with _agent_lock:
        # Double-check after acquiring lock
        if _agent is not None:
            return _agent

        try:
            from hynous.nous.server import ensure_running
            if not ensure_running():
                logger.warning("Nous server not available — memory tools will fail")

            from hynous.intelligence import Agent
            _agent = Agent()
            _agent_error = None
            logger.info("Hynous agent initialized successfully")

            # Apply saved model preferences (survives restarts)
            prefs = _load_model_prefs()
            if prefs:
                main, sub = prefs
                if main:
                    _agent.config.agent.model = main
                if sub:
                    _agent.config.memory.compression_model = sub
                logger.info("Applied saved model prefs: %s / %s", main, sub)

            # Apply saved trading settings (propagates to config + prompt)
            try:
                from hynous.core.trading_settings import get_trading_settings
                _apply_trading_settings(get_trading_settings())
            except Exception:
                pass

            if _agent.config.daemon.enabled and _daemon is None:
                from hynous.intelligence.daemon import Daemon
                _daemon = Daemon(_agent, _agent.config)
                _daemon.start()
                logger.info("Daemon auto-started")

            if _agent.config.discord.enabled:
                try:
                    from hynous.discord.bot import start_bot
                    start_bot(_agent, _agent.config)
                except Exception as e:
                    logger.warning("Discord bot failed to start: %s", e)

            return _agent
        except Exception as e:
            _agent_error = str(e)
            logger.error(f"Failed to initialize agent: {e}")
            return None


def _apply_trading_settings(ts) -> None:
    """Propagate TradingSettings to agent, daemon config, and prompt."""
    if _agent is None:
        return
    try:
        # Rebuild system prompt (picks up new values via _build_ground_rules)
        _agent.rebuild_system_prompt()
        # Propagate to config objects used by daemon
        _agent.config.daemon.max_daily_loss_usd = ts.max_daily_loss_usd
        _agent.config.daemon.max_open_positions = ts.max_open_positions
        _agent.config.scanner.wake_threshold = ts.scanner_wake_threshold
        _agent.config.scanner.book_poll_enabled = ts.scanner_micro_enabled
        _agent.config.scanner.max_anomalies_per_wake = ts.scanner_max_wakes_per_cycle
        _agent.config.scanner.news_poll_enabled = ts.scanner_news_enabled
        _agent.config.hyperliquid.max_position_usd = ts.max_position_usd
    except Exception:
        pass


def _reset_agent():
    """Force re-initialization of the agent. Call after code changes."""
    global _agent, _agent_error
    _agent = None
    _agent_error = None


class AppState(rx.State):
    """Main application state."""

    # === Auth State ===
    is_authenticated: bool = False
    login_error: str = ""
    _session_token: str = rx.Cookie(name="hynous_session", max_age=86400 * 7)

    # === Auth Methods ===

    def authenticate(self, form_data: dict):
        """Validate password, set session cookie."""
        import hashlib, hmac, os
        password = form_data.get("password", "")
        expected = os.getenv("DASHBOARD_PASSWORD", "")
        if not expected:
            self.is_authenticated = True
            return AppState.load_page
        if hmac.compare_digest(password, expected):
            token = hashlib.sha256(expected.encode()).hexdigest()
            self._session_token = token
            self.is_authenticated = True
            self.login_error = ""
            return AppState.load_page
        else:
            self.login_error = "Wrong password"

    def logout(self):
        """Clear auth state and cookie."""
        self.is_authenticated = False
        self._session_token = ""

    def _check_session(self):
        """Validate session cookie against expected password hash."""
        import hashlib, os
        expected = os.getenv("DASHBOARD_PASSWORD", "")
        if not expected:
            self.is_authenticated = True
            return True
        valid_token = hashlib.sha256(expected.encode()).hexdigest()
        if self._session_token == valid_token:
            self.is_authenticated = True
            return True
        self.is_authenticated = False
        return False

    # === Chat State ===
    messages: List[Message] = []
    current_input: str = ""
    is_loading: bool = False
    streaming_text: str = ""
    active_tool: str = ""
    _pending_input: str = ""  # Backend-only: passed to background streaming task

    # === Agent State ===
    agent_status: str = "idle"  # "idle", "thinking", "online", "error"

    # === Portfolio State (updated by background poller) ===
    portfolio_value: float = 0.0  # Live account value
    portfolio_initial: float = 0.0  # Set from config/provider on first poll
    portfolio_change: float = 0.0  # % change from initial
    positions: List[Position] = []
    _polling: bool = False  # Guard against duplicate pollers

    # === Activity State ===
    activities: List[Activity] = []

    # === Debug State ===
    debug_traces: list[dict] = []
    debug_selected_trace_id: str = ""
    debug_selected_trace: dict = {}
    debug_filter_source: str = ""
    debug_filter_status: str = ""
    debug_expanded_spans: list[str] = []  # IDs of expanded spans (multi-open)

    # === Navigation ===
    current_page: str = "home"

    # === Unread Indicators ===
    chat_unread: bool = False
    journal_unread: bool = False
    memory_unread: bool = False

    # === Sparkline ===
    portfolio_sparkline_svg: str = ""

    # === Collapsible Cards ===
    news_expanded: bool = True
    clusters_sidebar_expanded: bool = True

    # === Position Chart (Sidebar Expand) ===
    expanded_position: str = ""  # symbol of expanded position ("" = none)
    position_chart_html: str = ""  # pre-rendered Lightweight Charts HTML
    position_chart_loading: bool = False

    # === Daemon State (updated by poll loop) ===
    daemon_running: bool = False
    daemon_wake_count: str = "0"
    daemon_status_text: str = "Stopped"
    daemon_status_color: str = "#525252"
    daemon_daily_pnl: str = "$0.00"
    daemon_trading_paused: bool = False
    daemon_activities: List[DaemonActivity] = []
    daemon_next_review: str = "—"
    daemon_cooldown: str = "—"
    daemon_cooldown_active: bool = False
    daemon_wake_rate: str = "—"
    daemon_reviews_until_learning: str = "—"
    daemon_last_wake_ago: str = "—"
    daemon_review_count: str = "0"
    daemon_today_wakes: list[DaemonActivityFormatted] = []

    # === Regime State (updated by poll loop) ===
    regime_label: str = ""
    regime_score: str = ""
    regime_macro_score: str = ""
    regime_micro_score: str = ""
    regime_micro_safe: bool = True
    regime_session: str = ""
    regime_reversal: bool = False
    regime_reversal_detail: str = ""
    regime_guidance: str = ""
    regime_color: str = "#525252"
    regime_bg: str = "#111111"
    regime_border: str = "1px solid #1a1a1a"

    # === Wallet State (updated by poll loop every 60s) ===
    wallet_total_str: str = "$0.00"
    wallet_subtitle: str = "This month"
    wallet_llm_cost: str = "$0.00"
    wallet_llm_calls: str = "0"
    wallet_llm_tokens: str = "0 in / 0 out"
    wallet_models_html: str = ""
    wallet_sonnet_cost: str = "$0.00"
    wallet_sonnet_calls: str = "0"
    wallet_haiku_cost: str = "$0.00"
    wallet_haiku_calls: str = "0"
    wallet_cache_savings: str = "$0.00"
    wallet_perplexity_cost: str = "$0.00"
    wallet_perplexity_calls: str = "0"
    total_trades_str: str = "0"
    micro_entries_today: str = "0"
    entries_today: str = "0"

    # === Scanner Display (updated by poll loop) ===
    scanner_status_text: str = "Scanner Offline"
    scanner_status_color: str = "#525252"
    scanner_subtitle: str = ""
    scanner_recent_html: str = ""
    news_feed_html: str = ""

    # === Journal Equity (updated by poll loop) ===
    journal_equity_data: list[dict] = []

    # === Activity Sidebar (Chat Page) ===
    wake_feed: List[WakeItem] = []
    wake_detail_content: str = ""
    wake_detail_category: str = ""
    wake_detail_time: str = ""
    wake_detail_open: bool = False
    wake_detail_tool_trace_text: str = ""
    wake_detail_signal_header: str = ""
    wake_detail_decision: str = ""
    active_watches: List[str] = []

    # === Trading Settings ===
    settings_dirty: bool = False
    # Macro
    settings_macro_sl_min: float = 1.0
    settings_macro_sl_max: float = 5.0
    settings_macro_tp_min: float = 2.0
    settings_macro_tp_max: float = 15.0
    settings_macro_lev_min: int = 5
    settings_macro_lev_max: int = 20
    # Micro
    settings_micro_sl_min: float = 0.2
    settings_micro_sl_warn: float = 0.3
    settings_micro_sl_max: float = 0.5
    settings_micro_tp_min: float = 0.15
    settings_micro_tp_max: float = 1.0
    settings_micro_leverage: int = 20
    # Risk
    settings_rr_floor_reject: float = 1.0
    settings_rr_floor_warn: float = 1.5
    settings_risk_cap_reject: float = 10.0
    settings_risk_cap_warn: float = 5.0
    settings_roe_reject: float = 25.0
    settings_roe_warn: float = 15.0
    settings_roe_target: float = 15.0
    # Sizing
    settings_tier_high: int = 30
    settings_tier_medium: int = 20
    settings_tier_speculative: int = 10
    settings_tier_pass: float = 0.3
    # Limits
    settings_max_position: float = 10000
    settings_max_positions: int = 3
    settings_max_daily_loss: float = 100
    # Scanner
    settings_scanner_threshold: float = 0.5
    settings_scanner_micro: bool = True
    settings_scanner_max_wakes: int = 5
    settings_scanner_news: bool = True
    # Smart Money
    settings_sm_copy_alerts: bool = True
    settings_sm_exit_alerts: bool = True
    settings_sm_min_win_rate: float = 0.55
    settings_sm_min_size: float = 50000
    # Smart Money Auto-Curation
    settings_sm_auto_curate: bool = True
    settings_sm_auto_min_wr: float = 0.55
    settings_sm_auto_min_trades: int = 10
    settings_sm_auto_min_pf: float = 1.5
    settings_sm_auto_max_wallets: int = 20
    # Small Wins Mode
    settings_small_wins_mode: bool = False
    settings_small_wins_roe_pct: float = 3.0
    settings_taker_fee_pct: float = 0.07

    # === Collapsible Toggles ===

    def toggle_news_expanded(self):
        self.news_expanded = not self.news_expanded

    def toggle_clusters_sidebar(self):
        self.clusters_sidebar_expanded = not self.clusters_sidebar_expanded

    def view_wake_detail(self, content: str, category: str, timestamp: str,
                         tool_trace_text: str = "", signal_header: str = "", decision: str = ""):
        """Open wake detail dialog with full content."""
        self.wake_detail_content = content
        self.wake_detail_category = category
        self.wake_detail_time = timestamp
        self.wake_detail_tool_trace_text = tool_trace_text
        self.wake_detail_signal_header = signal_header
        self.wake_detail_decision = decision
        self.wake_detail_open = True

    def close_wake_detail(self):
        self.wake_detail_open = False

    # === Stop Generation ===

    def stop_generation(self):
        """Interrupt agent stream."""
        global _agent
        if _agent:
            _agent.abort_stream()
        self.is_loading = False
        self.active_tool = ""
        self.agent_status = "idle"

    # === Chat Actions ===

    def set_input(self, value: str):
        """Update the current input value."""
        self.current_input = value

    def _append_msg(self, msg: Message):
        """Append a message, setting show_avatar based on previous sender."""
        if self.messages and self.messages[-1].sender == msg.sender:
            msg.show_avatar = False
        self.messages.append(msg)

    def _recompute_avatars(self):
        """Recompute show_avatar for all messages (used after bulk load)."""
        for i, msg in enumerate(self.messages):
            if i == 0:
                msg.show_avatar = True
            else:
                msg.show_avatar = msg.sender != self.messages[i - 1].sender

    def _format_time(self) -> str:
        """Format current time for display (Pacific timezone)."""
        from hynous.core.clock import now as pacific_now
        t = pacific_now()
        tz = t.strftime("%Z").lower()  # "pst" or "pdt"
        return t.strftime("%I:%M %p").lstrip("0").lower() + f" {tz}"

    def send_message(self, form_data: dict = {}):
        """Send a message and kick off background streaming.

        Accepts form data from the uncontrolled input (form submit sends
        {message: str}). Can also be called programmatically via
        _pending_input for suggestions and quick-chat.
        """
        # Get message from form data or _pending_input (for programmatic sends)
        text = form_data.get("message", "").strip() if form_data else ""
        if not text:
            text = self._pending_input.strip()
        if not text:
            return

        # Add user message
        user_msg = Message(
            sender="user",
            content=text,
            timestamp=self._format_time()
        )
        self._append_msg(user_msg)

        # Store input for background task
        self._pending_input = text
        self.is_loading = True
        self.streaming_text = ""
        self.active_tool = ""
        self.agent_status = "thinking"

        # Chain to background streaming task (state delta with user msg is sent first)
        return AppState.stream_response

    @_background
    async def stream_response(self):
        """Stream agent response as a background task.

        Runs chat_stream() in a thread so it never blocks the event loop.
        State updates are pushed via async with self between chunks.
        """
        async with self:
            user_input = self._pending_input

        # Run in thread so agent init (7s on first call) doesn't block event loop
        agent = await asyncio.to_thread(_get_agent)
        tools_used = []

        if agent:
            try:
                # Run sync streaming generator in a thread, consume via queue
                import queue
                chunk_queue: queue.Queue = queue.Queue()
                sentinel = object()

                def _produce():
                    try:
                        for chunk_type, chunk_data in agent.chat_stream(user_input):
                            chunk_queue.put((chunk_type, chunk_data))
                    except Exception as e:
                        chunk_queue.put(("error", str(e)))
                    chunk_queue.put(sentinel)

                # Start producer thread
                import threading
                producer = threading.Thread(target=_produce, daemon=True)
                producer.start()

                # Consume chunks in batches — push state every ~80ms
                # instead of per-token. Reduces state lock acquisitions
                # and computed var evaluations by ~10-50x.
                done = False
                while not done:
                    text_batch = []
                    tool_event = None
                    error_msg = None
                    replace_text = None

                    # Drain all available chunks without blocking
                    while True:
                        try:
                            item = chunk_queue.get_nowait()
                        except Exception:
                            break  # queue empty

                        if item is sentinel:
                            done = True
                            break
                        chunk_type, chunk_data = item
                        if chunk_type == "error":
                            error_msg = chunk_data
                            done = True
                            break
                        elif chunk_type == "text":
                            text_batch.append(chunk_data)
                        elif chunk_type == "tool":
                            tool_event = chunk_data
                            break  # Push tool events immediately
                        elif chunk_type == "replace":
                            replace_text = chunk_data

                    # Push batched updates in a single state lock
                    if text_batch or tool_event or error_msg or replace_text:
                        async with self:
                            if error_msg:
                                self.streaming_text += f"\n\nSomething went wrong: {error_msg}"
                                self.agent_status = "error"
                            if replace_text:
                                # Agent stripped text tool calls — replace with clean version
                                self.streaming_text = replace_text
                            elif text_batch:
                                self.active_tool = ""
                                self.streaming_text += "".join(text_batch)
                            if tool_event:
                                if self.streaming_text.strip():
                                    self._append_msg(Message(
                                        sender="hynous",
                                        content=_highlight(self.streaming_text),
                                        timestamp=self._format_time(),
                                    ))
                                    self.streaming_text = ""
                                self.active_tool = tool_event
                                if tool_event not in tools_used:
                                    tools_used.append(tool_event)

                    if not done:
                        await asyncio.sleep(0.08)  # ~80ms between UI pushes

                producer.join(timeout=5)

            except Exception as e:
                logger.error(f"Agent chat error: {e}")
                async with self:
                    self.streaming_text += "\n\nSomething went wrong on my end. Give me a moment and try again."
                    self.agent_status = "error"
        else:
            async with self:
                self.streaming_text = (
                    f"I can't connect to my brain right now. "
                    f"Make sure OPENROUTER_API_KEY is set in your .env file.\n\n"
                    f"Error: {_agent_error or 'Unknown'}"
                )
                self.agent_status = "error"

        # Finalize
        async with self:
            response = self.streaming_text
            display_tools = [_TOOL_TAG.get(t, t) for t in tools_used]
            hynous_msg = Message(
                sender="hynous",
                content=_highlight(response),
                timestamp=self._format_time(),
                tools_used=display_tools,
            )
            self._append_msg(hynous_msg)

            self.streaming_text = ""
            self.active_tool = ""
            self._add_activity("chat", f"Chat: {user_input[:30]}...", "info")
            self.is_loading = False
            if self.agent_status != "error":
                self.agent_status = "idle"

        # Persist to disk (outside state lock)
        self._save_chat(agent)

    def send_suggestion(self, suggestion: str):
        """Send a suggestion as a message."""
        self._pending_input = suggestion
        return self.send_message()

    def load_page(self):
        """Load persisted messages + start portfolio polling on page load."""
        # Check session cookie before loading anything
        if not self._check_session():
            return

        # Load chat history (wake log is drained in poll_portfolio, not here)
        if not self.messages:
            try:
                from hynous.core.persistence import load
                saved_messages, _ = load()
                if saved_messages:
                    self.messages = [Message(**m) for m in saved_messages]
                    self._recompute_avatars()
            except Exception as e:
                logger.error(f"Failed to load persisted chat: {e}")

        # Sync daemon status for this session (global _daemon may already be running)
        if _daemon is not None and _daemon.is_running:
            self.agent_status = "idle"

        # Start background tasks (init_daemon ensures agent+daemon start)
        return [AppState.init_daemon, AppState.poll_portfolio, AppState.load_watchpoints, AppState.load_clusters]

    @_background
    async def init_daemon(self):
        """Ensure agent + daemon are initialized (runs in background on page load)."""
        agent = await asyncio.to_thread(_get_agent)
        if agent:
            async with self:
                self.selected_model = agent.config.agent.model
                self.selected_sub_model = agent.config.memory.compression_model

    def _save_chat(self, agent=None):
        """Persist current messages and agent history to disk."""
        try:
            from hynous.core.persistence import save
            ui_data = [m.model_dump() for m in self.messages]
            history = agent._history if agent else []
            save(ui_data, history)
        except Exception as e:
            logger.error(f"Failed to save chat: {e}")

    def clear_messages(self):
        """Clear all messages, agent history, and persisted data."""
        self.messages = []
        agent = _get_agent()
        if agent:
            agent.clear_history()
        try:
            from hynous.core.persistence import clear
            clear()
        except Exception:
            pass

    # === Snapshot Helpers (update state fields from external sources) ===

    def _snapshot_daemon(self):
        """Update all daemon-related state fields from module-level _daemon."""
        import time as _time
        if _daemon is None or not _daemon.is_running:
            self.daemon_running = False
            self.daemon_status_text = "Stopped"
            self.daemon_status_color = "#525252"
            self.daemon_wake_count = "0"
            self.daemon_daily_pnl = "$0.00"
            self.daemon_trading_paused = False
            self.daemon_next_review = "\u2014"
            self.daemon_cooldown = "\u2014"
            self.daemon_cooldown_active = False
            self.daemon_wake_rate = "\u2014"
            self.daemon_reviews_until_learning = "\u2014"
            self.daemon_last_wake_ago = "\u2014"
            self.daemon_review_count = "0"
            self.micro_entries_today = "0"
            self.entries_today = "0"
            self.scanner_status_text = "Scanner Offline"
            self.scanner_status_color = "#525252"
            self.scanner_subtitle = ""
            self.active_watches = []
            return

        self.daemon_running = True
        self.daemon_trading_paused = _daemon.trading_paused
        if _daemon.trading_paused:
            self.daemon_status_text = "Paused"
            self.daemon_status_color = "#ef4444"
        else:
            self.daemon_status_text = "Running"
            self.daemon_status_color = "#22c55e"

        self.daemon_wake_count = str(_daemon.wake_count)

        pnl = _daemon.daily_realized_pnl
        sign = "+" if pnl >= 0 else ""
        self.daemon_daily_pnl = f"{sign}${pnl:,.2f}"

        secs = _daemon.next_review_seconds
        if secs <= 0:
            self.daemon_next_review = "Soon"
        else:
            mins = secs // 60
            if mins >= 60:
                self.daemon_next_review = f"{mins // 60}h {mins % 60}m"
            else:
                self.daemon_next_review = f"{mins}m"

        remaining = _daemon.cooldown_remaining
        self.daemon_cooldown_active = remaining > 0
        self.daemon_cooldown = "Ready" if remaining <= 0 else f"{remaining}s"

        current = _daemon.wakes_this_hour
        max_h = _daemon.config.daemon.max_wakes_per_hour
        self.daemon_wake_rate = f"{current}/{max_h}"

        n = _daemon.reviews_until_learning
        self.daemon_reviews_until_learning = "Next review" if n <= 1 else f"In {n} reviews"

        ts = _daemon.last_wake_time
        if not ts:
            self.daemon_last_wake_ago = "Never"
        else:
            elapsed = int(_time.time() - ts)
            if elapsed < 60:
                self.daemon_last_wake_ago = "Just now"
            else:
                mins = elapsed // 60
                if mins < 60:
                    self.daemon_last_wake_ago = f"{mins}m ago"
                else:
                    hours = mins // 60
                    self.daemon_last_wake_ago = f"{hours}h {mins % 60}m ago"

        self.daemon_review_count = str(_daemon.review_count)
        self.micro_entries_today = str(_daemon.micro_entries_today)
        self.entries_today = str(_daemon._entries_today)

        # Scanner status (needs daemon check)
        if _daemon._scanner is None:
            self.scanner_status_text = "Scanner Offline"
            self.scanner_status_color = "#525252"
        elif self.scanner_warming_up:
            self.scanner_status_text = f"Warming Up  {self.scanner_price_polls}/5 price  {self.scanner_deriv_polls}/2 deriv"
            self.scanner_status_color = "#fbbf24"
        elif self.scanner_active:
            self.scanner_status_text = f"Scanner Active  {self.scanner_pairs_count} pairs"
            self.scanner_status_color = "#2dd4bf"
        else:
            self.scanner_status_text = "Scanner Idle"
            self.scanner_status_color = "#525252"

        # Scanner subtitle
        if not self.scanner_active and not self.scanner_warming_up:
            self.scanner_subtitle = ""
        else:
            parts = []
            if self.scanner_anomalies_total > 0:
                parts.append(f"{self.scanner_anomalies_total} anomalies")
            if self.scanner_wakes_total > 0:
                parts.append(f"{self.scanner_wakes_total} wakes")
            self.scanner_subtitle = " \u00b7 ".join(parts) if parts else "No anomalies yet"

        # Active monitor_signal watches
        if _daemon._pending_watches:
            now = _time.time()
            self.active_watches = [
                f"{sym}{' [' + w['side'] + ']' if w.get('side') else ''} — {max(0, int(w['fire_at'] - now))}s"
                for sym, w in list(_daemon._pending_watches.items())
            ]
        else:
            self.active_watches = []

    def _snapshot_regime(self):
        """Update all regime-related state fields."""
        if _daemon is None or _daemon._regime is None:
            self.regime_label = ""
            self.regime_score = ""
            self.regime_macro_score = ""
            self.regime_micro_score = ""
            self.regime_micro_safe = True
            self.regime_session = ""
            self.regime_reversal = False
            self.regime_reversal_detail = ""
            self.regime_guidance = ""
            self.regime_color = "#525252"
            self.regime_bg = "#111111"
            self.regime_border = "1px solid #1a1a1a"
            return

        r = _daemon._regime
        label = r.combined_label
        self.regime_label = label
        macro_fmt = f"{r.macro_score:+.2f}"
        self.regime_score = macro_fmt
        self.regime_macro_score = macro_fmt
        micro_avail = r.signals.get("_micro_available", False)
        self.regime_micro_score = f"{r.micro_score:+.2f}" if micro_avail else ""
        self.regime_micro_safe = r.micro_safe
        self.regime_session = r.session
        self.regime_reversal = r.reversal_flag
        self.regime_reversal_detail = r.reversal_detail
        self.regime_guidance = r.guidance

        if "TREND_BULL" in label:
            self.regime_color = "#22c55e"
            self.regime_bg = "color-mix(in srgb, #22c55e 6%, #111111)"
            self.regime_border = "1px solid rgba(34,197,94,0.15)"
        elif "TREND_BEAR" in label:
            self.regime_color = "#ef4444"
            self.regime_bg = "color-mix(in srgb, #ef4444 6%, #111111)"
            self.regime_border = "1px solid rgba(239,68,68,0.15)"
        elif "VOLATILE_BULL" in label:
            self.regime_color = "#f59e0b"
            self.regime_bg = "color-mix(in srgb, #f59e0b 6%, #111111)"
            self.regime_border = "1px solid rgba(245,158,11,0.15)"
        elif "VOLATILE_BEAR" in label:
            self.regime_color = "#fb923c"
            self.regime_bg = "color-mix(in srgb, #f59e0b 6%, #111111)"
            self.regime_border = "1px solid rgba(245,158,11,0.15)"
        elif "SQUEEZE" in label:
            self.regime_color = "#a78bfa"
            self.regime_bg = "color-mix(in srgb, #a78bfa 6%, #111111)"
            self.regime_border = "1px solid rgba(167,139,250,0.15)"
        elif "RANGING" in label:
            self.regime_color = "#737373"
            self.regime_bg = "#111111"
            self.regime_border = "1px solid #1a1a1a"
        else:
            self.regime_color = "#525252"
            self.regime_bg = "#111111"
            self.regime_border = "1px solid #1a1a1a"

    @staticmethod
    def _fetch_wallet_snapshot() -> dict:
        """Fetch all wallet data in a single call (sync, runs in thread)."""
        result = {
            "total_str": "$0.00", "subtitle": "This month",
            "llm_cost": "$0.00", "llm_calls": "0", "llm_tokens": "0 in / 0 out",
            "models_html": "", "sonnet_cost": "$0.00", "sonnet_calls": "0",
            "haiku_cost": "$0.00", "haiku_calls": "0",
            "cache_savings": "$0.00", "perplexity_cost": "$0.00",
            "perplexity_calls": "0", "total_trades": "0",
        }
        try:
            from hynous.core.costs import get_month_summary
            s = get_month_summary()
            result["total_str"] = f"${s['total_usd']:.2f}"
            result["subtitle"] = f"{s['month']} operating costs"
            llm = s["llm"]
            result["llm_cost"] = f"${llm['total_cost_usd']:.2f}"
            result["llm_calls"] = str(llm["total_calls"])
            result["llm_tokens"] = f"{llm['total_input_tokens']:,} in / {llm['total_output_tokens']:,} out"
            # Models HTML
            from html import escape
            models = llm.get("models", [])
            if models:
                rows = []
                for m in models:
                    if m["calls"] == 0:
                        continue
                    rows.append(
                        f'<div style="display:flex;align-items:center;gap:0.5rem;padding:0.375rem 0;'
                        f'border-bottom:1px solid #1a1a1a">'
                        f'<div style="flex:1;min-width:0">'
                        f'<div style="color:#d4d4d4;font-size:0.78rem;font-weight:500">'
                        f'{escape(m["label"])}</div>'
                        f'<div style="display:flex;gap:0.5rem;font-size:0.65rem;margin-top:2px">'
                        f'<span style="color:#a78bfa;font-weight:500">${m["cost_usd"]:.2f}</span>'
                        f'<span style="color:#404040">\u00b7</span>'
                        f'<span style="color:#525252">{m["calls"]} calls</span>'
                        f'<span style="color:#404040">\u00b7</span>'
                        f'<span style="color:#404040">{m["input_tokens"]:,} in / {m["output_tokens"]:,} out</span>'
                        f'</div></div></div>'
                    )
                result["models_html"] = "".join(rows)
            try:
                result["sonnet_calls"] = str(s['claude']['sonnet']['calls'])
                result["sonnet_cost"]  = f"${s['claude']['sonnet']['cost_usd']:.2f}"
            except Exception:
                pass
            try:
                result["haiku_cost"] = f"${s['claude']['haiku']['cost_usd']:.2f}"
            except Exception:
                pass
            try:
                result["haiku_calls"] = str(s['claude']['haiku']['calls'])
            except Exception:
                pass
            try:
                result["cache_savings"] = f"${s['claude']['cache_savings_usd']:.2f}"
            except Exception:
                pass
            try:
                result["perplexity_cost"] = f"${s['perplexity']['cost_usd']:.2f}"
            except Exception:
                pass
            try:
                result["perplexity_calls"] = str(s["perplexity"]["calls"])
            except Exception:
                pass
        except Exception:
            pass
        try:
            from hynous.core.trade_analytics import get_trade_stats
            result["total_trades"] = str(get_trade_stats().total_trades)
        except Exception:
            pass
        return result

    @staticmethod
    def _build_scanner_html(recent: list[dict]) -> str:
        """Pre-build scanner recent anomalies HTML."""
        import time as _time
        if not recent:
            return (
                '<div style="font-family:\'JetBrains Mono\',monospace;font-size:0.72rem;'
                'color:#404040;text-align:center;padding:0.5rem 0;">'
                'No anomalies detected yet</div>'
            )
        rows = []
        now = _time.time()
        for a in recent[:10]:
            age_s = int(now - a.get("detected_at", now))
            if age_s < 60:
                age = "just now"
            elif age_s < 3600:
                age = f"{age_s // 60}m ago"
            else:
                age = f"{age_s // 3600}h ago"
            sev = a.get("severity", 0)
            sev_color = "#ef4444" if sev >= 0.7 else "#fbbf24" if sev >= 0.5 else "#525252"
            sym = a.get("symbol", "?")
            from html import escape
            headline = escape(a.get("headline", ""))
            rows.append(
                f'<div style="display:flex;gap:0.75rem;padding:0.25rem 0;align-items:center;">'
                f'<span style="width:52px;color:#525252;flex-shrink:0">{age}</span>'
                f'<span style="width:48px;color:#2dd4bf;font-weight:500;flex-shrink:0">{sym}</span>'
                f'<span style="flex:1;color:#a3a3a3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{headline}</span>'
                f'<span style="width:36px;text-align:right;color:{sev_color};flex-shrink:0">{sev:.2f}</span>'
                f'</div>'
            )
        return (
            '<div style="font-family:\'JetBrains Mono\',monospace;font-size:0.72rem;">'
            + "".join(rows) + '</div>'
        )

    @staticmethod
    def _build_news_html(news: list[dict]) -> str:
        """Pre-build news feed HTML."""
        import time as _time
        if not news:
            return (
                '<div style="font-size:0.8rem;color:#404040;text-align:center;padding:1rem 0;">'
                'No news yet \u2014 scanner polls every 5 min</div>'
            )
        rows = []
        now = _time.time()
        for n in news[:8]:
            pub = n.get("published_on", 0)
            age_s = int(now - pub) if pub else 0
            if age_s < 60:
                age = "now"
            elif age_s < 3600:
                age = f"{age_s // 60}m"
            else:
                age = f"{age_s // 3600}h"
            from html import escape
            title = escape(n.get("title", ""))
            source = escape(n.get("source", ""))
            rows.append(
                f'<div style="display:flex;gap:0.5rem;padding:0.35rem 0;border-bottom:1px solid #1a1a1a;align-items:baseline;min-width:0;overflow:hidden;">'
                f'<span style="width:28px;color:#525252;flex-shrink:0;font-size:0.7rem;text-align:right">{age}</span>'
                f'<span style="flex:1;min-width:0;color:#a3a3a3;font-size:0.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{title}</span>'
                f'<span style="color:#525252;font-size:0.65rem;flex-shrink:0">{source}</span>'
                f'</div>'
            )
        return '<div style="font-family:inherit;overflow:hidden;width:100%;">' + "".join(rows) + '</div>'

    @staticmethod
    def _fetch_daemon_events() -> tuple:
        """Fetch daemon events for activities + today_wakes (sync)."""
        activities_list = []
        today_list = []
        try:
            from hynous.core.daemon_log import get_events
            from datetime import datetime, timezone
            raw = get_events(limit=50)
            activities_list = [DaemonActivity(**e) for e in raw[:20]]
            today = datetime.now(timezone.utc).date()
            for e in raw:
                ts_str = e.get("timestamp", "")
                if not ts_str:
                    continue
                try:
                    ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                except Exception:
                    continue
                if ts.date() != today or e.get("type") == "skip":
                    continue
                now = datetime.now(timezone.utc)
                delta = int((now - ts).total_seconds())
                if delta < 60:
                    age = "Just now"
                elif delta < 3600:
                    age = f"{delta // 60}m ago"
                else:
                    age = f"{delta // 3600}h {(delta % 3600) // 60}m ago"
                today_list.append(DaemonActivityFormatted(
                    type=e.get("type", ""),
                    title=e.get("title", ""),
                    detail=e.get("detail", ""),
                    time_display=age,
                ))
        except Exception:
            pass
        return activities_list, today_list[:15]

    @staticmethod
    def _fetch_equity_data(days: int) -> list[dict]:
        """Fetch equity curve data (sync, runs in thread)."""
        try:
            from hynous.core.equity_tracker import get_equity_data
            from datetime import datetime, timezone
            data = get_equity_data(days=days)
            result = []
            for point in data:
                ts = point.get("timestamp", 0)
                dt = datetime.fromtimestamp(ts, tz=timezone.utc)
                result.append({
                    "date": dt.strftime("%m/%d"),
                    "value": point.get("account_value", 0),
                    "pnl": point.get("unrealized_pnl", 0),
                })
            return result
        except Exception:
            return []

    # === Portfolio Polling ===

    def start_polling(self):
        """Start the background portfolio poller on page load."""
        if not self._polling:
            return AppState.poll_portfolio

    @_background
    async def poll_portfolio(self):
        """Poll Hyperliquid testnet every few seconds for live portfolio data.

        Runs as a Reflex background task — outside the main state lock.
        Updates portfolio_value, portfolio_change, and positions.
        Zero LLM tokens — pure Python → Hyperliquid REST.
        """
        async with self:
            if self._polling:
                return
            self._polling = True

        _cluster_tick = 0
        while True:
            try:
                # Run sync Hyperliquid API call in a thread so it doesn't
                # block the Reflex event loop (call takes ~5-7s on testnet).
                state_data = await asyncio.to_thread(self._fetch_portfolio)

                if state_data is not None:
                    value, positions, initial = state_data
                    # Track sparkline history
                    _portfolio_history.append(round(value, 2))
                    async with self:
                        self.portfolio_value = round(value, 2)
                        if initial > 0:
                            self.portfolio_initial = initial
                            self.portfolio_change = round(
                                ((value - initial) / initial) * 100, 2
                            )
                        self.positions = positions
                        # Clear expanded chart if position was closed
                        if self.expanded_position and not any(
                            p.symbol == self.expanded_position for p in positions
                        ):
                            self.expanded_position = ""
                            self.position_chart_html = ""
                            self.position_chart_loading = False
                        # Update sparkline SVG
                        if len(_portfolio_history) >= 3:
                            self.portfolio_sparkline_svg = _build_sparkline_svg(
                                _portfolio_history, width=80, height=24,
                                color="#22c55e" if self.portfolio_change >= 0 else "#ef4444",
                            )
            except Exception as e:
                logger.debug(f"Portfolio poll error: {e}")

            # Snapshot daemon + regime state (every tick — fast in-memory reads)
            try:
                async with self:
                    self._snapshot_daemon()
                    self._snapshot_regime()
            except Exception:
                pass

            # Drain daemon chat queue — show daemon wakes in the chat feed
            try:
                from hynous.intelligence.daemon import get_daemon_chat_queue
                dq = get_daemon_chat_queue()
                new_daemon_msgs = []
                while not dq.empty():
                    try:
                        new_daemon_msgs.append(dq.get_nowait())
                    except Exception:
                        break
                # Also drain persistent wake log (catches anything missed)
                try:
                    from hynous.core.persistence import drain_wake_log
                    for entry in drain_wake_log():
                        # Dedup: skip if already in queue batch
                        if not any(d['response'] == entry['response'] for d in new_daemon_msgs):
                            new_daemon_msgs.append(entry)
                except Exception:
                    pass
                if new_daemon_msgs:
                    async with self:
                        self.is_waking = False  # Clear manual wake indicator
                        # Route ALL daemon wakes to sidebar activity feed
                        for item in new_daemon_msgs:
                            raw = item.get('response', '')
                            first_line = raw.split("\n")[0][:200] if raw else ""
                            # Classify wake type
                            evt = item.get('event_type', '')
                            src = item.get('type', '')
                            if evt == 'scanner' or src == 'Scanner':
                                cat = 'scanner'
                            elif evt == 'fill' or src == 'Fill':
                                cat = 'fill'
                            elif src in ('Review', 'Periodic'):
                                cat = 'review'
                            elif src == 'Watchpoint':
                                cat = 'watchpoint'
                            elif src == 'Learning':
                                cat = 'learning'
                            elif evt == 'error':
                                cat = 'error'
                            else:
                                cat = 'wake'
                            self.wake_feed = ([
                                WakeItem(
                                    category=cat,
                                    content=first_line,
                                    full_content=raw,
                                    timestamp=item.get('timestamp', self._format_time()),
                                    tool_trace_text=item.get('tool_trace_text', ''),
                                    signal_header=item.get('signal_header', ''),
                                    decision=item.get('decision', ''),
                                )
                            ] + self.wake_feed)[:100]
                        # Journal unread for fills
                        for item in new_daemon_msgs:
                            if item.get('event_type') == 'fill':
                                if self.current_page != "journal":
                                    self.journal_unread = True
                                break
            except Exception:
                pass

            # Refresh memory + scanner data every ~60s (4 polls)
            _cluster_tick = (_cluster_tick + 1) % 1200  # wraps every ~5h, stays bounded
            if _cluster_tick % 4 == 0:
                try:
                    # Grab current equity_days for equity fetch
                    eq_days = 30
                    async with self:
                        eq_days = self.equity_days

                    cluster_data, health_data, conflict_data, wp_data, scanner_data, \
                        wallet_data, daemon_events, equity_data = await asyncio.to_thread(
                        lambda: (
                            AppState._fetch_clusters(),
                            AppState._fetch_memory_health(),
                            AppState._fetch_conflicts(),
                            AppState._fetch_watchpoints(),
                            AppState._fetch_scanner_status(),
                            AppState._fetch_wallet_snapshot(),
                            AppState._fetch_daemon_events(),
                            AppState._fetch_equity_data(eq_days),
                        )
                    )
                    async with self:
                        self.cluster_displays = cluster_data["clusters"]
                        self.cluster_total = str(cluster_data["total"])
                        self.memory_node_count = health_data["node_count"]
                        self.memory_edge_count = health_data["edge_count"]
                        self.memory_health_ratio = health_data["health_ratio"]
                        self.memory_lifecycle_html = health_data["lifecycle_html"]
                        # Memory unread when new conflicts appear
                        if conflict_data["count"] != "0" and self.conflict_count == "0":
                            if self.current_page != "memory":
                                self.memory_unread = True
                        self.conflict_count = conflict_data["count"]
                        self.watchpoint_groups = wp_data["groups"]
                        self.watchpoint_count = str(wp_data["count"])
                        # Scanner banner
                        self.scanner_active = scanner_data["active"]
                        self.scanner_warming_up = scanner_data["warming_up"]
                        self.scanner_price_polls = scanner_data["price_polls"]
                        self.scanner_deriv_polls = scanner_data["deriv_polls"]
                        self.scanner_pairs_count = scanner_data["pairs_count"]
                        self.scanner_anomalies_total = scanner_data["anomalies_detected"]
                        self.scanner_wakes_total = scanner_data["wakes_triggered"]
                        self.scanner_recent = scanner_data["recent"]
                        self.scanner_news = scanner_data.get("news", [])
                        # Pre-build HTML (avoids per-tick rebuilds)
                        self.scanner_recent_html = AppState._build_scanner_html(self.scanner_recent)
                        self.news_feed_html = AppState._build_news_html(self.scanner_news)
                        # Wallet (single get_month_summary call for all fields)
                        self.wallet_total_str = wallet_data["total_str"]
                        self.wallet_subtitle = wallet_data["subtitle"]
                        self.wallet_llm_cost = wallet_data["llm_cost"]
                        self.wallet_llm_calls = wallet_data["llm_calls"]
                        self.wallet_llm_tokens = wallet_data["llm_tokens"]
                        self.wallet_models_html = wallet_data["models_html"]
                        self.wallet_sonnet_cost = wallet_data["sonnet_cost"]
                        self.wallet_sonnet_calls = wallet_data["sonnet_calls"]
                        self.wallet_haiku_cost = wallet_data["haiku_cost"]
                        self.wallet_haiku_calls = wallet_data["haiku_calls"]
                        self.wallet_cache_savings = wallet_data["cache_savings"]
                        self.wallet_perplexity_cost = wallet_data["perplexity_cost"]
                        self.wallet_perplexity_calls = wallet_data["perplexity_calls"]
                        self.total_trades_str = wallet_data["total_trades"]
                        # Daemon events
                        activities, today_wakes = daemon_events
                        self.daemon_activities = activities
                        self.daemon_today_wakes = today_wakes
                        # Equity data
                        self.journal_equity_data = equity_data
                except Exception:
                    pass

            # Refresh debug traces when on debug page
            try:
                async with self:
                    if self.current_page == "debug":
                        self.load_debug_traces()
                        # Also refresh selected trace if viewing one (live span updates)
                        if self.debug_selected_trace_id:
                            from hynous.core.request_tracer import get_tracer
                            trace = get_tracer().get_trace(self.debug_selected_trace_id)
                            if trace:
                                self.debug_selected_trace = trace
            except Exception:
                pass

            # Daemon watchdog — restart if thread died or is hung
            try:
                if _daemon is not None:
                    if not _daemon.is_running:
                        logger.warning("Daemon thread died — restarting")
                        _daemon.start()
                    elif time.time() - _daemon._heartbeat > 180:
                        logger.warning("Daemon thread hung (no heartbeat for 3min) — restarting")
                        _daemon._running = False  # Signal loop to stop
                        if _daemon._thread:
                            _daemon._thread.join(timeout=5)
                        _daemon._thread = None
                        _daemon.start()
            except Exception as e:
                logger.debug(f"Daemon watchdog error: {e}")

            # Refresh position chart every ~30s (every other poll)
            if _cluster_tick % 2 == 0:
                try:
                    chart_sym = ""
                    entry_px = 0.0
                    chart_side = "long"
                    async with self:
                        chart_sym = self.expanded_position
                        if chart_sym:
                            for p in self.positions:
                                if p.symbol == chart_sym:
                                    entry_px = p.entry
                                    chart_side = p.side
                                    break
                    if chart_sym:
                        chart_html = await asyncio.to_thread(
                            self._fetch_position_chart_data, chart_sym, entry_px, chart_side
                        )
                        async with self:
                            if self.expanded_position == chart_sym:
                                self.position_chart_html = chart_html
                except Exception:
                    pass

            await asyncio.sleep(_POLL_INTERVAL)

    # === Activity Actions ===

    def _add_activity(self, type: str, title: str, level: str = "info"):
        """Add an activity to the log."""
        activity = Activity(
            type=type,
            title=title,
            level=level,
            timestamp=datetime.now().isoformat()
        )
        self.activities.insert(0, activity)
        # Keep only last 50 activities
        self.activities = self.activities[:50]

    # === Computed Vars ===

    @staticmethod
    def _fetch_portfolio() -> tuple[float, list["Position"]] | None:
        """Fetch portfolio data from Hyperliquid (sync, runs in thread)."""
        from hynous.data.providers.hyperliquid import get_provider
        from hynous.core.config import load_config

        config = load_config()
        provider = get_provider(config=config)

        if not provider.can_trade:
            return None

        state = provider.get_user_state()
        value = state["account_value"]
        raw_positions = state["positions"]
        initial = getattr(provider, "_initial_balance", config.execution.paper_balance)

        # Compute realized PnL per open position from PARTIAL fills only.
        # Only count fills that happened AFTER the current position opened
        # (prevents old closed trades from bleeding into new positions).
        realized_by_symbol: dict[str, float] = {}
        opened_at_by_symbol: dict[str, str] = {}
        for p in raw_positions:
            opened_at_by_symbol[p["coin"]] = p.get("opened_at", "")
        try:
            from datetime import datetime, timezone
            import time as _time
            for sym, opened_at in opened_at_by_symbol.items():
                if not opened_at:
                    continue
                try:
                    dt = datetime.fromisoformat(opened_at.replace("Z", "+00:00"))
                    start_ms = int(dt.timestamp() * 1000)
                except Exception:
                    continue
                fills = provider.get_user_fills(start_ms=start_ms, end_ms=int(_time.time() * 1000))
                for f in fills:
                    if f.get("coin") != sym:
                        continue
                    direction = f.get("direction", "")
                    if "Close" in direction:
                        realized_by_symbol[sym] = realized_by_symbol.get(sym, 0) + f.get("closed_pnl", 0)
        except Exception:
            pass

        positions = [
            Position(
                symbol=p["coin"],
                side=p["side"],
                size=round(p["size_usd"], 2),
                entry=p["entry_px"],
                mark=p["mark_px"],
                pnl=round(p["return_pct"], 2),
                pnl_usd=round(p["unrealized_pnl"], 2),
                leverage=p["leverage"],
                realized_pnl=round(realized_by_symbol.get(p["coin"], 0), 2),
            )
            for p in raw_positions
        ]

        return (round(value, 2), positions, initial)

    @rx.var
    def portfolio_value_str(self) -> str:
        """Formatted portfolio value — updated by background poller."""
        if self.portfolio_value > 0:
            return f"${self.portfolio_value:,.2f}"
        return "Connecting..."

    @rx.var
    def small_wins_preview(self) -> dict:
        """Live preview: what Small Wins Mode earns per trade at current settings.

        Shows two scenarios — micro (fixed 20x) and macro (average of configured
        macro leverage range) — since fee cost as % of ROE scales with leverage.
        """
        fee_pct = self.settings_taker_fee_pct
        micro_lev = self.settings_micro_leverage
        # Macro leverage: midpoint of the configured macro range
        macro_lev = round((self.settings_macro_lev_min + self.settings_macro_lev_max) / 2)
        roe_target = self.settings_small_wins_roe_pct
        pv = self.portfolio_value if self.portfolio_value > 0 else 0.0

        def _scenario(lev: int) -> dict:
            fee_be = fee_pct * lev
            exit_roe = max(roe_target, fee_be + 0.1)
            net_roe = exit_roe - fee_be
            high_m = pv * self.settings_tier_high / 100
            med_m  = pv * self.settings_tier_medium / 100
            spec_m = pv * self.settings_tier_speculative / 100
            return {
                "fee_be_roe":    round(fee_be, 2),
                "exit_roe":      round(exit_roe, 2),
                "net_roe":       round(net_roe, 2),
                "leverage":      lev,
                "high_margin":   round(high_m, 2),
                "high_net_usd":  round(high_m * net_roe / 100, 2),
                "med_margin":    round(med_m, 2),
                "med_net_usd":   round(med_m * net_roe / 100, 2),
                "spec_margin":   round(spec_m, 2),
                "spec_net_usd":  round(spec_m * net_roe / 100, 2),
            }

        micro = _scenario(micro_lev)
        macro = _scenario(macro_lev)
        # Expose top-level fields using micro scenario (settings card shows micro by default)
        return {
            **micro,
            "fee_pct":     fee_pct,
            "portfolio":   round(pv, 2),
            "macro_lev":   macro_lev,
            "macro_fee_be_roe":   macro["fee_be_roe"],
            "macro_exit_roe":     macro["exit_roe"],
            "macro_net_roe":      macro["net_roe"],
            "macro_high_net_usd": macro["high_net_usd"],
            "macro_med_net_usd":  macro["med_net_usd"],
            "macro_spec_net_usd": macro["spec_net_usd"],
        }

    @rx.var
    def portfolio_change_str(self) -> str:
        """Formatted portfolio change %."""
        if self.portfolio_value == 0:
            return "Waiting for data"
        if self.portfolio_change == 0:
            return "Testnet trading"
        sign = "+" if self.portfolio_change > 0 else ""
        return f"{sign}{self.portfolio_change:.2f}% all time"

    @rx.var
    def portfolio_change_color(self) -> str:
        """Color for portfolio change."""
        if self.portfolio_change > 0:
            return "#22c55e"
        elif self.portfolio_change < 0:
            return "#ef4444"
        return "#fafafa"

    @rx.var
    def wallet_coinglass_cost(self) -> str:
        """Coinglass monthly subscription cost."""
        return "$35.00"

    @rx.var
    def positions_count(self) -> str:
        """Number of open positions — updated by background poller."""
        return str(len(self.positions))

    @rx.var
    def message_count(self) -> str:
        """Number of messages as string."""
        return str(len(self.messages))


    @rx.var
    def agent_status_display(self) -> str:
        """Capitalized agent status."""
        return self.agent_status.capitalize()

    @rx.var
    def agent_status_color(self) -> str:
        """Color for agent status dot."""
        colors = {
            "online": "#22c55e",
            "thinking": "#eab308",
            "error": "#ef4444",
        }
        return colors.get(self.agent_status, "#525252")

    @rx.var
    def streaming_show_avatar(self) -> bool:
        """Whether the streaming bubble should show the Hynous avatar.

        False when the last saved message is already from Hynous (grouped).
        """
        if not self.messages:
            return True
        return self.messages[-1].sender != "hynous"

    @rx.var
    def streaming_display(self) -> str:
        """Streaming text with financial highlights applied."""
        if not self.streaming_text:
            return ""
        return _highlight(self.streaming_text)

    @rx.var
    def active_tool_display(self) -> str:
        """Human-readable name for the currently active tool."""
        if not self.active_tool:
            return ""
        return _TOOL_DISPLAY.get(self.active_tool, self.active_tool)

    @rx.var
    def active_tool_color(self) -> str:
        """Accent color for the currently active tool indicator."""
        colors = {
            "get_market_data": "#60a5fa",
            "get_orderbook": "#22d3ee",
            "get_funding_history": "#fbbf24",
            "get_multi_timeframe": "#a78bfa",
            "get_liquidations": "#fb923c",
            "get_global_sentiment": "#2dd4bf",
            "get_options_flow": "#f472b6",
            "get_institutional_flow": "#34d399",
            "search_web": "#e879f9",
            "get_my_costs": "#94a3b8",
            "store_memory": "#a3e635",
            "recall_memory": "#a3e635",
            "get_account": "#f59e0b",
            "execute_trade": "#22c55e",
            "close_position": "#ef4444",
            "modify_position": "#a78bfa",
            "get_trade_stats": "#f97316",
            "explore_memory": "#a3e635",
            "manage_conflicts": "#f87171",
            "manage_clusters": "#a5b4fc",
        }
        return colors.get(self.active_tool, "#a5b4fc")

    # === Daemon Controls ===

    is_waking: bool = False  # True while a manual wake is in progress

    def wake_agent_now(self):
        """Trigger an immediate daemon review wake.

        Non-blocking: fires the wake in a daemon background thread.
        Response appears in chat feed via the daemon chat queue.
        The is_waking flag is cleared by poll_portfolio when the response arrives.
        """
        if _daemon is None or not _daemon.is_running:
            self._add_activity("system", "Cannot wake — daemon not running", "warning")
            return
        if self.is_waking:
            return  # Already waking

        self.is_waking = True
        _daemon.trigger_manual_wake()
        self._add_activity("system", "Manual wake triggered", "info")

    def toggle_daemon(self, checked: bool = True):
        """Toggle daemon on/off.

        Fully synchronous — if agent needs init on first toggle, this blocks
        for ~7s. Acceptable since the user explicitly requested the action.
        After first init, toggling is instant.
        """
        global _daemon

        if not checked:
            # Stop — always instant
            if _daemon is not None and _daemon.is_running:
                _daemon.stop()
                self._snapshot_daemon()
                self._add_activity("system", "Daemon stopped", "info")
            return

        # Start — initialize agent if needed
        agent = _get_agent()
        if not agent:
            self._add_activity("system", f"Daemon failed: {_agent_error}", "error")
            return

        if _daemon is None:
            from hynous.intelligence.daemon import Daemon
            _daemon = Daemon(agent, agent.config)
        if not _daemon.is_running:
            _daemon.start()
        # Immediate UI feedback (don't wait for next poll tick)
        self._snapshot_daemon()
        self._snapshot_regime()
        self._add_activity("system", "Daemon started", "info")

    # === Navigation ===

    def go_to_home(self):
        """Navigate to home page."""
        self.current_page = "home"

    def go_to_chat(self):
        """Navigate to chat page."""
        self.current_page = "chat"
        self.chat_unread = False

    def go_to_data(self):
        """Navigate to data intelligence page."""
        self.current_page = "data"

    def go_to_memory(self):
        """Navigate to memory management page and load data."""
        self.current_page = "memory"
        self.memory_unread = False
        return AppState.load_memory_page

    def go_to_chat_with_message(self, msg: str):
        """Navigate to chat and send a message."""
        self.current_page = "chat"
        self.chat_unread = False
        self._pending_input = msg
        return self.send_message()

    # === Position Chart (Sidebar Expand) ===

    def toggle_position_chart(self, symbol: str):
        """Expand/collapse position chart for a symbol."""
        if self.expanded_position == symbol:
            self.expanded_position = ""
            self.position_chart_html = ""
            self.position_chart_loading = False
        else:
            self.expanded_position = symbol
            self.position_chart_html = ""
            self.position_chart_loading = True
            return AppState._load_position_chart

    @_background
    async def _load_position_chart(self):
        """Background task: fetch candle + trigger data and build chart HTML."""
        async with self:
            symbol = self.expanded_position
            if not symbol:
                return
            # Grab entry price from current positions
            entry_px = 0.0
            side = "long"
            for p in self.positions:
                if p.symbol == symbol:
                    entry_px = p.entry
                    side = p.side
                    break

        try:
            html = await asyncio.to_thread(
                self._fetch_position_chart_data, symbol, entry_px, side
            )
        except Exception as e:
            logger.debug(f"Position chart error: {e}")
            html = ""

        async with self:
            if self.expanded_position == symbol:
                self.position_chart_html = html
                self.position_chart_loading = False

    @staticmethod
    def _fetch_position_chart_data(symbol: str, entry_px: float, side: str) -> str:
        """Build self-contained Lightweight Charts HTML for a position."""
        import time as _time
        from hynous.data.providers.hyperliquid import get_provider
        from hynous.core.config import load_config

        provider = get_provider(config=load_config())
        end_ms = int(_time.time() * 1000)
        start_ms = end_ms - 3600 * 1000  # 1 hour of 1m candles

        candles = provider.get_candles(symbol, "1m", start_ms, end_ms)
        if not candles:
            return ""

        # Get trigger orders (SL/TP)
        sl_px = 0.0
        tp_px = 0.0
        try:
            triggers = provider.get_trigger_orders(symbol)
            for t in triggers:
                if t.get("order_type") == "stop_loss" and t.get("trigger_px"):
                    sl_px = t["trigger_px"]
                elif t.get("order_type") == "take_profit" and t.get("trigger_px"):
                    tp_px = t["trigger_px"]
        except Exception:
            pass

        # Get heatmap overlay (optional)
        heatmap_buckets = []
        try:
            from hynous.data.providers.hynous_data import get_client
            hm = get_client().heatmap(symbol)
            if hm and "buckets" in hm:
                heatmap_buckets = hm["buckets"]
        except Exception:
            pass

        return AppState._build_position_chart_html(
            candles, entry_px, sl_px, tp_px, side, symbol, heatmap_buckets
        )

    @staticmethod
    def _build_position_chart_html(
        candles: list, entry: float, sl: float, tp: float,
        side: str, symbol: str, heatmap_buckets: list,
    ) -> str:
        """Return pure SVG candlestick chart — no script tags (rx.html strips them)."""
        if not candles:
            return ""

        W, H = 256, 170
        PAD_L, PAD_R, PAD_T, PAD_B = 42, 4, 8, 18  # axis label space
        cw = W - PAD_L - PAD_R
        ch = H - PAD_T - PAD_B

        # Price range — include entry/SL/TP in range calculation
        all_prices = []
        for c in candles:
            all_prices.extend([c["h"], c["l"]])
        for px in (entry, sl, tp):
            if px > 0:
                all_prices.append(px)
        hi = max(all_prices)
        lo = min(all_prices)
        rng = hi - lo if hi != lo else hi * 0.01 or 1
        # Add 5% padding
        hi += rng * 0.05
        lo -= rng * 0.05
        rng = hi - lo

        def y(price):
            return round(PAD_T + ch * (1 - (price - lo) / rng), 1)

        n = len(candles)
        bar_w = max(1.5, min(4, cw / n * 0.7))
        gap = cw / n if n > 1 else cw

        # Format price for axis labels
        def fmt_px(p):
            if p >= 1000:
                return f"${p:,.0f}"
            elif p >= 1:
                return f"${p:.2f}"
            else:
                return f"${p:.4f}"

        last_px = candles[-1]["c"]
        px_str = fmt_px(last_px)
        last_pnl_color = "#22c55e" if last_px >= candles[0]["o"] else "#ef4444"

        # Build SVG
        svg_parts = [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="{H}" '
            f'viewBox="0 0 {W} {H}" style="display:block;background:#0c0c0c;border-radius:4px">'
        ]

        # Y-axis grid lines + labels (4 levels)
        for i in range(5):
            price = lo + rng * i / 4
            yp = y(price)
            svg_parts.append(
                f'<line x1="{PAD_L}" y1="{yp}" x2="{W-PAD_R}" y2="{yp}" '
                f'stroke="#1a1a1a" stroke-width="0.5"/>'
            )
            svg_parts.append(
                f'<text x="{PAD_L-3}" y="{yp+3}" text-anchor="end" '
                f'font-size="7" fill="#404040" font-family="JetBrains Mono,monospace">'
                f'{fmt_px(price)}</text>'
            )

        # Heatmap zones (subtle yellow bands at liquidation levels)
        if heatmap_buckets:
            max_liq = 0
            hm_items = []
            for b in heatmap_buckets[:20]:
                liq_t = b.get("long_liq_usd", 0) + b.get("short_liq_usd", 0)
                pm = b.get("price_mid", 0)
                if liq_t > 10000 and pm > 0 and lo <= pm <= hi:
                    hm_items.append((pm, liq_t))
                    max_liq = max(max_liq, liq_t)
            for pm, liq_t in hm_items:
                opacity = round(min(0.15, (liq_t / max_liq) * 0.15), 3) if max_liq else 0
                yp = y(pm)
                svg_parts.append(
                    f'<rect x="{PAD_L}" y="{yp-2}" width="{cw}" height="4" '
                    f'fill="rgba(250,204,21,{opacity})" rx="1"/>'
                )

        # Price lines (Entry, SL, TP)
        markers = []
        if entry > 0 and lo <= entry <= hi:
            markers.append((entry, "#6366f1", "Entry"))
        if sl > 0 and lo <= sl <= hi:
            markers.append((sl, "#ef4444", "SL"))
        if tp > 0 and lo <= tp <= hi:
            markers.append((tp, "#22c55e", "TP"))

        for px, color, label in markers:
            yp = y(px)
            svg_parts.append(
                f'<line x1="{PAD_L}" y1="{yp}" x2="{W-PAD_R}" y2="{yp}" '
                f'stroke="{color}" stroke-width="0.7" stroke-dasharray="3,2" opacity="0.8"/>'
            )
            svg_parts.append(
                f'<text x="{W-PAD_R+2}" y="{yp+3}" font-size="6.5" fill="{color}" '
                f'font-family="JetBrains Mono,monospace" font-weight="500">{label}</text>'
            )

        # Candlesticks
        for i, c in enumerate(candles):
            cx = round(PAD_L + gap * (i + 0.5), 1)
            o, h_p, l_p, cl = c["o"], c["h"], c["l"], c["c"]
            is_up = cl >= o
            color = "#22c55e" if is_up else "#ef4444"
            body_top = y(max(o, cl))
            body_bot = y(min(o, cl))
            body_h = max(0.5, body_bot - body_top)

            # Wick
            svg_parts.append(
                f'<line x1="{cx}" y1="{y(h_p)}" x2="{cx}" y2="{y(l_p)}" '
                f'stroke="{color}" stroke-width="0.7"/>'
            )
            # Body
            svg_parts.append(
                f'<rect x="{cx - bar_w/2}" y="{body_top}" width="{bar_w}" height="{body_h}" '
                f'fill="{color}" rx="0.3"/>'
            )

        # Current price indicator (right edge)
        yp_last = y(last_px)
        svg_parts.append(
            f'<circle cx="{PAD_L + cw}" cy="{yp_last}" r="2" fill="{last_pnl_color}"/>'
        )

        # Time axis labels (first, middle, last)
        from datetime import datetime, timezone
        for idx in (0, n // 2, n - 1):
            if idx < n:
                t = candles[idx]["t"] / 1000
                dt = datetime.fromtimestamp(t, tz=timezone.utc)
                label = f"{dt.hour}:{dt.minute:02d}"
                cx = round(PAD_L + gap * (idx + 0.5), 1)
                svg_parts.append(
                    f'<text x="{cx}" y="{H-4}" text-anchor="middle" font-size="7" '
                    f'fill="#404040" font-family="JetBrains Mono,monospace">{label}</text>'
                )

        svg_parts.append("</svg>")
        svg = "\n".join(svg_parts)

        return (
            f'<div style="width:100%">'
            f'<div style="display:flex;justify-content:space-between;align-items:center;'
            f'padding:2px 4px;margin-bottom:2px">'
            f'<span style="font-size:0.65rem;color:#6366f1;font-weight:600">{symbol}</span>'
            f'<span style="font-size:0.6rem;color:{last_pnl_color};font-family:JetBrains Mono,monospace;'
            f'font-weight:500">{px_str}</span>'
            f'</div>{svg}</div>'
        )

    # === Model Selection ===
    selected_model: str = "openrouter/anthropic/claude-sonnet-4-5-20250929"
    selected_sub_model: str = "openrouter/anthropic/claude-haiku-4-5-20251001"

    @rx.var
    def selected_model_label(self) -> str:
        """Human-readable label for the currently selected main model."""
        return _MODEL_TO_LABEL.get(self.selected_model, self.selected_model)

    @rx.var
    def selected_sub_model_label(self) -> str:
        """Human-readable label for the currently selected sub-agent model."""
        return _MODEL_TO_LABEL.get(self.selected_sub_model, self.selected_sub_model)

    def set_agent_model(self, label: str):
        """Switch the main agent model at runtime."""
        model_id = _LABEL_TO_MODEL.get(label, label)
        self.selected_model = model_id
        agent = _get_agent()
        if agent:
            agent.config.agent.model = model_id
            agent.rebuild_system_prompt()
        _save_model_prefs(model_id, self.selected_sub_model)

    def set_sub_model(self, label: str):
        """Switch the sub-agent (coach/compression) model at runtime."""
        model_id = _LABEL_TO_MODEL.get(label, label)
        self.selected_sub_model = model_id
        agent = _get_agent()
        if agent:
            agent.config.memory.compression_model = model_id
        _save_model_prefs(self.selected_model, model_id)

    # === Watchlist State ===

    watchpoint_groups: List[WatchpointGroup] = []
    watchpoint_count: str = "0"

    @_background
    async def load_watchpoints(self):
        """Fetch active watchpoints from Nous, grouped by symbol."""
        data = await asyncio.to_thread(self._fetch_watchpoints)
        async with self:
            self.watchpoint_groups = data["groups"]
            self.watchpoint_count = str(data["count"])

    @staticmethod
    def _fetch_watchpoints() -> dict:
        """Fetch watchpoints from Nous (sync, runs in thread).

        Returns WatchpointGroup list with pre-rendered HTML detail.
        """
        try:
            from hynous.nous.client import get_client
            import json as _json
            from html import escape

            client = get_client()
            nodes = client.list_nodes(subtype="custom:watchpoint", lifecycle="ACTIVE", limit=50)

            # Group by symbol
            by_symbol: dict[str, list[tuple[bool, str, str]]] = {}
            for n in nodes:
                body = _json.loads(n.get("content_body", "{}"))
                trigger = body.get("trigger", {})
                symbol = trigger.get("symbol", "?")
                condition = trigger.get("condition", "?")
                value = trigger.get("value", 0)
                title = n.get("content_title", "")

                # Format value
                if "price" in condition and value >= 1000:
                    val_str = f"${value:,.0f}"
                elif "price" in condition:
                    val_str = f"${value}"
                else:
                    val_str = str(value)

                # Short title: strip symbol/price prefix
                title_short = title
                for prefix in [f"{symbol} ${value:,.0f}", f"{symbol} ${value}", symbol]:
                    if title_short.startswith(prefix):
                        title_short = title_short[len(prefix):].lstrip(" —-")
                        break

                # Condition + direction
                is_up = "above" in condition or condition == "fear_greed_extreme"
                if condition == "fear_greed_extreme":
                    cond_label = f"F&G < {int(value)}"
                elif "above" in condition:
                    cond_label = f"above {val_str}"
                else:
                    cond_label = f"below {val_str}"

                by_symbol.setdefault(symbol, []).append(
                    (is_up, cond_label, title_short[:50])
                )

            # Build groups with pre-rendered HTML
            groups: list[WatchpointGroup] = []
            for sym in sorted(by_symbol.keys()):
                wp_items = by_symbol[sym]
                html_parts = []
                for is_up, cond, title in wp_items:
                    color = "#4ade80" if is_up else "#f87171"
                    bg = "rgba(74,222,128,0.05)" if is_up else "rgba(248,113,113,0.05)"
                    icon = "↗" if is_up else "↘"
                    title_html = (
                        f'<div style="font-size:0.72rem;color:#a3a3a3;padding-top:2px;line-height:1.4">'
                        f'{escape(title)}</div>'
                    ) if title else ""
                    html_parts.append(
                        f'<div style="padding:0.5rem 0.625rem;border-left:2px solid {color};'
                        f'background:{bg};border-radius:0 6px 6px 0;margin-bottom:0.375rem">'
                        f'<div style="display:flex;align-items:center;gap:0.375rem">'
                        f'<span style="color:{color};font-size:0.82rem">{icon}</span>'
                        f'<span style="font-size:0.78rem;font-weight:500;color:{color}">'
                        f'{escape(cond)}</span>'
                        f'</div>{title_html}</div>'
                    )
                groups.append(WatchpointGroup(
                    symbol=sym,
                    count=str(len(wp_items)),
                    detail_html="".join(html_parts),
                ))

            return {"groups": groups, "count": len(nodes)}
        except Exception:
            return {"groups": [], "count": 0}

    # === Clusters State ===

    cluster_displays: List[ClusterDisplay] = []
    cluster_total: str = "0"

    @_background
    async def load_clusters(self):
        """Fetch cluster data from Nous."""
        data = await asyncio.to_thread(self._fetch_clusters)
        async with self:
            self.cluster_displays = data["clusters"]
            self.cluster_total = str(data["total"])

    @staticmethod
    def _fetch_clusters() -> dict:
        """Fetch clusters with health info (sync, runs in thread)."""
        try:
            from hynous.nous.client import get_client
            from html import escape

            client = get_client()
            clusters = client.list_clusters()

            # Color map for known cluster names
            accent_map = {
                "BTC": "#f7931a",
                "ETH": "#627eea",
                "SOL": "#9945ff",
                "Thesis": "#60a5fa",
                "Theses": "#60a5fa",
                "Lessons": "#a3e635",
                "Trade History": "#f59e0b",
            }

            displays: list[ClusterDisplay] = []
            total_nodes = 0

            for cl in clusters:
                cid = cl.get("id", "")
                name = cl.get("name", "?")
                node_count = cl.get("node_count", 0)
                total_nodes += node_count
                accent = accent_map.get(name, "#a5b4fc")

                # Fetch health for this cluster
                health_html = ""
                try:
                    health = client.get_cluster_health(cid)
                    active = health.get("active_nodes", 0)
                    weak = health.get("weak_nodes", 0)
                    dormant = health.get("dormant_nodes", 0)
                    total = active + weak + dormant

                    if total > 0:
                        a_pct = round(active / total * 100)
                        w_pct = round(weak / total * 100)
                        d_pct = 100 - a_pct - w_pct

                        # Health bar
                        bar = (
                            f'<div style="display:flex;height:4px;border-radius:2px;overflow:hidden;'
                            f'background:#1a1a1a;margin-top:6px">'
                        )
                        if a_pct > 0:
                            bar += f'<div style="width:{a_pct}%;background:#22c55e"></div>'
                        if w_pct > 0:
                            bar += f'<div style="width:{w_pct}%;background:#eab308"></div>'
                        if d_pct > 0:
                            bar += f'<div style="width:{d_pct}%;background:#404040"></div>'
                        bar += '</div>'

                        # Labels
                        labels = []
                        if active:
                            labels.append(f'<span style="color:#22c55e">{active} active</span>')
                        if weak:
                            labels.append(f'<span style="color:#eab308">{weak} weak</span>')
                        if dormant:
                            labels.append(f'<span style="color:#525252">{dormant} dormant</span>')
                        label_row = (
                            f'<div style="display:flex;gap:8px;font-size:0.65rem;margin-top:4px">'
                            f'{" ".join(labels)}</div>'
                        )
                        health_html = bar + label_row
                    else:
                        health_html = (
                            '<div style="font-size:0.65rem;color:#404040;margin-top:6px">'
                            'Empty cluster</div>'
                        )
                except Exception:
                    health_html = ""

                displays.append(ClusterDisplay(
                    name=name,
                    node_count=str(node_count),
                    health_html=health_html,
                    accent=accent,
                ))

            return {"clusters": displays, "total": total_nodes}
        except Exception:
            return {"clusters": [], "total": 0}

    # === Scanner Banner State ===

    scanner_active: bool = False
    scanner_warming_up: bool = False
    scanner_price_polls: int = 0
    scanner_deriv_polls: int = 0
    scanner_pairs_count: int = 0
    scanner_anomalies_total: int = 0
    scanner_wakes_total: int = 0
    scanner_recent: list[dict] = []
    scanner_expanded: bool = False
    scanner_news: list[dict] = []  # Recent news headlines from CryptoCompare

    def toggle_scanner_expanded(self):
        """Toggle scanner detail panel."""
        self.scanner_expanded = not self.scanner_expanded

    @staticmethod
    def _fetch_scanner_status() -> dict:
        """Read scanner status from daemon (sync, thread-safe)."""
        try:
            if _daemon is not None and _daemon._scanner is not None:
                return _daemon._scanner.get_status()
        except Exception:
            pass
        return {
            "active": False, "warming_up": False,
            "price_polls": 0, "deriv_polls": 0,
            "pairs_count": 0, "anomalies_detected": 0,
            "wakes_triggered": 0, "recent": [], "news": [],
        }

    # === Memory Management State ===

    memory_node_count: str = "0"
    memory_edge_count: str = "0"
    memory_health_ratio: str = "0%"
    memory_lifecycle_html: str = ""

    conflict_items: List[ConflictItem] = []
    conflict_count: str = "0"
    show_conflicts: bool = False

    stale_html: str = ""  # Pre-rendered dormant node list
    stale_count: str = "0"
    stale_filter: str = "DORMANT"
    show_stale: bool = False

    decay_running: bool = False
    decay_result: str = ""

    backfill_running: bool = False
    backfill_result: str = ""

    cluster_backfill_running: bool = False
    cluster_backfill_result: str = ""

    @_background
    async def load_memory_page(self):
        """Load all memory management data."""
        async with self:
            lifecycle = self.stale_filter
        health, conflicts, stale, clusters = await asyncio.to_thread(
            self._fetch_memory_page_data, lifecycle
        )
        async with self:
            self.memory_node_count = health["node_count"]
            self.memory_edge_count = health["edge_count"]
            self.memory_health_ratio = health["health_ratio"]
            self.memory_lifecycle_html = health["lifecycle_html"]
            self.conflict_items = conflicts["items"]
            self.conflict_count = conflicts["count"]
            self.stale_html = stale["html"]
            self.stale_count = stale["count"]
            self.cluster_displays = clusters["clusters"]
            self.cluster_total = str(clusters["total"])

    @staticmethod
    def _fetch_memory_page_data(lifecycle: str = "DORMANT") -> tuple:
        """Fetch all memory page data in one thread."""
        health = AppState._fetch_memory_health()
        conflicts = AppState._fetch_conflicts()
        stale = AppState._fetch_stale(lifecycle)
        clusters = AppState._fetch_clusters()
        return health, conflicts, stale, clusters

    @staticmethod
    def _fetch_memory_health() -> dict:
        """Fetch overall memory health from Nous."""
        try:
            from hynous.nous.client import get_client
            client = get_client()
            h = client.health()

            total_nodes = h.get("node_count", 0)
            edges = h.get("edge_count", 0)
            lifecycle = h.get("lifecycle", {})
            active = lifecycle.get("ACTIVE", 0)
            weak = lifecycle.get("WEAK", 0)
            dormant = lifecycle.get("DORMANT", 0)
            total = active + weak + dormant
            ratio = round(active / total * 100) if total > 0 else 0

            # Show active+weak as headline count (dormant are archived/hidden)
            live_nodes = active + weak

            # Pre-render lifecycle bar
            if total > 0:
                a_pct = round(active / total * 100)
                w_pct = round(weak / total * 100)
                d_pct = 100 - a_pct - w_pct

                bar = (
                    '<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;'
                    'background:#1a1a1a;margin:8px 0 10px 0;width:100%">'
                )
                if a_pct > 0:
                    bar += f'<div style="width:{a_pct}%;background:#22c55e"></div>'
                if w_pct > 0:
                    bar += f'<div style="width:{w_pct}%;background:#eab308"></div>'
                if d_pct > 0:
                    bar += f'<div style="width:{d_pct}%;background:#404040"></div>'
                bar += '</div>'

                labels = (
                    f'<div style="display:flex;gap:12px;font-size:0.68rem;flex-wrap:wrap">'
                    f'<span style="color:#22c55e;white-space:nowrap">{active} active</span>'
                    f'<span style="color:#eab308;white-space:nowrap">{weak} weak</span>'
                    f'<span style="color:#525252;white-space:nowrap">{dormant} archived</span>'
                    f'</div>'
                )
                lifecycle_html = bar + labels
            else:
                lifecycle_html = '<div style="color:#404040;font-size:0.7rem">No memories yet</div>'

            return {
                "node_count": str(live_nodes),
                "edge_count": str(edges),
                "health_ratio": f"{ratio}%",
                "lifecycle_html": lifecycle_html,
            }
        except Exception:
            return {"node_count": "0", "edge_count": "0", "health_ratio": "0%", "lifecycle_html": ""}

    @staticmethod
    def _fetch_conflicts() -> dict:
        """Fetch pending conflicts as structured ConflictItem list."""
        try:
            from hynous.nous.client import get_client
            client = get_client()
            conflicts = client.get_conflicts(status="pending")

            if not conflicts:
                return {"items": [], "count": "0"}

            items = []
            for c in conflicts[:100]:  # Cap at 100
                cid = c.get("id", "?")
                old_id = c.get("old_node_id", "?")
                new_id = c.get("new_node_id")
                new_content = c.get("new_content", "")
                confidence = c.get("detection_confidence", 0)
                ctype = c.get("conflict_type", "?")

                # Fetch old node
                old_title, old_body = old_id, ""
                try:
                    old_node = client.get_node(old_id)
                    if old_node:
                        old_title = old_node.get("content_title", old_id)
                        old_body = (old_node.get("content_body", "") or "")[:200]
                except Exception:
                    pass

                # Fetch new node
                new_title, new_body = "", ""
                if new_id:
                    try:
                        new_node = client.get_node(new_id)
                        if new_node:
                            new_title = new_node.get("content_title", "")
                            new_body = (new_node.get("content_body", "") or "")[:200]
                    except Exception:
                        pass

                conf_pct = f"{confidence:.0%}" if isinstance(confidence, float) else str(confidence)

                items.append(ConflictItem(
                    conflict_id=cid,
                    conflict_type=ctype,
                    confidence=conf_pct,
                    old_title=old_title,
                    old_body=old_body,
                    new_title=new_title or new_content[:80],
                    new_body=new_body or new_content[:200],
                ))

            return {"items": items, "count": str(len(conflicts))}
        except Exception:
            return {"items": [], "count": "0"}

    @staticmethod
    def _fetch_stale(lifecycle: str = "DORMANT") -> dict:
        """Fetch memories by lifecycle with pre-rendered HTML."""
        try:
            from hynous.nous.client import get_client
            from html import escape
            from datetime import datetime, timezone
            client = get_client()
            nodes = client.list_nodes(lifecycle=lifecycle, limit=30)

            if not nodes:
                return {"html": "", "count": "0"}

            now = datetime.now(timezone.utc)
            parts = []
            for n in nodes:
                nid = n.get("id", "?")
                title = n.get("content_title", "Untitled")
                subtype = (n.get("content_subtype", "") or "").replace("custom:", "")
                created = n.get("created_at", "")
                retrievability = n.get("neural_retrievability", 0)
                retr_pct = f"{retrievability:.0%}" if isinstance(retrievability, float) else "?"

                # Compute age
                days_old = "?"
                try:
                    ct = datetime.fromisoformat(created.replace("Z", "+00:00"))
                    days_old = f"{(now - ct).days}d"
                except Exception:
                    pass

                parts.append(
                    f'<div style="display:flex;align-items:center;gap:0.75rem;padding:0.625rem 0;'
                    f'border-bottom:1px solid #1a1a1a" data-nid="{escape(nid)}">'
                    f'<div style="flex:1;min-width:0">'
                    f'<div style="color:#fafafa;font-size:0.78rem;font-weight:500;'
                    f'overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{escape(title)}</div>'
                    f'<div style="display:flex;gap:0.5rem;font-size:0.65rem;margin-top:2px">'
                    f'<span style="color:#525252">{escape(subtype)}</span>'
                    f'<span style="color:#404040">{days_old} old</span>'
                    f'<span style="color:#404040">recall: {retr_pct}</span></div></div></div>'
                )

            return {"html": "".join(parts), "count": str(len(nodes))}
        except Exception:
            return {"html": "", "count": "0"}

    @_background
    async def run_decay(self):
        """Run FSRS decay cycle."""
        async with self:
            self.decay_running = True
            self.decay_result = ""
        try:
            result = await asyncio.to_thread(self._exec_decay)
            # Refresh health after decay
            health = await asyncio.to_thread(self._fetch_memory_health)
            async with self:
                self.decay_result = result
                self.decay_running = False
                self.memory_node_count = health["node_count"]
                self.memory_edge_count = health["edge_count"]
                self.memory_health_ratio = health["health_ratio"]
                self.memory_lifecycle_html = health["lifecycle_html"]
        except Exception as e:
            async with self:
                self.decay_result = f"Error: {e}"
                self.decay_running = False

    @staticmethod
    def _exec_decay() -> str:
        from hynous.nous.client import get_client
        client = get_client()
        result = client.run_decay()
        transitioned = result.get("transitioned", 0)
        processed = result.get("processed", 0)
        return f"Processed {processed} nodes, {transitioned} transitioned"

    @_background
    async def run_backfill(self):
        """Run embedding backfill."""
        async with self:
            self.backfill_running = True
            self.backfill_result = ""
        try:
            result = await asyncio.to_thread(self._exec_backfill)
            async with self:
                self.backfill_result = result
                self.backfill_running = False
        except Exception as e:
            async with self:
                self.backfill_result = f"Error: {e}"
                self.backfill_running = False

    @staticmethod
    def _exec_backfill() -> str:
        from hynous.nous.client import get_client
        client = get_client()
        result = client.backfill_embeddings()
        embedded = result.get("embedded", 0)
        total = result.get("total", 0)
        return f"Embedded {embedded}/{total} nodes"

    @_background
    async def run_cluster_backfill(self):
        """Retroactively assign all existing nodes to matching clusters."""
        async with self:
            self.cluster_backfill_running = True
            self.cluster_backfill_result = ""
        try:
            result = await asyncio.to_thread(self._exec_cluster_backfill)
            clusters = await asyncio.to_thread(self._fetch_clusters)
            async with self:
                self.cluster_backfill_result = result
                self.cluster_backfill_running = False
                self.cluster_displays = clusters["clusters"]
                self.cluster_total = str(clusters["total"])
        except Exception as e:
            async with self:
                self.cluster_backfill_result = f"Error: {e}"
                self.cluster_backfill_running = False

    @staticmethod
    def _exec_cluster_backfill() -> str:
        """Scan all ACTIVE nodes and assign to matching clusters."""
        import re as _re
        import json as _json
        from hynous.nous.client import get_client

        client = get_client()
        clusters = client.list_clusters()
        if not clusters:
            return "No clusters to backfill"

        nodes = client.list_nodes(lifecycle="ACTIVE", limit=500)
        if not nodes:
            return "No active nodes"

        assigned = 0
        for node in nodes:
            nid = node.get("id")
            subtype = node.get("subtype", "") or node.get("content_subtype", "")
            title = node.get("content_title", "")
            body = node.get("content_body", "")
            # Extract text from JSON body
            if body and body.startswith("{"):
                try:
                    body = _json.loads(body).get("text", body)
                except Exception:
                    pass
            text_upper = f"{title} {body}".upper()

            for cl in clusters:
                cid = cl.get("id")
                if not cid:
                    continue
                matched = False

                # Strategy 1: Subtype match
                auto_subs = cl.get("auto_subtypes")
                if auto_subs:
                    if isinstance(auto_subs, str):
                        try:
                            auto_subs = _json.loads(auto_subs)
                        except Exception:
                            auto_subs = None
                    if isinstance(auto_subs, list) and subtype in auto_subs:
                        matched = True

                # Strategy 2: Keyword match (cluster name in content)
                if not matched:
                    cluster_name = (cl.get("name") or "").upper()
                    if cluster_name and len(cluster_name) >= 2:
                        pattern = r'(?<![A-Z])' + _re.escape(cluster_name) + r'(?![A-Z])'
                        if _re.search(pattern, text_upper):
                            matched = True

                if matched:
                    try:
                        client.add_to_cluster(cid, node_id=nid)
                        assigned += 1
                    except Exception:
                        pass

        return f"Scanned {len(nodes)} nodes, {assigned} assignments made"

    @_background
    async def resolve_all_conflicts(self):
        """Batch resolve all pending conflicts as new_is_current."""
        try:
            result = await asyncio.to_thread(self._exec_batch_resolve, "new_is_current")
            # Refresh conflicts
            conflicts = await asyncio.to_thread(self._fetch_conflicts)
            health = await asyncio.to_thread(self._fetch_memory_health)
            async with self:
                self.conflict_items = conflicts["items"]
                self.conflict_count = conflicts["count"]
                self.memory_node_count = health["node_count"]
                self.memory_health_ratio = health["health_ratio"]
                self.memory_lifecycle_html = health["lifecycle_html"]
        except Exception:
            pass

    @_background
    async def resolve_all_keep_both(self):
        """Batch resolve all pending conflicts as keep_both."""
        try:
            result = await asyncio.to_thread(self._exec_batch_resolve, "keep_both")
            conflicts = await asyncio.to_thread(self._fetch_conflicts)
            async with self:
                self.conflict_items = conflicts["items"]
                self.conflict_count = conflicts["count"]
        except Exception:
            pass

    @staticmethod
    def _exec_batch_resolve(resolution: str) -> dict:
        from hynous.nous.client import get_client
        client = get_client()
        conflicts = client.get_conflicts(status="pending")
        if not conflicts:
            return {"resolved": 0}
        items = [{"conflict_id": c["id"], "resolution": resolution} for c in conflicts]
        return client.batch_resolve_conflicts(items)

    @_background
    async def bulk_archive_stale(self):
        """Archive all dormant memories."""
        try:
            await asyncio.to_thread(self._exec_bulk_archive)
            async with self:
                lifecycle = self.stale_filter
            stale = await asyncio.to_thread(self._fetch_stale, lifecycle)
            health = await asyncio.to_thread(self._fetch_memory_health)
            async with self:
                self.stale_html = stale["html"]
                self.stale_count = stale["count"]
                self.memory_node_count = health["node_count"]
                self.memory_health_ratio = health["health_ratio"]
                self.memory_lifecycle_html = health["lifecycle_html"]
        except Exception:
            pass

    @staticmethod
    def _exec_bulk_archive():
        from hynous.nous.client import get_client
        client = get_client()
        nodes = client.list_nodes(lifecycle="DORMANT", limit=100)
        archived = 0
        for n in nodes:
            try:
                client.update_node(n["id"], state_lifecycle="ARCHIVE")
                archived += 1
            except Exception:
                pass
        logger.info("Bulk archive: %d/%d dormant nodes archived", archived, len(nodes))

    def set_stale_filter(self, val: str):
        """Update stale lifecycle filter and refresh."""
        self.stale_filter = val
        return AppState.load_stale_filtered

    @_background
    async def load_stale_filtered(self):
        """Re-fetch stale nodes with current filter."""
        async with self:
            lifecycle = self.stale_filter
        stale = await asyncio.to_thread(self._fetch_stale, lifecycle)
        async with self:
            self.stale_html = stale["html"]
            self.stale_count = stale["count"]

    def toggle_conflicts(self):
        """Toggle conflicts dialog."""
        self.show_conflicts = not self.show_conflicts

    def toggle_stale(self):
        """Toggle stale memories dialog."""
        self.show_stale = not self.show_stale

    def resolve_one_conflict(self, conflict_id: str, resolution: str):
        """Resolve a single conflict and refresh."""
        return AppState._exec_resolve_one(conflict_id, resolution)

    @_background
    async def _exec_resolve_one(self, conflict_id: str, resolution: str):
        """Background: resolve one conflict, refresh list."""
        try:
            await asyncio.to_thread(self._do_resolve_one, conflict_id, resolution)
            conflicts = await asyncio.to_thread(self._fetch_conflicts)
            health = await asyncio.to_thread(self._fetch_memory_health)
            async with self:
                self.conflict_items = conflicts["items"]
                self.conflict_count = conflicts["count"]
                self.memory_node_count = health["node_count"]
                self.memory_health_ratio = health["health_ratio"]
                self.memory_lifecycle_html = health["lifecycle_html"]
        except Exception:
            pass

    @staticmethod
    def _do_resolve_one(conflict_id: str, resolution: str):
        from hynous.nous.client import get_client
        client = get_client()
        client.resolve_conflict(conflict_id, resolution)

    # === Journal State ===

    journal_win_rate: str = "—"
    journal_total_pnl: str = "—"        # Real PnL from exchange (account - initial)
    journal_recorded_pnl: str = "—"     # PnL sum from recorded trades in Nous
    journal_profit_factor: str = "—"
    journal_total_trades: str = "0"
    journal_fee_losses: str = "0"
    journal_fee_heavy_count:  str = "0"
    journal_total_fees:       str = "—"
    journal_pnl_mode:         str = "pct"   # "pct" = ROE %, "usd" = dollar amount
    journal_current_streak: str = "—"
    journal_max_win_streak: str = "0"
    journal_max_loss_streak: str = "0"
    journal_avg_duration: str = "—"
    equity_days: int = 30
    closed_trades: List[ClosedTrade] = []
    symbol_breakdown: list[dict] = []

    # Regret tab
    journal_tab: str = "trades"
    regret_missed_count: str = "0"
    regret_good_pass_count: str = "0"
    regret_miss_rate: str = "—"
    regret_miss_rate_high: bool = False  # True if miss rate >= 50%
    regret_phantoms: list[PhantomRecord] = []
    regret_playbooks: list[PlaybookRecord] = []
    journal_expanded_trades: list[str] = []
    journal_expanded_phantoms: list[str] = []
    journal_show_all_trades: bool = False
    journal_show_all_phantoms: bool = False

    def set_journal_tab(self, tab: str):
        self.journal_tab = tab

    def set_journal_pnl_mode(self, mode: str):
        self.journal_pnl_mode = mode

    # Memory page tab
    memory_tab: str = "graph"       # "graph" | "sections"

    def set_memory_tab(self, tab: str):
        self.memory_tab = tab

    def toggle_trade_detail(self, trade_id: str):
        """Toggle expand/collapse for a trade row."""
        if trade_id in self.journal_expanded_trades:
            self.journal_expanded_trades = [t for t in self.journal_expanded_trades if t != trade_id]
        else:
            self.journal_expanded_trades = self.journal_expanded_trades + [trade_id]

    def toggle_phantom_detail(self, phantom_id: str):
        """Toggle expand/collapse for a phantom row."""
        if phantom_id in self.journal_expanded_phantoms:
            self.journal_expanded_phantoms = [p for p in self.journal_expanded_phantoms if p != phantom_id]
        else:
            self.journal_expanded_phantoms = self.journal_expanded_phantoms + [phantom_id]

    def toggle_show_all_trades(self):
        self.journal_show_all_trades = not self.journal_show_all_trades

    def toggle_show_all_phantoms(self):
        self.journal_show_all_phantoms = not self.journal_show_all_phantoms

    @_background
    async def set_equity_days(self, days: str):
        """Update equity chart timeframe — fetch in background to avoid blocking UI."""
        async with self:
            self.equity_days = int(days)
        equity_data = await asyncio.to_thread(AppState._fetch_equity_data, int(days))
        async with self:
            self.journal_equity_data = equity_data

    def go_to_journal(self):
        """Navigate to journal page and load data."""
        self.current_page = "journal"
        self.journal_unread = False
        return AppState.load_journal

    def go_to_debug(self):
        """Navigate to the debug page."""
        self.current_page = "debug"
        return AppState.load_debug_traces

    def go_to_settings(self):
        """Navigate to settings page and load current values."""
        self.current_page = "settings"
        self._load_settings_state()

    def _load_settings_state(self):
        """Load current TradingSettings into state fields."""
        from hynous.core.trading_settings import get_trading_settings
        ts = get_trading_settings()
        self.settings_macro_sl_min = ts.macro_sl_min_pct
        self.settings_macro_sl_max = ts.macro_sl_max_pct
        self.settings_macro_tp_min = ts.macro_tp_min_pct
        self.settings_macro_tp_max = ts.macro_tp_max_pct
        self.settings_macro_lev_min = ts.macro_leverage_min
        self.settings_macro_lev_max = ts.macro_leverage_max
        self.settings_micro_sl_min = ts.micro_sl_min_pct
        self.settings_micro_sl_warn = ts.micro_sl_warn_pct
        self.settings_micro_sl_max = ts.micro_sl_max_pct
        self.settings_micro_tp_min = ts.micro_tp_min_pct
        self.settings_micro_tp_max = ts.micro_tp_max_pct
        self.settings_micro_leverage = ts.micro_leverage
        self.settings_rr_floor_reject = ts.rr_floor_reject
        self.settings_rr_floor_warn = ts.rr_floor_warn
        self.settings_risk_cap_reject = ts.portfolio_risk_cap_reject
        self.settings_risk_cap_warn = ts.portfolio_risk_cap_warn
        self.settings_roe_reject = ts.roe_at_stop_reject
        self.settings_roe_warn = ts.roe_at_stop_warn
        self.settings_roe_target = ts.roe_target
        self.settings_tier_high = ts.tier_high_margin_pct
        self.settings_tier_medium = ts.tier_medium_margin_pct
        self.settings_tier_speculative = ts.tier_speculative_margin_pct
        self.settings_tier_pass = ts.tier_pass_threshold
        self.settings_max_position = ts.max_position_usd
        self.settings_max_positions = ts.max_open_positions
        self.settings_max_daily_loss = ts.max_daily_loss_usd
        self.settings_scanner_threshold = ts.scanner_wake_threshold
        self.settings_scanner_micro = ts.scanner_micro_enabled
        self.settings_scanner_max_wakes = ts.scanner_max_wakes_per_cycle
        self.settings_scanner_news = ts.scanner_news_enabled
        self.settings_sm_copy_alerts = ts.sm_copy_alerts
        self.settings_sm_exit_alerts = ts.sm_exit_alerts
        self.settings_sm_min_win_rate = ts.sm_min_win_rate
        self.settings_sm_min_size = ts.sm_min_size
        self.settings_sm_auto_curate = ts.sm_auto_curate
        self.settings_sm_auto_min_wr = ts.sm_auto_min_wr
        self.settings_sm_auto_min_trades = ts.sm_auto_min_trades
        self.settings_sm_auto_min_pf = ts.sm_auto_min_pf
        self.settings_sm_auto_max_wallets = ts.sm_auto_max_wallets
        self.settings_small_wins_mode = ts.small_wins_mode
        self.settings_small_wins_roe_pct = ts.small_wins_roe_pct
        self.settings_taker_fee_pct = ts.taker_fee_pct
        self.settings_dirty = False

    def save_settings(self):
        """Build TradingSettings from state, save, and apply."""
        from hynous.core.trading_settings import TradingSettings, save_trading_settings
        ts = TradingSettings(
            macro_sl_min_pct=self.settings_macro_sl_min,
            macro_sl_max_pct=self.settings_macro_sl_max,
            macro_tp_min_pct=self.settings_macro_tp_min,
            macro_tp_max_pct=self.settings_macro_tp_max,
            macro_leverage_min=self.settings_macro_lev_min,
            macro_leverage_max=self.settings_macro_lev_max,
            micro_sl_min_pct=self.settings_micro_sl_min,
            micro_sl_warn_pct=self.settings_micro_sl_warn,
            micro_sl_max_pct=self.settings_micro_sl_max,
            micro_tp_min_pct=self.settings_micro_tp_min,
            micro_tp_max_pct=self.settings_micro_tp_max,
            micro_leverage=self.settings_micro_leverage,
            rr_floor_reject=self.settings_rr_floor_reject,
            rr_floor_warn=self.settings_rr_floor_warn,
            portfolio_risk_cap_reject=self.settings_risk_cap_reject,
            portfolio_risk_cap_warn=self.settings_risk_cap_warn,
            roe_at_stop_reject=self.settings_roe_reject,
            roe_at_stop_warn=self.settings_roe_warn,
            roe_target=self.settings_roe_target,
            tier_high_margin_pct=self.settings_tier_high,
            tier_medium_margin_pct=self.settings_tier_medium,
            tier_speculative_margin_pct=self.settings_tier_speculative,
            tier_pass_threshold=self.settings_tier_pass,
            max_position_usd=self.settings_max_position,
            max_open_positions=self.settings_max_positions,
            max_daily_loss_usd=self.settings_max_daily_loss,
            scanner_wake_threshold=self.settings_scanner_threshold,
            scanner_micro_enabled=self.settings_scanner_micro,
            scanner_max_wakes_per_cycle=self.settings_scanner_max_wakes,
            scanner_news_enabled=self.settings_scanner_news,
            sm_copy_alerts=self.settings_sm_copy_alerts,
            sm_exit_alerts=self.settings_sm_exit_alerts,
            sm_min_win_rate=self.settings_sm_min_win_rate,
            sm_min_size=self.settings_sm_min_size,
            sm_auto_curate=self.settings_sm_auto_curate,
            sm_auto_min_wr=self.settings_sm_auto_min_wr,
            sm_auto_min_trades=self.settings_sm_auto_min_trades,
            sm_auto_min_pf=self.settings_sm_auto_min_pf,
            sm_auto_max_wallets=self.settings_sm_auto_max_wallets,
            small_wins_mode=self.settings_small_wins_mode,
            small_wins_roe_pct=self.settings_small_wins_roe_pct,
            taker_fee_pct=self.settings_taker_fee_pct,
        )
        save_trading_settings(ts)
        _apply_trading_settings(ts)
        self.settings_dirty = False

    def reset_settings(self):
        """Reset all settings to defaults."""
        from hynous.core.trading_settings import reset_trading_settings
        ts = reset_trading_settings()
        _apply_trading_settings(ts)
        self._load_settings_state()

    # --- Per-field setters (mark dirty) ---
    def set_settings_macro_sl_min(self, v: str):
        self.settings_macro_sl_min = float(v); self.settings_dirty = True
    def set_settings_macro_sl_max(self, v: str):
        self.settings_macro_sl_max = float(v); self.settings_dirty = True
    def set_settings_macro_tp_min(self, v: str):
        self.settings_macro_tp_min = float(v); self.settings_dirty = True
    def set_settings_macro_tp_max(self, v: str):
        self.settings_macro_tp_max = float(v); self.settings_dirty = True
    def set_settings_macro_lev_min(self, v: str):
        self.settings_macro_lev_min = int(float(v)); self.settings_dirty = True
    def set_settings_macro_lev_max(self, v: str):
        self.settings_macro_lev_max = int(float(v)); self.settings_dirty = True
    def set_settings_micro_sl_min(self, v: str):
        self.settings_micro_sl_min = float(v); self.settings_dirty = True
    def set_settings_micro_sl_warn(self, v: str):
        self.settings_micro_sl_warn = float(v); self.settings_dirty = True
    def set_settings_micro_sl_max(self, v: str):
        self.settings_micro_sl_max = float(v); self.settings_dirty = True
    def set_settings_micro_tp_min(self, v: str):
        self.settings_micro_tp_min = float(v); self.settings_dirty = True
    def set_settings_micro_tp_max(self, v: str):
        self.settings_micro_tp_max = float(v); self.settings_dirty = True
    def set_settings_micro_leverage(self, v: str):
        self.settings_micro_leverage = int(float(v)); self.settings_dirty = True
    def set_settings_rr_floor_reject(self, v: str):
        self.settings_rr_floor_reject = float(v); self.settings_dirty = True
    def set_settings_rr_floor_warn(self, v: str):
        self.settings_rr_floor_warn = float(v); self.settings_dirty = True
    def set_settings_risk_cap_reject(self, v: str):
        self.settings_risk_cap_reject = float(v); self.settings_dirty = True
    def set_settings_risk_cap_warn(self, v: str):
        self.settings_risk_cap_warn = float(v); self.settings_dirty = True
    def set_settings_roe_reject(self, v: str):
        self.settings_roe_reject = float(v); self.settings_dirty = True
    def set_settings_roe_warn(self, v: str):
        self.settings_roe_warn = float(v); self.settings_dirty = True
    def set_settings_roe_target(self, v: str):
        self.settings_roe_target = float(v); self.settings_dirty = True
    def set_settings_tier_high(self, v: str):
        self.settings_tier_high = int(float(v)); self.settings_dirty = True
    def set_settings_tier_medium(self, v: str):
        self.settings_tier_medium = int(float(v)); self.settings_dirty = True
    def set_settings_tier_speculative(self, v: str):
        self.settings_tier_speculative = int(float(v)); self.settings_dirty = True
    def set_settings_tier_pass(self, v: str):
        self.settings_tier_pass = float(v); self.settings_dirty = True
    def set_settings_max_position(self, v: str):
        self.settings_max_position = float(v); self.settings_dirty = True
    def set_settings_max_positions(self, v: str):
        self.settings_max_positions = int(float(v)); self.settings_dirty = True
    def set_settings_max_daily_loss(self, v: str):
        self.settings_max_daily_loss = float(v); self.settings_dirty = True
    def set_settings_scanner_threshold(self, v: str):
        self.settings_scanner_threshold = float(v); self.settings_dirty = True
    def set_settings_scanner_micro(self, v: bool):
        self.settings_scanner_micro = v; self.settings_dirty = True
    def set_settings_scanner_max_wakes(self, v: str):
        self.settings_scanner_max_wakes = int(float(v)); self.settings_dirty = True
    def set_settings_scanner_news(self, v: bool):
        self.settings_scanner_news = v; self.settings_dirty = True
    def set_settings_sm_copy_alerts(self, v: bool):
        self.settings_sm_copy_alerts = v; self.settings_dirty = True
    def set_settings_sm_exit_alerts(self, v: bool):
        self.settings_sm_exit_alerts = v; self.settings_dirty = True
    def set_settings_sm_min_win_rate(self, v: str):
        self.settings_sm_min_win_rate = float(v); self.settings_dirty = True
    def set_settings_sm_min_size(self, v: str):
        self.settings_sm_min_size = float(v); self.settings_dirty = True
    def set_settings_sm_auto_curate(self, v: bool):
        self.settings_sm_auto_curate = v; self.settings_dirty = True
    def set_settings_sm_auto_min_wr(self, v: str):
        self.settings_sm_auto_min_wr = float(v); self.settings_dirty = True
    def set_settings_sm_auto_min_trades(self, v: str):
        self.settings_sm_auto_min_trades = int(float(v)); self.settings_dirty = True
    def set_settings_sm_auto_min_pf(self, v: str):
        self.settings_sm_auto_min_pf = float(v); self.settings_dirty = True
    def set_settings_sm_auto_max_wallets(self, v: str):
        self.settings_sm_auto_max_wallets = int(float(v)); self.settings_dirty = True
    def set_settings_small_wins_mode(self, v: bool):
        self.settings_small_wins_mode = v; self.settings_dirty = True
    def set_settings_small_wins_roe_pct(self, v: str):
        self.settings_small_wins_roe_pct = float(v); self.settings_dirty = True
    def set_settings_taker_fee_pct(self, v: str):
        self.settings_taker_fee_pct = float(v); self.settings_dirty = True

    def load_debug_traces(self):
        """Load recent traces for the debug sidebar."""
        try:
            from hynous.core.request_tracer import get_tracer
            tracer = get_tracer()
            self.debug_traces = tracer.get_recent_traces(limit=50)
        except Exception as e:
            logger.error("Failed to load debug traces: %s", e)
            self.debug_traces = []

    def select_debug_trace(self, trace_id: str):
        """Select a trace to view in detail."""
        self.debug_selected_trace_id = trace_id
        self.debug_expanded_spans = []
        try:
            from hynous.core.request_tracer import get_tracer
            trace = get_tracer().get_trace(trace_id)
            if trace:
                self.debug_selected_trace = trace
            else:
                self.debug_selected_trace = {}
        except Exception as e:
            logger.error("Failed to load trace %s: %s", trace_id, e)
            self.debug_selected_trace = {}

    def toggle_debug_span(self, span_id: str):
        """Toggle expansion of a span in the trace detail view."""
        if span_id in self.debug_expanded_spans:
            self.debug_expanded_spans = [s for s in self.debug_expanded_spans if s != span_id]
        else:
            self.debug_expanded_spans = self.debug_expanded_spans + [span_id]

    def set_debug_filter_source(self, value: str):
        """Set the source filter for debug traces."""
        self.debug_filter_source = value
        return AppState.load_debug_traces

    def set_debug_filter_status(self, value: str):
        """Set the status filter for debug traces."""
        self.debug_filter_status = value
        return AppState.load_debug_traces

    def refresh_debug_traces(self):
        """Refresh the trace list (called by manual refresh or polling)."""
        return AppState.load_debug_traces

    def load_debug_payload(self, payload_hash: str) -> str:
        """Load a content-addressed payload for display."""
        try:
            from hynous.core.trace_log import load_payload
            content = load_payload(payload_hash)
            return content or "(payload not found)"
        except Exception:
            return "(error loading payload)"

    @rx.var
    def debug_spans_display(self) -> list[dict]:
        """Prepare spans for display with pre-computed fields.

        This computed var is CRITICAL for Reflex compatibility:
        - rx.foreach only accepts single-argument lambdas (no index)
        - Python dict lookups don't work on reactive rx.Var values
        - We solve both by pre-processing spans server-side here

        IMPORTANT: This method also resolves all *_hash payload references
        to their actual content. Spans store large content (LLM messages,
        responses, injected context) via content-addressed hashes on disk.
        Here we load those payloads so the UI shows actual text, not hashes.

        Each span dict gets extra keys:
        - "span_id": unique identifier for expand/collapse
        - "label": display label ("LLM Call", "Tool", etc.)
        - "color": hex color for the badge/border
        - "summary": one-line description
        - "detail_json": formatted JSON string for expanded view (with resolved content)
        - "is_error": bool for error indicator
        """
        import json as _json
        spans = self.debug_selected_trace.get("spans", [])
        result = []

        # Lazy-load payload resolver (only import if we have spans)
        _load_payload = None
        if spans:
            try:
                from hynous.core.trace_log import load_payload
                _load_payload = load_payload
            except Exception:
                pass

        for i, span in enumerate(spans):
            span_type = span.get("type", "unknown")

            # Map span type -> label + color
            label_map = {
                "context": ("Context", "#818cf8"),
                "retrieval": ("Retrieval", "#34d399"),
                "llm_call": ("LLM Call", "#f59e0b"),
                "tool_execution": ("Tool", "#60a5fa"),
                "memory_op": ("Memory", "#a78bfa"),
                "compression": ("Compress", "#fb923c"),
                "queue_flush": ("Queue", "#94a3b8"),
                "trade_step": ("Trade", "#f472b6"),
            }
            label, color = label_map.get(span_type, (span_type, "#525252"))

            # Build summary based on span type
            if span_type == "llm_call":
                tokens = span.get("input_tokens", 0) + span.get("output_tokens", 0)
                model = span.get("model", "?")
                if tokens:
                    summary = f"{model} — {tokens} tok"
                else:
                    summary = f"{model} — streamed"
            elif span_type == "tool_execution":
                summary = span.get("tool_name", "")
            elif span_type == "retrieval":
                q = span.get("query", "")
                n = span.get("results_count", 0)
                summary = f'"{q[:50]}" → {n} results' if q else ""
            elif span_type == "memory_op":
                summary = f"{span.get('operation', '')}: {span.get('title', '')}"
            elif span_type == "context":
                parts = []
                if span.get("has_briefing"):
                    parts.append("briefing")
                if span.get("has_snapshot"):
                    parts.append("snapshot")
                summary = "Injected: " + ", ".join(parts) if parts else "Context injection"
            elif span_type == "compression":
                summary = f"{span.get('exchanges_evicted', 0)} exchanges evicted"
            elif span_type == "queue_flush":
                summary = f"{span.get('items_count', 0)} items"
            elif span_type == "trade_step":
                _step = span.get("step", "")
                _tool = span.get("trade_tool", "")
                _detail = span.get("detail", "")
                _ok = span.get("success", True)
                summary = f"{'[FAIL] ' if not _ok else ''}{_step}: {_detail}" if _detail else _step
            else:
                summary = ""

            # ---- Resolve payload hashes to actual content ----
            resolved = dict(span)
            if _load_payload:
                for key in list(resolved.keys()):
                    if key.endswith("_hash"):
                        try:
                            content = _load_payload(resolved[key])
                            if content is not None:
                                content_key = key.replace("_hash", "_content")
                                try:
                                    resolved[content_key] = _json.loads(content)
                                except (ValueError, TypeError):
                                    resolved[content_key] = content
                                del resolved[key]
                        except Exception:
                            pass  # Keep the hash if loading fails

            # JSON detail for expanded view (now with resolved content)
            try:
                detail = _json.dumps(resolved, indent=2, default=str)
            except Exception:
                detail = str(resolved)

            result.append({
                "span_id": f"span-{i}",
                "type": span_type,
                "label": label,
                "color": color,
                "summary": summary,
                "duration_ms": span.get("duration_ms", 0),
                "is_error": span.get("success") is False or "error" in span,
                "detail_json": detail,
            })
        return result

    @_background
    async def load_journal(self):
        """Load trade stats and equity data for journal page."""
        data = await asyncio.to_thread(self._fetch_journal_data)
        if data:
            async with self:
                stats, trades, breakdown = data
                self.journal_win_rate = f"{stats['win_rate']:.0f}%" if stats['total_trades'] > 0 else "—"
                # Real PnL from exchange (account_value - initial)
                if self.portfolio_value > 0 and self.portfolio_initial > 0:
                    real_pnl = self.portfolio_value - self.portfolio_initial
                    rsign = "+" if real_pnl >= 0 else ""
                    self.journal_total_pnl = f"{rsign}${real_pnl:.2f}"
                else:
                    self.journal_total_pnl = "—"
                # Recorded trade PnL from Nous (for reference)
                if stats['total_trades'] > 0:
                    rsign2 = "+" if stats['total_pnl'] >= 0 else ""
                    self.journal_recorded_pnl = f"{rsign2}${stats['total_pnl']:.2f}"
                else:
                    self.journal_recorded_pnl = "—"
                pf = stats['profit_factor']
                self.journal_profit_factor = f"{pf:.2f}" if pf != float('inf') else "∞" if stats['total_trades'] > 0 else "—"
                self.journal_total_trades = str(stats['total_trades'])
                self.journal_fee_losses       = str(stats.get('fee_losses', 0))
                self.journal_fee_heavy_count  = str(stats.get('fee_heavy_count', 0))
                total_fees = stats.get('total_fees', 0.0)
                self.journal_total_fees = f"-${total_fees:.2f}" if total_fees > 0 else "—"
                # Streaks
                streak = stats['current_streak']
                if streak > 0:
                    self.journal_current_streak = f"+{streak}W"
                elif streak < 0:
                    self.journal_current_streak = f"{streak}L"
                else:
                    self.journal_current_streak = "—"
                self.journal_max_win_streak = str(stats['max_win_streak'])
                self.journal_max_loss_streak = str(stats['max_loss_streak'])
                # Avg duration
                dur = stats['avg_duration_hours']
                if dur >= 24:
                    self.journal_avg_duration = f"{dur / 24:.1f}d"
                elif dur > 0:
                    self.journal_avg_duration = f"{dur:.1f}h"
                else:
                    self.journal_avg_duration = "—"
                self.closed_trades = trades
                self.symbol_breakdown = breakdown

        # Equity data — fetch immediately so chart isn't blank until poll loop fires
        eq_days = self.equity_days
        equity_data = await asyncio.to_thread(AppState._fetch_equity_data, eq_days)
        async with self:
            self.journal_equity_data = equity_data

        # Regret data (phantom tracker + playbooks from Nous)
        regret = await asyncio.to_thread(self._fetch_regret_data)
        if regret:
            phantoms = []
            for node in regret["missed"] + regret["good"]:
                try:
                    body = json.loads(node.get("content_body", "{}"))
                    sig = body.get("signals", {})
                    created = node.get("created_at", "")
                    date_str = created.split("T")[0] if "T" in created else created[:10]
                    headline = node.get("content_title", "")
                    node_id = node.get("id", "")
                    ep = float(sig.get("entry_price", 0) or sig.get("entry_px", 0) or 0)
                    xp = float(sig.get("exit_price", 0) or sig.get("exit_px", 0) or 0)
                    detail_html = _build_phantom_detail_html(sig, headline)
                    phantoms.append(PhantomRecord(
                        symbol=sig.get("symbol", "?"),
                        side=sig.get("side", "?"),
                        result=sig.get("result", "?"),
                        pnl_pct=round(float(sig.get("pnl_pct", 0)), 1),
                        anomaly_type=sig.get("anomaly_type", "?"),
                        category=sig.get("category", "?"),
                        date=date_str,
                        headline=headline,
                        phantom_id=node_id or f"p_{date_str}_{sig.get('symbol', '')}",
                        entry_px=ep,
                        exit_px=xp,
                        detail_html=detail_html,
                    ))
                except Exception:
                    continue
            # Sort newest first
            phantoms.sort(key=lambda p: p.date, reverse=True)

            pbs = []
            for node in regret["playbooks"]:
                try:
                    created = node.get("created_at", "")
                    date_str = created.split("T")[0] if "T" in created else created[:10]
                    body_raw = node.get("content_body", "")
                    # Body may be JSON or plain text
                    try:
                        body_data = json.loads(body_raw)
                        content = body_data.get("text", body_raw)
                    except (json.JSONDecodeError, TypeError):
                        content = body_raw
                    pbs.append(PlaybookRecord(
                        title=node.get("content_title", "Untitled"),
                        content=content or "",
                        date=date_str,
                    ))
                except Exception:
                    continue
            pbs.sort(key=lambda p: p.date, reverse=True)

            missed_count = sum(1 for p in phantoms if p.result == "missed_opportunity")
            good_count = sum(1 for p in phantoms if p.result == "good_pass")
            total = missed_count + good_count
            rate_pct = (missed_count / total * 100) if total > 0 else 0
            rate = f"{rate_pct:.0f}%" if total > 0 else "—"

            async with self:
                self.regret_phantoms = phantoms
                self.regret_playbooks = pbs
                self.regret_missed_count = str(missed_count)
                self.regret_good_pass_count = str(good_count)
                self.regret_miss_rate = rate
                self.regret_miss_rate_high = rate_pct >= 50

    @staticmethod
    def _fetch_journal_data():
        """Fetch journal data from trade analytics + Nous enrichment (sync, runs in thread)."""
        try:
            from hynous.core.trade_analytics import get_trade_stats
            stats = get_trade_stats()

            # Fetch raw close nodes from Nous for enrichment
            close_nodes_by_key: dict[tuple, dict] = {}
            nous_client = None
            try:
                from hynous.nous.client import get_client
                nous_client = get_client()
                if nous_client:
                    raw_nodes = nous_client.list_nodes(subtype="custom:trade_close", limit=500)
                    for node in raw_nodes:
                        try:
                            body = json.loads(node.get("content_body", "{}"))
                            sig = body.get("signals", {})
                            sym = sig.get("symbol", "")
                            created = node.get("created_at", "")
                            if sym and created:
                                # Key: (symbol, date prefix) for matching to TradeRecords
                                close_nodes_by_key[(sym, created[:16])] = node
                        except Exception:
                            continue
            except Exception:
                pass

            trades = []
            for t in stats.trades:
                dur_h = round(t.duration_hours, 1)
                if dur_h >= 24:
                    dur_str = f"{dur_h / 24:.1f}d"
                elif dur_h >= 1:
                    dur_str = f"{dur_h:.1f}h"
                elif dur_h > 0:
                    dur_str = f"{max(1, int(dur_h * 60))}m"
                else:
                    dur_str = "—"

                # Match to raw Nous node for enrichment
                enrichment = {}
                close_node = close_nodes_by_key.get((t.symbol, t.closed_at[:16]))
                if not close_node:
                    # Try broader match by symbol + date
                    for key, node in close_nodes_by_key.items():
                        if key[0] == t.symbol and key[1][:10] == t.closed_at[:10]:
                            close_node = node
                            break
                if close_node and nous_client:
                    enrichment = _enrich_trade(close_node, nous_client)

                detail_html = _build_trade_detail_html(enrichment) if enrichment else ""

                trades.append(ClosedTrade(
                    symbol=t.symbol,
                    side=t.side,
                    entry_px=t.entry_px,
                    exit_px=t.exit_px,
                    pnl_pct=round(t.pnl_pct, 2),
                    pnl_usd=round(t.pnl_usd, 2),
                    closed_at=t.closed_at,
                    close_type=t.close_type,
                    duration_hours=dur_h,
                    duration_str=dur_str,
                    date=t.closed_at.split("T")[0] if "T" in t.closed_at else t.closed_at[:10],
                    trade_id=enrichment.get("trade_id", f"{t.symbol}_{t.closed_at[:16]}"),
                    thesis=enrichment.get("thesis", ""),
                    stop_loss=enrichment.get("stop_loss", 0.0),
                    take_profit=enrichment.get("take_profit", 0.0),
                    confidence=enrichment.get("confidence", 0.0),
                    rr_ratio=enrichment.get("rr_ratio", 0.0),
                    trade_type=enrichment.get("trade_type", ""),
                    mfe_pct=enrichment.get("mfe_pct", 0.0),
                    mfe_usd=enrichment.get("mfe_usd") or t.mfe_usd,
                    mae_pct=enrichment.get("mae_pct", 0.0),
                    mae_usd=enrichment.get("mae_usd", 0.0),
                    lev_return_pct=enrichment.get("lev_return_pct") or t.lev_return_pct,
                    fee_loss=enrichment.get("fee_loss", False) or t.fee_loss,
                    fee_heavy=enrichment.get("fee_heavy", False) or t.fee_heavy,
                    fee_estimate=enrichment.get("fee_estimate") or t.fee_estimate,
                    pnl_gross=enrichment.get("pnl_gross") or t.pnl_gross,
                    leverage=enrichment.get("leverage") or t.leverage,
                    detail_html=detail_html,
                ))
            breakdown = [
                {
                    "symbol": sym,
                    "trades": d["trades"],
                    "win_rate": d["win_rate"],
                    "pnl": f"${d['pnl']:.2f}",
                    "pnl_positive": d["pnl"] >= 0,
                }
                for sym, d in sorted(stats.by_symbol.items())
            ]
            return (
                {
                    "win_rate": stats.win_rate,
                    "total_pnl": stats.total_pnl,
                    "profit_factor": stats.profit_factor,
                    "total_trades": stats.total_trades,
                    "current_streak": stats.current_streak,
                    "max_win_streak": stats.max_win_streak,
                    "max_loss_streak": stats.max_loss_streak,
                    "avg_duration_hours": stats.avg_duration_hours,
                    "fee_losses": stats.fee_losses,
                    "fee_heavy_count": stats.fee_heavy_count,
                    "total_fees": stats.total_fees,
                },
                trades,
                breakdown,
            )
        except Exception:
            return None

    @staticmethod
    def _fetch_regret_data() -> dict | None:
        """Fetch phantom + playbook data from Nous (sync, runs in thread)."""
        try:
            from hynous.nous.client import get_client
            client = get_client()
            if client is None:
                return None

            missed = client.list_nodes(subtype="custom:missed_opportunity", limit=500)
            good = client.list_nodes(subtype="custom:good_pass", limit=500)
            playbooks = client.list_nodes(subtype="custom:playbook", limit=30)

            return {"missed": missed, "good": good, "playbooks": playbooks}
        except Exception:
            return None
