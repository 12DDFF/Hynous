"""Standalone daemon runner for smoke tests and development.

In v1 the daemon runs in-process inside the Reflex dashboard
(scripts/run_dashboard.py). This script exists so phase smoke tests can
exercise the daemon subsystem without booting the full Reflex stack.

Usage:
    python -m scripts.run_daemon [--duration <seconds>]

By default runs until Ctrl-C. With --duration, exits cleanly after N seconds
(useful for automated smoke tests: ``timeout 300 python -m scripts.run_daemon``
is equivalent to ``python -m scripts.run_daemon --duration 300``).
"""

from __future__ import annotations

import argparse
import logging
import signal
import sys
import time
from typing import Any

logger = logging.getLogger(__name__)


def _setup_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-5s %(name)s: %(message)s",
        stream=sys.stdout,
    )


def _build_daemon() -> Any:
    """Construct the Daemon the same way the Reflex dashboard does.

    Returns the daemon instance. Imports happen inside the function so
    ``python -m scripts.run_daemon --help`` works without a full env.
    """
    from hynous.core.config import load_config
    from hynous.intelligence.daemon import Daemon

    cfg = load_config()
    logger.info("config loaded: mode=%s", cfg.execution.mode)

    daemon = Daemon(config=cfg)
    logger.info("daemon constructed")

    return daemon


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the Hynous daemon (standalone)")
    parser.add_argument(
        "--duration",
        type=int,
        default=0,
        help="Exit cleanly after N seconds (0 = run until Ctrl-C)",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    args = parser.parse_args()

    _setup_logging(getattr(logging, args.log_level))

    try:
        daemon = _build_daemon()
    except Exception:
        logger.exception("daemon construction failed")
        return 1

    # Graceful shutdown handler
    _stop = {"flag": False}

    def _handle_signal(signum: int, frame: Any) -> None:
        logger.info("received signal %s, stopping", signum)
        _stop["flag"] = True

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    # Start the daemon's internal loop
    if hasattr(daemon, "start"):
        try:
            daemon.start()
            logger.info("daemon.start() called")
        except Exception:
            logger.exception("daemon.start() failed")
            return 1

    # Idle heartbeat loop
    started = time.monotonic()
    last_heartbeat = started
    logger.info("daemon running (duration=%s)", args.duration or "infinite")

    try:
        while not _stop["flag"]:
            time.sleep(1)
            now = time.monotonic()
            if now - last_heartbeat >= 60:
                logger.info("heartbeat: %.0fs elapsed", now - started)
                last_heartbeat = now
            if args.duration > 0 and (now - started) >= args.duration:
                logger.info("duration reached, stopping")
                break
    except KeyboardInterrupt:
        logger.info("keyboard interrupt, stopping")

    # Graceful stop
    if hasattr(daemon, "stop"):
        try:
            daemon.stop()
            logger.info("daemon.stop() called")
        except Exception:
            logger.exception("daemon.stop() raised (continuing)")

    elapsed = time.monotonic() - started
    logger.info("run_daemon complete: %.0fs elapsed, no fatal errors", elapsed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
