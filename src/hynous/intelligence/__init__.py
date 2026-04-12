"""
Intelligence Layer

v2 contains:
- prompts/: System prompts (identity, trading knowledge)
- tools/: Tool definitions and handlers (audit pending — phase 5 M8 / phase 6)
- daemon.py: Background polling + mechanical entry/exit loop (no LLM)

The v1 ``Agent`` class (``agent.py``) was deleted in phase 5 M7. The only
LLM surface in v2 is the user-chat agent at :mod:`hynous.user_chat`.
"""
