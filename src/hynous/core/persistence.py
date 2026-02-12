"""
Chat Persistence

Save and load conversation state across server restarts.
Stores both UI messages (what the user sees) and agent history
(what the agent remembers for multi-turn context).

Storage: {project_root}/storage/chat.json
"""

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_STORAGE_DIR = Path(__file__).resolve().parents[3] / "storage"
_CHAT_FILE = _STORAGE_DIR / "chat.json"

_MAX_UI_MESSAGES = 200
_MAX_AGENT_HISTORY = 40


def _serialize_content(content: Any) -> Any:
    """Convert Anthropic SDK objects to JSON-serializable form.

    Agent history can contain ContentBlock objects (TextBlock, ToolUseBlock)
    from the Anthropic SDK. We strip to only the fields the API accepts
    on input — extra fields like parsed_output and citations cause errors.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for item in content:
            if isinstance(item, dict):
                out.append(_clean_block(item))
            elif hasattr(item, "type"):
                # SDK object — extract only the fields we need
                out.append(_clean_sdk_block(item))
            else:
                out.append(str(item))
        return out
    if hasattr(content, "type"):
        return _clean_sdk_block(content)
    return content


def _clean_sdk_block(block) -> dict:
    """Convert an SDK content block to a clean dict."""
    if block.type == "text":
        return {"type": "text", "text": block.text}
    elif block.type == "tool_use":
        return {"type": "tool_use", "id": block.id, "name": block.name, "input": block.input}
    elif block.type == "tool_result":
        d = {"type": "tool_result", "tool_use_id": block.tool_use_id, "content": block.content}
        if getattr(block, "is_error", False):
            d["is_error"] = True
        return d
    # Fallback
    return {"type": block.type}


def _clean_block(block: dict) -> dict:
    """Strip extra fields from a dict content block."""
    t = block.get("type")
    if t == "text":
        return {"type": "text", "text": block["text"]}
    elif t == "tool_use":
        return {"type": "tool_use", "id": block["id"], "name": block["name"], "input": block["input"]}
    elif t == "tool_result":
        d = {"type": "tool_result", "tool_use_id": block["tool_use_id"], "content": block["content"]}
        if block.get("is_error"):
            d["is_error"] = True
        return d
    return block


def save(ui_messages: list[dict] | None, agent_history: list[dict]) -> None:
    """Save UI messages and agent conversation history to disk.

    If ui_messages is None, the existing UI messages on disk are preserved
    (useful when the daemon saves agent history without touching the UI).
    """
    _STORAGE_DIR.mkdir(parents=True, exist_ok=True)

    # If no UI messages provided, keep what's on disk
    if ui_messages is None:
        try:
            existing = json.loads(_CHAT_FILE.read_text()) if _CHAT_FILE.exists() else {}
            ui_messages = existing.get("ui_messages", [])
        except Exception:
            ui_messages = []

    serialized_history = []
    for msg in agent_history[-_MAX_AGENT_HISTORY:]:
        entry = {
            "role": msg["role"],
            "content": _serialize_content(msg["content"]),
        }
        # Preserve OpenAI-format fields for tool calling
        if "tool_calls" in msg:
            entry["tool_calls"] = msg["tool_calls"]
        if "tool_call_id" in msg:
            entry["tool_call_id"] = msg["tool_call_id"]
        if msg.get("role") == "tool" and "name" in msg:
            entry["name"] = msg["name"]
        serialized_history.append(entry)

    data = {
        "ui_messages": ui_messages[-_MAX_UI_MESSAGES:],
        "agent_history": serialized_history,
    }

    try:
        _atomic_write(_CHAT_FILE, json.dumps(data, indent=2, default=str))
    except Exception as e:
        logger.error(f"Failed to save chat: {e}")


def load() -> tuple[list[dict], list[dict]]:
    """Load UI messages and agent history from disk.

    Returns (ui_messages, agent_history). Both empty if no file or error.
    """
    if not _CHAT_FILE.exists():
        return [], []

    try:
        data = json.loads(_CHAT_FILE.read_text())
        return data.get("ui_messages", []), data.get("agent_history", [])
    except Exception as e:
        logger.error(f"Failed to load chat: {e}")
        return [], []


def clear() -> None:
    """Delete saved chat history."""
    try:
        if _CHAT_FILE.exists():
            _CHAT_FILE.unlink()
        if _WAKE_LOG.exists():
            _WAKE_LOG.unlink()
    except Exception as e:
        logger.error(f"Failed to clear chat: {e}")


# ---- Persistent wake log ----
# Daemon writes wake messages here so they survive restarts and
# reach the dashboard even if the in-memory queue was lost.

_WAKE_LOG = _STORAGE_DIR / "wake_log.json"
_MAX_WAKE_LOG = 50  # Keep last N wake messages


def _atomic_write(path: Path, data: str) -> None:
    """Write to file atomically via temp file + rename."""
    import os
    import tempfile
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def append_wake(wake_type: str, title: str, response: str) -> None:
    """Append a daemon wake message to the persistent log (atomic write)."""
    _STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        entries = json.loads(_WAKE_LOG.read_text()) if _WAKE_LOG.exists() else []
    except Exception:
        entries = []
    from .clock import now as pacific_now
    t = pacific_now()
    tz = t.strftime("%Z").lower()
    ts = t.strftime("%I:%M %p").lstrip("0").lower() + f" {tz}"
    entries.append({
        "type": wake_type,
        "title": title,
        "response": response,
        "timestamp": ts,
    })
    entries = entries[-_MAX_WAKE_LOG:]
    try:
        _atomic_write(_WAKE_LOG, json.dumps(entries, default=str))
    except Exception as e:
        logger.error("Failed to write wake log: %s", e)


def drain_wake_log() -> list[dict]:
    """Read and clear the persistent wake log (atomic)."""
    if not _WAKE_LOG.exists():
        return []
    try:
        entries = json.loads(_WAKE_LOG.read_text())
        _atomic_write(_WAKE_LOG, "[]")
        return entries
    except Exception:
        return []
