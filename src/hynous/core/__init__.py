"""
Core - Shared Utilities

Foundation modules used throughout Hynous:
- config.py: Configuration loading and validation
- types.py: Shared type definitions
- errors.py: Custom exceptions
- logging.py: Logging setup

Usage:
    from hynous.core import Config, load_config
    config = load_config()
"""

from .config import Config, load_config
from . import clock
from . import persistence

__all__ = ["Config", "load_config", "clock", "persistence"]
