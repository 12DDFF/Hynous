"""
Nous Server Manager — auto-start the TypeScript memory server.

Spawns the Nous server as a background subprocess if it isn't already running.
Called lazily when the agent first initializes, so `reflex run` brings everything up.

The server is stateless — SQLite DB on disk persists across restarts.
"""

import atexit
import logging
import os
import subprocess
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import requests

logger = logging.getLogger(__name__)

_process: Optional[subprocess.Popen] = None


def _is_running(url: str) -> bool:
    """Check if the Nous server is already responding."""
    try:
        resp = requests.get(f"{url}/v1/health", timeout=2)
        return resp.status_code == 200
    except requests.ConnectionError:
        return False


def _shutdown():
    """Terminate the server subprocess on exit."""
    global _process
    if _process and _process.poll() is None:
        logger.info("Shutting down Nous server (pid %d)", _process.pid)
        _process.terminate()
        try:
            _process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _process.kill()
        _process = None


def ensure_running() -> bool:
    """Ensure the Nous server is running. Spawns it if needed.

    Returns True if the server is reachable, False on failure.
    """
    global _process

    from ..core.config import load_config
    cfg = load_config()
    url = cfg.nous.url

    # Already running (externally or from a previous call)?
    if _is_running(url):
        return True

    # Already spawned but crashed?
    if _process and _process.poll() is not None:
        logger.warning("Nous server process exited (code %d), restarting", _process.returncode)
        _process = None

    # Already spawned and alive but not yet responding — wait below
    if _process and _process.poll() is None:
        pass
    else:
        # Spawn the server
        server_dir = Path(cfg.nous.server_dir).expanduser().resolve()
        if not (server_dir / "package.json").exists():
            logger.error("Nous server not found at %s", server_dir)
            return False

        # Extract port from configured URL so the server binds correctly.
        # Reflex sets PORT=3000 in the env — we must override it.
        port = str(urlparse(url).port or 3100)
        env = {**os.environ, "PORT": port}

        logger.info("Starting Nous server from %s (port %s)", server_dir, port)
        _process = subprocess.Popen(
            ["npx", "tsx", "src/index.ts"],
            cwd=str(server_dir),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        atexit.register(_shutdown)

    # Wait for the server to be ready (up to 10s)
    for i in range(20):
        time.sleep(0.5)
        if _is_running(url):
            logger.info("Nous server ready on %s", url)
            return True
        # Check if process died
        if _process and _process.poll() is not None:
            stderr = _process.stderr.read().decode() if _process.stderr else ""
            logger.error("Nous server failed to start: %s", stderr[:500])
            _process = None
            return False

    logger.error("Nous server did not become ready within 10s")
    return False
