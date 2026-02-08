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


def save(ui_messages: list[dict], agent_history: list[dict]) -> None:
    """Save UI messages and agent conversation history to disk."""
    _STORAGE_DIR.mkdir(parents=True, exist_ok=True)

    serialized_history = []
    for msg in agent_history[-_MAX_AGENT_HISTORY:]:
        serialized_history.append({
            "role": msg["role"],
            "content": _serialize_content(msg["content"]),
        })

    data = {
        "ui_messages": ui_messages[-_MAX_UI_MESSAGES:],
        "agent_history": serialized_history,
    }

    try:
        _CHAT_FILE.write_text(json.dumps(data, indent=2, default=str))
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
    except Exception as e:
        logger.error(f"Failed to clear chat: {e}")
